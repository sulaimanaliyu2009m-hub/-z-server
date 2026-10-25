import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();
const MAX_REQUESTS = 10;
const REFILL_INTERVAL = 60000;

export function aiRateLimiter(req: AuthRequest, res: Response, next: NextFunction) {
  const key = req.user?.id || req.ip || 'global';
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: MAX_REQUESTS, lastRefill: now };
    buckets.set(key, bucket);
  }

  const elapsed = now - bucket.lastRefill;
  if (elapsed > REFILL_INTERVAL) {
    bucket.tokens = MAX_REQUESTS;
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) {
    return res.status(429).json({
      error: 'You have reached the AI rate limit for this minute. Please wait a moment.',
    });
  }

  bucket.tokens -= 1;
  next();
}
