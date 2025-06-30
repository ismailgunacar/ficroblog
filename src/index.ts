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
import { verifyPassword } from './auth-utils';
import { setSessionCookie, clearSessionCookie } from './session';

// Load environment variables from .env file
dotenv.config();

// Debug: Log the MongoDB URI being used
console.log('🔍 Environment check:');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'Set' : 'Not set');
console.log('NODE_ENV:', process.env.NODE_ENV || 'Not set');

const app = new Hono();

// MongoDB connection
const mongoUri = process.env.MONGODB_URI;
console.log(`🔗 Using MongoDB URI: ${mongoUri?.substring(0, 20)}...`);
export const client = new MongoClient(mongoUri || '');

// Mount Fedify routes first (ActivityPub endpoints)
console.log('🔗 Mounting Fedify federation routes...');
mountFedifyRoutes(app, client);

// Mount custom routes
console.log('🔗 Mounting custom application routes...');
mountAuthRoutes(app, client);
mountPostRoutes(app, client);
mountFollowingRoutes(app, client);

// Custom federation health endpoint
app.get('/federation-health', async (c) => {
  console.log('🏥 Federation health check requested');
  try {
    await client.connect();
    const db = client.db();
    const users = db.collection('users');
    const posts = db.collection('posts');
    const follows = db.collection('follows');
    
    const userCount = await users.countDocuments();
    const postCount = await posts.countDocuments();
    const followCount = await follows.countDocuments();
    
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      stats: {
        users: userCount,
        posts: postCount,
        follows: followCount
      },
      federation: {
        enabled: true,
        domain: getDomainFromRequest(c),
        endpoints: {
          webfinger: '/.well-known/webfinger',
          nodeinfo: '/.well-known/nodeinfo/2.0',
          users: '/users/{username}',
          inbox: '/users/{username}/inbox',
          outbox: '/users/{username}/outbox',
          followers: '/users/{username}/followers',
          following: '/users/{username}/following'
        }
      }
    });
  } catch (error) {
    console.error('❌ Federation health check failed:', error);
    return c.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Remote follow endpoint for Mastodon compatibility
app.get('/remote-follow', async (c) => {
  const username = c.req.query('acct');
  const domain = getDomainFromRequest(c);
  
  if (!username) {
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Remote Follow - fongoblog2</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      </head>
      <body>
        <main class="container">
          <h1>Remote Follow</h1>
          <p>Follow a user from another ActivityPub server.</p>
          <form method="GET" action="/remote-follow">
            <label for="acct">Account (username@domain)</label>
            <input type="text" id="acct" name="acct" placeholder="username@domain.com" required>
            <button type="submit">Follow</button>
          </form>
        </main>
      </body>
      </html>
    `);
  }
  
  // Check if user is logged in
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.redirect('/login');
  }
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  const currentUser = await users.findOne({ _id: new ObjectId(session) });
  if (!currentUser) {
    return c.redirect('/login');
  }
  
  // Parse the account
  const [remoteUsername, remoteDomain] = username.split('@');
  if (!remoteUsername || !remoteDomain) {
    return c.text('Invalid account format. Use username@domain', 400);
  }
  
  // Check if already following
  const existingFollow = await follows.findOne({
    followerId: currentUser._id.toString(),
    followingId: username
  });
  
  if (existingFollow) {
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Already Following - fongoblog2</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      </head>
      <body>
        <main class="container">
          <h1>Already Following</h1>
          <p>You are already following @${username}</p>
          <a href="/" role="button">Back to Home</a>
        </main>
      </body>
      </html>
    `);
  }
  
  // Create follow relationship
  await follows.insertOne({
    followerId: currentUser._id.toString(),
    followingId: username,
    followingUrl: `https://${remoteDomain}/users/${remoteUsername}`,
    followingInbox: `https://${remoteDomain}/users/${remoteUsername}/inbox`,
    remote: true,
    createdAt: new Date()
  });
  
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Following - fongoblog2</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
    </head>
    <body>
      <main class="container">
        <h1>Following</h1>
        <p>You are now following @${username}</p>
        <a href="/" role="button">Back to Home</a>
      </main>
    </body>
    </html>
  `);
});

// Homepage route (following tutorial pattern)
app.get('/', async (c) => {
  await client.connect();
  const db = client.db();
  const posts = db.collection<Post>('posts');
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  // Check if any users exist, if not redirect to setup
  const anyUser = await users.findOne({});
  if (!anyUser) return c.redirect('/setup');
  
  // Check session via cookie (seamless login)
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
  
  // If logged in, also fetch remote posts from followed users (following tutorial pattern)
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
                      const remotePost: Post = {
                        _id: new ObjectId(), // Generate a local ID
                        userId: remoteFollow.followingId as string, // Use the remote user ID as string
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
  if (user?._id) {
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

// Root POST handler (login and post creation)
app.post('/', async (c) => {
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const posts = db.collection<Post>('posts');
  const follows = db.collection<Follow>('follows');
  const user = await users.findOne({});
  if (!user) return c.redirect('/setup');
  const body = await c.req.parseBody();
  
  // If password is present, treat as login attempt
  if (typeof body.password === 'string') {
    const password = body.password;
    const valid = await verifyPassword(password, user.passwordHash);
    
    // Fetch posts and stats as in GET '/'
    const allPosts = await posts.find({}).sort({ createdAt: -1 }).limit(20).toArray();
    const userMap = new Map<string, User>();
    for (const post of allPosts) {
      const userIdStr = post.userId.toString();
      if (post.userId && !userMap.has(userIdStr)) {
        let postUser: User | null = null;
        try {
          const userId = typeof post.userId === 'string' ? new ObjectId(post.userId) : post.userId;
          postUser = await users.findOne({ _id: userId });
        } catch (e) {}
        if (postUser) {
          userMap.set(userIdStr, postUser);
        }
      }
    }
    
    // Stats for profile card
    let postCount = 0;
    let followerCount = 0;
    let followingCount = 0;
    if (user._id) {
      postCount = await posts.countDocuments({ userId: user._id.toString() });
      followerCount = await follows.countDocuments({ followingId: user._id.toString() });
      followingCount = await follows.countDocuments({ followerId: user._id.toString() });
    }
    
    // Detect if JSON is expected
    const wantsJson = c.req.header('x-requested-with') === 'fetch' ||
      c.req.header('accept')?.includes('application/json') ||
      c.req.header('content-type')?.includes('application/json') ||
      c.req.header('x-requested-with') === 'XMLHttpRequest';
    
    if (!valid) {
      if (wantsJson) {
        const domain = getDomainFromRequest(c);
        return c.json({ success: false, html: renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn: false, invalidPassword: true, domain }) });
      }
      const domain = getDomainFromRequest(c);
      return c.html(renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn: false, invalidPassword: true, domain }));
    }
    
    if (user._id) {
      setSessionCookie(c, user._id.toString());
    }
    
    if (wantsJson) {
      const domain = getDomainFromRequest(c);
      return c.json({ success: true, html: renderHome({ user, postCount, followerCount, followingCount, allPosts, userMap, loggedIn: true, invalidPassword: false, domain }) });
    }
    return c.redirect('/');
  }
  
  // If content is present, treat as post form (only for logged-in user)
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) return c.redirect('/');
  const loggedInUser = await users.findOne({ _id: new ObjectId(session) });
  if (!loggedInUser) return c.redirect('/');
  const content = typeof body.content === 'string' ? body.content : '';
  if (!content) return c.redirect('/');
  
  const result = await posts.insertOne({ userId: loggedInUser._id, content, createdAt: new Date() });
  
  return c.redirect('/');
});

// Logout handler (AJAX and fallback)
app.post('/logout', async (c) => {
  clearSessionCookie(c);
  return c.json({ success: true });
});

// Follow/Unfollow user via @username
app.post('/@:username/follow', async (c) => {
  const username = c.req.param('username');
  
  // Check if user is logged in
  const session = getCookie(c, 'session');
  if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
    return c.json({ success: false, error: 'Not logged in' });
  }
  
  await client.connect();
  const db = client.db();
  const users = db.collection<User>('users');
  const follows = db.collection<Follow>('follows');
  
  const currentUser = await users.findOne({ _id: new ObjectId(session) });
  if (!currentUser) {
    return c.json({ success: false, error: 'User not found' });
  }
  
  const targetUser = await users.findOne({ username });
  if (!targetUser) {
    return c.json({ success: false, error: 'Target user not found' });
  }
  
  // Check if already following
  const existingFollow = await follows.findOne({
    followerId: currentUser._id.toString(),
    followingId: targetUser._id.toString()
  });
  
  if (existingFollow) {
    // Unfollow
    await follows.deleteOne({
      followerId: currentUser._id.toString(),
      followingId: targetUser._id.toString()
    });
    return c.json({ success: true, following: false });
  }
  
  // Follow
  await follows.insertOne({
    followerId: currentUser._id.toString(),
    followingId: targetUser._id.toString(),
    createdAt: new Date()
  });
  return c.json({ success: true, following: true });
});

// @username route (direct profile page) - DEFINED AFTER specific routes
app.get('/@*', async (c) => {
  console.log('=== @USERNAME ROUTE HIT ===');
  
  const path = c.req.path;
  console.log('Path:', path);
  
  const username = path.substring(2); // Remove the /@ prefix
  console.log('Username from @ route:', username);
  
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
    if (currentUser) loggedIn = true;
  }
  
  // Get user's posts
  const userPosts = await posts.find({ userId: profileUser._id }).sort({ createdAt: -1 }).toArray();
  
  // Get follow stats
  const followerCount = await follows.countDocuments({ followingId: profileUser._id.toString() });
  const followingCount = await follows.countDocuments({ followerId: profileUser._id.toString() });
  
  // Check if current user is following this user
  let isFollowing = false;
  if (loggedIn && currentUser?._id) {
    const follow = await follows.findOne({
      followerId: currentUser._id.toString(),
      followingId: profileUser._id.toString()
    });
    isFollowing = !!follow;
  }
  
  const domain = getDomainFromRequest(c);
  
  // Create userMap for posts
  const userMap = new Map<string, User>();
  userMap.set(profileUser._id.toString(), profileUser);
  
  console.log('Rendering @username profile page for:', username);
  
  const html = renderUserProfile({ 
    profileUser, 
    currentUser, 
    userPosts, 
    userMap,
    loggedIn, 
    isOwnProfile: loggedIn && currentUser?._id?.toString() === profileUser._id?.toString(),
    isFollowing, 
    postCount: userPosts.length,
    followerCount, 
    followingCount, 
    domain 
  });
  
  return c.html(html);
});

// User profile page (preserving @username endpoints)
app.get('/profile/:username', async (c) => {
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
    if (currentUser) loggedIn = true;
  }
  
  // Get user's posts
  const userPosts = await posts.find({ userId: profileUser._id }).sort({ createdAt: -1 }).toArray();
  
  // Get follow stats
  const followerCount = await follows.countDocuments({ followingId: profileUser._id.toString() });
  const followingCount = await follows.countDocuments({ followerId: profileUser._id.toString() });
  
  // Check if current user is following this user
  let isFollowing = false;
  if (loggedIn && currentUser?._id) {
    const follow = await follows.findOne({
      followerId: currentUser._id.toString(),
      followingId: profileUser._id.toString()
    });
    isFollowing = !!follow;
  }
  
  const domain = getDomainFromRequest(c);
  
  // Create userMap for posts
  const userMap = new Map<string, User>();
  userMap.set(profileUser._id.toString(), profileUser);
  
  const html = renderUserProfile({ 
    profileUser, 
    currentUser, 
    userPosts, 
    userMap,
    loggedIn, 
    isOwnProfile: loggedIn && currentUser?._id?.toString() === profileUser._id?.toString(),
    isFollowing, 
    postCount: userPosts.length,
    followerCount, 
    followingCount, 
    domain 
  });
  
  return c.html(html);
});

// Start the server
console.log('🚀 Starting fongoblog2 server...');
serve({
  fetch: app.fetch,
  port: 8000
});
console.log('✅ Server started at http://0.0.0.0:8000');
console.log('🎉 Fedify federation enabled!');
console.log('🔗 ActivityPub endpoints available at:');
console.log('   - /.well-known/webfinger');
console.log('   - /.well-known/nodeinfo/2.0');
console.log('   - /users/{username}');
console.log('   - /users/{username}/inbox');
console.log('   - /users/{username}/outbox');
console.log('   - /users/{username}/followers');
console.log('   - /users/{username}/following');
console.log('🔗 Custom endpoints:');
console.log('   - /federation-health');
console.log('   - /remote-follow');
console.log('   - /profile/{username}'); 