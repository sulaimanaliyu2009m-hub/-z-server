import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryWithRetry } from '../config/db';

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Please enter both your email and password.' });
  }

  try {
    const result = await queryWithRetry(
      'SELECT id, email, username, display_name, password_hash, avatar_url FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Incorrect email or password. Please try again.' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Incorrect email or password. Please try again.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET || 'z_production_jwt_secret_2026_super_safe',
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (err: any) {
    console.error('❌ [Login Error]:', err);
    return res.status(503).json({ error: 'The authentication server is temporarily unavailable. Please try again.' });
  }
}

export async function register(req: Request, res: Response) {
  const { email, username, displayName, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ error: 'Email, username, and password are required.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await queryWithRetry(
      `INSERT INTO users (email, username, display_name, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, username, display_name, avatar_url`,
      [email, username, displayName || username, passwordHash]
    );

    const newUser = result.rows[0];
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, username: newUser.username },
      process.env.JWT_SECRET || 'z_production_jwt_secret_2026_super_safe',
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user: newUser,
    });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with that email or username already exists.' });
    }
    console.error('❌ [Register Error]:', err);
    return res.status(503).json({ error: 'The registration server is temporarily unavailable. Please try again.' });
  }
}
