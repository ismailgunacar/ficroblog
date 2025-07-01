import {
  Accept,
  type Context,
  Create,
  Endpoints,
  Follow as FediFollow,
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
import { Follow, Following, Post } from "./models.js";

const logger = getLogger("wendy");

await connectDB();

// Cache for in-memory keys
const keyCache = new Map<
  string,
  Array<{ privateKey: CryptoKey; publicKey: CryptoKey }>
>();

const PUBLIC_URL = process.env.PUBLIC_URL;
if (!PUBLIC_URL) {
  throw new Error(
    "PUBLIC_URL environment variable must be set to your production domain (e.g., https://gunac.ar)",
  );
}

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
  baseUrl: new URL(PUBLIC_URL),
});

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    logger.info(`Actor dispatcher called for identifier: ${identifier}`);
    const keys = await ctx.getActorKeyPairs(identifier);
    logger.info(`Loaded ${keys.length} keys for ${identifier}`);

    const actor = new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: identifier,
      followers: ctx.getFollowersUri(identifier),
      following: ctx.getFollowingUri(identifier),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      publicKey: keys[0]?.cryptographicKey,
      assertionMethods: keys.map((k) => k.multikey),
    });

    logger.info(`Created actor: ${actor.id?.href || "unknown"}`);
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

    // Generate both RSA and Ed25519 keys in memory
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
    // Use public URL for consistent storage
    const following = `${PUBLIC_URL}/users/ismail`;
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
  .on(Undo, async (ctx, undo) => {
    const object = await undo.getObject();
    if (!(object instanceof FediFollow)) return;
    if (!undo.actorId || !object.objectId) return;
    const parsed = ctx.parseUri(object.objectId);
    if (!parsed || parsed.type !== "actor") return;
    const following = `${PUBLIC_URL}/users/ismail`;
    const follower = undo.actorId.href;

    logger.info(`Received unfollow request from ${follower} to ${following}`);
    await Follow.deleteOne({ following, follower });
    logger.info(`Removed follower ${follower} from ${following}`);
  })
  .on(Accept, async (ctx, accept) => {
    logger.info(`Received Accept activity from ${accept.actorId?.href}`);

    // Get the object being accepted
    const object = await accept.getObject();
    if (!object) {
      logger.error(`Could not get object from Accept activity`);
      return;
    }

    // Check if it's accepting a Follow activity
    if (object instanceof FediFollow) {
      const following = object.objectId?.href;
      const follower = object.actorId?.href;

      if (following && follower) {
        logger.info(`Accepting follow from ${follower} to ${following}`);

        // Update the following relationship to mark it as accepted
        await Following.updateOne(
          { follower, following },
          { $set: { accepted: true, acceptedAt: new Date() } },
          { upsert: true },
        );

        logger.info(
          `Successfully processed Accept for follow from ${follower} to ${following}`,
        );
      }
    } else {
      logger.info(
        `Accept activity for non-Follow object: ${object.constructor.name}`,
      );
    }
  })
  .on(Create, async (ctx, create) => {
    const object = await create.getObject();
    if (!object || object.type !== "Note") return;
    const content = object.content;
    const author =
      object.attribution?.href ||
      object.attributedTo?.href ||
      object.actor?.href;
    await Post.create({
      content,
      author,
      createdAt: new Date(object.published || Date.now()),
      remote: true,
      objectId: object.id,
    });
  });

// Expose followers collection for ActivityPub
federation
  .setFollowersDispatcher(
    "/users/{identifier}/followers",
    async (ctx, identifier, cursor) => {
      const following = `${PUBLIC_URL}/users/ismail`;
      const docs = await Follow.find({ following })
        .sort({ createdAt: -1 })
        .exec();
      const items: Recipient[] = docs.map(
        (f: import("./models.js").IFollow) => ({
          id: new URL(f.follower),
          inboxId: null, // Optionally resolve inbox if you store it
        }),
      );
      return { items };
    },
  )
  .setCounter(async (ctx, identifier) => {
    const following = `${PUBLIC_URL}/users/ismail`;
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
    const post = await Post.findOne({
      _id: values.id,
      author: values.identifier,
    }).exec();

    if (!post) return null;

    return new Note({
      id: ctx.getObjectUri(Note, values),
      attribution: ctx.getActorUri(values.identifier),
      to: PUBLIC_COLLECTION,
      content: post.content,
      mediaType: "text/html",
      url: ctx.getObjectUri(Note, values),
    });
  },
);

export default federation;
