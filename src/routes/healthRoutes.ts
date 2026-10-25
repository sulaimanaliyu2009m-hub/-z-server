import { Router } from 'express';
import { getHealth, getDeepHealth, getStorageHealth } from '../controllers/healthController';

const router = Router();

router.get('/', getHealth);
router.get('/deep', getDeepHealth);
router.get('/storage', getStorageHealth);

export default router;
