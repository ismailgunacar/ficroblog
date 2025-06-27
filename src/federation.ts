import { Temporal } from "@js-temporal/polyfill";
import {
  Accept,
  Announce,
  Create,
  Delete,
  Endpoints,
  Follow,
  Like,
  Note,
  Person,
  PUBLIC_COLLECTION,
  Undo,
  Update,
  createFederation,
  exportJwk,
  generateCryptoKeyPair,
  getActorHandle,
  importJwk,
  isActor,
  type Actor as APActor,
  type Recipient,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { MemoryKvStore, InProcessMessageQueue } from "@fedify/fedify";
import { stringifyEntities } from "stringify-entities";
import { connectToDatabase, getUsersCollection, getActorsCollection, getKeysCollection, getFollowsCollection, getPostsCollection, getLikesCollection, getRepostsCollection } from "./db.ts";
import { getNextSequence } from "./utils.ts";
import type { Actor, Key, Post, User } from "./schema.ts";

const logger = getLogger("marco3");

// Ensure environment variables are available for federation context
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = "mongodb+srv://igunacar:fbVBpdpDuyTHxB5t@cluster0.isg22.mongodb.net/marco3?retryWrites=true&w=majority&appName=Cluster0";
  logger.warn("MONGODB_URI not found, using fallback for federation context");
}
if (!process.env.DOMAIN) {
  process.env.DOMAIN = "gunac.ar";
  logger.warn("DOMAIN not found, using fallback for federation context");
}

// Helper function to get canonical domain for federation
export function getCanonicalDomain(): string {
  const domain = process.env.DOMAIN || "gunac.ar";
  // Always use HTTPS for federation, even in development (unless localhost)
  if (domain.includes("localhost")) return `http://${domain}`;
  // Remove any protocol prefix and force https
  return `https://${domain.replace(/^https?:\/\//, "")}`;
}

// Helper function to create federation context with canonical domain
export function createCanonicalContext(request: Request, data?: any) {
  try {
    const canonicalUrl = getCanonicalDomain();
    // Create a new request with the canonical domain but preserve other request properties
    // For POST requests, don't try to pass the body as it may already be consumed
    const canonicalRequest = new Request(canonicalUrl + new URL(request.url).pathname + new URL(request.url).search, {
      method: 'GET', // Always use GET for federation context creation
      headers: {
        'Accept': 'application/activity+json',
        'User-Agent': request.headers.get('User-Agent') || 'Marco3/1.0',
      },
    });
    return federation.createContext(canonicalRequest, data);
  } catch (error) {
    logger.error("Error creating canonical context", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

// Helper function to persist actor to database
async function persistActor(actor: APActor): Promise<Actor | null> {
  if (actor.id == null || actor.inboxId == null) {
    logger.debug("Actor is missing required fields", { actor });
    return null;
  }

  await connectToDatabase();
  const actorsCollection = getActorsCollection();

  // Check if actor already exists
  const existingActor = await actorsCollection.findOne({ uri: actor.id.href });
  if (existingActor) {
    // Update existing actor with new data (but keep the same ID)
    const updatedData = {
      handle: await getActorHandle(actor),
      name: actor.name?.toString() || null,
      inbox_url: actor.inboxId.href,
      shared_inbox_url: actor.endpoints?.sharedInbox?.href || null,
      url: actor.url?.href || null,
    };

    await actorsCollection.updateOne(
      { uri: actor.id.href },
      { $set: updatedData }
    );
    
    return { ...existingActor, ...updatedData } as Actor;
  }

  // Create new actor
  const actorData = {
    id: await getNextSequence("actors"),
    user_id: null,
    uri: actor.id.href,
    handle: await getActorHandle(actor),
    name: actor.name?.toString() || null,
    inbox_url: actor.inboxId.href,
    shared_inbox_url: actor.endpoints?.sharedInbox?.href || null,
    url: actor.url?.href || null,
    created: new Date()
  };

  try {
    await actorsCollection.insertOne(actorData);
    return actorData as Actor;
  } catch (error) {
    logger.error("Failed to persist actor", { error, actor: actorData });
    return null;
  }
}

// Actor dispatcher
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    await connectToDatabase();
    const usersCollection = getUsersCollection();
    const actorsCollection = getActorsCollection();

    const user = await usersCollection.findOne({ username: identifier });
    if (!user) return null;

    const actor = await actorsCollection.findOne({ user_id: user.id });
    if (!actor) return null;

    const keys = await ctx.getActorKeyPairs(identifier);
    // Always use canonical HTTPS domain for all URLs
    const domain = getCanonicalDomain();
    const actorUrl = `${domain}/users/${identifier}`;
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: actor.name,
      summary: actor.summary, // Include bio/description for fediverse compatibility
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      url: ctx.getActorUri(identifier),
      publicKey: keys[0]?.cryptographicKey,
      assertionMethods: keys.map((k) => k.multikey),
      followers: ctx.getFollowersUri(identifier),
    });
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    await connectToDatabase();
    const usersCollection = getUsersCollection();
    const keysCollection = getKeysCollection();

    const user = await usersCollection.findOne({ username: identifier });
    if (!user) return [];

    const existingKeys = await keysCollection.find({ user_id: user.id }).toArray();
    const keysByType = Object.fromEntries(
      existingKeys.map((row) => [row.type, row])
    ) as Record<Key["type"], Key>;

    const pairs: CryptoKeyPair[] = [];

    // For each of the two key formats (RSASSA-PKCS1-v1_5 and Ed25519)
    for (const keyType of ["RSASSA-PKCS1-v1_5", "Ed25519"] as const) {
      if (keysByType[keyType] == null) {
        logger.debug("Creating new key pair", { identifier, keyType });
        const { privateKey, publicKey } = await generateCryptoKeyPair(keyType);
        
        await keysCollection.insertOne({
          user_id: user.id,
          type: keyType,
          private_key: JSON.stringify(await exportJwk(privateKey)),
          public_key: JSON.stringify(await exportJwk(publicKey)),
          created: new Date()
        });
        
        pairs.push({ privateKey, publicKey });
      } else {
        pairs.push({
          privateKey: await importJwk(
            JSON.parse(keysByType[keyType].private_key),
            "private"
          ),
          publicKey: await importJwk(
            JSON.parse(keysByType[keyType].public_key),
            "public"
          ),
        });
      }
    }
    return pairs;
  });

