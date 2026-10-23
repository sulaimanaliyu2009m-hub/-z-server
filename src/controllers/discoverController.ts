import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';
import { redis } from '../config/redis';

// 1. Unified Search (People, Posts, Hashtags via PostgreSQL FTS)
export const search = async (req: AuthRequest, res: Response) => {
  const { q } = req.query;
  const userId = req.user?.id;

  if (!q || typeof q !== 'string' || !q.trim()) {
    return res.json({ people: [], posts: [], hashtags: [] });
  }

  const queryTerm = q.trim();

  try {
    // Search People (FTS + prefix match)
    const peopleRes = await pool.query(`
      SELECT id, username, display_name AS "displayName", avatar_url AS "avatarUrl", bio,
             EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = users.id) AS "isFollowing"
      FROM users
      WHERE id <> $1
        AND (
          to_tsvector('simple', username || ' ' || display_name || ' ' || COALESCE(bio, '')) @@ plainto_tsquery('simple', $2)
          OR username ILIKE $3 OR display_name ILIKE $3
        )
      LIMIT 10;
    `, [userId, queryTerm, `%${queryTerm}%`]);

    // Search Posts (FTS + ILIKE fallback)
    const postsRes = await pool.query(`
      SELECT p.id, p.user_id AS "userId", p.post_type AS "type", p.content, p.media_url AS "mediaUrl", 
             p.thumbnail_url AS "thumbnailUrl", p.created_at AS "createdAt",
             u.display_name AS "authorName", u.username AS "authorUsername", u.avatar_url AS "authorAvatar",
             COALESCE(l.likes_count, 0)::int AS "likesCount",
             EXISTS(SELECT 1 FROM likes WHERE user_id = $1 AND post_id = p.id) AS "isLiked"
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN (SELECT post_id, COUNT(*) AS likes_count FROM likes GROUP BY post_id) l ON l.post_id = p.id
      WHERE to_tsvector('english', p.content) @@ plainto_tsquery('english', $2)
         OR p.content ILIKE $3
      ORDER BY p.created_at DESC
      LIMIT 15;
    `, [userId, queryTerm, `%${queryTerm}%`]);

    // Search Hashtags
    const cleanTag = queryTerm.replace(/^#/, '');
    const tagsRes = await pool.query(`
      SELECT h.tag, COUNT(ph.post_id)::int AS "postCount"
      FROM hashtags h
      JOIN post_hashtags ph ON h.id = ph.hashtag_id
      WHERE h.tag ILIKE $1
      GROUP BY h.tag
      ORDER BY "postCount" DESC
      LIMIT 8;
    `, [`%${cleanTag}%`]);

    res.json({
      people: peopleRes.rows,
      posts: postsRes.rows,
      hashtags: tagsRes.rows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 2. "Trending Now" Hashtags in the Last 24 Hours (Redis + PostgreSQL fallback)
export const getTrendingHashtags = async (req: AuthRequest, res: Response) => {
  try {
    // 1. Try Redis 24h sorted set
    try {
      const redisTop = await redis.zrevrange('trending:hashtags:24h', 0, 9, 'WITHSCORES');
      if (redisTop && redisTop.length > 0) {
        const trends = [];
        for (let i = 0; i < redisTop.length; i += 2) {
          trends.push({ tag: redisTop[i], count: parseInt(redisTop[i + 1], 10) });
        }
        return res.json(trends);
      }
    } catch {}

    // 2. PostgreSQL 24-hour fallback
    const query = `
      SELECT h.tag, COUNT(ph.post_id)::int AS count
      FROM hashtags h
      JOIN post_hashtags ph ON h.id = ph.hashtag_id
      JOIN posts p ON ph.post_id = p.id
      WHERE p.created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY h.tag
      ORDER BY count DESC
      LIMIT 10;
    `;
    const { rows } = await pool.query(query);

    // Warm Redis cache
    for (const r of rows) {
      try { await redis.zadd('trending:hashtags:24h', r.count, r.tag); } catch {}
    }

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 3. Suggested People to Follow
export const getSuggestedUsers = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  try {
    const query = `
      SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url AS "avatarUrl", u.bio,
             (SELECT COUNT(*)::int FROM follows WHERE following_id = u.id) AS "followersCount"
      FROM users u
      WHERE u.id <> $1
        AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = $1)
      ORDER BY "followersCount" DESC, u.created_at DESC
      LIMIT 8;
    `;
    const { rows } = await pool.query(query, [userId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 4. Hashtag Page Feed (Get all posts for a given hashtag)
export const getPostsByHashtag = async (req: AuthRequest, res: Response) => {
  const { tag } = req.params;
  const userId = req.user?.id;
  const cleanTag = tag.replace(/^#/, '').toLowerCase();

  try {
    const query = `
      SELECT p.id, p.user_id AS "userId", p.post_type AS "type", p.content, p.media_url AS "mediaUrl", 
             p.thumbnail_url AS "thumbnailUrl", p.created_at AS "createdAt",
             u.display_name AS "authorName", u.username AS "authorUsername", u.avatar_url AS "authorAvatar",
             COALESCE(l.likes_count, 0)::int AS "likesCount",
             EXISTS(SELECT 1 FROM likes WHERE user_id = $1 AND post_id = p.id) AS "isLiked"
      FROM posts p
      JOIN users u ON p.user_id = u.id
      JOIN post_hashtags ph ON ph.post_id = p.id
      JOIN hashtags h ON h.id = ph.hashtag_id
      LEFT JOIN (SELECT post_id, COUNT(*) AS likes_count FROM likes GROUP BY post_id) l ON l.post_id = p.id
      WHERE h.tag = $2
      ORDER BY p.created_at DESC;
    `;
    const { rows } = await pool.query(query, [userId, cleanTag]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
