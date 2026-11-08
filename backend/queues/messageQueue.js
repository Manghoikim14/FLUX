const pool = require('../config/db');

async function scheduleMessage({ senderId, recipientId, content, scheduledFor, ttlSeconds, replyToId, replyToContent }) {
  const scheduledAt = new Date(scheduledFor);
  const delay = scheduledAt.getTime() - Date.now();
  if (!Number.isFinite(delay) || delay < 1000 || delay > 30 * 24 * 60 * 60 * 1000) {
    throw new Error('Scheduled time must be between 1 second and 30 days from now.');
  }

  const result = await pool.query(
    `INSERT INTO messages (sender_id, recipient_id, content, scheduled_for, expires_at, reply_to_id)
     VALUES (
       $1, $2, $3, $4,
       CASE WHEN $5::integer > 0
         THEN $4::timestamptz + ($5::integer * INTERVAL '1 second')
         ELSE NULL
       END, $6
     )
     RETURNING id, sender_id, recipient_id, content, created_at,
               read_at, scheduled_for, expires_at, reply_to_id, is_forwarded`,
    [senderId, recipientId, content, scheduledAt, ttlSeconds, replyToId || null],
  );
  return toClientMessage({ ...result.rows[0], reply_to_content: replyToContent || null });
}

async function deliverDueMessages(io) {
  const client = await pool.connect();
  let delivered;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE messages AS message
       SET scheduled_for = NULL,
           created_at = NOW()
       WHERE message.id IN (
         SELECT candidate.id
         FROM messages AS candidate
         WHERE candidate.scheduled_for <= NOW()
           AND (candidate.expires_at IS NULL OR candidate.expires_at > NOW())
           AND EXISTS (
             SELECT 1
             FROM friendships
             WHERE user_low = LEAST(candidate.sender_id, candidate.recipient_id)
               AND user_high = GREATEST(candidate.sender_id, candidate.recipient_id)
           )
         ORDER BY candidate.scheduled_for
         LIMIT 50
         FOR UPDATE SKIP LOCKED
       )
       RETURNING message.id, message.sender_id, message.recipient_id,
                 message.content, message.created_at, message.read_at,
                 message.reply_to_id, message.is_forwarded,
                 message.expires_at`,
    );
    delivered = result.rows;
    if (delivered.length) {
      const replyResults = await client.query(
        `SELECT message.id, replied.content AS reply_to_content
         FROM messages message
         LEFT JOIN messages replied ON replied.id = message.reply_to_id
         WHERE message.id = ANY($1::uuid[])`,
        [delivered.map((message) => message.id)],
      );
      const replyByMessageId = new Map(
        replyResults.rows.map((row) => [row.id, row.reply_to_content]),
      );
      delivered = delivered.map((message) => ({
        ...message,
        reply_to_content: replyByMessageId.get(message.id) || null,
      }));
    }

    await client.query(
      `DELETE FROM messages AS message
       WHERE message.id IN (
         SELECT candidate.id
         FROM messages AS candidate
         WHERE candidate.scheduled_for <= NOW()
           AND (
             (candidate.expires_at IS NOT NULL AND candidate.expires_at <= NOW())
             OR NOT EXISTS (
               SELECT 1
               FROM friendships
               WHERE user_low = LEAST(candidate.sender_id, candidate.recipient_id)
                 AND user_high = GREATEST(candidate.sender_id, candidate.recipient_id)
             )
           )
         ORDER BY candidate.scheduled_for
         LIMIT 50
         FOR UPDATE SKIP LOCKED
       )`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  for (const row of delivered) {
    const message = toClientMessage(row);
    const roomId = [row.sender_id, row.recipient_id].sort().join(':');
    io.to(roomId).emit('chat:message', message);
    io.to(`user:${row.recipient_id}`).emit('notification:new-message', {
      messageId: row.id,
      peerId: row.sender_id,
      preview: row.content.slice(0, 100),
      createdAt: row.created_at,
    });
    io.to(`user:${row.sender_id}`).emit('notification:scheduled-message-sent', {
      messageId: row.id,
      peerId: row.recipient_id,
      createdAt: new Date().toISOString(),
    });
  }
}

function startMessageWorker(io) {
  let isPolling = false;
  let activePoll = Promise.resolve();

  const poll = () => {
    if (isPolling) return;
    isPolling = true;
    activePoll = deliverDueMessages(io)
      .catch((error) => {
        console.error('Unable to deliver scheduled messages:', error);
      })
      .finally(() => {
        isPolling = false;
      });
  };

  poll();
  const interval = setInterval(poll, 1000);

  return {
    async close() {
      clearInterval(interval);
      await activePoll;
    },
  };
}

function toClientMessage(message) {
  return {
    id: message.id,
    senderId: message.sender_id,
    recipientId: message.recipient_id,
    content: message.content,
    createdAt: message.created_at,
    readAt: message.read_at,
    replyToId: message.reply_to_id,
    replyToContent: message.reply_to_content,
    forwarded: message.is_forwarded,
    scheduledFor: message.scheduled_for,
    expiresAt: message.expires_at,
  };
}

module.exports = { scheduleMessage, startMessageWorker, toClientMessage };