// Note object dispatcher
federation.setObjectDispatcher(
  Note,
  "/users/{identifier}/posts/{id}",
  async (ctx, values) => {
    await connectToDatabase();
    const usersCollection = getUsersCollection();
    const actorsCollection = getActorsCollection();
    const postsCollection = getPostsCollection();

    const user = await usersCollection.findOne({ username: values.identifier });
    if (!user) return null;

    const actor = await actorsCollection.findOne({ user_id: user.id });
    if (!actor) return null;

    const post = await postsCollection.findOne({ 
      id: parseInt(values.id),
      actor_id: actor.id 
    });
    if (!post) return null;

    // Before constructing the Note, resolve inReplyTo URI if this is a reply
    let inReplyToUri: string | undefined = undefined;
    if (post.reply_to) {
      const parent = await getPostsCollection().findOne({ id: post.reply_to });
      if (parent && parent.uri) {
        inReplyToUri = parent.uri;
      } else {
        inReplyToUri = ctx.getObjectUri(Note, { identifier: values.identifier, id: post.reply_to.toString() }).toString();
      }
    }
    return new Note({
      id: ctx.getObjectUri(Note, values),
      attribution: ctx.getActorUri(values.identifier),
      to: PUBLIC_COLLECTION,
      cc: ctx.getFollowersUri(values.identifier),
      content: post.content,
      mediaType: "text/html",
      published: Temporal.Instant.from(post.created.toISOString()),
      url: ctx.getObjectUri(Note, values),
      ...(inReplyToUri ? { inReplyTo: inReplyToUri } : {})
    });
  }
);

