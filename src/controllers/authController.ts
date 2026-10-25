import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { executeQueryWithRetry } from '../config/db';

export const register = async (req: Request, res: Response) => {
  const { email, password, username, displayName } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Email, password, and username are required.' });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();

    const existing = await executeQueryWithRetry(
      'SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1',
      [normalizedEmail, normalizedUsername]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email or username already exists.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await executeQueryWithRetry(
      `INSERT INTO users (email, username, display_name, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, username, display_name AS "displayName", avatar_url AS "avatarUrl", bio, created_at AS "createdAt"`,
      [normalizedEmail, normalizedUsername, displayName?.trim() || normalizedUsername, hash]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || 'z_production_jwt_secret_2026_super_safe',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      user: {
        ...user,
        followersCount: 0,
        followingCount: 0,
        followingIds: [],
        interests: [],
      },
      token,
    });
  } catch (err: any) {
    console.error('❌ Registration Error:', err.message);
    res.status(500).json({ error: 'Registration failed due to a server error. Please try again.' });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();

    // Fast indexed email lookup with follower counts included in a single query
    const result = await executeQueryWithRetry(
      `SELECT 
         u.id, u.email, u.username, u.display_name AS "displayName", u.password_hash,
         u.avatar_url AS "avatarUrl", u.bio, u.interests, u.created_at AS "createdAt",
         COALESCE((SELECT array_agg(following_id) FROM follows WHERE follower_id = u.id), '{}') AS "followingIds",
         COALESCE((SELECT COUNT(*)::int FROM follows WHERE following_id = u.id), 0) AS "followersCount"
       FROM users u 
       WHERE u.email = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    delete user.password_hash;

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || 'z_production_jwt_secret_2026_super_safe',
      { expiresIn: '7d' }
    );

    res.json({
      user: {
        ...user,
        followingCount: (user.followingIds || []).length,
      },
      token,
    });
  } catch (err: any) {
    console.error('❌ Login Error:', err.message);
    res.status(500).json({ error: 'Unable to connect to your account right now. Please try again in a moment.' });
  }
};
