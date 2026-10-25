import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getProfile,
  toggleFollow,
  getFollowers,
  getFollowing,
  checkUsername,
  updateProfile,
} from '../controllers/userProfileController';

const router = Router();

// Public / Authenticated Lookups
router.get('/u/:identifier', getProfile);
router.get('/check-username', checkUsername);
router.get('/:identifier/followers', getFollowers);
router.get('/:identifier/following', getFollowing);

// Mutating Actions (Protected)
router.post('/:targetId/follow', authenticateToken, toggleFollow);
router.put('/profile', authenticateToken, updateProfile);

export default router;
