import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { executeQueryWithRetry } from '../config/db';

export const getUserProfile = async (req: AuthRequest, res: Response) => {
  const currentUserId = req.user?.id;
  const identifier = req.params.usernameOrId;

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

    const userQuery = isUuid
      ? `SELECT id, email, username, display_name AS "displayName", avatar_url AS "avatarUrl", cover_url AS "coverUrl", bio, location, website_link AS "websiteLink", is_verified AS "isVerified", created_at AS "createdAt" FROM users WHERE id = $1`
      : `SELECT id, email, username, display_name AS "displayName", avatar_url AS "avatarUrl", cover_url AS "coverUrl", bio, location, website_link AS "websiteLink", is_verified AS "isVerified", created_at AS "createdAt" FROM users WHERE LOWER(username) = LOWER($1)`;

    const userRes = await executeQueryWithRetry(userQuery, [identifier]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    const profileUser = userRes.rows[0];
    const profileId = profileUser.id;

    const [countsRes, relRes, postsRes] = await Promise.all([
      executeQueryWithRetry(
        `SELECT 
           (SELECT COUNT(*)::int FROM follows WHERE following_id = $1) AS "followersCount",
           (SELECT COUNT(*)::int FROM follows WHERE follower_id = $1) AS "followingCount"`,
        [profileId]
      ),
      currentUserId
        ? executeQueryWithRetry(
            `SELECT 
               EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) AS "isFollowing",
               EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = $1) AS "followsYou"`,
            [currentUserId, profileId]
          )
        : Promise.resolve({ rows: [{ isFollowing: false, followsYou: false }] }),
      executeQueryWithRetry(
        `SELECT p.id, p.user_id AS "userId", p.post_type AS "type", p.content, p.media_url AS "mediaUrl", 
                p.thumbnail_url AS "thumbnailUrl", p.created_at AS "createdAt",
                COALESCE(l.likes_count, 0)::int AS "likesCount",
                EXISTS(SELECT 1 FROM likes WHERE user_id = $2 AND post_id = p.id) AS "isLiked"
         FROM posts p
         LEFT JOIN (SELECT post_id, COUNT(*) AS likes_count FROM likes GROUP BY post_id) l ON l.post_id = p.id
         WHERE p.user_id = $1
         ORDER BY p.created_at DESC`,
        [profileId, currentUserId || '00000000-0000-0000-0000-000000000000']
      ),
    ]);

    const counts = countsRes.rows[0];
    const rel = relRes.rows[0];

    let connectionState = 'none';
    if (currentUserId === profileId) {
      connectionState = 'self';
    } else if (rel.isFollowing && rel.followsYou) {
      connectionState = 'friends';
    } else if (rel.isFollowing) {
      connectionState = 'following';
    } else if (rel.followsYou) {
      connectionState = 'follow_back';
    }

    res.json({
      ...profileUser,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount,
      isFollowing: rel.isFollowing,
      followsYou: rel.followsYou,
      connectionState,
      posts: postsRes.rows,
    });
  } catch (err: any) {
    console.error('❌ Get User Profile Error:', err.message);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { displayName, username, bio, avatarUrl, coverUrl, location, websiteLink } = req.body;

  try {
    if (username) {
      const normalizedUsername = username.toLowerCase().trim();
      const existing = await executeQueryWithRetry(
        'SELECT id FROM users WHERE LOWER(username) = $1 AND id <> $2 LIMIT 1',
        [normalizedUsername, userId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
    }

    const result = await executeQueryWithRetry(
      `UPDATE users 
       SET display_name = COALESCE($1, display_name),
           username = COALESCE(LOWER($2), username),
           bio = COALESCE($3, bio),
           avatar_url = COALESCE($4, avatar_url),
           cover_url = COALESCE($5, cover_url),
           location = COALESCE($6, location),
           website_link = COALESCE($7, website_link),
           updated_at = NOW()
       WHERE id = $8
       RETURNING id, email, username, display_name AS "displayName", avatar_url AS "avatarUrl", cover_url AS "coverUrl", bio, location, website_link AS "websiteLink", is_verified AS "isVerified"`,
      [
        displayName?.trim(),
        username?.trim(),
        bio !== undefined ? bio.trim() : null,
        avatarUrl !== undefined ? avatarUrl : null,
        coverUrl !== undefined ? coverUrl : null,
        location !== undefined ? location.trim() : null,
        websiteLink !== undefined ? websiteLink.trim() : null,
        userId,
      ]
    );

    res.json({ user: result.rows[0], message: 'Profile updated successfully.' });
  } catch (err: any) {
    console.error('❌ Update Profile Error:', err.message);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
};

export const getFollowersList = async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const currentUserId = req.user?.id;

  try {
    const query = `
      SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url AS "avatarUrl", u.bio, u.is_verified AS "isVerified",
             EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = u.id) AS "isFollowing"
      FROM follows f
      JOIN users u ON f.follower_id = u.id
      WHERE f.following_id = $1
      ORDER BY f.created_at DESC;
    `;
    const { rows } = await executeQueryWithRetry(query, [userId, currentUserId || '00000000-0000-0000-0000-000000000000']);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getFollowingList = async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const currentUserId = req.user?.id;

  try {
    const query = `
      SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url AS "avatarUrl", u.bio, u.is_verified AS "isVerified",
             EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = u.id) AS "isFollowing"
      FROM follows f
      JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = $1
      ORDER BY f.created_at DESC;
    `;
    const { rows } = await executeQueryWithRetry(query, [userId, currentUserId || '00000000-0000-0000-0000-000000000000']);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
