require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const pool = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const friendRoutes = require('./routes/friendRoutes');
const attachChatSocket = require('./sockets/chatSocket');
const { startDeletionWorker } = require('./queues/deletionQueue');
const { startMessageWorker } = require('./queues/messageQueue');

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET must be configured.');

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(server, { cors: { origin: allowedOrigin, methods: ['GET', 'POST'] } });
app.set('io', io);

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '32kb' }));

async function authenticate(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/friends', authenticate, friendRoutes);

app.use((error, req, res, next) => {
  console.error('Unhandled request error:', error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

attachChatSocket(io);
let workers = [];
const port = Number(process.env.PORT || 4000);

async function startServer() {
  await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ');
  await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ');
  await pool.query(
    'CREATE INDEX IF NOT EXISTS messages_scheduled_for_idx ON messages (scheduled_for) WHERE scheduled_for IS NOT NULL',
  );
  workers = [startDeletionWorker(io), startMessageWorker(io)];
  server.listen(port, () => {
    console.log(`Chat API listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error('Unable to start the chat API:', error);
  process.exitCode = 1;
});

async function shutdown() {
  server.close();
  await Promise.all(workers.map((worker) => worker.close()));
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
