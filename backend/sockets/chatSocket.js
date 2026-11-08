const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { scheduleMessage, toClientMessage } = require('../queues/messageQueue');

const onlineSockets = new Map();

function roomIdFor(firstId, secondId) {
  return [firstId, secondId].sort().join(':');
}

async function getFriendIds(userId) {
  const result = await pool.query(
    `SELECT CASE WHEN user_low = $1 THEN user_high ELSE user_low END AS friend_id
     FROM friendships
     WHERE user_low = $1 OR user_high = $1`,
    [userId],
  );
  return result.rows.map((row) => row.friend_id);
}

function attachChatSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required.'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.sub;
      return next();
    } catch (error) {
      return next(new Error('Invalid or expired authentication token.'));
    }
  });

  io.on('connection', (socket) => {
    socket.data.peers = new Map();
    socket.join(`user:${socket.userId}`);

    let userSockets = onlineSockets.get(socket.userId);
    const isFirstConnection = !userSockets;
    if (!userSockets) {
      userSockets = new Set();
      onlineSockets.set(socket.userId, userSockets);
    }
    userSockets.add(socket.id);

    async function sendPresenceSnapshot(broadcastOnline = false) {
      try {
        const friendIds = await getFriendIds(socket.userId);
        socket.emit('presence:sync', {
          onlineFriendIds: friendIds.filter((friendId) => onlineSockets.has(friendId)),
        });
        if (broadcastOnline && onlineSockets.get(socket.userId)?.has(socket.id)) {
          friendIds.forEach((friendId) => {
            io.to(`user:${friendId}`).emit('presence:update', {
              userId: socket.userId,
              isOnline: true,
            });
          });
        }
      } catch (error) {
        console.error('Unable to sync friend presence:', error);
      }
    }

    sendPresenceSnapshot(isFirstConnection);

    socket.on('presence:sync', sendPresenceSnapshot);

    socket.on('chat:join', async ({ peerId } = {}, acknowledge = () => {}) => {
      try {
        if (typeof peerId !== 'string' || peerId === socket.userId) {
          return acknowledge({ error: 'A valid friend is required.' });
        }
        const [low, high] = [socket.userId, peerId].sort();
        const friendship = await pool.query(
          'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
          [low, high],
        );
        if (!friendship.rowCount) return acknowledge({ error: 'You are not connected to this user.' });

        const roomId = roomIdFor(socket.userId, peerId);
        socket.join(roomId);
        socket.data.peers.set(roomId, peerId);
        const history = await pool.query(
          `SELECT m.id, m.sender_id, m.recipient_id, m.content, m.created_at, m.read_at,
                  m.scheduled_for, m.expires_at, m.reply_to_id, m.is_forwarded,
                  replied.content AS reply_to_content
           FROM messages m
           LEFT JOIN messages replied ON replied.id = m.reply_to_id
           LEFT JOIN chat_history_clears history_clear
             ON history_clear.user_id = $1 AND history_clear.peer_id = $2
           WHERE ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
             AND (m.expires_at IS NULL OR m.expires_at > NOW())
             AND (m.scheduled_for IS NULL OR m.scheduled_for <= NOW() OR m.sender_id = $1)
             AND (history_clear.cleared_at IS NULL OR m.created_at > history_clear.cleared_at)
             AND NOT EXISTS (
               SELECT 1 FROM chat_message_hides message_hide
               WHERE message_hide.user_id = $1 AND message_hide.message_id = m.id
             )
           ORDER BY m.created_at DESC LIMIT 100`,
          [socket.userId, peerId],
        );
        return acknowledge({ roomId, messages: history.rows.reverse().map(toClientMessage) });
      } catch (error) {
        console.error('Unable to join chat:', error);
        return acknowledge({ error: 'Unable to load this conversation.' });
      }
    });

    socket.on('chat:read', async ({ peerId } = {}) => {
      try {
        const roomId = roomIdFor(socket.userId, peerId || '');
        if (typeof peerId !== 'string') return;

        const [low, high] = [socket.userId, peerId].sort();
        const friendship = await pool.query(
          'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
          [low, high],
        );
        if (!friendship.rowCount) return;

        const result = await pool.query(
          `UPDATE messages AS message SET read_at = NOW()
           WHERE message.sender_id = $1 AND message.recipient_id = $2 AND message.read_at IS NULL
             AND (message.scheduled_for IS NULL OR message.scheduled_for <= NOW())
             AND (message.expires_at IS NULL OR message.expires_at > NOW())
             AND NOT EXISTS (
               SELECT 1
               FROM chat_history_clears history_clear
               WHERE history_clear.user_id = $2
                 AND history_clear.peer_id = $1
                 AND message.created_at <= history_clear.cleared_at
             )
             AND NOT EXISTS (
               SELECT 1
               FROM chat_message_hides message_hide
               WHERE message_hide.user_id = $2 AND message_hide.message_id = message.id
             )
           RETURNING message.id, message.read_at`,
          [peerId, socket.userId],
        );
        if (result.rowCount) {
          io.to(`user:${peerId}`).emit('chat:read', {
            messageIds: result.rows.map((row) => row.id),
            readAt: result.rows[0].read_at,
          });
        }
      } catch (error) {
        console.error('Unable to mark chat messages as read:', error);
      }
    });

    socket.on('chat:send', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { peerId, content, ttlSeconds, replyToId, forwarded } = payload;
        if (typeof peerId !== 'string' || peerId === socket.userId) {
          return acknowledge({ error: 'Invalid recipient.' });
        }
        if (typeof content !== 'string' || !content.trim() || content.length > 4000) {
          return acknowledge({ error: 'Message must contain 1-4000 characters.' });
        }

        const ttl = Number(ttlSeconds) || 0;
        const maxTtl = Number(process.env.MESSAGE_MAX_TTL_SECONDS || 604800);
        if (!Number.isInteger(ttl) || ttl < 0 || (ttl > 0 && ttl < 10) || ttl > maxTtl) {
          return acknowledge({ error: `Expiry must be 0 or between 10 and ${maxTtl} seconds.` });
        }
        
        const [low, high] = [socket.userId, peerId].sort();
        const friendship = await pool.query(
          'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
          [low, high],
        );
        if (!friendship.rowCount) return acknowledge({ error: 'You are not connected to this user.' });

        let replyToContent = null;
        if (replyToId != null) {
          if (typeof replyToId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(replyToId)) {
            return acknowledge({ error: 'Invalid replied-to message.' });
          }
          const replied = await pool.query(
            `SELECT content FROM messages
             WHERE id = $1
               AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))
               AND (expires_at IS NULL OR expires_at > NOW())`,
            [replyToId, socket.userId, peerId],
          );
          if (!replied.rowCount) return acknowledge({ error: 'The message you replied to is no longer available.' });
          replyToContent = replied.rows[0].content;
        }

        const roomId = roomIdFor(socket.userId, peerId);
        socket.join(roomId);
        socket.data.peers.set(roomId, peerId);

        const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : null;
        const result = await pool.query(
          `INSERT INTO messages (sender_id, recipient_id, content, expires_at, reply_to_id, is_forwarded)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, sender_id, recipient_id, content, created_at, expires_at, reply_to_id, is_forwarded`,
          [socket.userId, peerId, content.trim(), expiresAt, replyToId || null, forwarded === true],
        );
        const message = toClientMessage({ ...result.rows[0], reply_to_content: replyToContent });

        io.to(roomId).emit('chat:message', message);
        io.to(`user:${peerId}`).emit('notification:new-message', {
          messageId: message.id,
          peerId: socket.userId,
          preview: message.content.slice(0, 100),
          createdAt: message.createdAt,
        });
        return acknowledge({ message });
      } catch (error) {
        console.error('Unable to send chat message:', error);
        return acknowledge({ error: 'Message could not be sent.' });
      }
    });

    socket.on('chat:schedule', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { peerId, content, scheduledFor, ttlSeconds, replyToId } = payload;
        if (typeof peerId !== 'string' || peerId === socket.userId) {
          return acknowledge({ error: 'Invalid recipient.' });
        }
        if (typeof content !== 'string' || !content.trim() || content.length > 4000) {
          return acknowledge({ error: 'Message must contain 1-4000 characters.' });
        }
        const ttl = Number(ttlSeconds) || 0;
        const maxTtl = Number(process.env.MESSAGE_MAX_TTL_SECONDS || 604800);
        if (!Number.isInteger(ttl) || ttl < 0 || (ttl > 0 && ttl < 10) || ttl > maxTtl) {
          return acknowledge({ error: `Expiry must be 0 or between 10 and ${maxTtl} seconds.` });
        }
        const [low, high] = [socket.userId, peerId].sort();
        const friendship = await pool.query(
          'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
          [low, high],
        );
        if (!friendship.rowCount) return acknowledge({ error: 'You are not connected to this user.' });

        let replyToContent = null;
        if (replyToId != null) {
          if (typeof replyToId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(replyToId)) {
            return acknowledge({ error: 'Invalid replied-to message.' });
          }
          const replied = await pool.query(
            `SELECT content FROM messages
             WHERE id = $1
               AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))
               AND (expires_at IS NULL OR expires_at > NOW())`,
            [replyToId, socket.userId, peerId],
          );
          if (!replied.rowCount) return acknowledge({ error: 'The message you replied to is no longer available.' });
          replyToContent = replied.rows[0].content;
        }

        const roomId = roomIdFor(socket.userId, peerId);
        socket.join(roomId);
        socket.data.peers.set(roomId, peerId);

        const message = await scheduleMessage({
          senderId: socket.userId,
          recipientId: peerId,
          content: content.trim(),
          scheduledFor,
          ttlSeconds: ttl,
          replyToId,
          replyToContent,
        });
        return acknowledge({ scheduled: true, message });
      } catch (error) {
        if (error.message && error.message.startsWith('Scheduled time')) {
          return acknowledge({ error: error.message });
        }
        console.error('Unable to schedule chat message:', error);
        return acknowledge({ error: 'Message could not be scheduled.' });
      }
    });

    socket.on('chat:delete-message', async ({ messageId, forEveryone } = {}, acknowledge = () => {}) => {
      try {
        if (typeof messageId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(messageId)) {
          return acknowledge({ error: 'Invalid message.' });
        }
        const result = await pool.query(
          `SELECT id, sender_id, recipient_id
           FROM messages
           WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)
             AND (expires_at IS NULL OR expires_at > NOW())`,
          [messageId, socket.userId],
        );
        const message = result.rows[0];
        if (!message) return acknowledge({ error: 'Message not found.' });
        const peerId = message.sender_id === socket.userId ? message.recipient_id : message.sender_id;
        const [low, high] = [socket.userId, peerId].sort();
        const friendship = await pool.query(
          'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
          [low, high],
        );
        if (!friendship.rowCount) return acknowledge({ error: 'You are not connected to this user.' });

        if (forEveryone) {
          if (message.sender_id !== socket.userId) {
            return acknowledge({ error: 'You can only delete your own messages for everyone.' });
          }
          await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);
          io.to(roomIdFor(socket.userId, peerId))
            .to(`user:${socket.userId}`)
            .to(`user:${peerId}`)
            .emit('chat:message-deleted', {
              id: messageId,
              senderId: socket.userId,
              recipientId: peerId,
            });
        } else {
          await pool.query(
            `INSERT INTO chat_message_hides (user_id, message_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, message_id) DO NOTHING`,
            [socket.userId, messageId],
          );
          io.to(`user:${socket.userId}`).emit('chat:message-hidden', {
            id: messageId,
            peerId,
          });
        }
        return acknowledge({ deleted: true });
      } catch (error) {
        console.error('Unable to delete chat message:', error);
        return acknowledge({ error: 'Message could not be deleted.' });
      }
    });

    socket.on('document:join', async ({ peerId } = {}, acknowledge = () => {}) => {
      try {
        const roomId = roomIdFor(socket.userId, peerId || '');
        const documentRoom = `document:${roomId}`;
        socket.join(documentRoom);
        const result = await pool.query(
          `INSERT INTO collaborative_documents (room_id) VALUES ($1)
           ON CONFLICT (room_id) DO UPDATE SET room_id = EXCLUDED.room_id
           RETURNING content`,
          [roomId],
        );
        return acknowledge({ content: result.rows[0].content });
      } catch (error) {
        console.error('Unable to load collaborative document:', error);
        return acknowledge({ error: 'Unable to load the shared document.' });
      }
    });

    socket.on('document:update', async ({ peerId, content } = {}, acknowledge = () => {}) => {
      try {
        const roomId = roomIdFor(socket.userId, peerId || '');
        if (typeof content !== 'string' || content.length > 20000) {
          return acknowledge({ error: 'Document must be 20000 characters or fewer.' });
        }
        await pool.query(
          `INSERT INTO collaborative_documents (room_id, content, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (room_id) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
          [roomId, content],
        );
        socket.to(`document:${roomId}`).emit('document:updated', { content });
        return acknowledge({ saved: true });
      } catch (error) {
        console.error('Unable to save collaborative document:', error);
        return acknowledge({ error: 'Document could not be saved.' });
      }
    });

    socket.on('disconnect', () => {
      const currentSockets = onlineSockets.get(socket.userId);
      currentSockets?.delete(socket.id);
      if (currentSockets?.size) return;
      onlineSockets.delete(socket.userId);

      getFriendIds(socket.userId)
        .then((friendIds) => {
          if (!onlineSockets.has(socket.userId)) {
            friendIds.forEach((friendId) => {
              io.to(`user:${friendId}`).emit('presence:update', {
                userId: socket.userId,
                isOnline: false,
              });
            });
          }
        })
        .catch((error) => console.error('Unable to broadcast friend presence:', error));
    });
  });
}

module.exports = attachChatSocket;