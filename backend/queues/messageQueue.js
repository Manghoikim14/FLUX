const pool = require('../config/db');

async function scheduleMessage({ senderId, recipientId, content, scheduledFor, ttlSeconds }) {
  const scheduledAt = new Date(scheduledFor);
  const delay = scheduledAt.getTime() - Date.now();
  if (!Number.isFinite(delay) || delay < 1000 || delay > 30 * 24 * 60 * 60 * 1000) {
    throw new Error('Scheduled time must be between 1 second and 30 days from now.');
  }

  const result = await pool.query(
    `INSERT INTO messages (sender_id, recipient_id, content, scheduled_for, expires_at)
     VALUES (
       $1, $2, $3, $4,
       CASE WHEN $5::integer > 0
         THEN $4::timestamptz + ($5::integer * INTERVAL '1 second')
         ELSE NULL
       END
     )
     RETURNING id, sender_id, recipient_id, content, created_at,
               read_at, scheduled_for, expires_at`,
    [senderId, recipientId, content, scheduledAt, ttlSeconds],
  );
  return toClientMessage(result.rows[0]);
}

async function deliverDueMessages(io) {
  const client = await pool.connect();
  let delivered;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE messages AS message
       SET scheduled_for = NULL
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
                 message.expires_at`,
    );
    delivered = result.rows;

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

    if (row.expires_at) {
      const ttlSeconds = Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000);
      if (ttlSeconds > 0) {
        try {
          const { scheduleDeletion } = require('./deletionQueue');
          await scheduleDeletion(row.id, ttlSeconds);
        } catch (error) {
          console.error(`Unable to schedule deletion for message ${row.id}:`, error);
        }
      }
    }
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
    scheduledFor: message.scheduled_for,
    expiresAt: message.expires_at,
  };
}

module.exports = { scheduleMessage, startMessageWorker, toClientMessage };
