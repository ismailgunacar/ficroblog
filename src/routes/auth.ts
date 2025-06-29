import { Hono } from 'hono';
import { MongoClient, ObjectId } from 'mongodb';
import { getCookie, setCookie } from 'hono/cookie';
import { hashPassword, verifyPassword } from '../auth-utils';
import { generateKeyPair } from '../keys';
import type { User } from '../models';

export function mountAuthRoutes(app: Hono, client: MongoClient) {
  // Login handler
  app.post('/login', async (c) => {
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    
    const body = await c.req.parseBody();
    const username = body.username as string;
    const password = body.password as string;
    
    if (!username || !password) {
      return c.json({ success: false, error: 'Username and password required' });
    }
    
    const user = await users.findOne({ username });
    if (!user) {
      return c.json({ success: false, error: 'User not found' });
    }
    
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return c.json({ success: false, error: 'Invalid password' });
    }
    
    setCookie(c, 'session', user._id.toString(), { httpOnly: true, path: '/' });
    return c.json({ success: true, user: { username: user.username, name: user.name } });
  });

  // Logout handler
  app.post('/logout', async (c) => {
    setCookie(c, 'session', '', { httpOnly: true, path: '/', maxAge: 0 });
    return c.json({ success: true });
  });

  // Setup page (first user creation)
  app.get('/setup', async (c) => {
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    
    const anyUser = await users.findOne({});
    if (anyUser) {
      return c.redirect('/');
    }
    
    return c.html(`
      <!DOCTYPE html>
      <html lang="en" data-theme="light">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Setup - fongoblog2</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css">
      </head>
      <body>
        <main class="container">
          <h1>Welcome to fongoblog2!</h1>
          <p>Let's create your first user account.</p>
          <form method="POST" action="/setup">
            <label for="username">Username</label>
            <input type="text" id="username" name="username" required>
            <label for="name">Display Name</label>
            <input type="text" id="name" name="name" required>
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required>
            <button type="submit">Create Account</button>
          </form>
        </main>
      </body>
      </html>
    `);
  });

  // Setup handler
  app.post('/setup', async (c) => {
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    
    const anyUser = await users.findOne({});
    if (anyUser) {
      return c.redirect('/');
    }
    
    const body = await c.req.parseBody();
    const username = body.username as string;
    const name = body.name as string;
    const password = body.password as string;
    
    if (!username || !name || !password) {
      return c.text('All fields required', 400);
    }
    
    const passwordHash = await hashPassword(password);
    const { privateKey, publicKey } = generateKeyPair();
    
    const newUser: User = { 
      username, 
      name, 
      passwordHash, 
      createdAt: new Date(), 
      publicKey, 
      privateKey,
      avatarUrl: 'https://placehold.co/600x400',
      bio: 'Bio for testing.',
      headerUrl: 'https://placehold.co/600x400'
    };
    
    const result = await users.insertOne(newUser);
    setCookie(c, 'session', result.insertedId.toString(), { httpOnly: true, path: '/' });
    return c.redirect('/');
  });
} 