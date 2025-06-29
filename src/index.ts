import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { MongoClient } from 'mongodb';
import { getCookie } from 'hono/cookie';
import { ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import { mountFedifyRoutes } from './fedify';
import { mountAuthRoutes } from './routes/auth';
import { mountPostRoutes } from './routes/posts';
import { mountFollowingRoutes } from './routes/following';
import { renderHome, renderUserProfile } from './views/home';
import { getDomainFromRequest } from './utils';
import type { User, Post, Follow } from './models';

// Load environment variables from .env file
dotenv.config();

const app = new Hono();

// MongoDB connection
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/fongoblog2';
export const client = new MongoClient(mongoUri);

// Homepage route
app.get('/', async (c) => {
  await client.connect();
  const db = client.db();
  const posts = db.collection<Post>('posts');
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  // Check if any users exist, if not redirect to setup
  const anyUser = await users.findOne({});
  if (!anyUser) return c.redirect('/setup');
  
  // Check session via cookie
  const session = getCookie(c, 'session');
  let loggedIn = false;
  let user: User | null = null;
  if (session && session.length === 24 && /^[a-fA-F0-9]+$/.test(session)) {
    user = await users.findOne({ _id: new ObjectId(session) });
    if (user) loggedIn = true;
  } else {
    user = await users.findOne({}); // fallback for stats if not logged in
  }
  
  // Get local posts
  let allPosts = await posts.find({}).sort({ createdAt: -1 }).limit(20).toArray();
  
  // If logged in, also fetch remote posts from followed users
  if (loggedIn && user) {
    const remoteFollows = await follows.find({ 
      followerId: user._id?.toString(), 
      remote: true 
    }).toArray();
    
    // Fetch remote posts for each followed remote user
    for (const remoteFollow of remoteFollows) {
      try {
        if (remoteFollow.followingUrl) {
          // Get the outbox URL from the actor profile
          const actorResponse = await fetch(remoteFollow.followingUrl, {
            headers: {
              'Accept': 'application/activity+json'
            }
          });
          
          if (actorResponse.ok) {
            const actor = await actorResponse.json();
            const outboxUrl = actor.outbox;
            
            if (outboxUrl) {
              // Fetch recent posts from the outbox
              const outboxResponse = await fetch(outboxUrl, {
                headers: {
                  'Accept': 'application/activity+json'
                }
              });
              
              if (outboxResponse.ok) {
                const outbox = await outboxResponse.json();
                
                // Process Create activities that contain Note objects
                if (outbox.orderedItems) {
                  for (const activity of outbox.orderedItems.slice(0, 5)) { // Limit to 5 recent posts
                    if (activity.type === 'Create' && activity.object && activity.object.type === 'Note') {
                      const remotePost = {
                        _id: new ObjectId(), // Generate a local ID
                        userId: remoteFollow.followingId, // Use the remote user ID
                        content: activity.object.content || '',
                        createdAt: new Date(activity.published || activity.object.published || Date.now()),
                        federated: true,
                        federatedFrom: activity.actor,
                        remote: true,
                        remotePostId: activity.object.id,
                        remoteActor: activity.actor
                      };
                      
                      allPosts.push(remotePost);
                    }
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching remote posts for ${remoteFollow.followingId}:`, error);
      }
    }
    
    // Sort all posts by creation date (newest first)
    allPosts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // Limit to 20 posts total
    allPosts = allPosts.slice(0, 20);
  }
  
  // Fetch usernames for posts
  const userMap = new Map<string, User>();
  for (const post of allPosts) {
    const userIdStr = post.userId.toString();
    if (post.userId && !userMap.has(userIdStr)) {
      // Check if this is a remote user
      if (post.remote) {
        // For remote users, create a virtual user object
        const remoteUsername = post.userId.toString();
        userMap.set(userIdStr, {
          _id: remoteUsername,
          username: remoteUsername.split('@')[0] || remoteUsername,
          name: remoteUsername.split('@')[0] || remoteUsername,
          bio: `Remote user from ${remoteUsername.split('@')[1] || 'unknown domain'}`,
          avatarUrl: '',
          headerUrl: '',
          passwordHash: '',
          createdAt: new Date()
        });
      } else {
        // Local user
        let user: User | null = null;
        try {
          // Handle both ObjectId and string types
          const userId = typeof post.userId === 'string' ? new ObjectId(post.userId) : post.userId;
          user = await users.findOne({ _id: userId });
        } catch (e) {
          // ignore invalid ObjectId
        }
        if (user) {
          userMap.set(userIdStr, user);
        }
      }
    }
  }
  
  // Stats
  let postCount = 0;
  let followerCount = 0;
  let followingCount = 0;
  if (user && user._id) {
    postCount = await posts.countDocuments({}); // Count all posts, not just user's posts
    followerCount = await follows.countDocuments({ followingId: user._id.toString() });
    followingCount = await follows.countDocuments({ followerId: user._id.toString() });
  }
  
  // Detect if JSON is expected
  const wantsJson = c.req.header('x-requested-with') === 'fetch' || c.req.header('accept')?.includes('application/json') || c.req.header('content-type')?.includes('application/json');
  const domain = getDomainFromRequest(c);
  const html = renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn, invalidPassword: false, domain });
  if (wantsJson) {
    return c.json({ html });
  }
  return c.html(html);
});

// User profile page
app.get('/users/:username', async (c) => {
  const username = c.req.param('username');
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  const follows = db.collection<Follow>('follows');
  
  const profileUser = await users.findOne({ username });
  if (!profileUser) {
    return c.text('User not found', 404);
  }
  
  // Check if current user is logged in
  const session = getCookie(c, 'session');
  let loggedIn = false;
  let currentUser: User | null = null;
  
  if (session && session.length === 24 && /^[a-fA-F0-9]+$/.test(session)) {
    currentUser = await users.findOne({ _id: new ObjectId(session) });
    if (currentUser) {
      loggedIn = true;
    }
  }
  
  // Get user's posts
  const userPosts = await posts.find({ userId: profileUser._id }).sort({ createdAt: -1 }).toArray();
  
  // Check if current user is following this user
  let isFollowing = false;
  if (loggedIn && currentUser && currentUser._id) {
    const follow = await follows.findOne({
      followerId: currentUser._id.toString(),
      followingId: profileUser._id.toString()
    });
    isFollowing = !!follow;
  }
  
  // Get stats
  const postCount = await posts.countDocuments({ userId: profileUser._id });
  const followerCount = await follows.countDocuments({ followingId: profileUser._id.toString() });
  const followingCount = await follows.countDocuments({ followerId: profileUser._id.toString() });
  
  const isOwnProfile = loggedIn && currentUser && currentUser._id?.toString() === profileUser._id.toString();
  
  const domain = getDomainFromRequest(c);
  
  return c.html(renderUserProfile({
    profileUser,
    currentUser,
    userPosts,
    userMap: new Map([[profileUser._id.toString(), profileUser]]),
    loggedIn,
    isOwnProfile,
    isFollowing,
    postCount,
    followerCount,
    followingCount,
    domain
  }));
});

// Follow/unfollow handlers
app.post('/follow', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.json({ success: false, error: 'Not logged in' });
  }
  
  const currentUser = await users.findOne({ _id: new ObjectId(session) });
  if (!currentUser) {
    return c.json({ success: false, error: 'User not found' });
  }
  
  const body = await c.req.parseBody();
  const targetUserId = typeof body['userId'] === 'string' ? body['userId'] : '';
  
  if (!targetUserId) {
    return c.json({ success: false, error: 'User ID required' });
  }
  
  // Check if already following
  const existingFollow = await follows.findOne({
    followerId: currentUser._id?.toString(),
    followingId: targetUserId
  });
  
  if (existingFollow) {
    return c.json({ success: false, error: 'Already following this user' });
  }
  
  // Create follow relationship
  await follows.insertOne({
    followerId: currentUser._id?.toString(),
    followingId: targetUserId,
    createdAt: new Date()
  });
  
  return c.json({ success: true });
});

app.post('/unfollow', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.json({ success: false, error: 'Not logged in' });
  }
  
  const currentUser = await users.findOne({ _id: new ObjectId(session) });
  if (!currentUser) {
    return c.json({ success: false, error: 'User not found' });
  }
  
  const body = await c.req.parseBody();
  const targetUserId = typeof body['userId'] === 'string' ? body['userId'] : '';
  
  if (!targetUserId) {
    return c.json({ success: false, error: 'User ID required' });
  }
  
  // Remove follow relationship
  const result = await follows.deleteOne({
    followerId: currentUser._id?.toString(),
    followingId: targetUserId
  });
  
  if (result.deletedCount > 0) {
    return c.json({ success: true });
  } else {
    return c.json({ success: false, error: 'Not following this user' });
  }
});

// Federation health check
app.get('/federation-health', async (c) => {
  const domain = getDomainFromRequest(c);
  return c.json({
    status: 'healthy',
    domain,
    nodeInfo: `https://${domain}/.well-known/nodeinfo/2.0`
  });
});

// Mount modular routes
mountAuthRoutes(app, client);
mountPostRoutes(app, client);
mountFollowingRoutes(app, client);

// Mount Fedify ActivityPub routes
mountFedifyRoutes(app, client);

// Start server
serve({ fetch: app.fetch, port: 8000 });

console.log('🚀 DEPLOYED VERSION: ' + new Date().toISOString()); 