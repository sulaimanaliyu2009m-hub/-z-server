import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { aiRateLimiter } from '../middleware/aiRateLimit';
import { generateCaption } from '../controllers/aiController';
const router = Router();
router.post('/generate-caption', authenticateToken, aiRateLimiter, generateCaption);
export default router;
