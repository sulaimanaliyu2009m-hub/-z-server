import healthRoutes from "./routes/healthRoutes";
import { validateStorageConfig } from "./config/storage";
import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Server, Socket } from 'socket.io';
import apiRoutes from './routes/api';
import { globalLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { checkDatabaseHealth } from './config/db';
import { redis } from './config/redis';
import { testStorageConfig } from './config/s3';
import { initializeGemini } from './services/geminiService';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(globalLimiter);

// 1. Instant Health Check (no DB call, used by frontend to wake Render free tier)
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// 2. Deep Diagnostics (measures PostgreSQL and Redis latency)
app.get('/health/deep', async (_req, res) => {
  const dbHealth = await checkDatabaseHealth();
  let redisHealth = { ok: false, latencyMs: 0, error: undefined as string | undefined };

  const start = Date.now();
  try {
    await redis.ping();
    redisHealth = { ok: true, latencyMs: Date.now() - start, error: undefined };
  } catch (e: any) {
    redisHealth = { ok: false, latencyMs: Date.now() - start, error: e.message };
  }

  const allHealthy = dbHealth.ok;
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    postgres: dbHealth,
    redis: redisHealth,
  });
});

// 3. Storage Health Check (tests Cloudflare R2 presigned URL generation)
app.get('/health/storage', async (_req, res) => {
  const test = await testStorageConfig();
  if (test.ok) {
    res.json({ status: 'ok', storage: 'Cloudflare R2 / S3 ready' });
  } else {
    console.error('❌ Storage Health Check Failed:', test.error);
    res.status(503).json({ status: 'error', message: 'Storage configuration error' });
  }
});

app.get("/", (req, res) => res.json({ name: "Z Backend API", status: "active", version: "1.0.0", docs: "/health/deep" }));
app.use("/health", healthRoutes);
app.use("/api", apiRoutes);
app.use(errorHandler);

// Setup Socket.IO
export const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.split(' ')[1];
  if (!token) return next(new Error('Authentication token required'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'z_production_jwt_secret_2026_super_safe') as {
      id: string;
      username: string;
    };
    socket.data.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket: Socket) => {
  const user = socket.data.user;
  if (!user) return;

  redis.sadd('online_users', user.id).catch(() => {});
  socket.join(`user:${user.id}`);

  socket.on('join_conversation', (convId: string) => socket.join(`conv:${convId}`));
  socket.on('leave_conversation', (convId: string) => socket.leave(`conv:${convId}`));

  socket.on('disconnect', () => {
    redis.srem('online_users', user.id).catch(() => {});
  });
});

server.listen(PORT, async () => {
  validateStorageConfig();
  console.log(`🚀 Z Backend running on port ${PORT}`);
  initializeGemini().catch((e) => console.warn('Gemini init notice:', e.message));
});
