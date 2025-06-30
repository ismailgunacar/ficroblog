import { Hono } from 'hono';
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

// Middleware
import { sessionMiddleware, clearSessionCookie } from './session';

// Route modules
import { createHomeRoutes } from './routes/home';
import { createUserRoutes } from './routes/user';
import { createPostRoutes } from './routes/post';
import { createSetupRoutes } from './routes/setup';
import { createFederationRoutes } from './routes/federation';
import { createRemoteFollowRoutes } from './routes/remoteFollow';

// Fedify integration
import { mountFedifyRoutes } from './fedify';

dotenv.config();

const app = new Hono();

// Session middleware
app.use(sessionMiddleware);

// Static files
app.use('/styles/*', serveStatic({ root: './src' }));
app.use('/client/*', serveStatic({ root: './src' }));

// Database setup
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error('MONGODB_URI is not set in environment variables');
}

const client = new MongoClient(mongoUri);
export { client };

// Mount route modules
app.route('/', createHomeRoutes(client));
app.route('/', createUserRoutes(client));
app.route('/', createPostRoutes(client));
app.route('/', createSetupRoutes(client));
app.route('/', createFederationRoutes(client));
app.route('/', createRemoteFollowRoutes(client));

// Logout handler
app.post('/logout', async (c) => {
  clearSessionCookie(c);
  return c.json({ success: true });
});

// Profile editing (AJAX)
app.post('/profile/edit', async (c) => {
  await client.connect();
  const db = client.db();
  
  const { name, username, bio, avatarUrl, headerUrl } = await c.req.json();
  // TODO: Add validation and session check
  
  return c.json({ success: true });
});

// Mount Fedify routes for ActivityPub
mountFedifyRoutes(app, client);

// Start server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

console.log(`🚀 Server starting on port ${port}`);
console.log(`📱 Local: http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port
});