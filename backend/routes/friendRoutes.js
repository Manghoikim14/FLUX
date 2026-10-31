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
      'SELECT id, display_name, language FROM users WHERE id = $1',
      [senderId],
    );
    const user = userResult.rows[0];
    return res.json({ user: { id: user.id, displayName: user.display_name, language: user.language } });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.display_name, u.language
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_low = $1 THEN f.user_high ELSE f.user_low END
       WHERE f.user_low = $1 OR f.user_high = $1
       ORDER BY u.display_name`,
      [req.user.id],
    );
    return res.json({
      friends: result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        language: row.language,
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
