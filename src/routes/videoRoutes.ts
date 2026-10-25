import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getVideoConfig, requestVideoUploadUrl, publishVideoPost } from '../controllers/videoController';

const router = Router();

router.get('/config', getVideoConfig);
router.post('/request-upload-url', authenticateToken, requestVideoUploadUrl);
router.post('/publish', authenticateToken, publishVideoPost);

export default router;
