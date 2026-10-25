import { Response } from 'express';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../config/db';
import { s3, BUCKET_NAME, CDN_BASE_URL, isStorageConfigured } from '../config/s3';

const execAsync = promisify(exec);

export const MAX_VIDEO_SECONDS = parseInt(process.env.MAX_VIDEO_SECONDS || '300', 10);
export const MAX_VIDEO_MB = parseInt(process.env.MAX_VIDEO_MB || '100', 10);

export const getVideoLimits = (_req: AuthRequest, res: Response) => {
  res.json({
    maxVideoSeconds: MAX_VIDEO_SECONDS,
    maxVideoMb: MAX_VIDEO_MB,
    storageReady: isStorageConfigured,
  });
};

export const getVideoConfig = getVideoLimits;

export const getUploadUrl = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { contentType, fileSize } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Please log in to upload videos.' });
  }

  if (!isStorageConfigured) {
    console.error('❌ S3/R2 storage is not configured in environment.');
    return res.status(503).json({ error: 'Storage service is not configured on the server.' });
  }

  const maxBytes = MAX_VIDEO_MB * 1024 * 1024;
  if (fileSize && fileSize > maxBytes) {
    return res.status(400).json({ error: `Video exceeds maximum allowed size of ${MAX_VIDEO_MB} MB.` });
  }

  const rawKey = `raw/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;

  try {
    // 1. Check if user actually exists in Neon to prevent foreign key errors from stale sessions
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(401).json({ error: 'Your session is from an older database. Please log out and log in again.' });
    }

    // 2. Insert tracking record in videos table
    const dbRes = await pool.query(
      `INSERT INTO videos (user_id, raw_s3_key, file_size_bytes, status)
       VALUES ($1, $2, $3, 'uploading')
       RETURNING id`,
      [userId, rawKey, fileSize || null]
    );

    const videoId = dbRes.rows[0].id;

    // 3. Generate presigned URL
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: rawKey,
      ContentType: contentType || 'video/mp4',
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    res.json({ videoId, uploadUrl, s3Key: rawKey });
  } catch (err: any) {
    console.error('❌ Failed to generate signed upload URL:', err.message || err);
    res.status(500).json({ error: `Upload error: ${err.message || 'Database error'}` });
  }
};

export const requestVideoUploadUrl = getUploadUrl;

export const processVideo = async (req: AuthRequest, res: Response) => {
  const { videoId } = req.body;
  const userId = req.user?.id;

  const dbRes = await pool.query(
    'SELECT * FROM videos WHERE id = $1 AND user_id = $2',
    [videoId, userId]
  );

  if (dbRes.rows.length === 0) {
    return res.status(404).json({ error: 'Video record not found.' });
  }

  const video = dbRes.rows[0];

  await pool.query("UPDATE videos SET status = 'processing', updated_at = NOW() WHERE id = $1", [videoId]);
  res.json({ message: 'Video processing started', videoId, status: 'processing' });

  (async () => {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `in-${videoId}.mp4`);
    const outputPath = path.join(tmpDir, `out-${videoId}.mp4`);
    const thumbPath = path.join(tmpDir, `thumb-${videoId}.jpg`);

    try {
      const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: video.raw_s3_key });
      const s3Response = await s3.send(getCmd);
      const writeStream = fs.createWriteStream(inputPath);

      await new Promise<void>((resolve, reject) => {
        (s3Response.Body as Readable)
          .pipe(writeStream)
          .on('finish', () => resolve())
          .on('error', (err) => reject(err));
      });

      const { stdout: durationOut } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`
      );
      const duration = parseFloat(durationOut.trim()) || 0;

      if (duration > MAX_VIDEO_SECONDS + 1) {
        throw new Error(`Video duration of ${Math.round(duration)}s exceeds maximum allowed (${MAX_VIDEO_SECONDS}s).`);
      }

      const transcodeCmd = `ffmpeg -y -i "${inputPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -vf "scale='min(720,iw)':-2" "${outputPath}"`;
      await execAsync(transcodeCmd);

      const thumbOffset = duration >= 1.0 ? '00:00:01' : '00:00:00.1';
      const thumbCmd = `ffmpeg -y -ss ${thumbOffset} -i "${inputPath}" -vframes 1 -q:v 2 "${thumbPath}"`;
      await execAsync(thumbCmd);

      const transKey = `processed/${userId}/${videoId}.mp4`;
      const thumbKey = `thumbnails/${userId}/${videoId}.jpg`;

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: transKey,
        Body: fs.createReadStream(outputPath),
        ContentType: 'video/mp4',
      }));

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: thumbKey,
        Body: fs.createReadStream(thumbPath),
        ContentType: 'image/jpeg',
      }));

      const videoUrl = `${CDN_BASE_URL}/${transKey}`;
      const thumbnailUrl = `${CDN_BASE_URL}/${thumbKey}`;

      await pool.query(
        `UPDATE videos 
         SET status = 'ready', transcoded_s3_key = $1, thumbnail_s3_key = $2,
             video_url = $3, thumbnail_url = $4, duration = $5, updated_at = NOW()
         WHERE id = $6`,
        [transKey, thumbKey, videoUrl, thumbnailUrl, duration, videoId]
      );

      console.log(`✅ Video ${videoId} processed successfully (${duration.toFixed(1)}s).`);
    } catch (processErr: any) {
      console.error(`❌ Video processing failed for ${videoId}:`, processErr.message);
      await pool.query(
        "UPDATE videos SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
        [processErr.message || 'Processing failed', videoId]
      );
    } finally {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }
  })();
};

export const publishVideoPost = async (req: AuthRequest, res: Response) => {
  const { content, mediaUrl, thumbnailUrl } = req.body;
  const userId = req.user?.id;

  try {
    const postRes = await pool.query(
      `INSERT INTO posts (user_id, post_type, content, media_url, thumbnail_url)
       VALUES ($1, 'video', $2, $3, $4)
       RETURNING id, user_id AS "userId", post_type AS "type", content, media_url AS "mediaUrl", thumbnail_url AS "thumbnailUrl", created_at AS "createdAt"`,
      [userId, content || '', mediaUrl || null, thumbnailUrl || null]
    );
    res.status(201).json(postRes.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getVideoStatus = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const dbRes = await pool.query(
    'SELECT status, video_url, thumbnail_url, error_message FROM videos WHERE id = $1',
    [id]
  );
  if (dbRes.rows.length === 0) return res.status(404).json({ error: 'Video not found.' });
  res.json(dbRes.rows[0]);
};
