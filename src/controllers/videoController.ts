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
import { s3, BUCKET_NAME, CDN_BASE_URL } from '../config/s3';

const execAsync = promisify(exec);

// 1. Generate Presigned Upload URL
export const getUploadUrl = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { contentType, fileSize } = req.body;

  // Enforce 100 MB Limit
  const MAX_BYTES = 100 * 1024 * 1024;
  if (fileSize && fileSize > MAX_BYTES) {
    return res.status(400).json({ error: 'Video file size exceeds 100 MB limit.' });
  }

  const rawKey = `raw/${userId}/${Date.now()}-upload.mp4`;

  try {
    const dbRes = await pool.query(
      `INSERT INTO videos (user_id, raw_s3_key, file_size_bytes, status)
       VALUES ($1, $2, $3, 'uploading')
       RETURNING id`,
      [userId, rawKey, fileSize || null]
    );

    const videoId = dbRes.rows[0].id;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: rawKey,
      ContentType: contentType || 'video/mp4'
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    res.json({ videoId, uploadUrl, s3Key: rawKey });
  } catch (err: any) {
    console.error('Upload URL generation error:', err);
    res.status(500).json({ error: 'Failed to generate signed upload URL' });
  }
};

// 2. Transcode Video and Extract Thumbnail via FFmpeg
export const processVideo = async (req: AuthRequest, res: Response) => {
  const { videoId } = req.body;
  const userId = req.user?.id;

  const dbRes = await pool.query(
    'SELECT * FROM videos WHERE id = $1 AND user_id = $2',
    [videoId, userId]
  );

  if (dbRes.rows.length === 0) {
    return res.status(404).json({ error: 'Video record not found' });
  }

  const video = dbRes.rows[0];

  // Set status to processing
  await pool.query("UPDATE videos SET status = 'processing', updated_at = NOW() WHERE id = $1", [videoId]);

  // Respond immediately so frontend can poll
  res.json({ message: 'Video processing started', videoId, status: 'processing' });

  // Background FFmpeg Execution
  (async () => {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `in-${videoId}.mp4`);
    const outputPath = path.join(tmpDir, `out-${videoId}.mp4`);
    const thumbPath = path.join(tmpDir, `thumb-${videoId}.jpg`);

    try {
      // 1. Download raw video from S3
      const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: video.raw_s3_key });
      const s3Response = await s3.send(getCmd);
      const writeStream = fs.createWriteStream(inputPath);
      await new Promise((resolve, reject) => {
        (s3Response.Body as Readable).pipe(writeStream).on('finish', resolve).on('error', reject);
      });

      // 2. Validate duration <= 60 seconds using ffprobe
      const { stdout: durationOut } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`
      );
      const duration = parseFloat(durationOut.trim()) || 0;

      if (duration > 60.5) {
        throw new Error(`Video exceeds maximum allowed duration of 60s (received ${duration.toFixed(1)}s)`);
      }

      // 3. Transcode to web-friendly MP4 with faststart (H.264 / AAC, 720p max)
      const transcodeCmd = `ffmpeg -y -i "${inputPath}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags +faststart -vf "scale='min(720,iw)':-2" "${outputPath}"`;
      await execAsync(transcodeCmd);

      // 4. Extract 1-second Thumbnail
      const thumbCmd = `ffmpeg -y -ss 00:00:01 -i "${inputPath}" -vframes 1 -q:v 2 "${thumbPath}"`;
      await execAsync(thumbCmd);

      // 5. Upload transcoded video and thumbnail to S3
      const transKey = `processed/${userId}/${videoId}.mp4`;
      const thumbKey = `thumbnails/${userId}/${videoId}.jpg`;

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: transKey,
        Body: fs.createReadStream(outputPath),
        ContentType: 'video/mp4'
      }));

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: thumbKey,
        Body: fs.createReadStream(thumbPath),
        ContentType: 'image/jpeg'
      }));

      const videoUrl = `${CDN_BASE_URL}/${transKey}`;
      const thumbnailUrl = `${CDN_BASE_URL}/${thumbKey}`;

      // 6. Update database to ready
      await pool.query(
        `UPDATE videos 
         SET status = 'ready', transcoded_s3_key = $1, thumbnail_s3_key = $2,
             video_url = $3, thumbnail_url = $4, duration = $5, updated_at = NOW()
         WHERE id = $6`,
        [transKey, thumbKey, videoUrl, thumbnailUrl, duration, videoId]
      );

      console.log(`✅ Video ${videoId} successfully transcoded and ready on CDN: ${videoUrl}`);
    } catch (processErr: any) {
      console.error(`❌ Transcoding error for video ${videoId}:`, processErr.message);
      await pool.query(
        "UPDATE videos SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
        [processErr.message, videoId]
      );
    } finally {
      // Cleanup local temp files
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }
  })();
};

// 3. Poll Processing Status
export const getVideoStatus = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const dbRes = await pool.query('SELECT status, video_url, thumbnail_url, error_message FROM videos WHERE id = $1', [id]);

  if (dbRes.rows.length === 0) return res.status(404).json({ error: 'Video not found' });
  res.json(dbRes.rows[0]);
};
