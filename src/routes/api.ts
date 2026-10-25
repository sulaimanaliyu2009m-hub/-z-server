import { Router } from 'express';
import { register, login } from '../controllers/authController';
import { createPost, getFeed } from '../controllers/postController';
import { toggleLike, addComment, toggleFollow } from '../controllers/interactionController';
import {
  getUploadUrl,
  processVideo,
  getVideoStatus,
  getVideoLimits,
} from '../controllers/videoController';
import { getActiveStories, createStory } from '../controllers/storyController';
import { 
  getConversations, createConversation, getMessages, sendMessageHttp,
  getNotifications, markNotificationsRead, searchUsers 
} from '../controllers/chatController';
import { 
  getGroups, createGroup, toggleJoinGroup, getGroupPosts, createGroupPost,
  getGroupMembers, getGroupEvents, createGroupEvent, rsvpEvent 
} from '../controllers/communityController';
import { 
  search, getTrendingHashtags, getSuggestedUsers, getPostsByHashtag 
} from '../controllers/discoverController';
import { getLivePosts, createLivePost, toggleRepost } from '../controllers/liveController';
import { generateCaptions, summarizePost, aiChat, testAiHealth } from '../controllers/aiController';
import { getForYouFeed, recordWatchTime } from '../controllers/recommendationController';
import { reportContent, toggleBlockUser } from '../controllers/moderationController';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

// Auth
router.post('/auth/register', authLimiter, register);
router.post('/auth/login', authLimiter, login);

// Posts & Feed
router.get('/posts/feed', authenticate, getFeed);
router.post('/posts', authenticate, createPost);

// Social
router.post('/posts/:id/like', authenticate, toggleLike);
router.post('/posts/:id/comment', authenticate, addComment);
router.post('/users/:id/follow', authenticate, toggleFollow);

// Video Upload
router.get('/videos/limits', authenticate, getVideoLimits);
router.post('/videos/upload-url', authenticate, getUploadUrl);
router.post('/videos/process', authenticate, processVideo);
router.get('/videos/:id/status', authenticate, getVideoStatus);

// Stories
router.get('/stories', authenticate, getActiveStories);
router.post('/stories', authenticate, createStory);

// Chat & DMs
router.get('/conversations', authenticate, getConversations);
router.post('/conversations', authenticate, createConversation);
router.get('/conversations/:id/messages', authenticate, getMessages);
router.post('/conversations/:id/messages', authenticate, sendMessageHttp);

// Notifications & User Search
router.get('/notifications', authenticate, getNotifications);
router.post('/notifications/read-all', authenticate, markNotificationsRead);
router.get('/users/search', authenticate, searchUsers);

// Communities & Events
router.get('/groups', authenticate, getGroups);
router.post('/groups', authenticate, createGroup);
router.post('/groups/:id/join', authenticate, toggleJoinGroup);
router.get('/groups/:id/posts', authenticate, getGroupPosts);
router.post('/groups/:id/posts', authenticate, createGroupPost);
router.get('/groups/:id/members', authenticate, getGroupMembers);
router.get('/groups/:id/events', authenticate, getGroupEvents);
router.post('/groups/:id/events', authenticate, createGroupEvent);
router.post('/events/:eventId/rsvp', authenticate, rsvpEvent);

// Discover
router.get('/discover/search', authenticate, search);
router.get('/discover/trending', authenticate, getTrendingHashtags);
router.get('/discover/suggested-users', authenticate, getSuggestedUsers);
router.get('/discover/tags/:tag', authenticate, getPostsByHashtag);

// Live Feed
router.get('/live/posts', authenticate, getLivePosts);
router.post('/live/posts', authenticate, createLivePost);
router.post('/live/repost/:id', authenticate, toggleRepost);

// AI Routes
router.post('/ai/generate-caption', authenticate, generateCaptions);
router.post('/ai/summarize', authenticate, summarizePost);
router.post('/ai/chat', authenticate, aiChat);
router.get('/ai/test', testAiHealth);

// Recommendation Engine
router.get('/recommend/for-you', authenticate, getForYouFeed);
router.post('/videos/watch', authenticate, recordWatchTime);

// Moderation
router.post('/moderation/report', authenticate, reportContent);
router.post('/moderation/block', authenticate, toggleBlockUser);

export default router;
