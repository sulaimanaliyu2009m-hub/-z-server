import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Server, Socket } from 'socket.io';
import apiRoutes from './routes/api';
import { globalLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { pool } from './config/db';
import { redis } from './config/redis';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(globalLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
app.use('/api', apiRoutes);
app.use(errorHandler);

// Setup Socket.IO
export const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Socket Auth Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.split(' ')[1];
  if (!token) return next(new Error('Authentication token required'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as { id: string; username: string };
    socket.data.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket: Socket) => {
  const user = socket.data.user;
  if (!user) return;

  // Track online status in Redis
  await redis.sadd('online_users', user.id);
  io.emit('presence_update', { userId: user.id, status: 'online' });

  // Join personal notification room
  socket.join(`user:${user.id}`);

  // Join Conversation Room
  socket.on('join_conversation', (conversationId: string) => {
    socket.join(`conv:${conversationId}`);
  });

  socket.on('leave_conversation', (conversationId: string) => {
    socket.leave(`conv:${conversationId}`);
  });

  // Real-time Chat Messaging
  socket.on('send_message', async (data: { conversationId: string; text?: string; imageUrl?: string }) => {
    const { conversationId, text, imageUrl } = data;
    if (!text && !imageUrl) return;

    try {
      const msgRes = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, text, image_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id, conversation_id AS "conversationId", sender_id AS "senderId", text, image_url AS "imageUrl", created_at AS "createdAt"`,
        [conversationId, user.id, text || '', imageUrl || null]
      );
      const newMsg = msgRes.rows[0];

      await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

      const userRes = await pool.query('SELECT username, display_name, avatar_url FROM users WHERE id = $1', [user.id]);
      const sender = userRes.rows[0];

      const fullMessage = {
        ...newMsg,
        senderUsername: sender.username,
        senderDisplayName: sender.display_name,
        senderAvatar: sender.avatar_url
      };

      // Broadcast message to room
      io.to(`conv:${conversationId}`).emit('new_message', fullMessage);

      // Create notification for conversation members
      const members = await pool.query(
        'SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2',
        [conversationId, user.id]
      );

      for (const m of members.rows) {
        const notifRes = await pool.query(
          `INSERT INTO notifications (recipient_id, actor_id, type, entity_id, message)
           VALUES ($1, $2, 'message', $3, $4)
           RETURNING id, type, entity_id AS "entityId", message, is_read AS "isRead", created_at AS "createdAt"`,
          [m.user_id, user.id, conversationId, text ? (text.length > 30 ? text.slice(0, 30) + '...' : text) : 'Sent an image']
        );
        io.to(`user:${m.user_id}`).emit('new_notification', {
          ...notifRes.rows[0],
          actorUsername: sender.username,
          actorDisplayName: sender.display_name,
          actorAvatar: sender.avatar_url
        });
      }
    } catch (e: any) {
      socket.emit('error', e.message);
    }
  });

  // Typing Indicator
  socket.on('typing', ({ conversationId, isTyping }: { conversationId: string; isTyping: boolean }) => {
    socket.to(`conv:${conversationId}`).emit('user_typing', {
      conversationId,
      userId: user.id,
      username: user.username,
      isTyping
    });
  });

  // Read Receipts
  socket.on('mark_read', async ({ conversationId }: { conversationId: string }) => {
    await pool.query(
      'UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, user.id]
    );
    socket.to(`conv:${conversationId}`).emit('messages_read', {
      conversationId,
      userId: user.id
    });
  });

  socket.on('disconnect', async () => {
    await redis.srem('online_users', user.id);
    io.emit('presence_update', { userId: user.id, status: 'offline' });
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Z Backend with WebSockets running on http://localhost:${PORT}`);
});