// Followers collection dispatcher
federation
  .setFollowersDispatcher(
    "/users/{identifier}/followers",
    async (ctx, identifier) => {
      await connectToDatabase();
      const usersCollection = getUsersCollection();
      const actorsCollection = getActorsCollection();
      const followsCollection = getFollowsCollection();

      const user = await usersCollection.findOne({ username: identifier });
      if (!user) return { items: [] };

      const actor = await actorsCollection.findOne({ user_id: user.id });
      if (!actor) return { items: [] };

      const followers = await followsCollection
        .aggregate([
          { $match: { following_id: actor.id } },
          {
            $lookup: {
              from: "actors",
              localField: "follower_id",
              foreignField: "id",
              as: "follower"
            }
          },
          { $sort: { created: -1 } }
        ])
        .toArray();

      console.log(`Found ${followers.length} followers for actor ${actor.id}`);

      const items: Recipient[] = followers.map((f) => {
        const follower = f.follower[0] as Actor;
        console.log("Follower data:", {
          follower: !!follower,
          uri: follower?.uri,
          inbox_url: follower?.inbox_url,
          shared_inbox_url: follower?.shared_inbox_url,
          fullFollower: follower
        });
        
        if (!follower || !follower.uri) {
          console.error("Invalid follower data:", f);
          return null;
        }
        
        return {
          id: new URL(follower.uri),
          inboxId: new URL(follower.inbox_url),
          endpoints: follower.shared_inbox_url 
            ? { sharedInbox: new URL(follower.shared_inbox_url) }
            : null,
        };
      }).filter(Boolean) as Recipient[];

      console.log(`Processed ${items.length} valid followers`);
      return { items };
    }
  )
  .setCounter(async (ctx, identifier) => {
    await connectToDatabase();
    const usersCollection = getUsersCollection();
    const actorsCollection = getActorsCollection();
    const followsCollection = getFollowsCollection();

    const user = await usersCollection.findOne({ username: identifier });
    if (!user) return 0;

    const actor = await actorsCollection.findOne({ user_id: user.id });
    if (!actor) return 0;

    return await followsCollection.countDocuments({ following_id: actor.id });
  });

// Outbox dispatcher
federation
  .setOutboxDispatcher("/users/{identifier}/outbox", async (ctx, identifier, cursor) => {
    await connectToDatabase();
    const usersCollection = getUsersCollection();
    const actorsCollection = getActorsCollection();
    const postsCollection = getPostsCollection();

    const user = await usersCollection.findOne({ username: identifier });
    if (!user) return { items: [] };

    const actor = await actorsCollection.findOne({ user_id: user.id });
    if (!actor) return { items: [] };

    // Get recent posts for this user
    const posts = await postsCollection
      .find({ actor_id: actor.id })
      .sort({ created: -1 })
      .limit(20)
      .toArray();

    const items = posts.map(post => {
      const note = new Note({
        id: ctx.getObjectUri(Note, { identifier, id: post.id.toString() }),
        attribution: ctx.getActorUri(identifier),
        to: PUBLIC_COLLECTION,
        cc: ctx.getFollowersUri(identifier),
        content: post.content,
        mediaType: "text/html",
        published: Temporal.Instant.from(post.created.toISOString()),
        url: ctx.getObjectUri(Note, { identifier, id: post.id.toString() }),
        ...(post.reply_to ? { inReplyTo: ctx.getObjectUri(Note, { identifier, id: post.reply_to.toString() }) } : {})
      });

      return new Create({
        id: new URL(ctx.getObjectUri(Note, { identifier, id: post.id.toString() }).href.replace('/posts/', '/activities/create/')),
        actor: ctx.getActorUri(identifier),
        object: note,
        to: PUBLIC_COLLECTION,
        cc: ctx.getFollowersUri(identifier),
        published: Temporal.Instant.from(post.created.toISOString()),
      });
    });

    return { items };
  })
  .setCounter(async (ctx, identifier) => {
    await connectToDatabase();
    const usersCollection = getUsersCollection();
    const actorsCollection = getActorsCollection();
    const postsCollection = getPostsCollection();

    const user = await usersCollection.findOne({ username: identifier });
    if (!user) return 0;

    const actor = await actorsCollection.findOne({ user_id: user.id });
    if (!actor) return 0;

    return await postsCollection.countDocuments({ actor_id: actor.id });
  });

