const pool = require('../config/db');

function startDeletionWorker(io) {
  let isPolling = false;
  let activePoll = Promise.resolve();

  const poll = () => {
    if (isPolling) return;
    isPolling = true;
    activePoll = pool.query(
      `DELETE FROM messages AS message
       USING (
         SELECT id
         FROM messages
         WHERE expires_at IS NOT NULL AND expires_at <= NOW()
         ORDER BY expires_at
         LIMIT 100
         FOR UPDATE SKIP LOCKED
       ) AS expired
       WHERE message.id = expired.id
       RETURNING message.id, message.sender_id, message.recipient_id`,
    ).then((result) => {
      for (const row of result.rows) {
        const roomId = [row.sender_id, row.recipient_id].sort().join(':');
        io.to(roomId)
          .to(`user:${row.sender_id}`)
          .to(`user:${row.recipient_id}`)
          .emit('chat:message-deleted', {
            id: row.id,
            senderId: row.sender_id,
            recipientId: row.recipient_id,
          });
        io.to(`user:${row.sender_id}`).emit('notification:message-deleted', {
          messageId: row.id,
          peerId: row.recipient_id,
          deletedAt: new Date().toISOString(),
        });
      }
    }).catch((error) => {
      console.error('Unable to delete expired messages:', error);
    }).finally(() => {
      isPolling = false;
    });
  };

  poll();
  const interval = setInterval(poll, 1000);

  return {
    async close() {
      clearInterval(interval);
      await activePoll;
    }
  };
}

module.exports = { startDeletionWorker };
