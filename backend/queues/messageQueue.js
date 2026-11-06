const { Queue, Worker } = require('bullmq');
const pool = require('../config/db');
const redisConnection = require('../config/redis');

const queue = new Queue('scheduled-messages', { connection: redisConnection() });

async function scheduleMessage({ senderId, recipientId, content, scheduledFor, ttlSeconds }) {
  const delay = new Date(scheduledFor).getTime() - Date.now();
  if (!Number.isFinite(delay) || delay < 1000 || delay > 30 * 24 * 60 * 60 * 1000) {
    throw new Error('Scheduled time must be between 1 second and 30 days from now.');
  }
  const job = await queue.add(
    'deliver',
    { senderId, recipientId, content, ttlSeconds },
    { delay, removeOnComplete: true, removeOnFail: 1000 },
  );
  return job.id;
}

function startMessageWorker(io) {
  const worker = new Worker('scheduled-messages', async (job) => {
    const { senderId, recipientId, content, ttlSeconds } = job.data;
    const [low, high] = [senderId, recipientId].sort();
    const friendship = await pool.query(
      'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
      [low, high],
    );
    if (!friendship.rowCount) return;

    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, content, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, sender_id, recipient_id, content, created_at, expires_at`,
      [senderId, recipientId, content, expiresAt],
    );
    const message = result.rows[0];
    const roomId = [senderId, recipientId].sort().join(':');
    io.to(roomId).emit('chat:message', toClientMessage(message));
    io.to(`user:${recipientId}`).emit('notification:new-message', {
      messageId: message.id,
      peerId: senderId,
      preview: message.content.slice(0, 100),
    });
    if (ttlSeconds) {
      const { scheduleDeletion } = require('./deletionQueue');
      await scheduleDeletion(message.id, ttlSeconds);
    }
  }, { connection: redisConnection() });

  worker.on('failed', (job, error) => {
    console.error(`Scheduled message job ${job ? job.id : 'unknown'} failed:`, error);
  });
  return worker;
}

function toClientMessage(message) {
  return {
    id: message.id,
    senderId: message.sender_id,
    recipientId: message.recipient_id,
    content: message.content,
    createdAt: message.created_at,
    readAt: message.read_at,
    expiresAt: message.expires_at,
  };
}

module.exports = { queue, scheduleMessage, startMessageWorker, toClientMessage };
