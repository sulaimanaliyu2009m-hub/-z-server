import { Request, Response } from 'express';
import { pool } from '../config/db';
import { redisClient } from '../config/redis';
import { s3Client } from '../config/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function getHealth(req: Request, res: Response) {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
}

export async function getDeepHealth(req: Request, res: Response) {
  const report: Record<string, any> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {},
  };

  const startDb = Date.now();
  try {
    await pool.query('SELECT 1');
    report.services.postgres = { status: 'healthy', latencyMs: Date.now() - startDb };
  } catch (err: any) {
    report.status = 'degraded';
    report.services.postgres = { status: 'unhealthy', latencyMs: Date.now() - startDb, error: err.message };
  }

  const startRedis = Date.now();
  try {
    if (redisClient) {
      await redisClient.ping();
      report.services.redis = { status: 'healthy', latencyMs: Date.now() - startRedis };
    } else {
      report.services.redis = { status: 'unconfigured' };
    }
  } catch (err: any) {
    report.status = 'degraded';
    report.services.redis = { status: 'unhealthy', latencyMs: Date.now() - startRedis, error: err.message };
  }

  res.status(report.status === 'ok' ? 200 : 503).json(report);
}

export async function getStorageHealth(req: Request, res: Response) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.error('❌ [Storage Check] S3_BUCKET environment variable missing.');
    return res.status(500).json({ status: 'unconfigured', message: 'Storage is not configured on this server.' });
  }

  try {
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: `health-check-${Date.now()}.tmp`,
      ContentType: 'text/plain',
    });
    await getSignedUrl(s3Client, cmd, { expiresIn: 60 });
    return res.status(200).json({ status: 'healthy', testSignedUrlGenerated: true });
  } catch (err: any) {
    console.error('❌ [Storage Check Error] Presign failure:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Storage service encountered an internal configuration issue.',
    });
  }
}
