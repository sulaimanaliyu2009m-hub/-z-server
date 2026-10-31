import { Server as SocketIOServer } from "socket.io";
import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

import healthRoutes from './routes/healthRoutes';
import authRoutes from './routes/authRoutes';
import videoRoutes from './routes/videoRoutes';
import aiRoutes from './routes/aiRoutes';
import userRoutes from './routes/userRoutes';
import { initializeOllama } from './config/ollama';
import { validateStorageConfig } from './config/storage';

const app = express();
const server = http.createServer(app);
export const io = new SocketIOServer(server, { cors: { origin: "*" } });

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.includes('vercel.app') || origin.includes('localhost') || origin === process.env.CLIENT_URL) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).json({ name: 'Zumeko Backend API', status: 'active', version: '1.0.0', docs: '/health/deep' });
});

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/users', userRoutes);

const PORT = process.env.PORT || 10000;

server.listen(PORT, async () => {
  console.log(`🚀 Zumeko Backend running on port ${PORT}`);
  validateStorageConfig();
  await initializeOllama();
});

export { app, server };
