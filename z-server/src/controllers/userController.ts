import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';

export const getUserProfile = async (req: AuthRequest, res: Response) => {
  const currentUserId = req.user?.id;
  const identifier = req.params.usernameOrId;

  try {
    // Determine if identifier is UUID or Username
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    const query = isUuid 
      ? 'SELECT * FROM users WHERE id = $1' 
      : 'SELECT * FROM users WHERE LOWER(username) = LOWER($1)';

    const userRes = await pool.query(query, [identifier]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = userRes.rows[0];

    // Aggregated stats & relationship check
    const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM follows WHERE following_id = $1) as followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as following,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = $1) as "isFollowing",
        EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) as "followsYou"
    `;
    const stats = await pool.query(statsQuery, [user.id, currentUserId]);
    
    res.json({ ...user, ...stats.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};