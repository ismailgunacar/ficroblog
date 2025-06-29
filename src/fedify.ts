import { createFederation, MemoryKvStore, Person, Note, Follow, Accept, Create, Like, Announce, Image, Undo, Reject, NodeInfo } from '@fedify/fedify';
import { federation as fedifyHonoMiddleware } from '@fedify/fedify/x/hono';
import type { Hono } from 'hono';
import type { User, Post } from './models';
import { ObjectId } from 'mongodb';
import type { MongoClient, Collection } from 'mongodb';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Helper function to extract database name from MongoDB URI
function getDatabaseNameFromUri(uri: string): string {
  try {
    const url = new URL(uri);
    // Remove leading slash and get database name
    const dbName = url.pathname.substring(1);
    return dbName || 'fongoblog2'; // fallback to default if no database specified
  } catch (error) {
    console.warn('Could not parse MongoDB URI, using default database name');
    return 'fongoblog2';
  }
}

// MongoDB-based KV store for Fedify
class MongoDBKVStore {
  private db: any;
  private collection: Collection;

  constructor(client: MongoClient) {
    // Use the same database as the main app
    const dbName = getDatabaseNameFromUri(process.env.MONGODB_URI || '');
    this.db = client.db(dbName);
    this.collection = this.db.collection('fedify_kv');
    console.log(`📦 Using database: ${dbName} for Fedify KV store`);
  }

  async get<T = unknown>(key: readonly string[]): Promise<T | undefined> {
    const keyStr = key.join(':');
    const doc = await this.collection.findOne({ key: keyStr });
    return doc ? doc.value : undefined;
  }

