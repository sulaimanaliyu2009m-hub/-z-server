import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_VARS = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'CDN_URL'
];

export function validateStorageConfig(): boolean {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`❌ [Storage Error] Missing required Cloudflare R2 variables: ${missing.join(', ')}`);
    return false;
  }
  console.log('✅ Cloudflare R2 configuration verified.');
  return true;
}

export const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_ENDPOINT || '',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export async function createUploadPresignedUrl(
  key: string,
  contentType: string,
  contentLength?: number
): Promise<string> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is not configured.');

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ...(contentLength ? { ContentLength: contentLength } : {})
  });

  return await getSignedUrl(s3Client, command, { expiresIn: 900 });
}
