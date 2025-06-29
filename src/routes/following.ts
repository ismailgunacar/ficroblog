import { Hono } from 'hono';
import { MongoClient, ObjectId } from 'mongodb';
import { getCookie } from 'hono/cookie';
import { User, Follow } from '../models';
import { renderFollowingList } from '../views/following';
import { getDomainFromRequest } from '../utils';
import { signRequest } from '../federation-utils';

export function mountFollowingRoutes(app: Hono, client: MongoClient) {
  // Following list page
  app.get('/following', async (c) => {
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    const follows = db.collection<Follow>('follows');
    
    // Check if any users exist, if not redirect to setup
    const anyUser = await users.findOne({});
    if (!anyUser) return c.redirect('/setup');
    
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
    
    if (!loggedIn || !currentUser) {
      return c.redirect('/');
    }
    
    // Get all users that the current user is following
    const following = await follows.find({ 
      followerId: currentUser._id?.toString() 
    }).toArray();
    
    // Separate local and remote follows
    const localFollows = following.filter(f => !f.remote);
    const remoteFollows = following.filter(f => f.remote);
    
    // Get user details for local follows
    const localUserIds = localFollows.map(f => f.followingId);
    const localUsers = await users.find({ 
      _id: { $in: localUserIds.map(id => new ObjectId(id)) } 
    }).toArray();
    
    const domain = getDomainFromRequest(c);
    
    return c.html(renderFollowingList({
      currentUser,
      localFollows,
      remoteFollows,
      localUsers,
      domain
    }));
  });

  // Remote follow handler
  app.post('/remote-follow', async (c) => {
    console.log('🔗 Remote follow request received');
    
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    
    const session = getCookie(c, 'session');
    if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
      return c.json({ success: false, error: 'Not logged in' });
    }
    
    const currentUser = await users.findOne({ _id: new ObjectId(session) });
    if (!currentUser) {
      return c.json({ success: false, error: 'User not found' });
    }
    
    // Validate that currentUser has a valid _id
    if (!currentUser._id) {
      console.error('Current user has no _id:', currentUser);
      return c.json({ success: false, error: 'Invalid user data' });
    }
    
    const body = await c.req.parseBody();
    const remoteUser = typeof body['remoteUser'] === 'string' ? body['remoteUser'] : '';
    
    if (!remoteUser || !remoteUser.includes('@')) {
      return c.json({ success: false, error: 'Invalid remote user format. Use username@domain' });
    }
    
    const [username, domain] = remoteUser.split('@');
    if (!username || !domain) {
      return c.json({ success: false, error: 'Invalid remote user format. Use username@domain' });
    }
    
    try {
      // First, try to discover the remote user via WebFinger
      const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`;
      const webfingerResponse = await fetch(webfingerUrl);
      
      if (!webfingerResponse.ok) {
        return c.json({ success: false, error: `Could not find user ${remoteUser} on ${domain}` });
      }
      
      const webfinger = await webfingerResponse.json();
      
      // Find the actor URL from WebFinger links
      const actorLink = webfinger.links?.find((link: any) => 
        link.rel === 'self' && link.type === 'application/activity+json'
      );
      
      if (!actorLink?.href) {
        return c.json({ success: false, error: `Could not find actor URL for ${remoteUser}` });
      }
      
      const actorUrl = actorLink.href;
      
      // Get the actor profile to find their inbox
      const actorResponse = await fetch(actorUrl, {
        headers: {
          'Accept': 'application/activity+json'
        }
      });
      
      if (!actorResponse.ok) {
        return c.json({ success: false, error: `Could not fetch profile for ${remoteUser}` });
      }
      
      const actor = await actorResponse.json();
      const inboxUrl = actor.inbox;
      
      if (!inboxUrl) {
        return c.json({ success: false, error: `Could not find inbox for ${remoteUser}` });
      }
      
      // Check if already following this remote user
      const follows = db.collection('follows');
      const existingFollow = await follows.findOne({
        followerId: currentUser._id.toString(),
        followingId: `${username}@${domain}`
      });
      
      if (existingFollow) {
        return c.json({ 
          success: false, 
          error: `Already following ${remoteUser}` 
        });
      }
      
      // Store the remote follow relationship
      const followData = {
        followerId: currentUser._id.toString(),
        followingId: `${username}@${domain}`,
        followingUrl: actorUrl,
        followingInbox: inboxUrl,
        remote: true,
        createdAt: new Date()
      };
      
      console.log('📝 Inserting remote follow:', followData);
      console.log('🔍 Debug info:', {
        currentUser: currentUser,
        currentUserId: currentUser._id,
        currentUserIdString: currentUser._id?.toString(),
        session: session,
        remoteUser: remoteUser,
        username: username,
        domain: domain
      });
      
      // Double-check that we have valid data before inserting
      if (!followData.followerId || followData.followerId === 'null' || followData.followerId === 'undefined') {
        console.error('❌ Invalid followerId detected:', followData.followerId);
        return c.json({ success: false, error: 'Invalid user data - missing follower ID' });
      }
      
      if (!followData.followingId || followData.followingId === 'null' || followData.followingId === 'undefined') {
        console.error('❌ Invalid followingId detected:', followData.followingId);
        return c.json({ success: false, error: 'Invalid remote user data' });
      }
      
      await follows.insertOne(followData);
      
      // Send the actual Follow activity to the remote user's inbox
      try {
        console.log('📤 Sending Follow activity to remote inbox...');
        
        const currentDomain = getDomainFromRequest(c);
        const followActivity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          "id": `https://${currentDomain}/follows/${followData.followerId}/${followData.followingId}`,
          "type": "Follow",
          "actor": `https://${currentDomain}/users/${currentUser.username}`,
          "object": actorUrl,
          "to": [actorUrl],
          "cc": ["https://www.w3.org/ns/activitystreams#Public"]
        };
        
        console.log('📋 Follow activity:', followActivity);
        
        // Sign and send the activity
        const signedRequest = await signRequest({
          method: 'POST',
          url: inboxUrl,
          body: JSON.stringify(followActivity),
          headers: {
            'Content-Type': 'application/activity+json',
            'Accept': 'application/activity+json'
          }
        }, currentUser.username);
        
        const response = await fetch(inboxUrl, {
          method: 'POST',
          headers: signedRequest.headers,
          body: signedRequest.body,
          duplex: 'half'
        });
        
        if (response.ok) {
          console.log('✅ Follow activity sent successfully to remote inbox');
          return c.json({ 
            success: true, 
            message: `Successfully followed ${remoteUser}! Follow activity sent to their inbox.`,
            actorUrl,
            inboxUrl,
            followActivityId: followActivity.id
          });
        } else {
          console.error('❌ Failed to send follow activity:', response.status, response.statusText);
          const errorText = await response.text();
          console.error('Error response:', errorText);
          
          // Still return success since we stored it locally
          return c.json({ 
            success: true, 
            message: `Followed ${remoteUser} locally, but failed to send activity to their inbox (${response.status})`,
            actorUrl,
            inboxUrl,
            warning: 'Activity not delivered to remote server'
          });
        }
        
      } catch (federationError) {
        console.error('❌ Error sending follow activity:', federationError);
        
        // Still return success since we stored it locally
        return c.json({ 
          success: true, 
          message: `Followed ${remoteUser} locally, but failed to send activity to their inbox`,
          actorUrl,
          inboxUrl,
          warning: 'Activity not delivered due to error'
        });
      }
      
    } catch (error) {
      console.error('Error following remote user:', error);
      return c.json({ 
        success: false, 
        error: `Error following ${remoteUser}: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
  });

  // Local unfollow handler
  app.post('/unfollow', async (c) => {
    console.log('🔗 Local unfollow request received');
    
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    
    const session = getCookie(c, 'session');
    if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
      return c.json({ success: false, error: 'Not logged in' });
    }
    
    const currentUser = await users.findOne({ _id: new ObjectId(session) });
    if (!currentUser) {
      return c.json({ success: false, error: 'User not found' });
    }
    
    // Validate that currentUser has a valid _id
    if (!currentUser._id) {
      console.error('Current user has no _id:', currentUser);
      return c.json({ success: false, error: 'Invalid user data' });
    }
    
    // Parse request body - handle both JSON and form data
    let userId: string;
    const contentType = c.req.header('content-type');
    
    if (contentType?.includes('application/json')) {
      const body = await c.req.json();
      userId = body.userId || '';
    } else {
      const body = await c.req.parseBody();
      userId = typeof body['userId'] === 'string' ? body['userId'] : '';
    }
    
    console.log('🔍 Unfollow request for local user:', userId);
    
    if (!userId) {
      return c.json({ success: false, error: 'User ID is required' });
    }
    
    try {
      // Remove the local follow relationship
      const follows = db.collection('follows');
      const result = await follows.deleteOne({
        followerId: currentUser._id.toString(),
        followingId: userId
      });
      
      if (result.deletedCount > 0) {
        console.log(`✅ Unfollowed local user: ${userId}`);
        return c.json({ 
          success: true, 
          message: `Successfully unfollowed user` 
        });
      } else {
        return c.json({ 
          success: false, 
          error: `Not following this user` 
        });
      }
      
    } catch (error) {
      console.error('Error unfollowing local user:', error);
      return c.json({ 
        success: false, 
        error: `Error unfollowing user: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
  });

  // Remote unfollow handler
  app.post('/remote-unfollow', async (c) => {
    console.log('🔗 Remote unfollow request received');
    
    await client.connect();
    const db = client.db();
    const users = db.collection<User>('users');
    
    const session = getCookie(c, 'session');
    if (!session || session.length !== 24 || !/^[a-fA-F0-9]+$/.test(session)) {
      return c.json({ success: false, error: 'Not logged in' });
    }
    
    const currentUser = await users.findOne({ _id: new ObjectId(session) });
    if (!currentUser) {
      return c.json({ success: false, error: 'User not found' });
    }
    
    // Validate that currentUser has a valid _id
    if (!currentUser._id) {
      console.error('Current user has no _id:', currentUser);
      return c.json({ success: false, error: 'Invalid user data' });
    }
    
    // Parse request body - handle both JSON and form data
    let remoteUser: string;
    const contentType = c.req.header('content-type');
    
    if (contentType?.includes('application/json')) {
      const body = await c.req.json();
      remoteUser = body.remoteUser || '';
    } else {
      const body = await c.req.parseBody();
      remoteUser = typeof body['remoteUser'] === 'string' ? body['remoteUser'] : '';
    }
    
    console.log('🔍 Unfollow request for remote user:', remoteUser);
    
    if (!remoteUser || !remoteUser.includes('@')) {
      return c.json({ success: false, error: 'Invalid remote user format. Use username@domain' });
    }
    
    const [username, domain] = remoteUser.split('@');
    if (!username || !domain) {
      return c.json({ success: false, error: 'Invalid remote user format. Use username@domain' });
    }
    
    try {
      // Remove the remote follow relationship
      const follows = db.collection('follows');
      const result = await follows.deleteOne({
        followerId: currentUser._id.toString(),
        followingId: `${username}@${domain}`
      });
      
      if (result.deletedCount > 0) {
        console.log(`✅ Unfollowed remote user: ${remoteUser}`);
        return c.json({ 
          success: true, 
          message: `Successfully unfollowed ${remoteUser}` 
        });
      } else {
        return c.json({ 
          success: false, 
          error: `Not following ${remoteUser}` 
        });
      }
      
    } catch (error) {
      console.error('Error unfollowing remote user:', error);
      return c.json({ 
        success: false, 
        error: `Error unfollowing ${remoteUser}: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
  });
} 