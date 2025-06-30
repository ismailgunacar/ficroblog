import { Hono } from 'hono';
import { getUsersCollection } from '../db.js';
import { renderUserProfile } from '../views/profile.js';

const profileRoutes = new Hono();

// Route: /@username
profileRoutes.get('/:username', async (c) => {
  const username = c.req.param('username');
  const users = getUsersCollection();
  const user = await users.findOne({ username });
  if (!user) return c.notFound();
  return c.html(renderUserProfile(user));
});

export default profileRoutes;
