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
const configuredOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isPrivateIPv4(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets;
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    first === 127;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;

  try {
    const url = new URL(origin);
    return url.protocol === 'http:' &&
      url.port === '5173' &&
      (url.hostname === 'localhost' || isPrivateIPv4(url.hostname));
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  methods: ['GET', 'POST'],
};
const io = new Server(server, { cors: corsOptions });
app.set('io', io);

app.use(cors(corsOptions));
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
const host = process.env.HOST || '0.0.0.0';

async function startServer() {
  await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ');
  await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ');
  await pool.query(
    `CREATE TABLE IF NOT EXISTS chat_history_clears (
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       peer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       cleared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (user_id, peer_id),
       CHECK (user_id <> peer_id)
     )`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS chat_message_hides (
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
       hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (user_id, message_id)
     )`,
  );
  await pool.query(
    'ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL',
  );
  await pool.query(
    'ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN NOT NULL DEFAULT FALSE',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS messages_scheduled_for_idx ON messages (scheduled_for) WHERE scheduled_for IS NOT NULL',
  );
  workers = [startDeletionWorker(io), startMessageWorker(io)];
  server.listen(port, host, () => {
    console.log(`Chat API listening on ${host}:${port}`);
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
