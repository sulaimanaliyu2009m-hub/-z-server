import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const requiredEnv = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'CDN_URL'];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.warn(`⚠️ Warning: Missing storage environment variables: ${missingEnv.join(', ')}`);
} else {
  console.log('✅ Storage environment variables verified.');
}

export const isStorageConfigured = missingEnv.length === 0;
export const BUCKET_NAME = process.env.S3_BUCKET || 'z-media';
export const CDN_BASE_URL = (process.env.CDN_URL || 'http://localhost:5000/cdn').replace(/\/$/, '');

export const s3 = new S3Client({
  region: 'auto', // Cloudflare R2 standard region
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
  // Crucial for Cloudflare R2 presigned PUT URLs with AWS SDK v3:
  // Prevents SHA256 checksum headers from failing presigned PUT requests from browser
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

// Self-test for /health/storage
export async function testStorageConfig(): Promise<{ ok: boolean; error?: string }> {
  if (!isStorageConfigured) {
    return { ok: false, error: `Missing variables: ${missingEnv.join(', ')}` };
  }
  try {
    const cmd = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `health-check/${Date.now()}.txt`,
      ContentType: 'text/plain',
    });
    await getSignedUrl(s3, cmd, { expiresIn: 60 });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}