  async set(key: readonly string[], value: unknown): Promise<void> {
    const keyStr = key.join(':');
    await this.collection.updateOne(
      { key: keyStr },
      { $set: { value, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async delete(key: readonly string[]): Promise<void> {
    const keyStr = key.join(':');
    await this.collection.deleteOne({ key: keyStr });
  }
}

// Export a function to create and configure the federation instance
export function createFederationInstance(mongoClient: MongoClient) {
  console.log('🔧 Creating Fedify federation instance...');
  
  try {
    // Create the Federation instance with full configuration
    const kvStore = new MongoDBKVStore(mongoClient);
    console.log('📦 Created MongoDB KV store for Fedify');

    const federation = createFederation({
      kv: kvStore,
      // Allow all domains for now (you can restrict this later)
      skipSignatureVerification: true, // For development only
    });
    console.log('✅ Fedify federation instance created');
    console.log('🔍 Federation instance:', typeof federation);
    console.log('🔍 Federation keys:', Object.keys(federation));
    
    // Try different ways to access the Hono app
    let honoApp = null;
    
    // Method 1: Try federation.hono
    if (federation.hono) {
      honoApp = federation.hono;
      console.log('✅ Found federation.hono');
    }
    // Method 2: Try federation.app
    else if (federation.app) {
      honoApp = federation.app;
      console.log('✅ Found federation.app');
    }
    // Method 3: Try federation.router
    else if (federation.router) {
      honoApp = federation.router;
      console.log('✅ Found federation.router');
    }
    // Method 4: Try federation.getHonoApp()
    else if (typeof federation.getHonoApp === 'function') {
      honoApp = federation.getHonoApp();
      console.log('✅ Found federation.getHonoApp()');
    }
    // Method 5: Try federation.createHonoApp()
    else if (typeof federation.createHonoApp === 'function') {
      honoApp = federation.createHonoApp();
      console.log('✅ Found federation.createHonoApp()');
    }
    
    if (!honoApp) {
      console.error('❌ Could not find Hono app in federation instance');
      console.error('🔍 Available properties:', Object.getOwnPropertyNames(federation));
      console.error('🔍 Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(federation)));
      throw new Error('Fedify Hono app is not available');
    }
    
    console.log('🔍 Hono app type:', typeof honoApp);
    console.log('🔍 Hono app keys:', Object.keys(honoApp));

    // Set up NodeInfo dispatcher
    federation.setNodeInfoDispatcher('/.well-known/nodeinfo/2.0', async (ctx): Promise<NodeInfo> => {
      console.log('📊 NodeInfo request received');
      const db = mongoClient.db();
      const users = db.collection('users');
      const posts = db.collection('posts');
      
      const userCount = await users.countDocuments();
      const postCount = await posts.countDocuments();
      
      console.log(`📈 NodeInfo stats: ${userCount} users, ${postCount} posts`);
      
      return {
        version: '2.0',
        software: {
          name: 'fongoblog2',
          version: { major: 1, minor: 0, patch: 0 }
        },
        protocols: ['activitypub'],
        services: {
          inbound: [],
          outbound: []
        },
        openRegistrations: false,
        usage: {
          users: {
            total: userCount
          },
          localPosts: postCount,
          localComments: 0
        },
        metadata: {
          nodeName: 'fongoblog2',
          nodeDescription: 'A federated social media platform'
        }
      };
    });
    console.log('📊 NodeInfo dispatcher configured');

    // Set up actor dispatcher
    federation.setActorDispatcher('/users/{identifier}', async (ctx, identifier) => {
      console.log(`👤 Actor request for: ${identifier}`);
      const db = mongoClient.db();
      const users = db.collection('users');
      
      const user = await users.findOne({ username: identifier });
      if (!user) {
        console.log(`❌ User not found: ${identifier}`);
        return null;
      }

      const domain = ctx.hostname;
      console.log(`✅ Creating actor for ${identifier} on domain ${domain}`);
      
      // Build the actor object
      const actor: any = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1'
        ],
        id: `https://${domain}/users/${user.username}`,
        type: 'Person',
        preferredUsername: user.username,
        name: user.name || user.username,
        summary: user.bio || '',
        inbox: `https://${domain}/users/${user.username}/inbox`,
        outbox: `https://${domain}/users/${user.username}/outbox`,
        followers: `https://${domain}/users/${user.username}/followers`,
        following: `https://${domain}/users/${user.username}/following`,
        url: `https://${domain}/users/${user.username}`,
        icon: user.avatarUrl ? { type: 'Image', url: user.avatarUrl } : undefined,
        image: user.headerUrl ? { type: 'Image', url: user.headerUrl } : undefined
      };
      if (user.publicKey && typeof user.publicKey === 'string' && user.publicKey.trim()) {
        actor.publicKey = {
          id: `https://${domain}/users/${user.username}#main-key`,
          owner: `https://${domain}/users/${user.username}`,
          publicKeyPem: user.publicKey
        };
      }
      console.log('Actor JSON:', JSON.stringify(actor, null, 2));
      return actor;
    });
    console.log('👤 Actor dispatcher configured');

    // Register followers and following collection paths
    federation.setFollowersDispatcher('/users/{identifier}/followers', async (ctx, identifier, cursor) => {
      console.log(`👥 Followers request for: ${identifier}, cursor: ${cursor}`);
      const db = mongoClient.db();
      const users = db.collection('users');
      const follows = db.collection('follows');
      
      const user = await users.findOne({ username: identifier });
      if (!user) {
        console.log(`❌ User not found for followers: ${identifier}`);
        return null;
      }

      const limit = 20;
      const skip = cursor ? Number.parseInt(cursor, 10) : 0;
      
      const followers = await follows
        .find({ following_id: user._id.toString() })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      console.log(`✅ Followers: ${followers.length} followers for ${identifier}`);
      
      const followerActors = followers.map((follow: any) => new URL(follow.follower_id));

      return {
        items: followerActors,
        nextCursor: followers.length === limit ? (skip + limit).toString() : null
      };
    });

    federation.setFollowingDispatcher('/users/{identifier}/following', async (ctx, identifier, cursor) => {
      console.log(`👥 Following request for: ${identifier}, cursor: ${cursor}`);
      const db = mongoClient.db();
      const users = db.collection('users');
      const follows = db.collection('follows');
      
      const user = await users.findOne({ username: identifier });
      if (!user) {
        console.log(`❌ User not found for following: ${identifier}`);
        return null;
      }

      const limit = 20;
      const skip = cursor ? Number.parseInt(cursor, 10) : 0;
      
      const following = await follows
        .find({ follower_id: user._id.toString() })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      console.log(`✅ Following: ${following.length} following for ${identifier}`);
      
      const followingActors = following.map((follow: any) => new URL(follow.following_id));

      return {
        items: followingActors,
        nextCursor: following.length === limit ? (skip + limit).toString() : null
      };
    });

    console.log('👥 Followers and following dispatchers configured');

    // Set up object dispatcher for posts
    federation.setObjectDispatcher(Note, '/posts/{postId}', async (ctx, { postId }) => {
      console.log(`📝 Note request for post: ${postId}`);
      const db = mongoClient.db();
      const posts = db.collection('posts');
      const users = db.collection('users');
      
      const post = await posts.findOne({ _id: new ObjectId(postId) });
      if (!post) {
        console.log(`❌ Post not found: ${postId}`);
        return null;
      }

      const author = await users.findOne({ _id: post.userId });
      if (!author) {
        console.log(`❌ Post author not found for post: ${postId}`);
        return null;
      }

      const domain = ctx.hostname;
      console.log(`✅ Creating Note for post ${postId} by ${author.username}`);
      
      return new Note({
        id: new URL(`https://${domain}/posts/${post._id}`),
        content: post.content,
        attributedTo: new URL(`https://${domain}/users/${author.username}`),
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        published: post.createdAt,
        updated: post.updatedAt
      });
    });
    console.log('📝 Note dispatcher configured');

    // Set up outbox dispatcher
    federation.setOutboxDispatcher('/users/{identifier}/outbox', async (ctx, identifier, cursor) => {
      console.log(`📤 Outbox request for: ${identifier}, cursor: ${cursor}`);
      const db = mongoClient.db();
      const posts = db.collection('posts');
      const users = db.collection('users');
      
      const user = await users.findOne({ username: identifier });
      if (!user) {
        console.log(`❌ User not found for outbox: ${identifier}`);
        return null;
      }

      const limit = 20;
      const skip = cursor ? Number.parseInt(cursor, 10) : 0;
      
      const userPosts = await posts
        .find({ userId: user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const domain = ctx.hostname;
      console.log(`✅ Outbox: ${userPosts.length} posts for ${identifier}`);
      
      const activities = userPosts.map((post: any) => new Create({
        id: new URL(`https://${domain}/posts/${post._id}/activity`),
        actor: new URL(`https://${domain}/users/${user.username}`),
        object: new Note({
          id: new URL(`https://${domain}/posts/${post._id}`),
          content: post.content,
          attributedTo: new URL(`https://${domain}/users/${user.username}`),
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          published: post.createdAt,
          updated: post.updatedAt
        }),
        published: post.createdAt
      }));

      return {
        items: activities,
        nextCursor: userPosts.length === limit ? (skip + limit).toString() : null
      };
    });
    console.log('📤 Outbox dispatcher configured');

    // Set up inbox listeners
    federation
      .setInboxListeners('/users/{identifier}/inbox', '/inbox')
      .on(Follow, async (ctx, follow) => {
        console.log('🤝 Follow activity received');
        console.log('📋 Follow activity details:', {
          id: follow.id?.href,
          actor: follow.actorId?.href,
          object: follow.objectId?.href,
          target: follow.targetId?.href
        });
        
        const from = await follow.getActor(ctx);
        if (!from) {
          console.log('❌ Could not get actor from follow activity');
          return;
        }
        
        console.log(`👤 Follow from: ${from.id?.href}`);
        
        const db = mongoClient.db();
        const users = db.collection('users');
        const follows = db.collection('follows');
        
        // Extract username from the follow target
        const targetUri = follow.objectId?.href;
        console.log(`🎯 Target URI: ${targetUri}`);
        
        const username = targetUri?.split('/users/')[1];
        
        if (!username) {
          console.log('❌ Could not extract username from follow target');
          console.log('🔍 Available parts:', targetUri?.split('/'));
          return;
        }
        
        console.log(`🎯 Follow target username: ${username}`);
        
        const targetUser = await users.findOne({ username });
        if (!targetUser) {
          console.log(`❌ Target user not found: ${username}`);
          console.log('🔍 Available users:', await users.find({}).toArray());
          return;
        }
        
        console.log(`✅ Found target user: ${targetUser.username}`);
        
        // Check if already following
        const existingFollow = await follows.findOne({
          follower_id: from.id?.href,
          following_id: targetUser._id?.toString()
        });
        
        if (!existingFollow) {
          // Validate that we have valid IDs before inserting
          if (!from.id?.href || !targetUser._id) {
            console.error('❌ Invalid IDs for follow relationship:', {
              follower_id: from.id?.href,
              following_id: targetUser._id?.toString()
            });
            return;
          }
          
          // Create follow relationship
          await follows.insertOne({
            follower_id: from.id.href,
            following_id: targetUser._id.toString(),
            createdAt: new Date()
          });
          console.log(`✅ Created follow relationship: ${from.id.href} -> ${username}`);
        } else {
          console.log(`ℹ️ Follow relationship already exists: ${from.id?.href} -> ${username}`);
        }
        
        // Send Accept activity back
        console.log('📤 Sending Accept activity...');
        const accept = new Accept({
          actorId: new URL(`https://${ctx.hostname}/users/${username}`),
          object: follow,
          to: [from.id?.href || ''],
          cc: ['https://www.w3.org/ns/activitystreams#Public']
        });
        
        console.log('📋 Accept activity details:', {
          actor: accept.actorId?.href,
          object: accept.objectId?.href,
          to: accept.to,
          cc: accept.cc
        });
        
        // Send the accept activity
        try {
          await ctx.sendActivity({ identifier: username }, [from.id?.href || ''], accept);
          console.log('✅ Accept activity sent successfully');
        } catch (error) {
          console.error('❌ Error sending accept activity:', error);
        }
      })
      .on(Undo, async (ctx, undo) => {
        console.log('🔄 Undo activity received');
        console.log('📋 Undo activity details:', {
          id: undo.id?.href,
          actor: undo.actorId?.href,
          object: undo.objectId?.href
        });
        
        const from = await undo.getActor(ctx);
        if (!from) {
          console.log('❌ Could not get actor from undo activity');
          return;
        }
        
        console.log(`👤 Undo from: ${from.id?.href}`);
        
        // Get the object being undone
        const undoneObject = await undo.getObject(ctx);
        if (!undoneObject) {
          console.log('❌ Could not get undone object');
          return;
        }
        
        console.log(`🎯 Undone object type: ${undoneObject.constructor.name}`);
        
        // Handle unfollow (Undo of Follow)
        if (undoneObject instanceof Follow) {
          console.log('👋 Processing unfollow...');
          
          const db = mongoClient.db();
          const users = db.collection('users');
          const follows = db.collection('follows');
          
          // Extract username from the follow target
          const targetUri = undoneObject.objectId?.href;
          console.log(`🎯 Unfollow target URI: ${targetUri}`);
          
          const username = targetUri?.split('/users/')[1];
          
          if (!username) {
            console.log('❌ Could not extract username from unfollow target');
            return;
          }
          
          console.log(`🎯 Unfollow target username: ${username}`);
          
          const targetUser = await users.findOne({ username });
          if (!targetUser) {
            console.log(`❌ Target user not found for unfollow: ${username}`);
            return;
          }
          
          // Remove follow relationship
          const result = await follows.deleteOne({
            follower_id: from.id?.href,
            following_id: targetUser._id?.toString()
          });
          
          if (result.deletedCount > 0) {
            console.log(`✅ Removed follow relationship: ${from.id?.href} -> ${username}`);
          } else {
            console.log(`ℹ️ No follow relationship found to remove: ${from.id?.href} -> ${username}`);
          }
        }
      })
      .on(Reject, async (ctx, reject) => {
        console.log('❌ Reject activity received');
        console.log('📋 Reject activity details:', {
          id: reject.id?.href,
          actor: reject.actorId?.href,
          object: reject.objectId?.href
        });
        
        const from = await reject.getActor(ctx);
        if (!from) {
          console.log('❌ Could not get actor from reject activity');
          return;
        }
        
        console.log(`👤 Reject from: ${from.id?.href}`);
        
        // Get the object being rejected
        const rejectedObject = await reject.getObject(ctx);
        if (!rejectedObject) {
          console.log('❌ Could not get rejected object');
          return;
        }
        
        console.log(`🎯 Rejected object type: ${rejectedObject.constructor.name}`);
        
        // Handle follow rejection
        if (rejectedObject instanceof Follow) {
          console.log('🚫 Processing follow rejection...');
          
          const db = mongoClient.db();
          const users = db.collection('users');
          const follows = db.collection('follows');
          
          // Extract username from the follow target
          const targetUri = rejectedObject.objectId?.href;
          console.log(`🎯 Rejection target URI: ${targetUri}`);
          
          const username = targetUri?.split('/users/')[1];
          
          if (!username) {
            console.log('❌ Could not extract username from rejection target');
            return;
          }
          
          console.log(`🎯 Rejection target username: ${username}`);
          
          const targetUser = await users.findOne({ username });
          if (!targetUser) {
            console.log(`❌ Target user not found for rejection: ${username}`);
            return;
          }
          
          // Remove follow relationship if it exists
          const result = await follows.deleteOne({
            follower_id: from.id?.href,
            following_id: targetUser._id?.toString()
          });
          
          if (result.deletedCount > 0) {
            console.log(`✅ Removed follow relationship due to rejection: ${from.id?.href} -> ${username}`);
          } else {
            console.log(`ℹ️ No follow relationship found to remove for rejection: ${from.id?.href} -> ${username}`);
          }
        }
      })
      .on(Create, async (ctx, create) => {
        console.log('📝 Create activity received');
        const from = await create.getActor(ctx);
        if (!from) {
          console.log('❌ Could not get actor from create activity');
          return;
        }
        
        console.log(`👤 Create from: ${from.id?.href}`);
        
        const object = await create.getObject(ctx);
        if (!object || !(object instanceof Note)) {
          console.log('❌ Create activity does not contain a Note');
          return;
        }
        
        console.log(`📄 Note content: ${object.content?.substring(0, 100)}...`);
        
        // Store the remote post
        const db = mongoClient.db();
        const posts = db.collection('posts');
        
        await posts.insertOne({
          userId: from.id?.href || 'unknown',
          content: object.content || '',
          createdAt: object.published || new Date(),
          remote: true,
          remotePostId: object.id?.href,
          remoteActor: from.id?.href
        });
        
        console.log('✅ Stored remote post');
      })
      .on(Like, async (ctx, like) => {
        console.log('❤️ Like activity received');
        const from = await like.getActor(ctx);
        if (!from) {
          console.log('❌ Could not get actor from like activity');
          return;
        }
        
        console.log(`👤 Like from: ${from.id?.href}`);
        console.log(`🎯 Like target: ${like.objectId?.href}`);
      })
      .on(Announce, async (ctx, announce) => {
        console.log('🔄 Announce activity received');
        const from = await announce.getActor(ctx);
        if (!from) {
          console.log('❌ Could not get actor from announce activity');
          return;
        }
        
        console.log(`👤 Announce from: ${from.id?.href}`);
        console.log(`🎯 Announce target: ${announce.objectId?.href}`);
      });

    console.log('📥 Inbox listeners configured');
    console.log('🎉 Fedify federation instance fully configured!');
    
    // Return both federation and honoApp
    return { federation, honoApp };
  } catch (error) {
    console.error('❌ Error creating Fedify federation instance:', error);
    throw error;
  }
}

// Export a function to mount Fedify's ActivityPub endpoints into your Hono app
export function mountFedifyRoutes(app: Hono, mongoClient: MongoClient) {
  console.log('🔗 Mounting Fedify routes...');
  
  try {
    const { federation, honoApp } = createFederationInstance(mongoClient);
    
    if (!federation || !honoApp) {
      console.error('❌ Fedify federation instance or hono app is undefined');
      return;
    }
    
    // Mount Fedify routes by using the federation instance directly as middleware
    // This should properly handle all ActivityPub routes
    app.use('*', async (c, next) => {
      try {
        // Check if this is an ActivityPub route
        const path = c.req.path;
        const isActivityPubRoute = 
          path.startsWith('/.well-known/webfinger') ||
          path.startsWith('/.well-known/nodeinfo') ||
          path.startsWith('/users/') ||
          path === '/inbox' ||
          path === '/outbox';
        
        if (isActivityPubRoute) {
          console.log(`🔗 Handling ActivityPub route: ${path}`);
          
          // Try multiple approaches to handle the request
          
          // Method 1: Try federation.fetch
          if (typeof federation.fetch === 'function') {
            console.log('🔍 Trying federation.fetch...');
            const result = await federation.fetch(c.req.raw);
            if (result && result.status !== 404) {
              console.log(`✅ Federation.fetch handled: ${path}`);
              return new Response(result.body, result);
            }
          }
          
          // Method 2: Try federation.handle
          if (typeof federation.handle === 'function') {
            console.log('🔍 Trying federation.handle...');
            const result = await federation.handle(c.req.raw);
            if (result) {
              console.log(`✅ Federation.handle handled: ${path}`);
              return new Response(result.body, result);
            }
          }
          
          // Method 3: Try federation.router.handle
          if (federation.router && typeof federation.router.handle === 'function') {
            console.log('🔍 Trying federation.router.handle...');
            const result = await federation.router.handle(c.req.raw);
            if (result) {
              console.log(`✅ Router.handle handled: ${path}`);
              return new Response(result.body, result);
            }
          }
          
          // Method 4: Try federation.router.fetch
          if (federation.router && typeof federation.router.fetch === 'function') {
            console.log('🔍 Trying federation.router.fetch...');
            const result = await federation.router.fetch(c.req.raw);
            if (result && result.status !== 404) {
              console.log(`✅ Router.fetch handled: ${path}`);
              return new Response(result.body, result);
            }
          }
          
          // Method 5: Try using the federation as a Hono app
          if (typeof federation.fetch === 'function') {
            console.log('🔍 Trying federation as Hono app...');
            const result = await federation.fetch(c.req.raw);
            if (result && result.status !== 404) {
              console.log(`✅ Federation as Hono handled: ${path}`);
              return new Response(result.body, result);
            }
          }
          
          console.log(`❌ No handler found for: ${path}`);
          console.log('🔍 Available methods on federation:', Object.getOwnPropertyNames(Object.getPrototypeOf(federation)));
          console.log('🔍 Available methods on router:', federation.router ? Object.getOwnPropertyNames(Object.getPrototypeOf(federation.router)) : 'No router');
        }
      } catch (error) {
        console.error(`❌ Error handling ActivityPub route:`, error);
      }
      
      return next();
    });
    
    console.log('✅ Fedify routes mounted successfully');
  } catch (error) {
    console.error('❌ Failed to mount Fedify routes:', error);
  }
} 