import {
  Accept,
  Announce,
  type Context,
  Create,
  Delete,
  Endpoints,
  Follow as FediFollow,
  Image,
  Like,
  Note,
  PUBLIC_COLLECTION,
  Person,
  type Recipient,
  Undo,
  createFederation,
  generateCryptoKeyPair,
} from "@fedify/fedify";
import { InProcessMessageQueue, MemoryKvStore } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { connectDB } from "./db.js";
import {
  Announce as AnnounceModel,
  Follow,
  Following,
  Like as LikeModel,
  Post,
  User,
} from "./models.js";

const logger = getLogger("wendy");

await connectDB();

// Cache for in-memory keys
const keyCache = new Map<
  string,
  Array<{ privateKey: CryptoKey; publicKey: CryptoKey }>
>();

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    const keys = await ctx.getActorKeyPairs(identifier);
    // Fetch user from DB to get bio, avatar, header
    const user = await User.findOne({ username: identifier }).exec();

    const actor = new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: user?.displayName || identifier,
      followers: ctx.getFollowersUri(identifier),
      following: ctx.getFollowingUri(identifier),
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      publicKey: keys[0]?.cryptographicKey,
      assertionMethods: keys.map((k) => k.multikey),
      summary: user?.bio || undefined,
      icon:
        user?.avatarUrl &&
        (user.avatarUrl.startsWith("http://") ||
          user.avatarUrl.startsWith("https://"))
          ? new Image({ url: new URL(user.avatarUrl) })
          : undefined,
      image:
        user?.headerUrl &&
        (user.headerUrl.startsWith("http://") ||
          user.headerUrl.startsWith("https://"))
          ? new Image({ url: new URL(user.headerUrl) })
          : undefined,
    });

    return actor;
  })
  .setKeyPairsDispatcher(async (ctx: Context<unknown>, identifier: string) => {
    logger.info(`Getting keys for identifier: ${identifier}`);

    // Check if keys are already cached
    const cachedKeys = keyCache.get(identifier);
    if (cachedKeys) {
      logger.info(`Using cached keys for ${identifier}`);
      return cachedKeys;
    }

    // Generate both key types for cryptographic proofs
    logger.info(`Generating new keys for ${identifier}`);
    const rsaKeys = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
    const ed25519Keys = await generateCryptoKeyPair("Ed25519");

    const keys = [rsaKeys, ed25519Keys];
    keyCache.set(identifier, keys);

    logger.info(`Generated and cached keys for ${identifier}: RSA and Ed25519`);

    return keys;
  });

