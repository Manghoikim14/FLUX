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

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '32kb' }));

function authenticate(req, res, next) {
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
const workers = [startDeletionWorker(io), startMessageWorker(io)];
const port = Number(process.env.PORT || 4000);

server.listen(port, () => {
  console.log(`Chat API listening on port ${port}`);
});

async function shutdown() {
  server.close();
  await Promise.all(workers.map((worker) => worker.close()));
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
