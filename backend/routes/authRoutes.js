const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const generateFriendCode = require('../utils/generateFriendCode');

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    friendCode: user.friend_code,
    language: user.language,
  };
}

function issueToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

router.post('/register', async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  const displayName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : '';
  const language = typeof req.body.language === 'string' ? req.body.language.trim() : 'en';

  if (!emailPattern.test(email) || typeof password !== 'string' || password.length < 8 ||
      password.length > 128 || displayName.length < 1 || displayName.length > 60 ||
      language.length < 2 || language.length > 16) {
    return res.status(400).json({ error: 'Provide a valid email, password (8-128 characters), display name, and language.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await pool.query(
          `INSERT INTO users (email, password_hash, display_name, friend_code, language)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, email, display_name, friend_code, language`,
          [email, passwordHash, displayName, generateFriendCode(), language],
        );
        const user = result.rows[0];
        return res.status(201).json({ user: publicUser(user), token: issueToken(user) });
      } catch (error) {
        if (error.code === '23505' && error.constraint === 'users_friend_code_key') continue;
        if (error.code === '23505' && error.constraint === 'users_email_key') {
          return res.status(409).json({ error: 'An account with that email already exists.' });
        }
        throw error;
      }
    }
    throw new Error('Unable to allocate a unique friend code.');
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;

  if (!emailPattern.test(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'Provide a valid email and password.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, password_hash, display_name, friend_code, language FROM users WHERE email = $1',
      [email],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    return res.json({ user: publicUser(user), token: issueToken(user) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
