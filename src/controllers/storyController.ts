import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';
import { redis } from '../config/redis';

// 1. Fetch all active stories grouped by user
export const getActiveStories = async (req: AuthRequest, res: Response) => {
  const cacheKey = 'stories:active';

  try {
    // Check Redis cache first
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    } catch {}

    const query = `
      SELECT 
        s.id, s.user_id AS "userId", s.media_type AS "mediaType", s.media_url AS "mediaUrl",
        s.text_overlay AS "textOverlay", s.filter_style AS "filterStyle",
        s.created_at AS "createdAt", s.expires_at AS "expiresAt",
        u.username, u.display_name AS "displayName", u.avatar_url AS "avatarUrl"
      FROM stories s
      JOIN users u ON s.user_id = u.id
      WHERE s.expires_at > NOW()
      ORDER BY s.created_at ASC;
    `;
    const { rows } = await pool.query(query);

    // Group stories by user
    const groupedMap = new Map<string, any>();
    rows.forEach(story => {
      if (!groupedMap.has(story.userId)) {
        groupedMap.set(story.userId, {
          userId: story.userId,
          username: story.username,
          displayName: story.displayName,
          avatarUrl: story.avatarUrl,
          stories: []
        });
      }
      groupedMap.get(story.userId).stories.push(story);
    });

    const result = Array.from(groupedMap.values());

    // Cache in Redis for 60 seconds (with 24hr individual keys)
    try { await redis.setex(cacheKey, 60, JSON.stringify(result)); } catch {}

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 2. Create a new story with 24-hour Redis TTL
export const createStory = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { mediaType, mediaUrl, textOverlay, filterStyle } = req.body;

  if (!mediaUrl) {
    return res.status(400).json({ error: 'Media is required for a story' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO stories (user_id, media_type, media_url, text_overlay, filter_style)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id AS "userId", media_type AS "mediaType", media_url AS "mediaUrl",
                 text_overlay AS "textOverlay", filter_style AS "filterStyle",
                 created_at AS "createdAt", expires_at AS "expiresAt"`,
      [userId, mediaType || 'image', mediaUrl, textOverlay || '', filterStyle || 'normal']
    );

    const story = result.rows[0];

    // Cache this story in Redis with strict 24-hour TTL (86400 seconds)
    try {
      await redis.setex(`story:${story.id}`, 86400, JSON.stringify(story));
      await redis.del('stories:active'); // Invalidate grouped cache
    } catch {}

    const userRes = await pool.query('SELECT username, display_name, avatar_url FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];

    res.status(201).json({
      ...story,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