// Inbox listeners
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    if (follow.objectId == null) {
      logger.debug("Follow object does not have an object", { follow });
      return;
    }

    const object = ctx.parseUri(follow.objectId);
    if (object == null || object.type !== "actor") {
      logger.debug("Follow object's object is not an actor", { follow });
      return;
    }

    const follower = await follow.getActor();
    if (follower?.id == null || follower.inboxId == null) {
      logger.debug("Follow object does not have an actor", { follow });
      return;
    }

    await connectToDatabase();
    const usersCollection = getUsersCollection();
    const actorsCollection = getActorsCollection();
    const followsCollection = getFollowsCollection();

    const user = await usersCollection.findOne({ username: object.identifier });
    if (!user) {
      logger.debug("Failed to find user to follow", { identifier: object.identifier });
      return;
    }

    const followingActor = await actorsCollection.findOne({ user_id: user.id });
    if (!followingActor) {
      logger.debug("Failed to find actor to follow", { user });
      return;
    }

    const followerActor = await persistActor(follower);
    if (!followerActor) {
      logger.debug("Failed to persist follower actor", { follower });
      return;
    }

    try {
      await followsCollection.insertOne({
        following_id: followingActor.id,
        follower_id: followerActor.id,
        created: new Date()
      });

      const accept = new Accept({
        actor: follow.objectId,
        to: follow.actorId,
        object: follow,
      });

      await ctx.sendActivity(object, follower, accept);
    } catch (error) {
      logger.error("Failed to process follow request", { error });
    }
  })
  .on(Accept, async (ctx, accept) => {
    const follow = await accept.getObject();
    if (!(follow instanceof Follow)) return;

    const following = await accept.getActor();
    if (!isActor(following)) return;

    const follower = follow.actorId;
    if (follower == null) return;

    const parsed = ctx.parseUri(follower);
    if (parsed == null || parsed.type !== "actor") return;

    await connectToDatabase();
    const usersCollection = getUsersCollection();
    const followsCollection = getFollowsCollection();

    const user = await usersCollection.findOne({ username: parsed.identifier });
    if (!user) return;

    const followingActor = await persistActor(following);
    if (!followingActor) return;

    try {
      await followsCollection.insertOne({
        following_id: followingActor.id,
        follower_id: user.id, // The single user's actor ID is always 1
        created: new Date()
      });
    } catch (error) {
      logger.error("Failed to process accept activity", { error });
    }
  })
  .on(Undo, async (ctx, undo) => {
    const object = await undo.getObject();
    
    if (object instanceof Like) {
      // Handle unlike
      if (object.objectId == null || undo.actorId == null) {
        logger.debug("Undo Like activity missing required fields", { undo, object });
        return;
      }

      await connectToDatabase();
      const actorsCollection = getActorsCollection();
      const postsCollection = getPostsCollection();
      const likesCollection = getLikesCollection();

      const actorRecord = await actorsCollection.findOne({ uri: undo.actorId.href });
      if (!actorRecord) {
        logger.debug("Actor not found for undo like", { actorId: undo.actorId.href });
        return;
      }

      const post = await postsCollection.findOne({ uri: object.objectId.href });
      if (!post) {
        logger.debug("Post not found for undo like", { postUri: object.objectId.href });
        return;
      }

      try {
        await likesCollection.deleteOne({
          actor_id: actorRecord.id,
          post_id: post.id
        });
        logger.info("Unlike activity processed", { postId: post.id, actorId: actorRecord.id });
      } catch (error) {
        logger.error("Failed to process undo like activity", { error });
      }
    } else if (object instanceof Announce) {
      // Handle unrepost
      if (object.objectId == null || undo.actorId == null) {
        logger.debug("Undo Announce activity missing required fields", { undo, object });
        return;
      }

      await connectToDatabase();
      const actorsCollection = getActorsCollection();
      const postsCollection = getPostsCollection();
      const repostsCollection = getRepostsCollection();

      const actorRecord = await actorsCollection.findOne({ uri: undo.actorId.href });
      if (!actorRecord) {
        logger.debug("Actor not found for undo announce", { actorId: undo.actorId.href });
        return;
      }

      const post = await postsCollection.findOne({ uri: object.objectId.href });
      if (!post) {
        logger.debug("Post not found for undo announce", { postUri: object.objectId.href });
        return;
      }

      try {
        await repostsCollection.deleteOne({
          actor_id: Number(actorRecord.id),
          post_id: Number(post.id)
        });
        logger.info("Unannounce activity processed", { postId: post.id, actorId: actorRecord.id });
      } catch (error) {
        logger.error("Failed to process undo announce activity", { error });
      }
    } else if (object instanceof Follow) {
      // Handle unfollow
      if (object.objectId == null || undo.actorId == null) return;

      const parsed = ctx.parseUri(object.objectId);
      if (parsed == null || parsed.type !== "actor") return;

      await connectToDatabase();
      const usersCollection = getUsersCollection();
      const actorsCollection = getActorsCollection();
      const followsCollection = getFollowsCollection();

      const user = await usersCollection.findOne({ username: parsed.identifier });
      if (!user) return;

      const actor = await actorsCollection.findOne({ user_id: user.id });
      if (!actor) return;

      const followerActor = await actorsCollection.findOne({ uri: undo.actorId.href });
      if (!followerActor) return;

      try {
        await followsCollection.deleteOne({
          following_id: actor.id,
          follower_id: followerActor.id
        });
      } catch (error) {
        logger.error("Failed to process unfollow", { error });
      }
    }
  })
  .on(Create, async (ctx, create) => {
    const object = await create.getObject();
    if (!(object instanceof Note)) return;

    const actor = create.actorId;
    if (actor == null) return;

    const author = await object.getAttribution();
    if (!isActor(author) || author.id?.href !== actor.href) return;

    const actorRecord = await persistActor(author);
    if (!actorRecord) return;

    if (object.id == null) return;

    const content = object.content?.toString();
    if (!content) return;

    await connectToDatabase();
    const postsCollection = getPostsCollection();

    try {
      // Check for inReplyTo property (may be on object directly or in object._fields)
      let replyToId: number | undefined = undefined;
      const inReplyTo = (object as any).inReplyTo || (object as any)._fields?.inReplyTo;
      if (inReplyTo) {
        // Try to match by full URI first
        const parentPost = await postsCollection.findOne({ uri: inReplyTo.toString() });
        if (parentPost) {
          replyToId = parentPost.id;
        } else {
          // Fallback: try to match /posts/{id} in the URI
          const match = /\/posts\/(\d+)/.exec(inReplyTo.toString());
          if (match) replyToId = parseInt(match[1], 10);
        }
      }
      const postId = await getNextSequence("posts");
      await postsCollection.insertOne({
        id: postId,
        uri: object.id.href,
        actor_id: actorRecord.id,
        content,
        url: object.url?.href || null,
        created: new Date(),
        ...(replyToId ? { reply_to: replyToId } : {})
      });
    } catch (error) {
      logger.error("Failed to create post from activity", { error });
    }
  })
  .on(Like, async (ctx, like) => {
    if (like.objectId == null || like.actorId == null) {
      logger.debug("Like activity missing required fields", { like });
      return;
    }

    await connectToDatabase();
    const actorsCollection = getActorsCollection();
    const postsCollection = getPostsCollection();
    const likesCollection = getLikesCollection();

    // Find the actor who liked
    let actorRecord = await actorsCollection.findOne({ uri: like.actorId.href });
    if (!actorRecord) {
      // Try to fetch and persist the actor
      const actor = await like.getActor();
      if (!isActor(actor)) {
        logger.debug("Could not fetch actor for like", { actorId: like.actorId.href });
        return;
      }
      const persistedActor = await persistActor(actor);
      if (!persistedActor) {
        logger.debug("Could not persist actor for like", { actor });
        return;
      }
      // Update actorRecord reference
      actorRecord = await actorsCollection.findOne({ uri: like.actorId.href });
      if (!actorRecord) return; // Defensive: still not found
    }

    // Find the post being liked
    const post = await postsCollection.findOne({ uri: like.objectId.href });
    if (!post) {
      logger.debug("Post not found for like", { postUri: like.objectId.href });
      return;
    }

    // Check if already liked
    const existingLike = await likesCollection.findOne({
      actor_id: actorRecord.id,
      post_id: post.id
    });

    if (existingLike) {
      logger.debug("Post already liked by this actor", { postId: post.id, actorId: actorRecord.id });
      return;
    }

    try {
      const likeId = await getNextSequence("likes");
      await likesCollection.insertOne({
        id: likeId,
        uri: like.id?.href || `${actorRecord.uri}/likes/${likeId}`,
        actor_id: actorRecord.id,
        post_id: post.id,
        created: new Date()
      });
      logger.info("Like activity processed", { postId: post.id, actorId: actorRecord.id });
    } catch (error) {
      logger.error("Failed to process like activity", { error });
    }
  })
  // Handle ActivityPub Delete activity
  .on(Delete, async (ctx, del) => {
    logger.info("Received Delete activity", { id: del.id?.href, actor: del.actorId?.href, object: del.objectId?.href });
    if (!del.objectId) return;
    const objectUri = del.objectId.href;
    // Only handle actor deletion for now
    if (objectUri.startsWith("http")) {
      try {
        await connectToDatabase();
        const actorsCollection = getActorsCollection();
        const likesCollection = getLikesCollection();
        const followsCollection = getFollowsCollection();
        const repostsCollection = getRepostsCollection();
        // Find the actor by URI
        const actor = await actorsCollection.findOne({ uri: objectUri });
        if (!actor) {
          logger.warn("Delete: No local actor found for URI (may be 401/410 or defederated)", { objectUri });
          // Optionally, mark unreachable in DB for future reference
          await actorsCollection.updateOne({ uri: objectUri }, { $set: { unreachable: true } }, { upsert: true });
          return;
        }
        // Remove likes, follows, reposts by this actor
        await likesCollection.deleteMany({ actor_id: actor.id });
        await followsCollection.deleteMany({ $or: [ { follower_id: actor.id }, { following_id: actor.id } ] });
        await repostsCollection.deleteMany({ actor_id: actor.id });
        // Remove the actor itself
        await actorsCollection.deleteOne({ id: actor.id });
        logger.info("Delete: Removed remote actor and related data", { actorId: actor.id, uri: objectUri });
      } catch (err) {
        logger.error("Delete: Error handling remote actor deletion", { objectUri, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      logger.info("Delete: Ignoring non-actor object", { objectUri });
    }
  })
  .on(Announce, async (ctx, announce) => {
    if (announce.objectId == null || announce.actorId == null) {
      logger.debug("Announce activity missing required fields", { announce });
      return;
    }

    await connectToDatabase();
    const actorsCollection = getActorsCollection();
    const postsCollection = getPostsCollection();
    const repostsCollection = getRepostsCollection();

    // Find the actor who announced (reposted)
    let actorRecord = await actorsCollection.findOne({ uri: announce.actorId.href });
    if (!actorRecord) {
      // Try to fetch and persist the actor
      const actor = await announce.getActor();
      if (!isActor(actor)) {
        logger.debug("Could not fetch actor for announce", { actorId: announce.actorId.href });
        return;
      }
      const persistedActor = await persistActor(actor);
      if (!persistedActor) {
        logger.debug("Could not persist actor for announce", { actor });
        return;
      }
      actorRecord = await actorsCollection.findOne({ uri: announce.actorId.href });
      if (!actorRecord) return; // Defensive: still not found
    }

    // Find the post being announced
    const post = await postsCollection.findOne({ uri: announce.objectId.href });
    if (!post) {
      logger.debug("Post not found for announce", { postUri: announce.objectId.href });
      return;
    }

    // Check if already reposted
    const existingRepost = await repostsCollection.findOne({
      actor_id: actorRecord.id,
      post_id: post.id
    });

    if (existingRepost) {
      logger.debug("Post already reposted by this actor", { postId: post.id, actorId: actorRecord.id });
      return;
    }

    try {
      const repostId = await getNextSequence("reposts");
      await repostsCollection.insertOne({
        id: repostId,
        uri: announce.id?.href || `${actorRecord.uri}/announces/${repostId}`,
        actor_id: actorRecord.id,
        post_id: post.id,
        created: new Date()
      });
      logger.info("Announce activity processed", { postId: post.id, actorId: actorRecord.id });
    } catch (error) {
      logger.error("Failed to process announce activity", { error });
    }
  });

// Function to send new post to followers
export async function sendPostToFollowers(userId: number, post: Post, actor: Actor): Promise<void> {
  try {
    await connectToDatabase();
    const followsCollection = getFollowsCollection();
    const actorsCollection = getActorsCollection();
    const usersCollection = getUsersCollection();
    const postsCollection = getPostsCollection();
    
    // Get the user to find username
    const user = await usersCollection.findOne({ id: userId });
    if (!user) {
      logger.error("User not found for sending post to followers", { userId });
      return;
    }
    
    // Get all followers for this user
    const followers = await followsCollection.find({ following_id: userId }).toArray();
    
    if (followers.length === 0) {
      logger.debug("No followers to send post to", { userId, postId: post.id });
      return;
    }
    
    // Create the context for sending activities  
    const context = federation.createContext(new URL(getCanonicalDomain()), userId);

    // Patch: Always use parent post's canonical uri for inReplyTo if available
    let inReplyToUri: string | undefined = undefined;
    if (post.reply_to) {
      const parent = await postsCollection.findOne({ id: post.reply_to });
      logger.info("[Federation] Reply logic triggered", {
        postId: post.id,
        replyTo: post.reply_to,
        parentFound: !!parent,
        parentActorId: parent?.actor_id,
        currentActorId: actor.id
      });
      if (parent && parent.uri) {
        inReplyToUri = parent.uri;
      }
      if (!parent) {
        logger.warn("[Federation] Parent post not found in DB for reply", {
          postId: post.id,
          replyTo: post.reply_to
        });
      } else if (parent.actor_id === actor.id) {
        logger.info("[Federation] Parent actor is local user, skipping remote federation", {
          postId: post.id,
          parentActorId: parent.actor_id
        });
      } else {
        const parentActor = await actorsCollection.findOne({ id: parent.actor_id });
        logger.info("[Federation] Parent actor lookup", {
          parentActorId: parentActor?.id,
          parentActorInbox: parentActor?.inbox_url,
          parentActorUri: parentActor?.uri,
          currentActorUri: actor.uri
        });
        if (!parentActor) {
          logger.warn("[Federation] Parent actor not found in DB", {
            postId: post.id,
            parentActorId: parent.actor_id
          });
        } else if (!parentActor.inbox_url) {
          logger.warn("[Federation] Parent actor has no inbox_url", {
            postId: post.id,
            parentActorId: parentActor.id,
            parentActorUri: parentActor.uri
          });
        } else if (parentActor.uri === actor.uri) {
          logger.info("[Federation] Parent actor is same as current actor, skipping federation", {
            postId: post.id,
            parentActorId: parentActor.id
          });
        } else {
          try {
            // Create the Note and Create activity for federation
            const note = new Note({
              id: context.getObjectUri(Note, { identifier: user.username, id: post.id.toString() }),
              attribution: context.getActorUri(user.username),
              to: PUBLIC_COLLECTION,
              cc: context.getFollowersUri(user.username),
              content: post.content,
              mediaType: "text/html",
              published: Temporal.Instant.from(post.created.toISOString()),
              url: context.getObjectUri(Note, { identifier: user.username, id: post.id.toString() }),
              ...(inReplyToUri ? { inReplyTo: inReplyToUri } : {})
            });
            const createActivity = new Create({
              id: new URL(context.getObjectUri(Note, { identifier: user.username, id: post.id.toString() }).href.replace('/posts/', '/activities/create/')),
              actor: context.getActorUri(user.username),
              object: note,
              to: PUBLIC_COLLECTION,
              cc: context.getFollowersUri(user.username),
              published: Temporal.Instant.from(post.created.toISOString()),
            });
            await context.sendActivity(
              { identifier: user.username },
              {
                id: new URL(parentActor.uri),
                inboxId: new URL(parentActor.inbox_url)
              },
              createActivity
            );
            logger.info("Reply federated to remote parent actor's inbox", {
              postId: post.id,
              parentActorId: parentActor.id,
              parentActorUri: parentActor.uri
            });
          } catch (error) {
            logger.error("Failed to federate reply to remote parent actor", {
              postId: post.id,
              parentActorId: parentActor.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }

    // Always send Create activity to all followers' inboxes
    const note = new Note({
      id: context.getObjectUri(Note, { identifier: user.username, id: post.id.toString() }),
      attribution: context.getActorUri(user.username),
      to: PUBLIC_COLLECTION,
      cc: context.getFollowersUri(user.username),
      content: post.content,
      mediaType: "text/html",
      published: Temporal.Instant.from(post.created.toISOString()),
      url: context.getObjectUri(Note, { identifier: user.username, id: post.id.toString() }),
      ...(post.reply_to ? { inReplyTo: inReplyToUri || undefined } : {})
    });
    const createActivity = new Create({
      id: new URL(context.getObjectUri(Note, { identifier: user.username, id: post.id.toString() }).href.replace('/posts/', '/activities/create/')),
      actor: context.getActorUri(user.username),
      object: note,
      to: PUBLIC_COLLECTION,
      cc: context.getFollowersUri(user.username),
      published: Temporal.Instant.from(post.created.toISOString()),
    });
    for (const follow of followers) {
      const followerActor = await actorsCollection.findOne({ id: follow.follower_id });
      if (followerActor && followerActor.inbox_url) {
        try {
          await context.sendActivity(
            { identifier: user.username },
            {
              id: new URL(followerActor.uri),
              inboxId: new URL(followerActor.inbox_url)
            },
            createActivity
          );
          logger.info("Create activity sent to follower", {
            followerId: followerActor.id,
            followerUri: followerActor.uri,
            postId: post.id
          });
        } catch (error) {
          logger.error("Failed to send create activity to follower", {
            followerId: followerActor.id,
            postId: post.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    
    logger.info("Post sent to followers", { 
      userId, 
      postId: post.id,
      followerCount: followers.length 
    });
  } catch (error) {
    logger.error("Failed to send post to followers", { 
      userId, 
      postId: post.id,
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}

// Function to send profile update to followers
export async function sendProfileUpdate(userId: number, actor: Actor): Promise<void> {
  try {
    await connectToDatabase();
    const followsCollection = getFollowsCollection();
    const actorsCollection = getActorsCollection();
    const usersCollection = getUsersCollection();
    
    // Get the user to find username
    const user = await usersCollection.findOne({ id: userId });
    if (!user) {
      logger.error("User not found for sending profile update", { userId });
      return;
    }
    
    // Get all followers for this user
    const followers = await followsCollection.find({ following_id: userId }).toArray();
    
    if (followers.length === 0) {
      logger.debug("No followers to notify of profile update", { userId });
      return;
    }
    
    // Create the context for sending activities
    const context = federation.createContext(new URL(getCanonicalDomain()), userId);
    
    const person = new Person({
      id: context.getActorUri(user.username),
      name: actor.name,
      summary: actor.summary,
      preferredUsername: user.username,
      inbox: context.getInboxUri(user.username),
      endpoints: new Endpoints({
        sharedInbox: context.getInboxUri(),
      }),
      url: context.getActorUri(user.username),
      published: Temporal.Instant.fromEpochMilliseconds(actor.created.getTime()),
    });
    
    const update = new Update({
      id: new URL(`${getCanonicalDomain()}/activities/update/${Date.now()}`),
      actor: context.getActorUri(user.username),
      object: person,
      published: Temporal.Instant.fromEpochMilliseconds(Date.now()),
      to: PUBLIC_COLLECTION,
    });
    
    // Send to all followers
    for (const follow of followers) {
      const followerActor = await actorsCollection.findOne({ id: follow.follower_id });
      
      if (followerActor && followerActor.inbox_url) {
        try {
          await context.sendActivity(
            { identifier: user.username },
            { 
              id: new URL(followerActor.uri),
              inboxId: new URL(followerActor.inbox_url)
            },
            update
          );
          
          logger.debug("Profile update sent to follower", { 
            followerId: followerActor.id,
            followerUri: followerActor.uri
          });
        } catch (error) {
          logger.error("Failed to send profile update to follower", {
            followerId: followerActor.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    
    logger.info("Profile update sent to followers", { 
      userId, 
      followerCount: followers.length 
    });
  } catch (error) {
    logger.error("Failed to send profile update", { 
      userId, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}

// Send ActivityPub Delete activity for a post
export async function sendDeleteActivity(post: Post) {
  await connectToDatabase();
  const actorsCollection = getActorsCollection();
  const followsCollection = getFollowsCollection();
  const usersCollection = getUsersCollection();
  const actor = await actorsCollection.findOne({ id: post.actor_id });
  if (!actor) return;
  const user = await usersCollection.findOne({ id: actor.user_id });
  if (!user) return;
  const followers = await followsCollection.find({ following_id: actor.id }).toArray();
  const context = federation.createContext(new URL(getCanonicalDomain()), actor.user_id);
  const objectUri = post.uri;
  // Use Fedify's Delete class to construct the activity
  const activity = new Delete({
    id: new URL(`${actor.uri}/activity/delete/${post.id}`),
    actor: new URL(actor.uri),
    object: new URL(objectUri),
    to: PUBLIC_COLLECTION,
    published: Temporal.Now.instant(),
  });
  for (const follow of followers) {
    const followerActor = await actorsCollection.findOne({ id: follow.follower_id });
    if (followerActor && followerActor.inbox_url) {
      try {
        await context.sendActivity(
          { identifier: user.username },
          {
            id: new URL(followerActor.uri),
            inboxId: new URL(followerActor.inbox_url)
          },
          activity
        );
        logger.debug("Delete activity sent to follower", {
          followerId: followerActor.id,
          followerUri: followerActor.uri
        });
      } catch (error) {
        logger.error("Failed to send delete activity to follower", {
          followerId: followerActor.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  logger.info("Delete activity sent to followers", {
    postId: post.id,
    followerCount: followers.length
  });
}

export default federation;
