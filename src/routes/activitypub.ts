import { Hono } from 'hono';
import { getUsersCollection, getFollowsCollection } from '../db';

const activitypubRoutes = new Hono();

// ActivityPub: /users/:username/following
activitypubRoutes.get('/users/:username/following', async (c) => {
  const username = c.req.param('username');
  const users = getUsersCollection();
  const follows = getFollowsCollection();
  const user = await users.findOne({ username });
  if (!user) return c.notFound();

  // Find all users this user is following
  const following = await follows.find({ followerId: user._id.toString() }).toArray();
  const followingUrls = following.map(f => `https://${c.req.header('host')}/users/${f.followingId}`);

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${c.req.header('host')}/users/${username}/following`,
    type: 'OrderedCollection',
    totalItems: followingUrls.length,
    orderedItems: followingUrls,
  });
});

// ActivityPub: /users/:username/followers
activitypubRoutes.get('/users/:username/followers', async (c) => {
  const username = c.req.param('username');
  const users = getUsersCollection();
  const follows = getFollowsCollection();
  const user = await users.findOne({ username });
  if (!user) return c.notFound();

  // Find all users following this user
  const followers = await follows.find({ followingId: user._id.toString() }).toArray();
  const followerUrls = followers.map(f => `https://${c.req.header('host')}/users/${f.followerId}`);

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${c.req.header('host')}/users/${username}/followers`,
    type: 'OrderedCollection',
    totalItems: followerUrls.length,
    orderedItems: followerUrls,
  });
});

export default activitypubRoutes;
