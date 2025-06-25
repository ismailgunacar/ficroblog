import { Temporal } from "@js-temporal/polyfill";
import {
  Accept,
  Announce,
  Create,
  Endpoints,
  Follow,
  Like,
  Note,
  Person,
  PUBLIC_COLLECTION,
  Undo,
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
    // Try to update existing actor or insert new one
    const result = await actorsCollection.findOneAndUpdate(
      { uri: actorData.uri },
      { $set: actorData },
      { upsert: true, returnDocument: "after" }
    );
    return result as Actor;
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
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: actor.name,
      summary: actor.summary, // Include bio/description for fediverse compatibility
      inbox: ctx.getInboxUri(identifier),
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
    const postsCollection = getPostsCollection();

    const user = await usersCollection.findOne({ username: values.identifier });
    if (!user) return null;

    const post = await postsCollection.findOne({ 
      id: parseInt(values.id),
      actor_id: user.id 
    });
    if (!post) return null;

    return new Note({
      id: ctx.getObjectUri(Note, values),
      attribution: ctx.getActorUri(values.identifier),
      to: PUBLIC_COLLECTION,
      cc: ctx.getFollowersUri(values.identifier),
      content: post.content,
      mediaType: "text/html",
      published: Temporal.Instant.from(post.created.toISOString()),
      url: ctx.getObjectUri(Note, values),
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

      const items: Recipient[] = followers.map((f) => {
        const follower = f.follower[0] as Actor;
        return {
          id: new URL(follower.uri),
          inboxId: new URL(follower.inbox_url),
          endpoints: follower.shared_inbox_url 
            ? { sharedInbox: new URL(follower.shared_inbox_url) }
            : null,
        };
      });

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
          actor_id: actorRecord.id,
          post_id: post.id
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
      const postId = await getNextSequence("posts");
      await postsCollection.insertOne({
        id: postId,
        uri: object.id.href,
        actor_id: actorRecord.id,
        content,
        url: object.url?.href || null,
        created: new Date()
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
      actorRecord = persistedActor;
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
      // Update actorRecord reference
      actorRecord = persistedActor;
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

export default federation;
