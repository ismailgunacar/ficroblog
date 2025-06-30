import { Hono } from 'hono';
import { MongoClient, ObjectId } from 'mongodb';
import type { User } from '../models';
import bcrypt from 'bcrypt';

export function createSetupRoutes(client: MongoClient) {
  const app = new Hono();

  // Setup page - show only if no users exist
  app.get('/setup', async (c) => {
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    
    // Check if any users exist
    const userCount = await users.countDocuments();
    if (userCount > 0) {
      return c.redirect('/');
    }
    
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Setup - Fongoblog2</title>
        <link rel="stylesheet" href="/styles/main.css">
      </head>
      <body>
        <div class="container">
          <div class="setup-container">
            <h1>🚀 Setup Your Microblog</h1>
            <p>Create your account to get started with your federated microblog.</p>
            
            <form method="post" action="/setup" class="setup-form">
              <div class="form-group">
                <label for="username">Username</label>
                <input 
                  type="text" 
                  id="username" 
                  name="username" 
                  required 
                  pattern="^[a-zA-Z0-9_-]{3,20}$"
                  title="Username must be 3-20 characters, letters, numbers, underscore, or dash only"
                  placeholder="your_username"
                >
                <small>This will be your handle: @username@yourdomain.com</small>
              </div>
              
              <div class="form-group">
                <label for="name">Display Name</label>
                <input 
                  type="text" 
                  id="name" 
                  name="name" 
                  required 
                  maxlength="50"
                  placeholder="Your Display Name"
                >
                <small>This is how your name will appear to others</small>
              </div>
              
              <div class="form-group">
                <label for="password">Password</label>
                <input 
                  type="password" 
                  id="password" 
                  name="password" 
                  required 
                  minlength="8"
                  placeholder="Choose a strong password"
                >
                <small>Minimum 8 characters</small>
              </div>
              
              <div class="form-group">
                <label for="bio">Bio (Optional)</label>
                <textarea 
                  id="bio" 
                  name="bio" 
                  maxlength="200" 
                  rows="3"
                  placeholder="Tell us about yourself..."
                ></textarea>
                <small>Up to 200 characters</small>
              </div>
              
              <button type="submit" class="btn btn-primary">Create Account & Setup</button>
            </form>
          </div>
        </div>
      </body>
      </html>
    `;
    
    return c.html(html);
  });

  // Handle setup form submission
  app.post('/setup', async (c) => {
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    
    // Check if any users already exist
    const userCount = await users.countDocuments();
    if (userCount > 0) {
      return c.redirect('/');
    }
    
    const body = await c.req.parseBody();
    const username = typeof body['username'] === 'string' ? body['username'].toLowerCase().trim() : '';
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const bio = typeof body['bio'] === 'string' ? body['bio'].trim() : '';
    
    // Validate input
    if (!username || !name || !password) {
      return c.html('<h1>Error</h1><p>All required fields must be filled out.</p><a href="/setup">Go back</a>');
    }
    
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      return c.html('<h1>Error</h1><p>Username must be 3-20 characters, letters, numbers, underscore, or dash only.</p><a href="/setup">Go back</a>');
    }
    
    if (password.length < 8) {
      return c.html('<h1>Error</h1><p>Password must be at least 8 characters long.</p><a href="/setup">Go back</a>');
    }
    
    if (name.length > 50) {
      return c.html('<h1>Error</h1><p>Display name must be 50 characters or less.</p><a href="/setup">Go back</a>');
    }
    
    if (bio.length > 200) {
      return c.html('<h1>Error</h1><p>Bio must be 200 characters or less.</p><a href="/setup">Go back</a>');
    }
    
    try {
      // Hash the password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      
      // Create the user
      const newUser: User = {
        username,
        name,
        passwordHash,
        bio: bio || undefined,
        createdAt: new Date()
      };
      
      const result = await users.insertOne(newUser);
      
      if (result.insertedId) {
        // Redirect to login page or automatically log them in
        return c.html(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Setup Complete - Fongoblog2</title>
            <link rel="stylesheet" href="/styles/main.css">
          </head>
          <body>
            <div class="container">
              <div class="success-container">
                <h1>🎉 Setup Complete!</h1>
                <p>Your account <strong>@${username}</strong> has been created successfully.</p>
                <p>You can now log in and start using your federated microblog.</p>
                <a href="/login" class="btn btn-primary">Go to Login</a>
              </div>
            </div>
          </body>
          </html>
        `);
      } else {
        throw new Error('Failed to create user account');
      }
      
    } catch (error) {
      console.error('Setup error:', error);
      return c.html('<h1>Error</h1><p>An error occurred while creating your account. Please try again.</p><a href="/setup">Go back</a>');
    }
  });

  return app;
}