import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';
import { recommendationClient } from '../services/recommendationClient';
import { videoServiceClient } from '../services/videoServiceClient';

export const getForYouFeed = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;

  try {
    // 1. Try Go high-speed feed cache first
    const fastFeed = await videoServiceClient.getFastFeed();
    if (fastFeed && fastFeed.length > 0) {
      return res.json(fastFeed);
    }

    // 2. Fall back to Python Recommender (or SQL fallback)
    const rankedIds = await recommendationClient.getRankedVideoIds(userId || '', 30);

    if (rankedIds.length === 0) {
      return res.json([]);
    }

    const query = `
      SELECT 
        p.id, p.user_id AS "userId", p.post_type AS "type", p.content, p.media_url AS "mediaUrl", 
        p.thumbnail_url AS "thumbnailUrl", p.created_at AS "createdAt",
        u.display_name AS "authorName", u.username AS "authorUsername", u.avatar_url AS "authorAvatar",
        COALESCE(l.likes_count, 0)::int AS "likesCount",
        EXISTS(SELECT 1 FROM likes WHERE user_id = $1 AND post_id = p.id) AS "isLiked"
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN (SELECT post_id, COUNT(*) AS likes_count FROM likes GROUP BY post_id) l ON l.post_id = p.id
      WHERE p.id = ANY($2::uuid[]);
    `;
    const { rows } = await pool.query(query, [userId, rankedIds]);
    const sorted = rankedIds.map(id => rows.find(r => r.id === id)).filter(Boolean);

    // Warm Go service feed cache in background
    videoServiceClient.syncFeedCache(sorted);

    res.json(sorted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const recordWatchTime = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { postId, watchSeconds, completionRate } = req.body;

  if (!postId) return res.status(400).json({ error: 'postId is required' });

  // 1. Send to high-speed Go service for atomic view counting
  videoServiceClient.recordView(postId, userId);

  // 2. Save watch history to PostgreSQL for recommendation training
  try {
    await pool.query(
      `INSERT INTO video_views (user_id, post_id, watch_seconds, completion_rate)
       VALUES ($1, $2, $3, $4)`,
      [userId, postId, watchSeconds || 0, Math.min(completionRate || 0, 1.0)]
    );
    res.json({ tracked: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
