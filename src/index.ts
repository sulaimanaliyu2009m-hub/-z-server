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
import { initializeGemini } from './config/gemini';
import { validateStorageConfig } from './config/storage';

const app = express();
const server = http.createServer(app);

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

// 1. Instant response endpoint
app.get("/", (req, res) => {
  res.status(200).json({
    name: "Z Backend API",
    status: "active",
    version: "1.0.0",
    docs: "/health/deep"
  });
});

app.use("/health", healthRoutes);

// 2. Application API endpoints
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/ai', aiRoutes);

const PORT = process.env.PORT || 10000;

server.listen(PORT, async () => {
  console.log(`🚀 Z Backend running on port ${PORT}`);
  validateStorageConfig();
  await initializeGemini();
});

export { app, server };
