import { Hono } from 'hono';
import { getPostsCollection } from '../db.js';
import { renderHome } from '../views/home.js';
import { getDefaultUser } from '../utils/session.js';

const homeRoutes = new Hono();

// Home page
homeRoutes.get('/', async (c) => {
  try {
    const posts = getPostsCollection();
    const user = getDefaultUser();
    
    // Get recent posts
    const recentPosts = await posts.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    
    // Add like/announce counts and status for each post
    const postsWithStats = recentPosts.map(post => ({
      ...post,
      likeCount: 0, // TODO: Get actual counts
      announceCount: 0, // TODO: Get actual counts
      isLiked: false, // TODO: Check if user liked
      isAnnounced: false // TODO: Check if user announced
    }));
    
    return c.html(renderHome({ 
      user, 
      posts: postsWithStats 
    }));
  } catch (error) {
    console.error('Error loading home page:', error);
    return c.html('<h1>Error loading home page</h1>');
  }
});

export default homeRoutes;