import { createFederation, MemoryKvStore, Person, Note, Follow, Accept, Create, Like, Announce, Image, Undo, Reject, NodeInfo } from '@fedify/fedify';
import { federation as fedifyHonoMiddleware } from '@fedify/fedify/x/hono';
import type { Hono } from 'hono';
import type { User, Post } from './models';
import { ObjectId } from 'mongodb';
import type { MongoClient, Collection } from 'mongodb';

// MongoDB-based KV store for Fedify
class MongoDBKVStore {
  private db: any;
  private collection: Collection;

  constructor(client: MongoClient, dbName: string) {
    this.db = client.db(dbName);
    this.collection = this.db.collection('fedify_kv');
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
  
  // Create the Federation instance with full configuration
  const kvStore = new MongoDBKVStore(mongoClient, 'fongoblog2');
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
    const db = mongoClient.db('fongoblog2');
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
    const db = mongoClient.db('fongoblog2');
    const users = db.collection('users');
    
    const user = await users.findOne({ username: identifier });
    if (!user) {
      console.log(`❌ User not found: ${identifier}`);
      return null;
    }

    const domain = ctx.hostname;
    console.log(`✅ Creating actor for ${identifier} on domain ${domain}`);
    
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: user.username,
      name: user.name || user.username,
      summary: user.bio || '',
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      following: ctx.getFollowingUri(identifier),
      url: new URL(`https://${domain}/users/${user.username}`),
      icon: user.avatarUrl ? new Image({ url: new URL(user.avatarUrl) }) : undefined,
      image: user.headerUrl ? new Image({ url: new URL(user.headerUrl) }) : undefined
    });
  });
  console.log('👤 Actor dispatcher configured');

  // Set up object dispatcher for posts
  federation.setObjectDispatcher(Note, '/posts/{postId}', async (ctx, { postId }) => {
    console.log(`📝 Note request for post: ${postId}`);
    const db = mongoClient.db('fongoblog2');
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
    const db = mongoClient.db('fongoblog2');
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
      
      const db = mongoClient.db('fongoblog2');
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
        followerId: from.id?.href,
        followingId: targetUser._id?.toString()
      });
      
      if (!existingFollow) {
        // Create follow relationship
        await follows.insertOne({
          followerId: from.id?.href,
          followingId: targetUser._id?.toString(),
          createdAt: new Date()
        });
        console.log(`✅ Created follow relationship: ${from.id?.href} -> ${username}`);
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
        
        const db = mongoClient.db('fongoblog2');
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
          followerId: from.id?.href,
          followingId: targetUser._id?.toString()
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
        
        const db = mongoClient.db('fongoblog2');
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
          followerId: from.id?.href,
          followingId: targetUser._id?.toString()
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
      const db = mongoClient.db('fongoblog2');
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
}

// Export a function to mount Fedify's ActivityPub endpoints into your Hono app
export function mountFedifyRoutes(app: Hono, mongoClient: MongoClient) {
  console.log('🔗 Mounting Fedify routes...');
  
  const federation = createFederationInstance(mongoClient);
  
  // Mount Fedify routes
  app.use('*', async (c, next) => {
    // Log all requests to Fedify endpoints
    const url = c.req.url;
    if (url.includes('/.well-known/') || 
        url.includes('/users/') || 
        url.includes('/inbox') ||
        url.includes('/outbox') ||
        url.includes('/followers') ||
        url.includes('/following')) {
      console.log(`🌐 Fedify request: ${c.req.method} ${url}`);
    }
    await next();
  });
  
  app.use('*', federation.hono);
  console.log('✅ Fedify routes mounted successfully');
} 