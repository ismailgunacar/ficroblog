import { createFederation, MemoryKvStore, Person, Note, Follow, Accept, Create, Like, Announce, Image, generateCryptoKeyPair, exportJwk, importJwk } from '@fedify/fedify';
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
  const kvStore = new MongoDBKVStore(mongoClient, mongoClient.db().databaseName || 'fongoblog2');

  const federation = createFederation({
    kv: kvStore,
    // Allow all domains for now (you can restrict this later)
    skipSignatureVerification: true, // For development only
  });

  // Set up NodeInfo dispatcher
  federation.setNodeInfoDispatcher('/.well-known/nodeinfo/2.0', async (ctx) => {
    const db = mongoClient.db();
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



  // Set up object dispatcher for posts
  federation.setObjectDispatcher(Note, '/posts/{postId}', async (ctx, { postId }) => {
    const db = mongoClient.db();
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
    const db = mongoClient.db();
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

  // Set up actor dispatcher with key pairs dispatcher
  federation
    .setActorDispatcher('/users/{identifier}', async (ctx, identifier) => {
      const db = mongoClient.db(); // Use default database from connection string
      const users = db.collection('users');
      
      const user = await users.findOne({ username: identifier });
      if (!user) return null;

      const domain = ctx.hostname;
      
      // Get the actor's key pairs
      const keys = await ctx.getActorKeyPairs(identifier);
      
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
        // Add cryptographic keys for signature verification
        publicKey: keys[0]?.cryptographicKey,
        assertionMethods: keys.map((k) => k.multikey),
      });
    })
    .setKeyPairsDispatcher(async (ctx, identifier) => {
    console.log(`🔑 Key pairs dispatcher called for identifier: ${identifier}`);
    const db = mongoClient.db(); // Use default database from connection string
    const users = db.collection('users');
    const keys = db.collection('keys');
    
    console.log(`🔍 Looking for user with username: "${identifier}"`);
    
    // Debug: Let's see what users exist
    const allUsers = await users.find({}).limit(5).toArray();
    console.log(`📊 Available users in database:`, allUsers.map(u => u.username));
    
    const user = await users.findOne({ username: identifier });
    if (!user) {
      console.log(`❌ User not found for identifier: "${identifier}"`);
      console.log(`🔍 Trying case-insensitive search...`);
      
      // Try case-insensitive search
      const userCaseInsensitive = await users.findOne({ 
        username: { $regex: new RegExp(`^${identifier}$`, 'i') } 
      });
      
      if (userCaseInsensitive) {
        console.log(`✅ Found user with case-insensitive search:`, userCaseInsensitive.username);
        return [];
      }
      
      return [];
    }
    
    // Clear existing keys to regenerate them with correct format
    console.log(`🧹 Clearing existing keys for regeneration...`);
    await keys.deleteMany({ user_id: user._id });
    
    // Get existing keys or generate new ones
    let rsaKey = await keys.findOne({ user_id: user._id, type: 'RSASSA-PKCS1-v1_5' });
    let ed25519Key = await keys.findOne({ user_id: user._id, type: 'Ed25519' });
    
    const keyPairs = [];
    
    // Generate RSA key if it doesn't exist
    if (!rsaKey) {
      console.log(`🔑 Generating RSA key for user: ${user.username}`);
      const { privateKey, publicKey } = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5', {
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: 'SHA-256',
      });
      
      rsaKey = {
        user_id: user._id,
        type: 'RSASSA-PKCS1-v1_5',
        private_key: JSON.stringify(await exportJwk(privateKey)),
        public_key: JSON.stringify(await exportJwk(publicKey)),
        created: new Date().toISOString(),
      };
      
      await keys.insertOne(rsaKey);
      console.log(`✅ RSA key generated and stored for user: ${user.username}`);
    }
    
    // Generate Ed25519 key if it doesn't exist
    if (!ed25519Key) {
      console.log(`🔑 Generating Ed25519 key for user: ${user.username}`);
      const { privateKey, publicKey } = await generateCryptoKeyPair('Ed25519');
      
      ed25519Key = {
        user_id: user._id,
        type: 'Ed25519',
        private_key: JSON.stringify(await exportJwk(privateKey)),
        public_key: JSON.stringify(await exportJwk(publicKey)),
        created: new Date().toISOString(),
      };
      
      await keys.insertOne(ed25519Key);
      console.log(`✅ Ed25519 key generated and stored for user: ${user.username}`);
    }
    
    // Return key pairs
    if (rsaKey) {
      try {
        const privateKey = await importJwk(JSON.parse(rsaKey.private_key), 'RSASSA-PKCS1-v1_5');
        const publicKey = await importJwk(JSON.parse(rsaKey.public_key), 'RSASSA-PKCS1-v1_5');
        keyPairs.push({ privateKey, publicKey });
        console.log(`✅ Successfully imported RSA key pair`);
      } catch (error) {
        console.error(`❌ Failed to import RSA key pair:`, error);
      }
    }
    
    if (ed25519Key) {
      try {
        const privateKey = await importJwk(JSON.parse(ed25519Key.private_key), 'Ed25519');
        const publicKey = await importJwk(JSON.parse(ed25519Key.public_key), 'Ed25519');
        keyPairs.push({ privateKey, publicKey });
        console.log(`✅ Successfully imported Ed25519 key pair`);
      } catch (error) {
        console.error(`❌ Failed to import Ed25519 key pair:`, error);
      }
    }
    
    console.log(`🔑 Returning ${keyPairs.length} key pairs for user: ${user.username}`);
    return keyPairs;
  });

  // Set up inbox listeners
  federation
    .setInboxListeners('/users/{identifier}/inbox', '/inbox')
    .on(Follow, async (ctx, follow) => {
      const from = await follow.getActor(ctx);
      if (!from) {
        console.log('Could not get actor from follow activity');
        return;
      }
      
      const db = mongoClient.db();
      const users = db.collection('users');
      const follows = db.collection('follows');
      
      // Get the target user from the context (the recipient)
      const recipient = ctx.getRecipient();
      if (!recipient?.identifier) {
        console.log('No recipient found in context');
        return;
      }
      
      const username = recipient.identifier;
      const targetUser = await users.findOne({ username });
      if (!targetUser) {
        console.log(`Target user ${username} not found`);
        return;
      }
      
      console.log(`Received follow request from ${from.preferredUsername} to ${username}`);
      
      // Check if already following
      const existingFollow = await follows.findOne({
        followerId: from.id?.href,
        followingId: targetUser._id.toString()
      });
      
      if (!existingFollow) {
        // Create follow relationship
        await follows.insertOne({
          followerId: from.id?.href,
          followingId: targetUser._id.toString(),
          followerHandle: `${from.preferredUsername}@${from.id?.hostname}`,
          followerName: from.name || from.preferredUsername,
          followerUrl: from.id?.href,
          followerInbox: from.inbox?.href,
          remote: true,
          pending: false, // Auto-accept for now
          createdAt: new Date()
        });
        
        console.log(`Created follow relationship: ${from.preferredUsername} -> ${username}`);
      } else {
        console.log(`Follow relationship already exists: ${from.preferredUsername} -> ${username}`);
      }
      
      // Send Accept activity back
      const accept = new Accept({
        id: new URL(`https://${ctx.hostname}/activities/${new ObjectId()}`),
        actor: ctx.getActorUri(username),
        object: follow,
        to: from.id,
      });
      
      // Send the accept activity using the correct sendActivity signature
      try {
        await ctx.sendActivity({ username }, from.id?.href, accept);
        console.log(`Sent Accept activity to ${from.preferredUsername}`);
      } catch (error) {
        console.error('Error sending accept activity:', error);
      }
    })
    .on(Accept, async (ctx, accept) => {
      // Handle Accept activities (when someone accepts our follow request)
      const from = await accept.getActor(ctx);
      if (!from) return;
      
      const db = mongoClient.db();
      const follows = db.collection('follows');
      
      // Update the follow relationship to mark it as accepted
      await follows.updateOne(
        { 
          followingId: from.id?.href,
          pending: true 
        },
        { 
          $set: { 
            pending: false,
            acceptedAt: new Date()
          } 
        }
      );
      
      console.log(`Received Accept from ${from.preferredUsername}`);
    })
    .on(Create, async (ctx, create) => {
      // Handle incoming posts
      const from = await create.getActor(ctx);
      if (!from) return;
      
      const db = mongoClient.db();
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
        const db = mongoClient.db();
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
        const db = mongoClient.db();
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

// Global federation instance
let globalFederation: any = null;

// Export a function to mount Fedify's ActivityPub endpoints into your Hono app
export function mountFedifyRoutes(app: Hono, mongoClient: any) {
  const federation = createFederationInstance(mongoClient);
  globalFederation = federation; // Store for later use
  // Mount the Fedify federation middleware at root
  app.use('*', fedifyHonoMiddleware(federation, () => ({})));
}

// Export function to get the federation instance
export function getFederation() {
  if (!globalFederation) {
    throw new Error('Federation not initialized. Call mountFedifyRoutes first.');
  }
  return globalFederation;
}