import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const s3Config: any = {
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || 'mock_key',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'mock_secret'
  }
};

if (process.env.S3_ENDPOINT) {
  s3Config.endpoint = process.env.S3_ENDPOINT;
  s3Config.forcePathStyle = true;
}

export const s3 = new S3Client(s3Config);
export const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'z-media-bucket';
export const CDN_BASE_URL = (process.env.CDN_BASE_URL || 'http://localhost:5000/cdn').replace(/\/$/, '');
