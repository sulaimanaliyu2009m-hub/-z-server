import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { queryWithRetry, pool } from '../config/db';
import { redis } from '../config/redis';

/**
 * GET /api/users/u/:identifier
 * Retrieves a user profile by username or UUID with relative follow states
 */
export async function getProfile(req: AuthRequest, res: Response) {
  const { identifier } = req.params;
  const viewerId = req.user?.id || null;

  try {
    await queryWithRetry(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(100) DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS website VARCHAR(255) DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false;
    `);
    // 1. Fetch user profile + follow metrics + viewer state
    const userQuery = `
      SELECT 
        u.id, 
        u.username, 
        u.display_name, 
        u.avatar_url, 
        u.cover_url, 
        u.bio, 
        u.location, 
        u.website, 
        u.is_verified, 
        u.is_private,
        u.created_at,
        (SELECT COUNT(*)::int FROM follows WHERE following_id = u.id AND status = 'accepted') AS followers_count,
        (SELECT COUNT(*)::int FROM follows WHERE follower_id = u.id AND status = 'accepted') AS following_count,
        (SELECT COUNT(*)::int FROM posts WHERE user_id = u.id) AS posts_count,
        CASE 
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1 FROM follows 
            WHERE follower_id = $2::uuid AND following_id = u.id AND status = 'accepted'
          )
        END AS is_following,
        CASE 
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1 FROM follows 
            WHERE follower_id = $2::uuid AND following_id = u.id AND status = 'pending'
          )
        END AS is_requested,
        CASE 
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1 FROM follows 
            WHERE follower_id = u.id AND following_id = $2::uuid AND status = 'accepted'
          )
        END AS follows_you,
        CASE 
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1 FROM blocks 
            WHERE (blocker_id = $2::uuid AND blocked_id = u.id) 
               OR (blocker_id = u.id AND blocked_id = $2::uuid)
          )
        END AS is_blocked
      FROM users u
      WHERE (LOWER(u.username) = LOWER($1) OR u.id::text = $1)
      LIMIT 1;
    `;

    const userResult = await queryWithRetry(userQuery, [identifier, viewerId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    const profile = userResult.rows[0];

    if (profile.is_blocked) {
      return res.status(403).json({ error: 'You are blocked or have blocked this user.' });
    }

    // Determine mutual follow state
    let followStatus: 'none' | 'following' | 'requested' | 'friends' | 'follow_back' = 'none';
    if (profile.is_requested) {
      followStatus = 'requested';
    } else if (profile.is_following && profile.follows_you) {
      followStatus = 'friends';
    } else if (profile.is_following) {
      followStatus = 'following';
    } else if (profile.follows_you) {
      followStatus = 'follow_back';
    }

    // 2. Fetch posts if viewer is allowed (public OR following OR self)
    const isSelf = viewerId && viewerId === profile.id;
    const canViewPosts = !profile.is_private || profile.is_following || isSelf;

    let posts: any[] = [];
    if (canViewPosts) {
      const postsQuery = `
        SELECT 
          p.id, 
          p.user_id, 
          p.post_type, 
          p.content, 
          p.media_url, 
          p.thumbnail_url, 
          p.created_at,
          (SELECT COUNT(*)::int FROM likes WHERE post_id = p.id) AS likes_count,
          (SELECT COUNT(*)::int FROM comments WHERE post_id = p.id) AS comments_count,
          CASE 
            WHEN $2::uuid IS NULL THEN false
            ELSE EXISTS (SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $2::uuid)
          END AS is_liked
        FROM posts p
        WHERE p.user_id = $1
        ORDER BY p.created_at DESC
        LIMIT 30;
      `;
      const postsResult = await queryWithRetry(postsQuery, [profile.id, viewerId]);
      posts = postsResult.rows;
    }

    return res.status(200).json({
      profile: {
        ...profile,
        followStatus,
      },
      posts,
      canViewPosts,
    });
  } catch (err: any) {
    console.error('❌ [getProfile Error]:', err);
    return res.status(500).json({ error: 'Failed to load user profile.' });
  }
}

/**
 * POST /api/users/:targetId/follow
 * Follows, requests, or unfollows a user with optimistic counter updates
 */
export async function toggleFollow(req: AuthRequest, res: Response) {
  const followerId = req.user?.id;
  const { targetId } = req.params;

  if (!followerId) return res.status(401).json({ error: 'Authentication required' });
  if (followerId === targetId) return res.status(400).json({ error: 'You cannot follow yourself.' });

  try {
    // Check target exists and its privacy status
    const targetQuery = await queryWithRetry('SELECT id, is_private FROM users WHERE id = $1', [targetId]);
    if (targetQuery.rows.length === 0) {
      return res.status(404).json({ error: 'User does not exist.' });
    }

    const isPrivate = targetQuery.rows[0].is_private;

    // Check existing follow
    const existing = await queryWithRetry(
      'SELECT status FROM follows WHERE follower_id = $1 AND following_id = $2',
      [followerId, targetId]
    );

    if (existing.rows.length > 0) {
      // Unfollow / Cancel request
      await queryWithRetry('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, targetId]);

      // Remove notification if still unread
      await queryWithRetry(
        'DELETE FROM notifications WHERE recipient_id = $1 AND actor_id = $2 AND type = \x27follow\x27',
        [targetId, followerId]
      );

      return res.status(200).json({
        following: false,
        status: 'none',
        message: 'Unfollowed successfully',
      });
    }

    // Follow or Request
    const initialStatus = isPrivate ? 'pending' : 'accepted';
    await queryWithRetry(
      'INSERT INTO follows (follower_id, following_id, status) VALUES ($1, $2, $3)',
      [followerId, targetId, initialStatus]
    );

    // Create Notification
    const actor = await queryWithRetry('SELECT username, display_name FROM users WHERE id = $1', [followerId]);
    const actorName = actor.rows[0]?.display_name || actor.rows[0]?.username || 'Someone';

    await queryWithRetry(
      `INSERT INTO notifications (recipient_id, actor_id, type, entity_id, message)
       VALUES ($1, $2, 'follow', $2::text, $3)`,
      [targetId, followerId, `${actorName} started following you.`]
    );

    // Mutual check
    const followsYouQuery = await queryWithRetry(
      'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2 AND status = \x27accepted\x27',
      [targetId, followerId]
    );
    const followsYou = followsYouQuery.rows.length > 0;

    let status = initialStatus === 'pending' ? 'requested' : followsYou ? 'friends' : 'following';

    return res.status(200).json({
      following: initialStatus === 'accepted',
      status,
      message: initialStatus === 'pending' ? 'Follow request sent' : 'Followed successfully',
    });
  } catch (err: any) {
    console.error('❌ [toggleFollow Error]:', err);
    return res.status(500).json({ error: 'Could not process follow request.' });
  }
}

/**
 * GET /api/users/:identifier/followers
 */
export async function getFollowers(req: AuthRequest, res: Response) {
  const { identifier } = req.params;
  const viewerId = req.user?.id || null;
  const searchQuery = (req.query.q as string) || '';

  try {
    const sql = `
      SELECT 
        u.id, 
        u.username, 
        u.display_name, 
        u.avatar_url, 
        u.bio, 
        u.is_verified,
        CASE 
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1 FROM follows WHERE follower_id = $2::uuid AND following_id = u.id AND status = 'accepted'
          )
        END AS is_following,
        CASE 
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = $2::uuid AND status = 'accepted'
          )
        END AS follows_you,
        (
          SELECT array_to_json(array_agg(m.username))
          FROM (
            SELECT f3.username
            FROM follows f1
            JOIN follows f2 ON f1.following_id = f2.following_id
            JOIN users f3 ON f3.id = f1.following_id
            WHERE f1.follower_id = $2::uuid AND f2.follower_id = u.id AND f1.status = 'accepted'
            LIMIT 2
          ) m
        ) AS mutual_sample
      FROM follows f
      JOIN users target ON (LOWER(target.username) = LOWER($1) OR target.id::text = $1)
      JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = target.id AND f.status = 'accepted'
        AND ($3 = '' OR LOWER(u.username) LIKE LOWER($3) OR LOWER(u.display_name) LIKE LOWER($3))
      ORDER BY f.created_at DESC
      LIMIT 50;
    `;

    const result = await queryWithRetry(sql, [identifier, viewerId, `%${searchQuery}%`]);
    return res.status(200).json({ followers: result.rows });
  } catch (err: any) {
    console.error('❌ [getFollowers Error]:', err);
    return res.status(500).json({ error: 'Failed to fetch followers list.' });
  }
}

/**
 * GET /api/users/:identifier/following
 */
export async function getFollowing(req: AuthRequest, res: Response) {
  const { identifier } = req.params;
  const viewerId = req.user?.id || null;
  const searchQuery = (req.query.q as string) || '';

  try {
    const sql = `
      SELECT 
        u.id, 
        u.username, 
        u.display_name, 
        u.avatar_url, 
        u.bio, 
        u.is_verified,
        CASE 
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1 FROM follows WHERE follower_id = $2::uuid AND following_id = u.id AND status = 'accepted'
          )
        END AS is_following,
        CASE 
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = $2::uuid AND status = 'accepted'
          )
        END AS follows_you
      FROM follows f
      JOIN users target ON (LOWER(target.username) = LOWER($1) OR target.id::text = $1)
      JOIN users u ON u.id = f.following_id
      WHERE f.follower_id = target.id AND f.status = 'accepted'
        AND ($3 = '' OR LOWER(u.username) LIKE LOWER($3) OR LOWER(u.display_name) LIKE LOWER($3))
      ORDER BY f.created_at DESC
      LIMIT 50;
    `;

    const result = await queryWithRetry(sql, [identifier, viewerId, `%${searchQuery}%`]);
    return res.status(200).json({ following: result.rows });
  } catch (err: any) {
    console.error('❌ [getFollowing Error]:', err);
    return res.status(500).json({ error: 'Failed to fetch following list.' });
  }
}

/**
 * GET /api/users/check-username?username=xyz
 */
export async function checkUsername(req: AuthRequest, res: Response) {
  const username = (req.query.username as string || '').trim().toLowerCase();
  const currentUserId = req.user?.id;

  if (!username || username.length < 3) {
    return res.status(400).json({ available: false, error: 'Username must be at least 3 characters.' });
  }

  const result = await queryWithRetry(
    'SELECT id FROM users WHERE LOWER(username) = $1 AND id != COALESCE($2::uuid, \x2700000000-0000-0000-0000-000000000000\x27)',
    [username, currentUserId]
  );

  return res.status(200).json({ available: result.rows.length === 0 });
}

/**
 * PUT /api/users/profile
 */
export async function updateProfile(req: AuthRequest, res: Response) {
  const userId = req.user?.id || (req as any).userId;
  const { displayName, username, bio, location, website, avatarUrl, coverUrl, isPrivate } = req.body;

  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  try {
    // Check username uniqueness if changed
    if (username) {
      const usernameExists = await queryWithRetry(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2::uuid',
        [username.trim(), userId]
      );
      if (usernameExists.rows.length > 0) {
        return res.status(409).json({ error: 'That username is already taken.' });
      }
    }

    const updateQuery = `
      UPDATE users
      SET 
        display_name = COALESCE($1, display_name),
        username = COALESCE($2, username),
        bio = COALESCE($3, bio),
        location = COALESCE($4, location),
        website = COALESCE($5, website),
        avatar_url = COALESCE($6, avatar_url),
        cover_url = COALESCE($7, cover_url),
        is_private = COALESCE($8, is_private),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9::uuid
      RETURNING id, username, display_name, avatar_url, cover_url, bio, location, website, is_verified, is_private;
    `;

    const result = await queryWithRetry(updateQuery, [
      displayName,
      username?.trim(),
      bio,
      location,
      website,
      avatarUrl,
      coverUrl,
      isPrivate,
      userId,
    ]);

    return res.status(200).json({
      message: 'Profile updated successfully',
      user: result.rows[0],
    });
  } catch (err: any) {
    console.error('❌ [updateProfile Error]:', err);
    return res.status(500).json({ error: err.message || 'Could not update profile.' });
  }
}
