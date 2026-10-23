import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';

// 1. Report Post or User
export const reportContent = async (req: AuthRequest, res: Response) => {
  const reporterId = req.user?.id;
  const { reportedPostId, reportedUserId, reason, details } = req.body;

  if (!reason) {
    return res.status(400).json({ error: 'Reporting reason is required' });
  }

  try {
    await pool.query(
      `INSERT INTO content_reports (reporter_id, reported_post_id, reported_user_id, reason, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [reporterId, reportedPostId || null, reportedUserId || null, reason, details || '']
    );
    res.status(201).json({ message: 'Report submitted for review. Thank you for keeping Z safe.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 2. Block / Unblock User
export const toggleBlockUser = async (req: AuthRequest, res: Response) => {
  const blockerId = req.user?.id;
  const { targetUserId } = req.body;

  if (blockerId === targetUserId) {
    return res.status(400).json({ error: 'You cannot block yourself' });
  }

  try {
    const existing = await pool.query(
      'SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [blockerId, targetUserId]
    );

    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, targetUserId]);
      res.json({ blocked: false, message: 'User unblocked' });
    } else {
      await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)', [blockerId, targetUserId]);
      // Remove follows automatically when blocking
      await pool.query('DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)', [blockerId, targetUserId]);
      res.json({ blocked: true, message: 'User blocked' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
