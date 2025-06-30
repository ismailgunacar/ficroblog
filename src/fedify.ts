import { 
  createFederation, 
  MemoryKvStore, 
  Person, 
  Note, 
  Follow, 
  Accept, 
  Create, 
  Like, 
  Announce, 
  Image, 
  Undo, 
  NodeInfo,
  PUBLIC_COLLECTION
} from '@fedify/fedify';
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
      
      // Create a Fedify Person object
      const actor = new Person({
        id: new URL(`https://${domain}/users/${user.username}`),
        preferredUsername: user.username,
        name: user.name || user.username,
        summary: user.bio || '',
        inbox: new URL(`https://${domain}/users/${user.username}/inbox`),
        outbox: new URL(`https://${domain}/users/${user.username}/outbox`),
        followers: new URL(`https://${domain}/users/${user.username}/followers`),
        following: new URL(`https://${domain}/users/${user.username}/following`),
        url: new URL(`https://${domain}/users/${user.username}`),
        icon: user.avatarUrl ? new Image({ url: new URL(user.avatarUrl) }) : undefined,
        image: user.headerUrl ? new Image({ url: new URL(user.headerUrl) }) : undefined
      });

      console.log('Actor JSON:', JSON.stringify(actor, null, 2));
      return actor;
    });
    console.log('👤 Actor dispatcher configured');

    // Set up inbox listeners following the tutorial pattern
    federation
      .setInboxListeners('/users/{identifier}/inbox', '/inbox')
      .on(Follow, async (ctx, follow) => {
        console.log('🤝 Follow activity received');
        
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
          return;
        }
        
        console.log(`🎯 Follow target username: ${username}`);
        
        const targetUser = await users.findOne({ username });
        if (!targetUser) {
          console.log(`❌ Target user not found: ${username}`);
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
          cc: [PUBLIC_COLLECTION]
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
        
        // Store the remote post following tutorial pattern
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
    
    return federation;
  } catch (error) {
    console.error('❌ Error creating Fedify federation instance:', error);
    throw error;
  }
}

// Export a function to mount Fedify's ActivityPub endpoints into your Hono app
export function mountFedifyRoutes(app: Hono, mongoClient: MongoClient) {
  console.log('🔗 Mounting Fedify routes...');
  
  try {
    const federation = createFederationInstance(mongoClient);
    
    if (!federation) {
      console.error('❌ Fedify federation instance is undefined');
      return;
    }
    
    // Mount Fedify routes using the correct middleware approach
    // The federation instance should be used directly as middleware
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
          
          // Use the federation instance directly
          const response = await federation.fetch(c.req.raw);
          if (response && response.status !== 404) {
            console.log(`✅ Federation handled: ${path}`);
            return new Response(response.body, response);
          }
        }
      } catch (error) {
        console.error('❌ Error handling ActivityPub route:', error);
      }
      
      return next();
    });
    
    console.log('✅ Fedify routes mounted successfully');
  } catch (error) {
    console.error('❌ Failed to mount Fedify routes:', error);
  }
} 