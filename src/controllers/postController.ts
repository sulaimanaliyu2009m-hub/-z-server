import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';
import { redis } from '../config/redis';

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[a-zA-Z0-9_]+/g);
  return matches ? Array.from(new Set(matches.map(t => t.slice(1).toLowerCase()))) : [];
}

export const createPost = async (req: AuthRequest, res: Response) => {
  const { type, content, mediaUrl, thumbnailUrl } = req.body;
  const userId = req.user?.id;

  if (!content) return res.status(400).json({ error: 'Content is required' });

  try {
    const result = await pool.query(
      `INSERT INTO posts (user_id, post_type, content, media_url, thumbnail_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id AS "userId", post_type AS "type", content, media_url AS "mediaUrl", 
                 thumbnail_url AS "thumbnailUrl", created_at AS "createdAt"`,
      [userId, type || 'text', content, mediaUrl || null, thumbnailUrl || null]
    );

    const post = result.rows[0];

    // Extract and track hashtags in PostgreSQL & Redis
    const tags = extractHashtags(content);
    for (const tag of tags) {
      const tagRes = await pool.query(
        `INSERT INTO hashtags (tag) VALUES ($1) ON CONFLICT (tag) DO UPDATE SET tag = EXCLUDED.tag RETURNING id`,
        [tag]
      );
      const tagId = tagRes.rows[0].id;
      await pool.query(
        `INSERT INTO post_hashtags (post_id, hashtag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [post.id, tagId]
      );

      // Increment Redis 24-hour trending counter
      try {
        await redis.zincrby('trending:hashtags:24h', 1, tag);
        await redis.expire('trending:hashtags:24h', 86400);
      } catch {}
    }

    // Invalidate Feed Cache
    try { await redis.del('feed:global'); } catch {}

    const userRes = await pool.query('SELECT username, display_name, avatar_url FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];

    res.status(201).json({
      ...post,
      authorName: user.display_name,
      authorUsername: user.username,
      authorAvatar: user.avatar_url,
      hashtags: tags,
      likesCount: 0,
      comments: [],
      isLiked: false
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getFeed = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const cacheKey = 'feed:global';

  try {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    } catch {}

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
      ORDER BY p.created_at DESC
      LIMIT 50;
    `;
    const { rows } = await pool.query(query, [userId]);

    const postsWithDetails = await Promise.all(rows.map(async (p) => {
      const commRes = await pool.query(`
        SELECT c.id, c.content AS text, c.created_at AS "createdAt", u.username, c.parent_id AS "parentId"
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = $1 ORDER BY c.created_at ASC
      `, [p.id]);

      const topLevel: any[] = [];
      const replyMap: { [key: string]: any[] } = {};
      commRes.rows.forEach(c => {
        if (c.parentId) {
          replyMap[c.parentId] = replyMap[c.parentId] || [];
          replyMap[c.parentId].push(c);
        } else {
          c.replies = [];
          topLevel.push(c);
        }
      });
      topLevel.forEach(c => c.replies = replyMap[c.id] || []);

      return { ...p, comments: topLevel, hashtags: extractHashtags(p.content) };
    }));

    try { await redis.setex(cacheKey, 15, JSON.stringify(postsWithDetails)); } catch {}

    res.json(postsWithDetails);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
