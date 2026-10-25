import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';
import { io } from '../index';

// 1. Get user's conversation list
export const getConversations = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  try {
    const query = `
      SELECT 
        c.id, c.is_group AS "isGroup", c.title, c.updated_at AS "updatedAt",
        (
          SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'displayName', u.display_name, 'avatarUrl', u.avatar_url))
          FROM conversation_members cm2
          JOIN users u ON cm2.user_id = u.id
          WHERE cm2.conversation_id = c.id
        ) AS members,
        (
          SELECT json_build_object('id', m.id, 'text', m.text, 'imageUrl', m.image_url, 'senderId', m.sender_id, 'createdAt', m.created_at)
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC LIMIT 1
        ) AS "lastMessage",
        (
          SELECT COUNT(*)::int
          FROM messages m
          JOIN conversation_members cm_me ON cm_me.conversation_id = c.id AND cm_me.user_id = $1
          WHERE m.conversation_id = c.id AND m.created_at > cm_me.last_read_at AND m.sender_id <> $1
        ) AS "unreadCount"
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE cm.user_id = $1
      ORDER BY c.updated_at DESC;
    `;
    const { rows } = await pool.query(query, [userId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 2. Start a 1-on-1 DM or Group Chat
export const createConversation = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { recipientIds, isGroup, title } = req.body;

  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({ error: 'At least one recipient is required' });
  }

  const allMemberIds = Array.from(new Set([userId, ...recipientIds]));

  try {
    if (!isGroup && allMemberIds.length === 2) {
      const existing = await pool.query(`
        SELECT c.id FROM conversations c
        JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
        JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = $2
        WHERE c.is_group = false LIMIT 1
      `, [allMemberIds[0], allMemberIds[1]]);

      if (existing.rows.length > 0) {
        return res.json({ id: existing.rows[0].id, isExisting: true });
      }
    }

    const convRes = await pool.query(
      `INSERT INTO conversations (is_group, title) VALUES ($1, $2) RETURNING id`,
      [Boolean(isGroup), isGroup ? (title || 'Group Chat') : null]
    );
    const convId = convRes.rows[0].id;

    for (const memberId of allMemberIds) {
      await pool.query(
        `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)`,
        [convId, memberId]
      );
    }

    res.status(201).json({ id: convId, isGroup: Boolean(isGroup), title });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 3. Get messages for a specific conversation
export const getMessages = async (req: AuthRequest, res: Response) => {
  const { id: conversationId } = req.params;
  const userId = req.user?.id;

  try {
    await pool.query(
      `UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId]
    );

    const query = `
      SELECT 
        m.id, m.conversation_id AS "conversationId", m.sender_id AS "senderId",
        m.text, m.image_url AS "imageUrl", m.created_at AS "createdAt",
        u.username AS "senderUsername", u.display_name AS "senderDisplayName", u.avatar_url AS "senderAvatar"
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
      LIMIT 100;
    `;
    const { rows } = await pool.query(query, [conversationId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 4. Send Message via HTTP API (Guaranteed delivery fallback)
export const sendMessageHttp = async (req: AuthRequest, res: Response) => {
  const { id: conversationId } = req.params;
  const { text, imageUrl } = req.body;
  const userId = req.user?.id;

  if (!text && !imageUrl) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  try {
    const msgRes = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, text, image_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id AS "conversationId", sender_id AS "senderId", text, image_url AS "imageUrl", created_at AS "createdAt"`,
      [conversationId, userId, text || '', imageUrl || null]
    );

    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

    const userRes = await pool.query('SELECT username, display_name, avatar_url FROM users WHERE id = $1', [userId]);
    const sender = userRes.rows[0];

    const fullMessage = {
      ...msgRes.rows[0],
      senderUsername: sender.username,
      senderDisplayName: sender.display_name,
      senderAvatar: sender.avatar_url,
    };

    // Broadcast over WebSocket if connected
    if (io) {
      io.to(`conv:${conversationId}`).emit('new_message', fullMessage);
    }

    res.status(201).json(fullMessage);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 5. Notifications
export const getNotifications = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  try {
    const query = `
      SELECT 
        n.id, n.type, n.entity_id AS "entityId", n.message, n.is_read AS "isRead", n.created_at AS "createdAt",
        u.username AS "actorUsername", u.display_name AS "actorDisplayName", u.avatar_url AS "actorAvatar"
      FROM notifications n
      JOIN users u ON n.actor_id = u.id
      WHERE n.recipient_id = $1
      ORDER BY n.created_at DESC
      LIMIT 50;
    `;
    const { rows } = await pool.query(query, [userId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const markNotificationsRead = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  try {
    await pool.query('UPDATE notifications SET is_read = true WHERE recipient_id = $1', [userId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// 6. User Search
export const searchUsers = async (req: AuthRequest, res: Response) => {
  const { q } = req.query;
  const currentUserId = req.user?.id;
  if (!q || typeof q !== 'string') return res.json([]);

  try {
    const query = `
      SELECT id, username, display_name AS "displayName", avatar_url AS "avatarUrl"
      FROM users
      WHERE (username ILIKE $1 OR display_name ILIKE $1) AND id <> $2
      LIMIT 10;
    `;
    const { rows } = await pool.query(query, [`%${q}%`, currentUserId]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
