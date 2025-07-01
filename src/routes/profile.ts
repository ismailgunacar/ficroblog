import { Hono } from 'hono';
import { getUsersCollection } from '../db.js';

const profileRoutes = new Hono();

// Profile page
profileRoutes.get('/:username', async (c) => {
  const username = c.req.param('username');
  
  try {
    const users = getUsersCollection();
    const user = await users.findOne({ username });
    
    if (!user) {
      return c.html('<h1>User not found</h1>', 404);
    }
    
    // Simple profile page
    return c.html(`
      <html>
        <head>
          <title>@${username}</title>
        </head>
        <body>
          <h1>@${username}</h1>
          <p>Display Name: ${user.displayName || username}</p>
          <p>Bio: ${user.bio || 'No bio available'}</p>
          <a href="/">← Back to Home</a>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error loading profile:', error);
    return c.html('<h1>Error loading profile</h1>', 500);
  }
});

export default profileRoutes;