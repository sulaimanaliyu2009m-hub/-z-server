import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';
import { redis } from '../config/redis';
import { io } from '../index';

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[a-zA-Z0-9_]+/g);
  return matches ? Array.from(new Set(matches.map(t => t.slice(1).toLowerCase()))) : [];
}

// 1. Fetch 280-char Live Feed (with Quotes and Reposts)
export const getLivePosts = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  try {
    const query = `
      SELECT 
        p.id, p.user_id AS "userId", p.content, p.media_url AS "mediaUrl", p.created_at AS "createdAt",
        p.quote_of_id AS "quoteOfId", p.is_repost AS "isRepost", p.repost_of_id AS "repostOfId",
        u.display_name AS "authorName", u.username AS "authorUsername", u.avatar_url AS "authorAvatar",
        COALESCE(l.likes_count, 0)::int AS "likesCount",
        COALESCE(r.reposts_count, 0)::int AS "repostsCount",
        EXISTS(SELECT 1 FROM likes WHERE user_id = $1 AND post_id = p.id) AS "isLiked",
        EXISTS(SELECT 1 FROM reposts WHERE user_id = $1 AND post_id = p.id) AS "isReposted",
        -- Quoted post subquery
        (
          SELECT json_build_object(
            'id', qp.id, 'content', qp.content, 'createdAt', qp.created_at,
            'authorName', qu.display_name, 'authorUsername', qu.username, 'authorAvatar', qu.avatar_url
          )
          FROM posts qp
          JOIN users qu ON qp.user_id = qu.id
          WHERE qp.id = p.quote_of_id
        ) AS "quotedPost"
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN (SELECT post_id, COUNT(*) AS likes_count FROM likes GROUP BY post_id) l ON l.post_id = p.id
      LEFT JOIN (SELECT post_id, COUNT(*) AS reposts_count FROM reposts GROUP BY post_id) r ON r.post_id = p.id
      WHERE LENGTH(p.content) <= 280
      ORDER BY p.created_at DESC
      LIMIT 40;
    `;
    const { rows } = await pool.query(query, [userId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 2. Create Live Post (Limit 280 chars) & Publish to Redis Stream + Socket.IO
export const createLivePost = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { content, quoteOfId } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (content.trim().length > 280) {
    return res.status(400).json({ error: 'Post exceeds 280 character limit' });
  }

  try {
    const postRes = await pool.query(
      `INSERT INTO posts (user_id, post_type, content, quote_of_id)
       VALUES ($1, 'text', $2, $3)
       RETURNING id, user_id AS "userId", post_type AS "type", content, quote_of_id AS "quoteOfId", created_at AS "createdAt"`,
      [userId, content.trim(), quoteOfId || null]
    );

    const post = postRes.rows[0];

    // Track hashtags in PostgreSQL and Redis
    const tags = extractHashtags(content);
    for (const tag of tags) {
      await redis.zincrby('trending:hashtags:24h', 1, tag);
    }

    const userRes = await pool.query('SELECT username, display_name, avatar_url FROM users WHERE id = $1', [userId]);
    const u = userRes.rows[0];

    // Fetch quoted post if present
    let quotedPost = null;
    if (quoteOfId) {
      const qRes = await pool.query(`
        SELECT qp.id, qp.content, qp.created_at AS "createdAt",
               qu.display_name AS "authorName", qu.username AS "authorUsername", qu.avatar_url AS "authorAvatar"
        FROM posts qp JOIN users qu ON qp.user_id = qu.id WHERE qp.id = $1
      `, [quoteOfId]);
      quotedPost = qRes.rows[0] || null;
    }

    const fullPost = {
      ...post,
      authorName: u.display_name,
      authorUsername: u.username,
      authorAvatar: u.avatar_url,
      likesCount: 0,
      repostsCount: 0,
      commentsCount: 0,
      isLiked: false,
      isReposted: false,
      quotedPost
    };

    // 1. Publish to Redis Stream
    try {
      await redis.xadd('stream:live_posts', '*', 'postId', post.id, 'data', JSON.stringify(fullPost));
    } catch {}

    // 2. Broadcast immediately over WebSockets
    io.emit('live_stream_new_post', fullPost);

    res.status(201).json(fullPost);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 3. Instant Repost (Retweet)
export const toggleRepost = async (req: AuthRequest, res: Response) => {
  const { id: postId } = req.params;
  const userId = req.user?.id;

  try {
    const exists = await pool.query('SELECT id FROM reposts WHERE user_id = $1 AND post_id = $2', [userId, postId]);
    if (exists.rows.length > 0) {
      await pool.query('DELETE FROM reposts WHERE user_id = $1 AND post_id = $2', [userId, postId]);
      res.json({ reposted: false });
    } else {
      await pool.query('INSERT INTO reposts (user_id, post_id) VALUES ($1, $2)', [userId, postId]);
      res.json({ reposted: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
