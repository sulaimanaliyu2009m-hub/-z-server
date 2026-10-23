import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';
import { checkCommentSafety } from './aiController';

export const toggleLike = async (req: AuthRequest, res: Response) => {
  const { id: postId } = req.params;
  const userId = req.user?.id;

  try {
    const existing = await pool.query('SELECT id FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
      res.json({ liked: false });
    } else {
      await pool.query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [userId, postId]);
      res.json({ liked: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const addComment = async (req: AuthRequest, res: Response) => {
  const { id: postId } = req.params;
  const { text, parentId } = req.body;
  const userId = req.user?.id;

  if (!text || !text.trim()) return res.status(400).json({ error: 'Comment text required' });

  // 1. Gemini AI Safety & Moderation Check
  const safety = await checkCommentSafety(text.trim());
  if (!safety.isSafe) {
    return res.status(400).json({
      error: `Comment blocked by Z AI Safety: ${safety.reason || 'Violated community guidelines (toxicity/spam).'}`
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO comments (user_id, post_id, parent_id, content) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, content AS text, created_at AS "createdAt"`,
      [userId, postId, parentId || null, text.trim()]
    );
    res.status(201).json({ ...result.rows[0], username: req.user?.username, replies: [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const toggleFollow = async (req: AuthRequest, res: Response) => {
  const { id: targetId } = req.params;
  const userId = req.user?.id;

  if (targetId === userId) return res.status(400).json({ error: 'Cannot follow yourself' });

  try {
    const exists = await pool.query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [userId, targetId]);
    if (exists.rows.length > 0) {
      await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [userId, targetId]);
      res.json({ following: false });
    } else {
      await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [userId, targetId]);
      res.json({ following: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
