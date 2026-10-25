import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { createUploadPresignedUrl } from '../config/storage';
import { queryWithRetry } from '../config/db';
import crypto from 'crypto';

export function getVideoConstraints() {
  const maxSeconds = parseInt(process.env.MAX_VIDEO_SECONDS || '300', 10);
  const maxMb = parseInt(process.env.MAX_VIDEO_MB || '100', 10);
  return { maxSeconds, maxMb };
}

export function getVideoConfig(req: AuthRequest, res: Response) {
  res.status(200).json(getVideoConstraints());
}

export async function requestVideoUploadUrl(req: AuthRequest, res: Response) {
  const { contentType, sizeBytes, durationSeconds } = req.body;
  const { maxSeconds, maxMb } = getVideoConstraints();
  const maxBytes = maxMb * 1024 * 1024;

  if (!contentType || !contentType.startsWith('video/')) {
    return res.status(400).json({ error: 'Please select a valid video format.' });
  }

  if (sizeBytes && sizeBytes > maxBytes) {
    return res.status(400).json({ error: `The video exceeds the maximum size limit of ${maxMb} MB.` });
  }

  if (durationSeconds !== undefined) {
    if (durationSeconds < 1) {
      return res.status(400).json({ error: 'Video duration must be at least 1 second.' });
    }
    if (durationSeconds > maxSeconds) {
      return res.status(400).json({ error: `The video exceeds the maximum duration of ${Math.floor(maxSeconds / 60)} minutes.` });
    }
  }

  try {
    const ext = contentType.split('/')[1] || 'mp4';
    const uniqueKey = `videos/${req.user?.id || 'anonymous'}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;

    const uploadUrl = await createUploadPresignedUrl(uniqueKey, contentType, sizeBytes);
    const cdnBase = (process.env.CDN_URL || '').replace(/\/$/, '');
    const publicUrl = `${cdnBase}/${uniqueKey}`;

    return res.status(200).json({ uploadUrl, publicUrl, key: uniqueKey });
  } catch (err: any) {
    console.error('❌ [Video Presign Error]:', err);
    return res.status(500).json({ error: 'Unable to prepare cloud storage for video upload. Please try again.' });
  }
}

export async function publishVideoPost(req: AuthRequest, res: Response) {
  const { content, mediaUrl, durationSeconds, thumbnailUrl } = req.body;
  const userId = req.user?.id;

  if (!mediaUrl) {
    return res.status(400).json({ error: 'Media URL is required to publish a video.' });
  }

  try {
    const postResult = await queryWithRetry(
      `INSERT INTO posts (user_id, post_type, content, media_url, thumbnail_url)
       VALUES ($1, 'video', $2, $3, $4)
       RETURNING *`,
      [userId, content || '', mediaUrl, thumbnailUrl || null]
    );

    return res.status(201).json({
      message: 'Video posted successfully',
      post: postResult.rows[0],
    });
  } catch (err: any) {
    console.error('❌ [Publish Video Error]:', err);
    return res.status(500).json({ error: 'Could not publish video post. Please try again.' });
  }
}
