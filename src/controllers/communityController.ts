import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';

// 1. List groups
export const getGroups = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  try {
    const query = `
      SELECT 
        g.id, g.name, g.description, g.cover_image_url AS "coverImageUrl", 
        g.is_private AS "isPrivate", g.created_at AS "createdAt",
        (SELECT COUNT(*)::int FROM group_members WHERE group_id = g.id) AS "memberCount",
        EXISTS(SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = $1) AS "isMember",
        (SELECT role FROM group_members WHERE group_id = g.id AND user_id = $1) AS "myRole"
      FROM groups g
      WHERE g.is_private = false 
         OR EXISTS(SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = $1)
      ORDER BY g.created_at DESC;
    `;
    const { rows } = await pool.query(query, [userId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 2. Create a new community
export const createGroup = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { name, description, isPrivate, coverImageUrl } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  try {
    const groupRes = await pool.query(
      `INSERT INTO groups (name, description, is_private, cover_image_url, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, is_private AS "isPrivate", cover_image_url AS "coverImageUrl", created_at AS "createdAt"`,
      [name.trim(), description || '', Boolean(isPrivate), coverImageUrl || '', userId]
    );

    const group = groupRes.rows[0];

    // Assign creator as admin
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [group.id, userId]
    );

    res.status(201).json({ ...group, memberCount: 1, isMember: true, myRole: 'admin' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 3. Join / Leave Community
export const toggleJoinGroup = async (req: AuthRequest, res: Response) => {
  const { id: groupId } = req.params;
  const userId = req.user?.id;

  try {
    const check = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
    if (check.rows.length > 0) {
      await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
      res.json({ joined: false });
    } else {
      await pool.query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, \'member\')', [groupId, userId]);
      res.json({ joined: true, role: 'member' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 4. Group Feed (Posts)
export const getGroupPosts = async (req: AuthRequest, res: Response) => {
  const { id: groupId } = req.params;
  try {
    const query = `
      SELECT 
        gp.id, gp.group_id AS "groupId", gp.content, gp.media_url AS "mediaUrl", gp.created_at AS "createdAt",
        u.id AS "authorId", u.display_name AS "authorName", u.username AS "authorUsername", u.avatar_url AS "authorAvatar"
      FROM group_posts gp
      JOIN users u ON gp.user_id = u.id
      WHERE gp.group_id = $1
      ORDER BY gp.created_at DESC;
    `;
    const { rows } = await pool.query(query, [groupId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const createGroupPost = async (req: AuthRequest, res: Response) => {
  const { id: groupId } = req.params;
  const userId = req.user?.id;
  const { content, mediaUrl } = req.body;

  if (!content || !content.trim()) return res.status(400).json({ error: 'Post content is required' });

  try {
    const resPost = await pool.query(
      `INSERT INTO group_posts (group_id, user_id, content, media_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, group_id AS "groupId", content, media_url AS "mediaUrl", created_at AS "createdAt"`,
      [groupId, userId, content.trim(), mediaUrl || null]
    );

    const userRes = await pool.query('SELECT id, username, display_name, avatar_url FROM users WHERE id = $1', [userId]);
    const u = userRes.rows[0];

    res.status(201).json({
      ...resPost.rows[0],
      authorId: u.id,
      authorName: u.display_name,
      authorUsername: u.username,
      authorAvatar: u.avatar_url
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 5. Group Members & Roles (Admin, Moderator, Member)
export const getGroupMembers = async (req: AuthRequest, res: Response) => {
  const { id: groupId } = req.params;
  try {
    const query = `
      SELECT 
        u.id, u.username, u.display_name AS "displayName", u.avatar_url AS "avatarUrl",
        gm.role, gm.joined_at AS "joinedAt"
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
      ORDER BY CASE gm.role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, gm.joined_at ASC;
    `;
    const { rows } = await pool.query(query, [groupId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 6. Group Events & RSVP
export const getGroupEvents = async (req: AuthRequest, res: Response) => {
  const { id: groupId } = req.params;
  const userId = req.user?.id;
  try {
    const query = `
      SELECT 
        e.id, e.group_id AS "groupId", e.title, e.description, e.event_date AS "eventDate", e.location, e.created_at AS "createdAt",
        (SELECT COUNT(*)::int FROM event_rsvps WHERE event_id = e.id AND status = 'going') AS "goingCount",
        (SELECT COUNT(*)::int FROM event_rsvps WHERE event_id = e.id AND status = 'interested') AS "interestedCount",
        (SELECT status FROM event_rsvps WHERE event_id = e.id AND user_id = $2) AS "myRsvp"
      FROM events e
      WHERE e.group_id = $1
      ORDER BY e.event_date ASC;
    `;
    const { rows } = await pool.query(query, [groupId, userId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const createGroupEvent = async (req: AuthRequest, res: Response) => {
  const { id: groupId } = req.params;
  const userId = req.user?.id;
  const { title, description, eventDate, location } = req.body;

  if (!title || !eventDate || !location) {
    return res.status(400).json({ error: 'Title, date, and location are required' });
  }

  try {
    const resEv = await pool.query(
      `INSERT INTO events (group_id, created_by, title, description, event_date, location)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, group_id AS "groupId", title, description, event_date AS "eventDate", location, created_at AS "createdAt"`,
      [groupId, userId, title, description || '', eventDate, location]
    );

    res.status(201).json({ ...resEv.rows[0], goingCount: 0, interestedCount: 0, myRsvp: null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const rsvpEvent = async (req: AuthRequest, res: Response) => {
  const { eventId } = req.params;
  const userId = req.user?.id;
  const { status } = req.body; // 'going', 'interested', 'not_going'

  try {
    if (status === 'not_going') {
      await pool.query('DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
      return res.json({ status: null });
    }

    await pool.query(
      `INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status`,
      [eventId, userId, status]
    );

    res.json({ status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
