import { Hono } from 'hono';
import { MongoClient, ObjectId } from 'mongodb';
import { getCookie } from 'hono/cookie';
import { Post, User } from '../models';
import { renderHome, renderPostPermalink } from '../views/home';
import { getDomainFromRequest } from '../utils';

export function mountPostRoutes(app: Hono, client: MongoClient) {
  // Create post handler
  app.post('/post', async (c) => {
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    const posts = db.collection<Post>('posts');
    
    const session = getCookie(c, 'session');
    if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
      return c.json({ success: false, error: 'Not logged in' });
    }
    
    const user = await users.findOne({ _id: new ObjectId(session) });
    if (!user) {
      return c.json({ success: false, error: 'User not found' });
    }
    
    const body = await c.req.parseBody();
    const content = typeof body['content'] === 'string' ? body['content'] : '';
    
    if (!content.trim()) {
      return c.json({ success: false, error: 'Post content cannot be empty' });
    }
    
    const post: Post = {
      userId: user._id,
      content: content.trim(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await posts.insertOne(post);
    return c.json({ success: true, post });
  });

  // Post permalink page
  app.get('/posts/:id', async (c) => {
    const postId = c.req.param('id');
    console.log('=== POST PERMALINK ROUTE HIT ===');
    console.log('Looking for post ID:', postId);
    
    await client.connect();
    const db = client.db();
    const posts = db.collection<Post>('posts');
    const users = db.collection<User>('users');
    
    let post: Post | null = null;
    try {
      post = await posts.findOne({ _id: new ObjectId(postId) });
      console.log('Found post:', post);
    } catch (e) {
      console.error('Error finding post:', e);
    }
    
    if (!post) {
      return c.text('Post not found', 404);
    }
    
    console.log('Rendering post permalink page for:', postId);
    
    // Get post author
    const postAuthor = await users.findOne({ _id: post.userId });
    if (!postAuthor) {
      return c.text('Post author not found', 404);
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
    
    // Get stats for the current user
    let postCount = 0;
    let followerCount = 0;
    let followingCount = 0;
    
    if (currentUser && currentUser._id) {
      postCount = await posts.countDocuments({ userId: currentUser._id });
      const follows = db.collection('follows');
      followerCount = await follows.countDocuments({ followingId: currentUser._id.toString() });
      followingCount = await follows.countDocuments({ followerId: currentUser._id.toString() });
    }
    
    const domain = getDomainFromRequest(c);
    
    return c.html(renderPostPermalink({
      post,
      postAuthor,
      currentUser,
      userMap: new Map([[postAuthor._id.toString(), postAuthor]]),
      loggedIn,
      postCount,
      followerCount,
      followingCount,
      domain
    }));
  });
} 