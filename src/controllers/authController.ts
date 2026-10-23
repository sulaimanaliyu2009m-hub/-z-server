import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';

export const register = async (req: Request, res: Response) => {
  const { email, password, username, displayName } = req.body;
  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Missing required credentials' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already in use' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, username, display_name, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, username, display_name AS "displayName", avatar_url AS "avatarUrl", bio, created_at AS "createdAt"`,
      [email.toLowerCase(), username.toLowerCase(), displayName || username, hash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });

    res.status(201).json({ user: { ...user, followersCount: 0, followingCount: 0, followingIds: [] }, token });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT id, email, username, display_name AS "displayName", password_hash, avatar_url AS "avatarUrl", bio, created_at AS "createdAt" 
       FROM users WHERE email = $1`, 
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    delete user.password_hash;
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });

    // Fetch followings
    const followings = await pool.query('SELECT following_id FROM follows WHERE follower_id = $1', [user.id]);
    const followingIds = followings.rows.map(r => r.following_id);

    res.json({
      user: {
        ...user,
        followersCount: 0,
        followingCount: followingIds.length,
        followingIds
      },
      token
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};