// Handle incoming Follow and Undo(Follow) activities
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(FediFollow, async (ctx, follow) => {
    if (!follow.objectId || !follow.actorId) return;
    const parsed = ctx.parseUri(follow.objectId);
    if (!parsed || parsed.type !== "actor") return;
    // Only allow follows to our user (single user)
    // Use context to get the correct URL
    const following = ctx.getActorUri(parsed.identifier).href;
    const follower = follow.actorId.href;

    logger.info(`Received follow request from ${follower} to ${following}`);

    // Upsert follower
    await Follow.updateOne(
      { following, follower },
      {
        $set: { following, follower },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );

    // Accept the follow
    const actorObj = await follow.getActor(ctx);
    if (!actorObj) {
      logger.error(`Could not get actor for ${follow.actorId.href}`);
      return;
    }

    const acceptId = new URL(`#accept-${Date.now()}`, following);
    logger.info(`Sending Accept activity with ID: ${acceptId.href}`);

    await ctx.sendActivity(
      { identifier: parsed.identifier },
      actorObj,
      new Accept({
        id: acceptId,
        actor: follow.objectId,
        object: follow,
      }),
    );

    logger.info(
      `Successfully sent Accept activity to ${actorObj.inboxId?.href || "unknown inbox"}`,
    );
  })
  .on(Like, async (ctx, like) => {
    if (!like.actorId || !like.objectId) return;
    logger.info(
      `Received Like activity from ${like.actorId.href} for ${like.objectId.href}`,
    );
    // Extract post ID from the object URL
    const objectUrl = like.objectId.href;
    const postIdMatch = objectUrl.match(/\/posts\/([^\/]+)$/);
    if (!postIdMatch) {
      logger.warn(`Invalid object URI for like: ${objectUrl}`);
      return;
    }
    const postId = postIdMatch[1];
    try {
      // Store the like
      await LikeModel.updateOne(
        { actor: like.actorId.href, object: postId },
        {
          $set: { actor: like.actorId.href, object: postId },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
      logger.info(`Stored like from ${like.actorId.href} for post ${postId}`);
    } catch (error) {
      logger.error(`Failed to store like: ${error}`);
    }
  })
  .on(Announce, async (ctx, announce) => {
    if (!announce.actorId || !announce.objectId) return;
    logger.info(
      `Received Announce activity from ${announce.actorId.href} for ${announce.objectId.href}`,
    );
    // Extract post ID from the object URL
    const objectUrl = announce.objectId.href;
    const postIdMatch = objectUrl.match(/\/posts\/([^\/]+)$/);
    if (!postIdMatch) {
      logger.warn(`Invalid object URI for announce: ${objectUrl}`);
      return;
    }
    const postId = postIdMatch[1];
    try {
      // Store the announce
      await AnnounceModel.updateOne(
        { actor: announce.actorId.href, object: postId },
        {
          $set: { actor: announce.actorId.href, object: postId },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
      logger.info(
        `Stored announce from ${announce.actorId.href} for post ${postId}`,
      );
    } catch (error) {
      logger.error(`Failed to store announce: ${error}`);
    }
  })
  .on(Undo, async (ctx, undo) => {
    const object = await undo.getObject();
    if (!undo.actorId) return;
    // Handle Undo(Like)
    if (object instanceof Like) {
      if (!object.objectId) return;
      const objectUrl = object.objectId.href;
      const postIdMatch = objectUrl.match(/\/posts\/([^\/]+)$/);
      if (!postIdMatch) return;
      const postId = postIdMatch[1];
      logger.info(
        `Received Undo(Like) from ${undo.actorId.href} for post ${postId}`,
      );
      try {
        await LikeModel.deleteOne({ actor: undo.actorId.href, object: postId });
        logger.info(
          `Removed like from ${undo.actorId.href} for post ${postId}`,
        );
      } catch (error) {
        logger.error(`Failed to remove like: ${error}`);
      }
      return;
    }
    // Handle Undo(Announce)
    if (object instanceof Announce) {
      if (!object.objectId) return;
      const objectUrl = object.objectId.href;
      const postIdMatch = objectUrl.match(/\/posts\/([^\/]+)$/);
      if (!postIdMatch) return;
      const postId = postIdMatch[1];
      logger.info(
        `Received Undo(Announce) from ${undo.actorId.href} for post ${postId}`,
      );
      try {
        await AnnounceModel.deleteOne({
          actor: undo.actorId.href,
          object: postId,
        });
        logger.info(
          `Removed announce from ${undo.actorId.href} for post ${postId}`,
        );
      } catch (error) {
        logger.error(`Failed to remove announce: ${error}`);
      }
      return;
    }
    // Handle Undo(Follow)
    if (object instanceof FediFollow) {
      if (!object.objectId) return;
      const parsed = ctx.parseUri(object.objectId);
      if (!parsed || parsed.type !== "actor") return;
      const following = ctx.getActorUri(parsed.identifier).href;
      const follower = undo.actorId.href;
      logger.info(`Received unfollow request from ${follower} to ${following}`);
      await Follow.deleteOne({ following, follower });
      logger.info(`Removed follower ${follower} from ${following}`);
    }
  })
  .on(Create, async (ctx, create) => {
    logger.info(`Received Create activity: ${create.id?.href}`);

    const object = await create.getObject();
    if (!object) {
      logger.error(`Could not get object from Create activity`);
      return;
    }

    // Check if it's a Note (post) - handle both direct type and object structure
    const isNote = object.type === "Note" || object.constructor.name === "Note";

    if (!isNote) {
      logger.info(
        `Ignoring non-Note Create activity: ${object.type || object.constructor.name}`,
      );
      return;
    }

    const content = object.content;
    const author = object.attributionId?.href || create.actorId?.href;

    logger.info(`Processing Note from author: ${author}`);
    logger.info(`Note content: ${content?.substring(0, 100)}...`);

    if (author && content) {
      try {
        // Convert Temporal.Instant to JavaScript Date for MongoDB
        let publishedDate = new Date();
        if (object.published) {
          if (typeof object.published === "string") {
            publishedDate = new Date(object.published);
          } else if (object.published.epochMilliseconds) {
            publishedDate = new Date(object.published.epochMilliseconds);
          } else {
            publishedDate = new Date(object.published.toString());
          }
        }

        // Extract remote author info from the author URL
        let remoteAuthorName = author;
        let remoteAuthorAvatar = "";
        let remoteAuthorUrl = author;

        // Try to extract a display name from the author URL
        try {
          const url = new URL(author);
          const pathParts = url.pathname.split("/").filter(Boolean);
          if (pathParts.length > 0) {
            remoteAuthorName = pathParts[pathParts.length - 1];
          }
        } catch (e) {
          // If URL parsing fails, use the full author as name
          remoteAuthorName = author;
        }

        const post = await Post.create({
          content,
          author,
          createdAt: publishedDate,
          remote: true,
          objectId: object.id?.href,
          remoteAuthorName,
          remoteAuthorAvatar,
          remoteAuthorUrl,
        });

        logger.info(`Successfully stored remote post with ID: ${post._id}`);
        logger.info(`Post author: ${post.author}, remote: ${post.remote}`);
        logger.info(`Remote author name: ${post.remoteAuthorName}`);
      } catch (error) {
        logger.error(`Failed to store remote post: ${error}`);
      }
    } else {
      logger.error(
        `Missing author or content for remote post. Author: ${author}, Content: ${content ? "present" : "missing"}`,
      );
    }
  })
  .on(Delete, async (ctx, del) => {
    logger.info(
      `Received Delete activity: ${del.id?.href || del.id || "unknown"}`,
    );
    logger.info(`Delete actor: ${del.actorId?.href || "unknown"}`);
    logger.info(`Delete object: ${del.objectId?.href || "unknown"}`);
    // For now, just log the deletion. You could add cleanup logic here if desired.
    // Respond with 202 Accepted
    return ctx.res?.status(202);
  });

// Expose followers collection for ActivityPub
federation
  .setFollowersDispatcher(
    "/users/{identifier}/followers",
    async (ctx, identifier, cursor) => {
      const following = ctx.getActorUri(identifier).href;

      const docs = await Follow.find({ following })
        .sort({ createdAt: -1 })
        .exec();

      const items: Recipient[] = docs.map(
        (f: import("./models.js").IFollow) => {
          const inboxUrl = `${f.follower}/inbox`;
          return {
            id: new URL(f.follower),
            inboxId: new URL(inboxUrl),
          };
        },
      );

      return { items };
    },
  )
  .setCounter(async (ctx, identifier) => {
    const following = ctx.getActorUri(identifier).href;
    return await Follow.countDocuments({ following });
  });

// Expose following collection for ActivityPub
federation
  .setFollowingDispatcher(
    "/users/{identifier}/following",
    async (ctx, identifier, cursor) => {
      const follower = ctx.getActorUri(identifier).href;
      const docs = await Following.find({ follower })
        .sort({ createdAt: -1 })
        .exec();
      const items = docs.map(
        (f: import("./models.js").IFollowing) => new URL(f.following),
      );
      return { items };
    },
  )
  .setCounter(async (ctx, identifier) => {
    const follower = ctx.getActorUri(identifier).href;
    return await Following.countDocuments({ follower });
  });

// Expose posts as ActivityPub Note objects
federation.setObjectDispatcher(
  Note,
  "/users/{identifier}/posts/{id}",
  async (ctx, values) => {
    try {
      // Validate that the ID is a valid ObjectId format
      if (
        !values.id ||
        typeof values.id !== "string" ||
        values.id.length !== 24
      ) {
        logger.warn(`Invalid ObjectId format: ${values.id}`);
        return null;
      }

      const post = await Post.findOne({
        _id: values.id,
        author: values.identifier,
      }).exec();

      if (!post) {
        logger.info(
          `Post not found: ${values.id} for user ${values.identifier}`,
        );
        return null;
      }

      return new Note({
        id: ctx.getObjectUri(Note, values),
        attribution: ctx.getActorUri(values.identifier),
        to: PUBLIC_COLLECTION,
        content: post.content,
        mediaType: "text/html",
        url: ctx.getObjectUri(Note, values),
      });
    } catch (error) {
      logger.error(`Error fetching post ${values.id}: ${error}`);
      return null;
    }
  },
);

// Expose outbox for ActivityPub
federation.setOutboxDispatcher(
  "/users/{identifier}/outbox",
  async (ctx, identifier, cursor) => {
    const posts = await Post.find({ author: identifier })
      .sort({ createdAt: -1 })
      .limit(20)
      .exec();

    const activities = posts.map((post) => {
      return new Create({
        id: new URL(`#create-${post._id}`, ctx.getActorUri(identifier).href),
        actor: ctx.getActorUri(identifier),
        object: new Note({
          id: ctx.getObjectUri(Note, { identifier, id: post._id.toString() }),
          attribution: ctx.getActorUri(identifier),
          to: PUBLIC_COLLECTION,
          content: post.content,
          mediaType: "text/html",
          // Don't set published field for now to avoid Temporal issues
        }),
        // Don't set published field for now to avoid Temporal issues
      });
    });

    return { items: activities };
  },
);

// Set up NodeInfo dispatcher
federation.setNodeInfoDispatcher("/.well-known/nodeinfo/2.0", async (ctx) => {
  const userCount = await User.countDocuments();
  const postCount = await Post.countDocuments();

  return {
    version: "2.0",
    software: {
      name: "fongoblog2",
      version: "1.0.0",
    },
    protocols: ["activitypub"],
    services: {
      inbound: [],
      outbound: [],
    },
    openRegistrations: false,
    usage: {
      users: {
        total: userCount,
      },
      localPosts: postCount,
    },
    metadata: {
      nodeName: "fongoblog2",
      nodeDescription: "A federated microblogging platform",
    },
  };
});

export default federation;
