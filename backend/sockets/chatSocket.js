const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { scheduleDeletion } = require('../queues/deletionQueue');
const { scheduleMessage, toClientMessage } = require('../queues/messageQueue');

function roomIdFor(firstId, secondId) {
  return [firstId, secondId].sort().join(':');
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
          `SELECT id, sender_id, recipient_id, content, created_at, expires_at
           FROM messages
           WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
             AND (expires_at IS NULL OR expires_at > NOW())
             AND (scheduled_for IS NULL OR scheduled_for <= NOW())
           ORDER BY created_at DESC LIMIT 100`,
          [socket.userId, peerId],
        );
        return acknowledge({ roomId, messages: history.rows.reverse().map(toClientMessage) });
      } catch (error) {
        console.error('Unable to join chat:', error);
        return acknowledge({ error: 'Unable to load this conversation.' });
      }
    });

    socket.on('chat:send', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { peerId, content, ttlSeconds } = payload;
        const roomId = roomIdFor(socket.userId, peerId || '');
        if (socket.data.peers.get(roomId) !== peerId) {
          return acknowledge({ error: 'Join this conversation before sending messages.' });
        }
        if (typeof content !== 'string' || !content.trim() || content.length > 4000) {
          return acknowledge({ error: 'Message must contain 1-4000 characters.' });
        }

        const ttl = Number(ttlSeconds) || 0;
        const maxTtl = Number(process.env.MESSAGE_MAX_TTL_SECONDS || 604800);
        if (!Number.isInteger(ttl) || ttl < 0 || (ttl > 0 && ttl < 10) || ttl > maxTtl) {
          return acknowledge({ error: `Expiry must be 0 or between 10 and ${maxTtl} seconds.` });
        }
        const friendship = await pool.query(
          'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
          [[socket.userId, peerId].sort()[0], [socket.userId, peerId].sort()[1]],
        );
        if (!friendship.rowCount) return acknowledge({ error: 'You are not connected to this user.' });

        const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : null;
        const result = await pool.query(
          `INSERT INTO messages (sender_id, recipient_id, content, expires_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id, sender_id, recipient_id, content, created_at, expires_at`,
          [socket.userId, peerId, content.trim(), expiresAt],
        );
        const message = toClientMessage(result.rows[0]);
        const { scheduleDeletion: enqueueDeletion } = require('../queues/deletionQueue');
        if (ttl) await enqueueDeletion(message.id, ttl);
        io.to(roomId).emit('chat:message', message);
        io.to(`user:${peerId}`).emit('notification:new-message', {
          messageId: message.id,
          peerId: socket.userId,
          preview: message.content.slice(0, 100),
        });
        return acknowledge({ message });
      } catch (error) {
        console.error('Unable to send chat message:', error);
        return acknowledge({ error: 'Message could not be sent.' });
      }
    });

    socket.on('chat:schedule', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { peerId, content, scheduledFor, ttlSeconds } = payload;
        const roomId = roomIdFor(socket.userId, peerId || '');
        if (socket.data.peers.get(roomId) !== peerId) {
          return acknowledge({ error: 'Join this conversation before scheduling messages.' });
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
        const jobId = await scheduleMessage({
          senderId: socket.userId,
          recipientId: peerId,
          content: content.trim(),
          scheduledFor,
          ttlSeconds: ttl,
        });
        return acknowledge({ scheduled: true, jobId });
      } catch (error) {
        if (error.message.startsWith('Scheduled time')) {
          return acknowledge({ error: error.message });
        }
        console.error('Unable to schedule chat message:', error);
        return acknowledge({ error: 'Message could not be scheduled.' });
      }
    });

    socket.on('document:join', async ({ peerId } = {}, acknowledge = () => {}) => {
      try {
        const roomId = roomIdFor(socket.userId, peerId || '');
        if (socket.data.peers.get(roomId) !== peerId) {
          return acknowledge({ error: 'Join this conversation before opening its document.' });
        }
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
        if (socket.data.peers.get(roomId) !== peerId || !socket.rooms.has(`document:${roomId}`)) {
          return acknowledge({ error: 'Join this shared document before editing.' });
        }
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
  });
}

module.exports = attachChatSocket;
