import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 2000)
});

redis.on('connect', () => {
  console.log('✅ Connected to Redis');
});

redis.on('error', (err) => {
  console.warn('⚠️ Redis Error (Caching disabled):', err.message);
});