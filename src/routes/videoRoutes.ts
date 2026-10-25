import { Router } from 'express';
import { 
  getVideoConfig, 
  getVideoLimits, 
  requestVideoUploadUrl, 
  getUploadUrl, 
  publishVideoPost, 
  processVideo, 
  getVideoStatus 
} from '../controllers/videoController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/config', authenticate, getVideoConfig);
router.get('/limits', authenticate, getVideoLimits);
router.post('/upload-url', authenticate, requestVideoUploadUrl);
router.post('/process', authenticate, processVideo);
router.post('/publish', authenticate, publishVideoPost);
router.get('/:id/status', authenticate, getVideoStatus);

export default router;
