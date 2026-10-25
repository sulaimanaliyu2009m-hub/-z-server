import { Router } from 'express';
import { generateCaptions, generateCaption, summarizePost, aiChat } from '../controllers/aiController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/generate-caption', authenticate, generateCaptions);
router.post('/caption', authenticate, generateCaption);
router.post('/summarize', authenticate, summarizePost);
router.post('/chat', authenticate, aiChat);

export default router;
