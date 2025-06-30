import { Hono } from 'hono';
import { MongoClient, ObjectId } from 'mongodb';
import type { User } from '../models';
import { getSessionUser } from '../session';
import { Follow } from '@fedify/fedify';
import { createFederationInstance } from '../fedify';

export function createRemoteFollowRoutes(client: MongoClient) {
  const app = new Hono();

  // Remote follow handler
  app.post('/remote-follow', async (c) => {
    await client.connect();
    const db = client.db();
    
    // Check if user is logged in
    const currentUser = await getSessionUser(c, db);
    if (!currentUser) {
      return c.json({ success: false, error: 'Not logged in' });
    }
    
    const body = await c.req.parseBody();
    const remoteUser = typeof body['remoteUser'] === 'string' ? body['remoteUser'] : '';
    
    if (!remoteUser || !remoteUser.includes('@')) {
      return c.json({ success: false, error: 'Invalid remote user format. Use @username@domain or username@domain' });
    }
    
    // Handle both @username@domain and username@domain formats
    const cleanRemoteUser = remoteUser.startsWith('@') ? remoteUser.slice(1) : remoteUser;
    const parts = cleanRemoteUser.split('@');
    
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return c.json({ success: false, error: 'Invalid remote user format. Use @username@domain or username@domain' });
    }
    
    const [username, domain] = parts;
    
    try {
      // Get the federation instance
      const federation = createFederationInstance(client);
      
      // Create Fedify context
      const ctx = federation.createContext(c.req.raw, undefined);
      
      // First, try to discover the remote user via WebFinger (using Fedify's method)
      try {
        const remoteActor = await ctx.lookupObject(`acct:${username}@${domain}`);
        
        if (!remoteActor) {
          return c.json({ success: false, error: `Could not find user ${remoteUser}` });
        }
        
        // Check if we're already following this user
        const follows = db.collection('follows');
        const existingFollow = await follows.findOne({
          followerId: currentUser._id.toString(),
          followingId: remoteActor.id?.href
        });
        
        if (existingFollow) {
          return c.json({ success: false, error: `Already following ${remoteUser}` });
        }
        
        // Create a Follow activity using Fedify's Follow class
        const followActivity = new Follow({
          id: new URL(`https://${ctx.hostname}/activities/${new ObjectId()}`),
          actor: ctx.getActorUri(currentUser.username),
          object: remoteActor.id,
          to: remoteActor.id,
        });
        
        // Send the Follow activity using Fedify's sendActivity method
        // The first parameter should be the actor's identifier, not an object
        console.log(`Sending follow request from ${currentUser.username} to ${remoteUser}`);
        console.log(`Remote actor ID: ${remoteActor.id?.href}`);
        console.log(`Remote actor inbox: ${remoteActor.inbox?.href}`);
        
        await ctx.sendActivity({ username: currentUser.username }, remoteActor, followActivity);
        
        console.log(`Successfully sent follow request to ${remoteUser}`);
        
        // Store the remote follow relationship in our database
        await follows.insertOne({
          followerId: currentUser._id.toString(),
          followingId: remoteActor.id?.href,
          followingHandle: remoteUser,
          followingName: remoteActor.name || username,
          followingUrl: remoteActor.id?.href,
          followingInbox: remoteActor.inbox?.href,
          remote: true,
          pending: true, // Will be set to false when we receive Accept
          createdAt: new Date()
        });
        
        return c.json({ 
          success: true, 
          message: `Follow request sent to ${remoteUser}. Waiting for acceptance.`
        });
        
      } catch (lookupError) {
        console.error('Error looking up remote actor:', lookupError);
        return c.json({ 
          success: false, 
          error: `Could not find user ${remoteUser}. Make sure the username and domain are correct.`
        });
      }
      
    } catch (error) {
      console.error('Error following remote user:', error);
      
      // Check if it's a network/HTTP error with status code
      if (error instanceof Error) {
        if (error.message.includes('401')) {
          return c.json({ 
            success: false, 
            error: `❌ Failed to send follow request to ${remoteUser}. Status: 401 - Authentication failed. This may be due to HTTP signature issues.` 
          });
        }
        
        const statusMatch = error.message.match(/status[:\s]+(\d+)/i);
        if (statusMatch) {
          const status = statusMatch[1];
          return c.json({ 
            success: false, 
            error: `❌ Failed to send follow request to ${remoteUser}. Status: ${status}` 
          });
        }
      }
      
      return c.json({ 
        success: false, 
        error: `Error following ${remoteUser}: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
  });

  return app;
}