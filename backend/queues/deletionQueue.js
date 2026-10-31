const { Queue, Worker } = require('bullmq');
const pool = require('../config/db');
const redisConnection = require('../config/redis');

const queue = new Queue('message-deletions', { connection: redisConnection() });

async function scheduleDeletion(messageId, ttlSeconds) {
  await queue.add(
    'delete',
    { messageId },
    { delay: ttlSeconds * 1000, removeOnComplete: true, removeOnFail: 1000 },
  );
}

function startDeletionWorker(io) {
  const worker = new Worker('message-deletions', async (job) => {
    const result = await pool.query(
      'DELETE FROM messages WHERE id = $1 RETURNING sender_id, recipient_id',
      [job.data.messageId],
    );
    if (result.rowCount) {
      const roomId = [result.rows[0].sender_id, result.rows[0].recipient_id].sort().join(':');
      io.to(roomId).emit('chat:message-deleted', { id: job.data.messageId });
    }
  }, { connection: redisConnection() });

  worker.on('failed', (job, error) => {
    console.error(`Message deletion job ${job ? job.id : 'unknown'} failed:`, error);
  });
  return worker;
}

module.exports = { queue, scheduleDeletion, startDeletionWorker };
