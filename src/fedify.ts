import { createFederation, MemoryKvStore, Person, Note, Follow, Accept, Create, Like, Announce, Image } from '@fedify/fedify';
import { federation as fedifyHonoMiddleware } from '@fedify/fedify/x/hono';
import type { Hono } from 'hono';
import type { User, Post } from './models';
import { ObjectId } from 'mongodb';

// MongoDB-based KV store for Fedify
class MongoDBKVStore {
  private db: any;
  private collection: any;

  constructor(client: any, dbName: string) {
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
export function createFederationInstance(mongoClient: any) {
  // Create the Federation instance with full configuration
  const kvStore = new MongoDBKVStore(mongoClient, 'fongoblog2');

  const federation = createFederation({
    kv: kvStore,
    // Allow all domains for now (you can restrict this later)
    skipSignatureVerification: true, // For development only
  });

  // Set up NodeInfo dispatcher
  federation.setNodeInfoDispatcher('/.well-known/nodeinfo/2.0', async (ctx) => {
    const db = mongoClient.db('fongoblog2');
    const users = db.collection('users');
    const posts = db.collection('posts');
    
    const userCount = await users.countDocuments();
    const postCount = await posts.countDocuments();
    
    return {
      version: '2.0',
      software: {
        name: 'fongoblog2',
        version: '1.0.0'
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
        localPosts: postCount
      },
      metadata: {
        nodeName: 'fongoblog2',
        nodeDescription: 'A federated social media platform'
      }
    };
  });

  // Set up actor dispatcher
  federation.setActorDispatcher('/users/{identifier}', async (ctx, identifier) => {
    const db = mongoClient.db('fongoblog2');
    const users = db.collection('users');
    
    const user = await users.findOne({ username: identifier });
    if (!user) return null;

    const domain = ctx.hostname;
    
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
      image: user.headerUrl ? new Image({ url: new URL(user.headerUrl) }) : undefined,
      publicKey: user.publicKey ? {
        id: `https://${domain}/users/${user.username}#main-key`,
        owner: `https://${domain}/users/${user.username}`,
        publicKeyPem: user.publicKey
      } : undefined
    });
  });

  // Set up object dispatcher for posts
  federation.setObjectDispatcher(Note, '/posts/{postId}', async (ctx, { postId }) => {
    const db = mongoClient.db('fongoblog2');
    const posts = db.collection('posts');
    const users = db.collection('users');
    
    const post = await posts.findOne({ _id: new ObjectId(postId) });
    if (!post) return null;

    const author = await users.findOne({ _id: post.userId });
    if (!author) return null;

    const domain = ctx.hostname;
    
    return new Note({
      id: new URL(`https://${domain}/posts/${post._id}`),
      content: post.content,
      attributedTo: new URL(`https://${domain}/users/${author.username}`),
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      published: post.createdAt,
      updated: post.updatedAt
    });
  });

  // Set up outbox dispatcher
  federation.setOutboxDispatcher('/users/{identifier}/outbox', async (ctx, identifier, cursor) => {
    const db = mongoClient.db('fongoblog2');
    const posts = db.collection('posts');
    const users = db.collection('users');
    
    const user = await users.findOne({ username: identifier });
    if (!user) return null;

    const limit = 20;
    const skip = cursor ? Number.parseInt(cursor, 10) : 0;
    
    const userPosts = await posts
      .find({ userId: user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const domain = ctx.hostname;
    
    const activities = userPosts.map(post => new Create({
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

  // Set up inbox listeners
  federation
    .setInboxListeners('/users/{identifier}/inbox', '/inbox')
    .on(Follow, async (ctx, follow) => {
      const from = await follow.getActor(ctx);
      if (!from) return;
      
      const db = mongoClient.db('fongoblog2');
      const users = db.collection('users');
      const follows = db.collection('follows');
      
      // Extract username from the follow target
      const targetUri = follow.objectId?.href;
      const username = targetUri?.split('/users/')[1];
      
      if (!username) return;
      
      const targetUser = await users.findOne({ username });
      if (!targetUser) return;
      
      // Check if already following
      const existingFollow = await follows.findOne({
        followerId: from.id?.href?.split('/users/')[1],
        followingId: targetUser._id?.toString()
      });
      
      if (!existingFollow) {
        // Create follow relationship
        await follows.insertOne({
          followerId: from.id?.href?.split('/users/')[1],
          followingId: targetUser._id?.toString(),
          createdAt: new Date()
        });
      }
      
      // Send Accept activity back
      const accept = new Accept({
        actor: new URL(`https://${ctx.hostname}/users/${username}`),
        object: follow,
        to: [from.id?.href || ''],
        cc: ['https://www.w3.org/ns/activitystreams#Public']
      });
      
      // Send the accept activity
      try {
        await ctx.sendActivity({ username }, [from.id?.href || ''], accept);
      } catch (error) {
        console.error('Error sending accept activity:', error);
      }
    })
    .on(Create, async (ctx, create) => {
      // Handle incoming posts
      const from = await create.getActor(ctx);
      if (!from) return;
      
      const db = mongoClient.db('fongoblog2');
      const users = db.collection('users');
      const posts = db.collection('posts');
      
      // Extract username from the actor
      const username = from.id?.href?.split('/users/')[1];
      if (!username) return;
      
      const user = await users.findOne({ username });
      if (!user) return;
      
      // Check if this is a Note
      const object = await create.getObject(ctx);
      if (object instanceof Note) {
        // Store the incoming post
        await posts.insertOne({
          userId: user._id,
          content: object.content || '',
          createdAt: object.published || new Date(),
          updatedAt: object.updated || new Date(),
          federated: true,
          federatedFrom: from.id?.href
        });
      }
    })
    .on(Like, async (ctx, like) => {
      // Handle incoming likes
      const from = await like.getActor(ctx);
      if (!from) return;
      
      // Extract post ID from the liked object
      const objectUri = like.objectId?.href;
      const postId = objectUri?.split('/posts/')[1];
      
      if (postId) {
        const db = mongoClient.db('fongoblog2');
        const posts = db.collection('posts');
        
        // Increment like count
        await posts.updateOne(
          { _id: new ObjectId(postId) },
          { $inc: { likeCount: 1 } }
        );
      }
    })
    .on(Announce, async (ctx, announce) => {
      // Handle incoming reposts/boosts
      const from = await announce.getActor(ctx);
      if (!from) return;
      
      // Extract post ID from the announced object
      const objectUri = announce.objectId?.href;
      const postId = objectUri?.split('/posts/')[1];
      
      if (postId) {
        const db = mongoClient.db('fongoblog2');
        const posts = db.collection('posts');
        
        // Increment repost count
        await posts.updateOne(
          { _id: new ObjectId(postId) },
          { $inc: { repostCount: 1 } }
        );
      }
    });

  return federation;
}

// Export a function to mount Fedify's ActivityPub endpoints into your Hono app
export function mountFedifyRoutes(app: Hono, mongoClient: any) {
  const federation = createFederationInstance(mongoClient);
  // Mount the Fedify federation middleware at root
  app.use('*', fedifyHonoMiddleware(federation, () => ({})));
}