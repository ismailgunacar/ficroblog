import { Hono } from 'hono';
import { getLikesCollection, getAnnouncesCollection, getUsersCollection, getPostsCollection } from '../db.js';
import { renderFederationDashboard } from '../views/federationDashboard.js';
import { getDomainFromRequest } from '../utils/domain.js';
import type { Like } from '../models/like.js';
import type { Announce } from '../models/announce.js';

const federationRoutes = new Hono();

// Federation dashboard
federationRoutes.get('/', async (c) => {
  const domain = getDomainFromRequest(c);
  const likes = getLikesCollection();
  const announces = getAnnouncesCollection();
  const users = getUsersCollection();
  const posts = getPostsCollection();

  try {
    // Get federation stats
    const stats = {
      totalLikes: await likes.countDocuments({}),
      totalAnnounces: await announces.countDocuments({}),
      totalPosts: await posts.countDocuments({}),
      totalUsers: await users.countDocuments({})
    };

    // Get recent activity
    const recentLikes = await likes.find({}).sort({ createdAt: -1 }).limit(5).toArray();
    const recentAnnounces = await announces.find({}).sort({ createdAt: -1 }).limit(5).toArray();
    
    const recentActivity = [
      ...recentLikes.map(like => ({ type: 'like', ...like })),
      ...recentAnnounces.map(announce => ({ type: 'announce', ...announce }))
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10);

    return c.html(renderFederationDashboard({
      stats,
      recentActivity,
      federatedPosts: [], // You can implement this based on your needs
      loggedInUser: { username: 'admin' }, // Replace with actual user
      domain
    }));
  } catch (error) {
    console.error('Error fetching federation dashboard data:', error);
    return c.html('<h1>Error loading federation dashboard</h1>');
  }
});

// Handle incoming Like activities from remote servers
federationRoutes.post('/inbox/like', async (c) => {
  try {
    const activity = await c.req.json();
    console.log('Received Like activity:', JSON.stringify(activity, null, 2));

    if (activity.type !== 'Like') {
      return c.json({ error: 'Expected Like activity' }, 400);
    }

    const likes = getLikesCollection();
    
    // Extract actor and object info
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor?.id;
    const objectId = typeof activity.object === 'string' ? activity.object : activity.object?.id;
    
    if (!actorId || !objectId) {
      return c.json({ error: 'Missing actor or object' }, 400);
    }

    // Check if this like already exists
    const existingLike = await likes.findOne({ 
      actorId, 
      objectId,
      activityId: activity.id 
    });

    if (existingLike) {
      console.log('Like already exists, ignoring');
      return c.json({ status: 'ok' });
    }

    // Store the like
    const like: Like = {
      actorId,
      objectId,
      activityId: activity.id,
      createdAt: new Date(),
      actorUsername: activity.actor?.preferredUsername || actorId.split('/').pop(),
      actorDisplayName: activity.actor?.name,
      actorAvatar: activity.actor?.icon?.url
    };

    await likes.insertOne(like);
    console.log('Stored incoming Like activity');

    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('Error handling Like activity:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Handle incoming Announce activities from remote servers
federationRoutes.post('/inbox/announce', async (c) => {
  try {
    const activity = await c.req.json();
    console.log('Received Announce activity:', JSON.stringify(activity, null, 2));

    if (activity.type !== 'Announce') {
      return c.json({ error: 'Expected Announce activity' }, 400);
    }

    const announces = getAnnouncesCollection();
    
    // Extract actor and object info
    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor?.id;
    const objectId = typeof activity.object === 'string' ? activity.object : activity.object?.id;
    
    if (!actorId || !objectId) {
      return c.json({ error: 'Missing actor or object' }, 400);
    }

    // Check if this announce already exists
    const existingAnnounce = await announces.findOne({ 
      actorId, 
      objectId,
      activityId: activity.id 
    });

    if (existingAnnounce) {
      console.log('Announce already exists, ignoring');
      return c.json({ status: 'ok' });
    }

    // Store the announce
    const announce: Announce = {
      actorId,
      objectId,
      activityId: activity.id,
      createdAt: new Date(),
      actorUsername: activity.actor?.preferredUsername || actorId.split('/').pop(),
      actorDisplayName: activity.actor?.name,
      actorAvatar: activity.actor?.icon?.url
    };

    await announces.insertOne(announce);
    console.log('Stored incoming Announce activity');

    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('Error handling Announce activity:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Handle incoming Undo activities (for unlike/unannounce)
federationRoutes.post('/inbox/undo', async (c) => {
  try {
    const activity = await c.req.json();
    console.log('Received Undo activity:', JSON.stringify(activity, null, 2));

    if (activity.type !== 'Undo') {
      return c.json({ error: 'Expected Undo activity' }, 400);
    }

    const undoObject = activity.object;
    if (!undoObject || !undoObject.type) {
      return c.json({ error: 'Invalid Undo object' }, 400);
    }

    const actorId = typeof activity.actor === 'string' ? activity.actor : activity.actor?.id;

    if (undoObject.type === 'Like') {
      // Handle Unlike
      const likes = getLikesCollection();
      await likes.deleteOne({ 
        actorId, 
        activityId: undoObject.id 
      });
      console.log('Removed Like due to Undo activity');
    } else if (undoObject.type === 'Announce') {
      // Handle Unannounce
      const announces = getAnnouncesCollection();
      await announces.deleteOne({ 
        actorId, 
        activityId: undoObject.id 
      });
      console.log('Removed Announce due to Undo activity');
    }

    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('Error handling Undo activity:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default federationRoutes;
