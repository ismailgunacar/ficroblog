import { Hono } from 'hono';
import { getDomainFromRequest, getBaseUrlFromRequest } from '../utils/domain.js';
import { getUsersCollection } from '../db.js';

const activitypubRoutes = new Hono();

// User actor endpoint
activitypubRoutes.get('/users/:username', async (c) => {
  const username = c.req.param('username');
  const domain = getDomainFromRequest(c);
  const baseUrl = getBaseUrlFromRequest(c);
  
  // Check Accept header for ActivityPub content type
  const accept = c.req.header('accept') || '';
  const isActivityPub = accept.includes('application/activity+json') || 
                        accept.includes('application/ld+json');
  
  if (!isActivityPub) {
    // Redirect to profile page for regular browsers
    return c.redirect(`/@${username}`);
  }

  try {
    const users = getUsersCollection();
    const user = await users.findOne({ username });
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Create ActivityPub Actor object
    const actor = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1'
      ],
      id: `${baseUrl}/users/${username}`,
      type: 'Person',
      preferredUsername: username,
      name: user.displayName || username,
      summary: user.bio || `Posts from ${username}`,
      url: `${baseUrl}/@${username}`,
      inbox: `${baseUrl}/users/${username}/inbox`,
      outbox: `${baseUrl}/users/${username}/outbox`,
      followers: `${baseUrl}/users/${username}/followers`,
      following: `${baseUrl}/users/${username}/following`,
      icon: user.avatarUrl ? {
        type: 'Image',
        mediaType: 'image/png',
        url: user.avatarUrl
      } : undefined,
      publicKey: {
        id: `${baseUrl}/users/${username}#main-key`,
        owner: `${baseUrl}/users/${username}`,
        publicKeyPem: user.publicKey || '--- PLACEHOLDER PUBLIC KEY ---'
      }
    };

    return c.json(actor, 200, {
      'Content-Type': 'application/activity+json; charset=utf-8'
    });
  } catch (error) {
    console.error('Error fetching user for ActivityPub:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// User inbox endpoint
activitypubRoutes.post('/users/:username/inbox', async (c) => {
  const username = c.req.param('username');
  
  try {
    const activity = await c.req.json();
    console.log(`Received activity for ${username}:`, JSON.stringify(activity, null, 2));
    
    // For now, just log the activity
    // In a full implementation, you'd process different activity types
    
    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('Error processing inbox activity:', error);
    return c.json({ error: 'Bad request' }, 400);
  }
});

// User outbox endpoint
activitypubRoutes.get('/users/:username/outbox', async (c) => {
  const username = c.req.param('username');
  const baseUrl = getBaseUrlFromRequest(c);
  
  try {
    // Create a simple outbox
    const outbox = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${baseUrl}/users/${username}/outbox`,
      type: 'OrderedCollection',
      totalItems: 0,
      orderedItems: []
    };

    return c.json(outbox, 200, {
      'Content-Type': 'application/activity+json; charset=utf-8'
    });
  } catch (error) {
    console.error('Error fetching outbox:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// User followers endpoint
activitypubRoutes.get('/users/:username/followers', async (c) => {
  const username = c.req.param('username');
  const baseUrl = getBaseUrlFromRequest(c);
  
  try {
    // Create a simple followers collection
    const followers = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${baseUrl}/users/${username}/followers`,
      type: 'OrderedCollection',
      totalItems: 0,
      orderedItems: []
    };

    return c.json(followers, 200, {
      'Content-Type': 'application/activity+json; charset=utf-8'
    });
  } catch (error) {
    console.error('Error fetching followers:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// User following endpoint
activitypubRoutes.get('/users/:username/following', async (c) => {
  const username = c.req.param('username');
  const baseUrl = getBaseUrlFromRequest(c);
  
  try {
    // Create a simple following collection
    const following = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${baseUrl}/users/${username}/following`,
      type: 'OrderedCollection',
      totalItems: 0,
      orderedItems: []
    };

    return c.json(following, 200, {
      'Content-Type': 'application/activity+json; charset=utf-8'
    });
  } catch (error) {
    console.error('Error fetching following:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// WebFinger endpoint
activitypubRoutes.get('/.well-known/webfinger', async (c) => {
  const resource = c.req.query('resource');
  const domain = getDomainFromRequest(c);
  const baseUrl = getBaseUrlFromRequest(c);
  
  if (!resource) {
    return c.json({ error: 'Missing resource parameter' }, 400);
  }

  // Parse resource (should be acct:username@domain)
  const match = resource.match(/^acct:([^@]+)@(.+)$/);
  if (!match) {
    return c.json({ error: 'Invalid resource format' }, 400);
  }

  const [, username, resourceDomain] = match;
  
  // Check if this is for our domain
  if (resourceDomain !== domain) {
    return c.json({ error: 'Unknown domain' }, 404);
  }

  try {
    const users = getUsersCollection();
    const user = await users.findOne({ username });
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const webfinger = {
      subject: resource,
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: `${baseUrl}/users/${username}`
        }
      ]
    };

    return c.json(webfinger, 200, {
      'Content-Type': 'application/jrd+json; charset=utf-8'
    });
  } catch (error) {
    console.error('Error processing WebFinger request:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default activitypubRoutes;