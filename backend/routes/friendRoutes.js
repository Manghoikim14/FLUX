const express = require('express');
const pool = require('../config/db');

const router = express.Router();

router.post('/request', async (req, res, next) => {
  const friendCode = typeof req.body.friendCode === 'string'
    ? req.body.friendCode.trim().toUpperCase()
    : '';
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(friendCode)) {
    return res.status(400).json({ error: 'Enter a valid 8-character friend code.' });
  }

  try {
    const recipientResult = await pool.query(
      'SELECT id, display_name, friend_code, language FROM users WHERE friend_code = $1',
      [friendCode],
    );
    const recipient = recipientResult.rows[0];
    if (!recipient) return res.status(404).json({ error: 'No user has that friend code.' });
    if (recipient.id === req.user.id) return res.status(400).json({ error: 'You cannot add yourself.' });

    const [low, high] = [req.user.id, recipient.id].sort();
    const existing = await pool.query(
      'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
      [low, high],
    );
    if (existing.rowCount) return res.status(409).json({ error: 'You are already friends.' });

    const result = await pool.query(
      `INSERT INTO friend_requests (sender_id, recipient_id)
       VALUES ($1, $2)
       ON CONFLICT (sender_id, recipient_id) DO UPDATE
         SET status = 'pending', created_at = NOW()
       WHERE friend_requests.status = 'declined'
       RETURNING id, status`,
      [req.user.id, recipient.id],
    );
    if (!result.rowCount) return res.status(409).json({ error: 'A request is already pending or accepted.' });
    const senderResult = await pool.query(
      'SELECT display_name FROM users WHERE id = $1',
      [req.user.id],
    );
    const io = req.app.get('io');
    io.to(`user:${recipient.id}`).emit('notification:friend-request', {
      requestId: result.rows[0].id,
      from: { id: req.user.id, displayName: senderResult.rows[0].display_name },
      createdAt: new Date().toISOString(),
    });
    return res.status(201).json({
      request: result.rows[0],
      user: { id: recipient.id, displayName: recipient.display_name, language: recipient.language },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/requests', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT fr.id, fr.created_at, u.id AS user_id, u.display_name, u.friend_code
       FROM friend_requests fr
       JOIN users u ON u.id = fr.sender_id
       WHERE fr.recipient_id = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at`,
      [req.user.id],
    );
    return res.json({
      requests: result.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        user: { id: row.user_id, displayName: row.display_name, friendCode: row.friend_code },
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/requests/sent', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT fr.id, fr.created_at, fr.status,
              u.id AS user_id, u.display_name
       FROM friend_requests fr
       JOIN users u ON u.id = fr.recipient_id
       WHERE fr.sender_id = $1
       ORDER BY fr.created_at DESC
       LIMIT 50`,
      [req.user.id],
    );
    return res.json({
      requests: result.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        status: row.status,
        user: { id: row.user_id, displayName: row.display_name },
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/search/messages', async (req, res, next) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 100) {
    return res.status(400).json({ error: 'Search text must be between 2 and 100 characters.' });
  }

  try {
    const result = await pool.query(
      `SELECT m.id, m.sender_id, m.recipient_id, m.content, m.created_at, m.read_at,
              peer.id AS peer_id, peer.display_name AS peer_name
       FROM messages m
       JOIN users peer
         ON peer.id = CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END
       JOIN friendships f
         ON f.user_low = LEAST(m.sender_id, m.recipient_id)
        AND f.user_high = GREATEST(m.sender_id, m.recipient_id)
       WHERE (m.sender_id = $1 OR m.recipient_id = $1)
         AND (m.expires_at IS NULL OR m.expires_at > NOW())
         AND (m.scheduled_for IS NULL OR m.scheduled_for <= NOW())
         AND NOT EXISTS (
           SELECT 1
           FROM chat_history_clears history_clear
           WHERE history_clear.user_id = $1
             AND history_clear.peer_id = peer.id
             AND m.created_at <= history_clear.cleared_at
         )
         AND NOT EXISTS (
           SELECT 1
           FROM chat_message_hides message_hide
           WHERE message_hide.user_id = $1 AND message_hide.message_id = m.id
         )
         AND STRPOS(LOWER(m.content), LOWER($2)) > 0
       ORDER BY m.created_at DESC
       LIMIT 100`,
      [req.user.id, query],
    );

    return res.json({
      results: result.rows.map((row) => ({
        id: row.id,
        senderId: row.sender_id,
        recipientId: row.recipient_id,
        content: row.content,
        createdAt: row.created_at,
        readAt: row.read_at,
        peerId: row.peer_id,
        peerName: row.peer_name,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/requests/:requestId/accept', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, sender_id FROM friend_requests
       WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
       FOR UPDATE`,
      [req.params.requestId, req.user.id],
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending friend request not found.' });
    }

    const senderId = result.rows[0].sender_id;
    const [low, high] = [req.user.id, senderId].sort();
    await client.query(
      'INSERT INTO friendships (user_low, user_high) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [low, high],
    );
    await client.query(
      `UPDATE friend_requests SET status = 'accepted'
       WHERE id = $1 OR (sender_id = $2 AND recipient_id = $3 AND status = 'pending')`,
      [req.params.requestId, req.user.id, senderId],
    );
    await client.query('COMMIT');

    const userResult = await pool.query(
      'SELECT id, display_name, language FROM users WHERE id = ANY($1::uuid[])',
      [[senderId, req.user.id]],
    );
    const user = userResult.rows.find((row) => row.id === senderId);
    const acceptor = userResult.rows.find((row) => row.id === req.user.id);
    const io = req.app.get('io');
    io.to(`user:${req.user.id}`).emit('friends:updated');
    io.to(`user:${senderId}`).emit('friends:updated');
    io.to(`user:${senderId}`).emit('notification:friend-accepted', {
      peerId: req.user.id,
      displayName: acceptor.display_name,
      requestId: req.params.requestId,
      createdAt: new Date().toISOString(),
    });
    return res.json({ user: { id: user.id, displayName: user.display_name, language: user.language } });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.post('/requests/:requestId/reject', async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE friend_requests
       SET status = 'declined'
       WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
       RETURNING id, sender_id`,
      [req.params.requestId, req.user.id],
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Pending friend request not found.' });
    }

    const recipientResult = await pool.query(
      'SELECT display_name FROM users WHERE id = $1',
      [req.user.id],
    );
    const io = req.app.get('io');
    io.to(`user:${result.rows[0].sender_id}`).emit('notification:friend-rejected', {
      requestId: result.rows[0].id,
      peerId: req.user.id,
      displayName: recipientResult.rows[0].display_name,
      createdAt: new Date().toISOString(),
    });
    io.to(`user:${result.rows[0].sender_id}`).emit('friends:updated');
    return res.json({ requestId: result.rows[0].id, status: 'declined' });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.display_name, u.language,
              latest_message.content AS last_message,
              latest_message.created_at AS last_message_time
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_low = $1 THEN f.user_high ELSE f.user_low END
       LEFT JOIN LATERAL (
         SELECT m.content, m.created_at
         FROM messages m
         WHERE ((m.sender_id = $1 AND m.recipient_id = u.id)
             OR (m.sender_id = u.id AND m.recipient_id = $1))
           AND (m.expires_at IS NULL OR m.expires_at > NOW())
           AND (m.scheduled_for IS NULL OR m.scheduled_for <= NOW())
           AND NOT EXISTS (
             SELECT 1
             FROM chat_history_clears history_clear
             WHERE history_clear.user_id = $1
               AND history_clear.peer_id = u.id
               AND m.created_at <= history_clear.cleared_at
           )
           AND NOT EXISTS (
             SELECT 1
             FROM chat_message_hides message_hide
             WHERE message_hide.user_id = $1 AND message_hide.message_id = m.id
           )
         ORDER BY m.created_at DESC
         LIMIT 1
       ) latest_message ON TRUE
       WHERE f.user_low = $1 OR f.user_high = $1
       ORDER BY latest_message.created_at DESC NULLS LAST, u.display_name`,
      [req.user.id],
    );
    return res.json({
      friends: result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        language: row.language,
        lastMessage: row.last_message || '',
        lastMessageTime: row.last_message_time,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:friendId/messages', async (req, res, next) => {
  const friendId = req.params.friendId.toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(friendId)) {
    return res.status(400).json({ error: 'Invalid friend ID.' });
  }
  if (friendId === req.user.id) {
    return res.status(400).json({ error: 'You cannot clear a chat with yourself.' });
  }

  try {
    const [low, high] = [req.user.id, friendId].sort();
    const friendship = await pool.query(
      'SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2',
      [low, high],
    );
    if (!friendship.rowCount) {
      return res.status(404).json({ error: 'Friendship not found.' });
    }

    const result = await pool.query(
      `INSERT INTO chat_history_clears (user_id, peer_id, cleared_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, peer_id)
       DO UPDATE SET cleared_at = EXCLUDED.cleared_at
       RETURNING cleared_at`,
      [req.user.id, friendId],
    );
    req.app.get('io').to(`user:${req.user.id}`).emit('chat:history-cleared', {
      peerId: friendId,
      clearedAt: result.rows[0].cleared_at,
    });
    return res.json({ peerId: friendId, clearedAt: result.rows[0].cleared_at });
  } catch (error) {
    next(error);
  }
});

router.delete('/:friendId', async (req, res, next) => {
  const friendId = req.params.friendId.toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(friendId)) {
    return res.status(400).json({ error: 'Invalid friend ID.' });
  }

  try {
    const [low, high] = [req.user.id, friendId].sort();
    const result = await pool.query(
      'DELETE FROM friendships WHERE user_low = $1 AND user_high = $2 RETURNING user_low',
      [low, high],
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Friendship not found.' });
    }

    const io = req.app.get('io');
    io.to(`user:${req.user.id}`).emit('friends:updated');
    io.to(`user:${friendId}`).emit('friends:updated');
    return res.json({ friendId });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
