import {
  Announce,
  Create,
  Follow,
  Like,
  Note,
  PUBLIC_COLLECTION,
  Undo,
  isActor,
} from "@fedify/fedify";
import { federation } from "@fedify/fedify/x/hono";
import { getLogger } from "@logtape/logtape";
import * as bcrypt from "bcrypt";
import { Hono } from "hono";
import { stringifyEntities } from "stringify-entities";
import {
  authenticateUser,
  createSession,
  destroySession,
  getCurrentUser,
  redirectIfAuthenticated,
  requireAuth,
} from "./auth.ts";
import {
  handlePostPage,
  handleProfilePage,
  serveActivityPubPost,
} from "./controllers/user.tsx";
import {
  connectToDatabase,
  getActorsCollection,
  getFollowsCollection,
  getLikesCollection,
  getPostsCollection,
  getRepostsCollection,
  getUsersCollection,
} from "./db.ts";
import fedi, {
  sendProfileUpdate,
  sendPostToFollowers,
  createCanonicalContext,
  sendDeleteActivity,
} from "./federation.ts";
import type { Actor, Post, User } from "./schema.ts";
import { getNextSequence } from "./utils.ts";
import {
  FollowerList,
  FollowingList,
  Home,
  Layout,
  LoginForm,
  PostList,
  PostPage,
  Profile,
  ProfileEditForm,
  SetupForm,
} from "./views.tsx";

const logger = getLogger("fongoblog");

const app = new Hono();

// Debug log to trace app startup
console.log("[DEBUG] App starting, routes being registered...");

// URL rewriting middleware for Mastodon-style @ routes
app.use("*", async (c, next) => {
  const path = c.req.path;
  console.log(`[DEBUG] URL rewriting middleware: original path=${path}`);
  
  // Rewrite /@username/following to /profile/username/following
  if (path.match(/^\/@([^\/]+)\/following$/)) {
    const username = path.match(/^\/@([^\/]+)\/following$/)?.[1];
    if (username) {
      const newPath = `/profile/${username}/following`;
      console.log(`[DEBUG] Redirecting /@${username}/following to ${newPath}`);
      // Use redirect instead of rewrite
      return c.redirect(newPath);
    }
  }
  
  // Rewrite /@username/followers to /profile/username/followers
  if (path.match(/^\/@([^\/]+)\/followers$/)) {
    const username = path.match(/^\/@([^\/]+)\/followers$/)?.[1];
    if (username) {
      const newPath = `/profile/${username}/followers`;
      console.log(`[DEBUG] Redirecting /@${username}/followers to ${newPath}`);
      // Use redirect instead of rewrite
      return c.redirect(newPath);
    }
  }
  
  console.log(`[DEBUG] URL rewriting middleware: no rewrite needed for ${path}`);
  return next();
});

// Minimal test route to confirm app is running
app.get("/test-alive", (c) => {
  console.log("[DEBUG] /test-alive route hit");
  return c.text("ALIVE");
});

// Test route to verify route matching
app.get("/@:username/test", async (c) => {
  const username = c.req.param("username");
  console.log(`[DEBUG] Test route hit: username=@${username}, path=${c.req.path}`);
  return c.text(`Test route works for @${username}`);
});

// Remove global federation middleware
// app.use(federation(fedi, () => undefined));

// Home page
app.get("/", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();

  // Check if any user exists - if not, redirect to setup
  const anyUser = await usersCollection.findOne({});
  if (!anyUser) {
    logger.info("No user exists, redirecting to setup");
    return c.redirect("/setup");
  }

  // Check if current user is authenticated (but don't require it)
  const currentUser = getCurrentUser(c);
  const isAuthenticated = !!currentUser;
  logger.info("Current user from session", { currentUser, isAuthenticated });

  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();

  // Get the single user and their actor for the timeline
  const user = anyUser as User;
  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) {
    return c.redirect("/setup");
  }

  // Get follower and following counts
  const followerCount = await followsCollection.countDocuments({
    following_id: actor.id,
  });
  const followingCount = await followsCollection.countDocuments({
    follower_id: actor.id,
  });

  // Attach counts to userWithActor for Home
  const userWithActor = {
    ...user,
    ...actor,
    followers: followerCount,
    following: followingCount,
  } as User & Actor & { followers: number; following: number };

  // Get timeline posts (all posts for public view, or personalized if authenticated)
  let followingIds: number[] = [];
  if (isAuthenticated) {
    followingIds = await followsCollection
      .find({ follower_id: actor.id })
      .map((f: any) => f.following_id)
      .toArray();
  }

  const likesCollection = getLikesCollection();
  const repostsCollection = getRepostsCollection();

  const posts = await postsCollection
    .aggregate([
      {
        $lookup: {
          from: "actors",
          localField: "actor_id",
          foreignField: "id",
          as: "actor",
        },
      },
      {
        $lookup: {
          from: "likes",
          localField: "id",
          foreignField: "post_id",
          as: "likes",
        },
      },
      {
        $lookup: {
          from: "actors",
          localField: "likes.actor_id",
          foreignField: "id",
          as: "like_actors",
        },
      },
      {
        $lookup: {
          from: "reposts",
          localField: "id",
          foreignField: "post_id",
          as: "reposts",
        },
      },
      // Ensure reposts.actor_id is always a number for the join
      {
        $addFields: {
          reposts: {
            $map: {
              input: "$reposts",
              as: "r",
              in: {
                $mergeObjects: [
                  "$$r",
                  { actor_id: { $toInt: "$$r.actor_id" } },
                ],
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "actors",
          let: { repostActorIds: "$reposts.actor_id" },
          pipeline: [
            { $match: { $expr: { $in: ["$id", "$$repostActorIds"] } } },
          ],
          as: "repost_actors",
        },
      },
      {
        $lookup: {
          from: "posts",
          localField: "id",
          foreignField: "reply_to",
          as: "replies",
        },
      },
      {
        $addFields: {
          likesCount: { $size: "$likes" },
          repostsCount: { $size: "$reposts" },
          isLikedByUser: isAuthenticated
            ? {
                $in: [actor.id, "$likes.actor_id"],
              }
            : false,
          isRepostedByUser: isAuthenticated
            ? {
                $in: [actor.id, "$reposts.actor_id"],
              }
            : false,
        },
      },
      {
        $match: isAuthenticated
          ? {
              $or: [
                { actor_id: actor.id },
                { actor_id: { $in: followingIds } },
              ],
            }
          : {}, // Show all posts if not authenticated
      },
      { $sort: { created: -1 } },
      { $limit: 1000 }, // Load many more posts initially
      // Filter out deleted posts and replies to deleted posts
      { $match: { deleted: { $ne: true } } },
    ])
    .toArray();

  const postsWithActors = posts.map((post: any) => {
    const actor = post.actor[0] as Actor;
    const result = {
      ...post,
      // Add actor fields but preserve the post's created field
      uri: actor.uri,
      handle: actor.handle,
      name: actor.name,
      user_id: actor.user_id, // Include user_id for local actor detection
      inbox_url: actor.inbox_url,
      shared_inbox_url: actor.shared_inbox_url,
      url: actor.url || post.url, // Prefer post URL if available
      // Keep the post's created field, not the actor's
    };
    return result;
  }) as (Post & Actor)[];

  // Recursively nest replies for each post
  function nestReplies(posts: any[]): any[] {
    const postMap = new Map<number, any>();
    posts.forEach((post) => postMap.set(post.id, { ...post, replies: [] }));
    const roots: any[] = [];
    posts.forEach((post) => {
      // Prevent self-reply and only nest if parent exists and is not self
      if (
        post.reply_to &&
        post.reply_to !== post.id &&
        postMap.has(post.reply_to)
      ) {
        postMap.get(post.reply_to).replies.push(postMap.get(post.id));
      } else {
        roots.push(postMap.get(post.id));
      }
    });
    return roots;
  }

  // Nest the replies in the posts
  const nestedPosts = nestReplies(postsWithActors);

  return c.html(
    <Layout user={userWithActor} isAuthenticated={isAuthenticated}>
      <Home
        user={userWithActor}
        posts={nestedPosts}
        isAuthenticated={isAuthenticated}
      />
    </Layout>,
  );
});

// API endpoint for loading more posts (infinite scroll)
app.get("/api/posts", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();
  const likesCollection = getLikesCollection();
  const repostsCollection = getRepostsCollection();

  // Get pagination parameters
  const cursor = c.req.query("cursor"); // Last post ID seen
  const limit = Math.min(parseInt(c.req.query("limit") || "200"), 1000); // Max 1000 posts per request

  // Check if user is authenticated
  const currentUser = getCurrentUser(c);
  const isAuthenticated = !!currentUser;

  // Get the single user for filtering
  const anyUser = await usersCollection.findOne({});
  if (!anyUser) {
    return c.json({ posts: [], hasMore: false });
  }

  const user = anyUser as User;
  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) {
    return c.json({ posts: [], hasMore: false });
  }

  // Get following IDs if authenticated
  let followingIds: number[] = [];
  if (isAuthenticated) {
    followingIds = await followsCollection
      .find({ follower_id: actor.id })
      .map((f: any) => f.following_id)
      .toArray();
  }

  // Build aggregation pipeline with cursor-based pagination
  const pipeline: any[] = [
    {
      $lookup: {
        from: "actors",
        localField: "actor_id",
        foreignField: "id",
        as: "actor",
      },
    },
    {
      $lookup: {
        from: "likes",
        localField: "id",
        foreignField: "post_id",
        as: "likes",
      },
    },
    {
      $lookup: {
        from: "actors",
        localField: "likes.actor_id",
        foreignField: "id",
        as: "like_actors",
      },
    },
    {
      $lookup: {
        from: "reposts",
        localField: "id",
        foreignField: "post_id",
        as: "reposts",
      },
    },
    // Ensure reposts.actor_id is always a number for the join
    {
      $addFields: {
        reposts: {
          $map: {
            input: "$reposts",
            as: "r",
            in: {
              $mergeObjects: ["$$r", { actor_id: { $toInt: "$$r.actor_id" } }],
            },
          },
        },
      },
    },
    {
      $lookup: {
        from: "actors",
        let: { repostActorIds: "$reposts.actor_id" },
        pipeline: [{ $match: { $expr: { $in: ["$id", "$$repostActorIds"] } } }],
        as: "repost_actors",
      },
    },
    {
      $lookup: {
        from: "posts",
        localField: "id",
        foreignField: "reply_to",
        as: "replies",
      },
    },
    {
      $addFields: {
        likesCount: { $size: "$likes" },
        repostsCount: { $size: "$reposts" },
        isLikedByUser: isAuthenticated
          ? {
              $in: [actor.id, "$likes.actor_id"],
            }
          : false,
        isRepostedByUser: isAuthenticated
          ? {
              $in: [actor.id, "$reposts.actor_id"],
            }
          : false,
      },
    },
  ];

  // Add cursor-based pagination
  if (cursor) {
    pipeline.push({
      $match: {
        id: { $lt: parseInt(cursor) },
      },
    });
  }

  // Add filtering for authenticated users
  pipeline.push({
    $match: isAuthenticated
      ? {
          $or: [{ actor_id: actor.id }, { actor_id: { $in: followingIds } }],
        }
      : {}, // Show all posts if not authenticated
  });

  // Add sorting and limit
  pipeline.push(
    { $sort: { created: -1 } },
    { $limit: limit + 1 }, // Get one extra to check if there are more
  );

  const posts = await postsCollection.aggregate(pipeline).toArray();

  // Check if there are more posts
  const hasMore = posts.length > limit;
  if (hasMore) {
    posts.pop(); // Remove the extra post
  }

  // Transform posts to include actor data
  const postsWithActors = posts.map((post: any) => {
    const actorData = post.actor[0] as Actor;
    return {
      ...post,
      uri: actorData.uri,
      handle: actorData.handle,
      name: actorData.name,
      user_id: actorData.user_id,
      inbox_url: actorData.inbox_url,
      shared_inbox_url: actorData.shared_inbox_url,
      url: actorData.url || post.url,
    };
  });

  return c.json({
    posts: postsWithActors,
    hasMore,
    nextCursor: posts.length > 0 ? posts[posts.length - 1].id : null,
  });
});

// Post creation route - handle form submission from home page
app.post("/", requireAuth(), async (c) => {
  try {
    await connectToDatabase();
    const usersCollection = getUsersCollection();
    const actorsCollection = getActorsCollection();
    const postsCollection = getPostsCollection();

    const currentUser = getCurrentUser(c);
    if (!currentUser) {
      logger.warn("No user found in POST / route, redirecting to login");
      return c.redirect("/login");
    }

    const user = await usersCollection.findOne({ id: currentUser.userId });
    if (!user) {
      logger.error(`User not found: ${currentUser.userId}`);
      return c.redirect("/login");
    }

    const actor = await actorsCollection.findOne({ user_id: user.id });
    if (!actor) {
      logger.error(`No actor found for user ${user.id}`);
      return c.redirect("/setup");
    }

    const formData = await c.req.formData();
    const content = formData.get("content")?.toString();
    const replyToRaw = formData.get("reply_to");
    const reply_to = replyToRaw
      ? parseInt(replyToRaw.toString(), 10)
      : undefined;

    logger.info(
      `Received post content from ${user.username}: "${content}"${reply_to ? ` (reply to ${reply_to})` : ""}`,
    );

    if (!content || content.trim() === "") {
      logger.warn("Empty content submitted");
      return c.redirect("/?error=empty");
    }

    // Create the post
    logger.info("Getting next post ID...");
    const postId = await getNextSequence("posts");
    logger.info(`Post ID obtained: ${postId}`);

    logger.info("Creating canonical context...");
    const ctx = createCanonicalContext(c.req.raw, undefined);
    logger.info("Context created successfully");

    logger.info("Getting post URI...");
    const postUri = ctx.getObjectUri(Note, {
      identifier: user.username,
      id: postId.toString(),
    }).href;
    logger.info(`Post URI: ${postUri}`);

    const newPost = {
      id: postId,
      uri: postUri,
      actor_id: actor.id,
      content: stringifyEntities(content.trim(), { escapeOnly: true }),
      url: postUri,
      created: new Date(),
      ...(reply_to ? { reply_to } : {}),
    };

    logger.info("Inserting post into database...", { newPost });
    await postsCollection.insertOne(newPost);
    logger.info(
      `Post created successfully: ${postId} by user ${user.username}`,
    );

    // Send Create(Note) activity to followers using robust federation logic
    try {
      await sendPostToFollowers(user.id, newPost as Post, actor as Actor);
      logger.info("ActivityPub Create activity sent successfully", { postId });
    } catch (activityError) {
      logger.error("Failed to send ActivityPub Create activity", {
        activityError:
          activityError instanceof Error
            ? activityError.message
            : String(activityError),
        activityErrorStack:
          activityError instanceof Error ? activityError.stack : undefined,
        postId,
        username: user.username,
      });
      console.error("Full ActivityPub error:", activityError);
      // Continue anyway - the post was created successfully
    }

    // Redirect back to home page
    return c.redirect("/");
  } catch (error) {
    logger.error("Failed to create post", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.redirect("/?error=failed");
  }
});

// Setup page
app.get("/setup", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();

  // Check if any user already exists - if so, redirect to login
  const existingUser = await usersCollection.findOne({});
  if (existingUser) {
    return c.redirect("/login");
  }

  return c.html(
    <Layout>
      <SetupForm />
    </Layout>,
  );
});

// Setup form submission
app.post("/setup", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();

  // Check if any user already exists - prevent multiple users
  const existingUser = await usersCollection.findOne({});
  if (existingUser) {
    return c.redirect("/login");
  }

  const form = await c.req.formData();
  const username = form.get("username");
  const name = form.get("name");
  const password = form.get("password");

  if (typeof username !== "string" || !username.match(/^[a-z0-9_-]{1,50}$/)) {
    return c.redirect("/setup");
  }
  if (typeof name !== "string" || name.trim() === "") {
    return c.redirect("/setup");
  }
  if (typeof password !== "string" || password.length < 8) {
    return c.redirect("/setup");
  }

  const url = new URL(c.req.url);
  const handle = `@${username}@${url.host}`;
  const ctx = createCanonicalContext(c.req.raw, undefined);

  try {
    // Double-check no user exists before creating (race condition protection)
    const doubleCheckUser = await usersCollection.findOne({});
    if (doubleCheckUser) {
      return c.redirect("/login");
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    await usersCollection.insertOne({
      id: 1, // Single user always has ID 1
      username,
      password: hashedPassword,
      created: new Date(),
    });

    // Create actor
    await actorsCollection.insertOne({
      id: 1, // Single user always has ID 1
      user_id: 1,
      uri: ctx.getActorUri(username).href,
      handle,
      name,
      inbox_url: ctx.getInboxUri(username).href,
      shared_inbox_url: ctx.getInboxUri().href,
      url: ctx.getActorUri(username).href,
      created: new Date(),
    });

    // Create session for the new user
    const newUser = {
      id: 1,
      username,
      password: hashedPassword,
      created: new Date(),
    } as User;
    createSession(c, newUser);

    return c.redirect("/");
  } catch (error) {
    logger.error("Failed to create user", { error });
    return c.redirect("/setup");
  }
});

// --- ActivityPub JSON endpoints for federation (keep username in path for compatibility) ---

// Debug middleware to log federation requests
app.use("/users/:username*", async (c, next) => {
  const accept = c.req.header("Accept");
  const userAgent = c.req.header("User-Agent");
  console.log(`[DEBUG] Federation request: ${c.req.method} ${c.req.path}`);
  console.log(`[DEBUG] Accept: ${accept}`);
  console.log(`[DEBUG] User-Agent: ${userAgent}`);
  
  // If it's a browser request (no Accept header or HTML), serve the HTML page
  if (!accept || accept.includes("text/html") || accept.includes("*/*")) {
    console.log(`[DEBUG] Browser request detected, serving HTML instead of ActivityPub JSON`);
    return next();
  }
  
  // If it's an ActivityPub request, let the federation middleware handle it
  if (accept.includes("application/activity+json") || accept.includes("application/ld+json")) {
    console.log(`[DEBUG] ActivityPub request detected, using federation middleware`);
    return next();
  }
  
  // For other requests, serve HTML as fallback
  console.log(`[DEBUG] Unknown request type, serving HTML as fallback`);
  return next();
});

app.use(
  "/users/:username",
  federation(fedi, () => undefined),
);
app.use(
  "/users/:username/posts/:id.json",
  federation(fedi, () => undefined),
);
app.use(
  "/.well-known/webfinger",
  federation(fedi, () => undefined),
);

// Fallback handler for federation routes that don't match ActivityPub format
app.get("/users/:username", async (c) => {
  const username = c.req.param("username");
  console.log(`[DEBUG] Fallback handler for /users/${username} - serving HTML profile page`);
  return handleProfilePage(c, username);
});

app.get("/users/:username/posts/:id", async (c) => {
  const username = c.req.param("username");
  const postId = parseInt(c.req.param("id"));
  console.log(`[DEBUG] Fallback handler for /users/${username}/posts/${postId} - serving HTML post page`);
  return handlePostPage(c, username, postId);
});

// Like a post
app.post("/posts/:id/like", requireAuth(), async (c) => {
  try {
    await connectToDatabase();
    const likesCollection = getLikesCollection();
    const postsCollection = getPostsCollection();
    const actorsCollection = getActorsCollection();
    const usersCollection = getUsersCollection();

    const currentUser = getCurrentUser(c);
    if (!currentUser) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const postId = parseInt(c.req.param("id"));
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      return c.json({ error: "Post not found" }, 404);
    }

    const user = await usersCollection.findOne({ id: currentUser.userId });
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const actor = await actorsCollection.findOne({
      user_id: currentUser.userId,
    });
    if (!actor) {
      return c.json({ error: "Actor not found" }, 404);
    }

    // Check if already liked
    const existingLike = await likesCollection.findOne({
      actor_id: actor.id,
      post_id: postId,
    });

    const ctx = createCanonicalContext(c.req.raw, undefined);

    if (existingLike) {
      // Unlike - remove the like and send Undo activity
      await likesCollection.deleteOne({ _id: existingLike._id });

      try {
        // Send Undo(Like) activity
        const undoActivity = new Undo({
          actor: ctx.getActorUri(user.username),
          object: new Like({
            id: new URL(existingLike.uri),
            actor: ctx.getActorUri(user.username),
            object: new URL(post.uri),
          }),
        });

        await ctx.sendActivity(
          { identifier: user.username },
          "followers",
          undoActivity,
        );
      } catch (activityError) {
        logger.warn("Failed to send Undo Like activity", { activityError });
      }

      // Get updated count
      const likesCount = await likesCollection.countDocuments({
        post_id: postId,
      });
      return c.json({ liked: false, likesCount });
    } else {
      // Like the post
      const likeId = await getNextSequence("likes");
      const likeUri = `${ctx.getActorUri(user.username).href}/likes/${likeId}`;

      await likesCollection.insertOne({
        id: likeId,
        uri: likeUri,
        actor_id: actor.id,
        post_id: postId,
        created: new Date(),
      });

      try {
        // Send Like activity
        const likeActivity = new Like({
          id: new URL(likeUri),
          actor: ctx.getActorUri(user.username),
          object: new URL(post.uri),
        });

        await ctx.sendActivity(
          { identifier: user.username },
          "followers",
          likeActivity,
        );
      } catch (activityError) {
        logger.warn("Failed to send Like activity", { activityError });
      }

      // Get updated count
      const likesCount = await likesCollection.countDocuments({
        post_id: postId,
      });
      return c.json({ liked: true, likesCount });
    }
  } catch (error) {
    logger.error("Failed to like/unlike post", { error });
    return c.json({ error: "Failed to process like" }, 500);
  }
});

// Repost a post
app.post("/posts/:id/repost", requireAuth(), async (c) => {
  try {
    await connectToDatabase();
    const repostsCollection = getRepostsCollection();
    const postsCollection = getPostsCollection();
    const actorsCollection = getActorsCollection();
    const usersCollection = getUsersCollection();

    const currentUser = getCurrentUser(c);
    if (!currentUser) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const postId = parseInt(c.req.param("id"));
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      return c.json({ error: "Post not found" }, 404);
    }

    const user = await usersCollection.findOne({ id: currentUser.userId });
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const actor = await actorsCollection.findOne({
      user_id: currentUser.userId,
    });
    if (!actor) {
      return c.json({ error: "Actor not found" }, 404);
    }

    // Check if already reposted
    const existingRepost = await repostsCollection.findOne({
      actor_id: actor.id,
      post_id: postId,
    });

    const ctx = createCanonicalContext(c.req.raw, undefined);

    if (existingRepost) {
      // Unrepost - remove the repost and send Undo activity
      await repostsCollection.deleteOne({ _id: existingRepost._id });

      try {
        // Send Undo(Announce) activity
        const undoActivity = new Undo({
          actor: ctx.getActorUri(user.username),
          object: new Announce({
            id: new URL(existingRepost.uri),
            actor: ctx.getActorUri(user.username),
            object: new URL(post.uri),
          }),
        });

        await ctx.sendActivity(
          { identifier: user.username },
          "followers",
          undoActivity,
        );
      } catch (activityError) {
        logger.warn("Failed to send Undo Announce activity", { activityError });
      }

      // Get updated count
      const repostsCount = await repostsCollection.countDocuments({
        post_id: postId,
      });
      return c.json({ reposted: false, repostsCount });
    } else {
      // Repost the post
      const repostId = await getNextSequence("reposts");
      const announceUri = `${ctx.getActorUri(user.username).href}/announces/${repostId}`;

      await repostsCollection.insertOne({
        id: repostId,
        uri: announceUri,
        actor_id: actor.id,
        post_id: postId,
        created: new Date(),
      });

      try {
        // Send Announce activity
        const announceActivity = new Announce({
          id: new URL(announceUri),
          actor: ctx.getActorUri(user.username),
          object: new URL(post.uri),
          to: PUBLIC_COLLECTION,
        });

        await ctx.sendActivity(
          { identifier: user.username },
          "followers",
          announceActivity,
        );
      } catch (activityError) {
        logger.warn("Failed to send Announce activity", { activityError });
      }

      // Get updated count
      const repostsCount = await repostsCollection.countDocuments({
        post_id: postId,
      });
      return c.json({ reposted: true, repostsCount });
    }
  } catch (error) {
    logger.error("Failed to repost/unrepost post", { error });
    return c.json({ error: "Failed to process repost" }, 500);
  }
});

// Delete post (soft delete, federated)
app.post("/posts/:id/delete", requireAuth(), async (c) => {
  try {
    await connectToDatabase();
    const postsCollection = getPostsCollection();
    const actorsCollection = getActorsCollection();
    const id = Number(c.req.param("id"));
    const post = await postsCollection.findOne({ id });
    if (!post) return c.text("Post not found", 404);
    // Only allow deleting own posts
    const currentUser = getCurrentUser(c);
    if (!currentUser) return c.text("Forbidden", 403);
    const actor = await actorsCollection.findOne({
      user_id: currentUser.userId,
    });
    if (!actor || post.actor_id !== actor.id) return c.text("Forbidden", 403);
    // Soft delete: set deleted flag and clear content
    await postsCollection.updateOne(
      { id },
      { $set: { deleted: true, content: "(deleted)" } },
    );
    // Send ActivityPub Delete
    try {
      await sendDeleteActivity(post as Post);
    } catch (err) {
      console.error("Failed to federate delete activity", err);
    }
    return c.redirect("/");
  } catch (err) {
    console.error("Error in delete post route", err);
    return c.text("An error occurred while deleting the post.", 500);
  }
});

// WebFinger endpoint for ActivityPub discovery
app.get("/.well-known/webfinger", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const anyUser = await usersCollection.findOne({});
  if (!anyUser) {
    logger.warn("WebFinger: No user found");
    return c.json({ error: "No user found" }, 404);
  }
  const user = anyUser as User;
  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) {
    logger.warn("WebFinger: No actor found");
    return c.json({ error: "No actor found" }, 404);
  }
  // Parse resource param (e.g., acct:username@domain)
  const resource = c.req.query("resource");
  const host = c.req.header("host") || "";
  const domain = process.env.DOMAIN || host;
  const expectedAcct1 = `acct:${user.username}@${host}`.toLowerCase();
  const expectedAcct2 = `acct:${user.username}@${domain}`.toLowerCase();
  logger.info("WebFinger request", { resource, expectedAcct1, expectedAcct2 });
  if (
    !resource ||
    (resource.toLowerCase() !== expectedAcct1 &&
      resource.toLowerCase() !== expectedAcct2)
  ) {
    logger.warn("WebFinger: Resource not found", {
      resource,
      expectedAcct1,
      expectedAcct2,
    });
    return c.json({ error: "Resource not found" }, 404);
  }
  // Compose WebFinger response
  const response = {
    subject: resource,
    aliases: [actor.uri, actor.url].filter(Boolean),
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: actor.inbox_url,
      },
      {
        rel: "http://webfinger.net/rel/profile-page",
        href: actor.url,
      },
      {
        rel: "http://webfinger.net/rel/avatar",
        href: actor.avatar_url,
      },
      {
        rel: "http://webfinger.net/rel/registration",
        href: `https://${host}/login`,
      },
      {
        rel: "http://webfinger.net/rel/follow",
        href: actor.followers_url,
      },
      {
        rel: "http://webfinger.net/rel/likes",
        href: actor.likes_url,
      },
      {
        rel: "http://webfinger.net/rel/replies",
        href: actor.replies_url,
      },
      {
        rel: "http://webfinger.net/rel/posts",
        href: actor.posts_url,
      },
      {
        rel: "http://webfinger.net/rel/featured",
        href: actor.featured_url,
      },
      {
        rel: "http://webfinger.net/rel/collection",
        href: actor.collection_url,
      },
      {
        rel: "http://webfinger.net/rel/host-meta",
        href: `https://${host}/host-meta`,
      },
    ],
  };

  return c.json(response);
});

// --- Debugging and health check routes ---
app.get("/debug", async (c) => {
  return c.json({ ok: true, time: new Date() });
});
app.get("/health", async (c) => {
  return c.text("OK");
});
app.get("/.well-known/host-meta", async (c) => {
  const host = c.req.header("host") || "";
  const domain = process.env.DOMAIN || host;
  const webfinger = `https://${domain}/.well-known/webfinger`;
  const hostMeta = `
    <Link rel=\"lrdd\" template=\"${webfinger}?resource={uri}\" />
  `;
  return c.type("application/xml").send(hostMeta);
});

// --- Login page (must be above pretty URL routes) ---
app.get("/login", redirectIfAuthenticated(), async (c) => {
  console.log("[DEBUG] /login route hit");
  // Always destroy any existing session before showing login form
  destroySession(c);
  return c.html(
    <Layout>
      <LoginForm />
    </Layout>,
  );
});

// --- Login form submission (must be above pretty URL routes) ---
app.post("/login", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const form = await c.req.formData();
  const password = form.get("password")?.toString();
  if (!password) {
    return c.redirect("/login?error=missing");
  }
  // Always use the single user (id: 1)
  const user = await usersCollection.findOne({ id: 1 });
  if (!user) {
    return c.redirect("/login?error=invalid");
  }
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return c.redirect("/login?error=invalid");
  }
  // Build a User object for session
  const userForSession = {
    id: user.id,
    username: user.username,
    password: user.password,
    created: user.created,
  };
  createSession(c, userForSession);
  // Redirect to home after login
  return c.redirect("/");
});

// --- Logout route (must be above pretty URL routes) ---
app.get("/logout", async (c) => {
  destroySession(c);
  return c.redirect("/");
});

// --- Profile edit routes (must be above pretty URL routes) ---
app.get("/profile/edit", requireAuth, async (c) => {
  console.log(`[DEBUG] /profile/edit GET route hit`);
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();

  // Get the single user and their actor
  const user = await usersCollection.findOne({ id: 1 });
  const actor = await actorsCollection.findOne({ user_id: 1 });
  if (!user || !actor) return c.notFound();

  const userWithActor: User & Actor = {
    ...(user as User),
    ...(actor as Actor),
  };

  return c.html(
    <Layout user={userWithActor} isAuthenticated={true}>
      <ProfileEditForm name={actor.name || user.username} bio={actor.bio} />
    </Layout>,
  );
});

app.post("/profile/edit", requireAuth, async (c) => {
  console.log(`[DEBUG] /profile/edit POST route hit`);
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();

  const form = await c.req.formData();
  const name = form.get("name")?.toString() || "";
  const bio = form.get("bio")?.toString() || "";

  // Get the single user and their actor
  const user = await usersCollection.findOne({ id: 1 });
  const actor = await actorsCollection.findOne({ user_id: 1 });
  if (!user || !actor) return c.notFound();

  // Update the actor with new name and bio
  await actorsCollection.updateOne({ user_id: 1 }, { $set: { name, bio } });

  // Send profile update to followers via ActivityPub
  try {
    await sendProfileUpdate(actor.id);
  } catch (error) {
    console.warn("Failed to send profile update to followers:", error);
  }

  // Redirect back to profile page
  return c.redirect("/@user");
});

// --- Specific followers and following routes (must be before :atAndUsername route) ---
app.get("/profile/:username/followers", async (c) => {
  const username = c.req.param("username");
  console.log(`[DEBUG] /profile/:username/followers route hit: username=${username}, path=${c.req.path}`);
  
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const followsCollection = getFollowsCollection();
  const user = await usersCollection.findOne({ id: 1 });
  const actor = await actorsCollection.findOne({ user_id: 1 });
  if (!user || !actor) return c.text("Not Found", 404);
  
  const userWithActor: User & Actor = {
    ...(user as User),
    ...(actor as Actor),
  };
  
  console.log(`[DEBUG] Serving followers for ${username}`);
  const followerLinks = await followsCollection
    .find({ following_id: actor.id })
    .toArray();
  const followerIds = followerLinks.map((f) => f.follower_id);
  const followerDocs = await actorsCollection
    .find({ id: { $in: followerIds } })
    .toArray();
  const followerActors: Actor[] = followerDocs.map(
    ({ _id, ...rest }) => rest as Actor,
  );
  return c.html(
    <Layout user={userWithActor} isAuthenticated={!!getCurrentUser(c)}>
      <FollowerList followers={followerActors} />
    </Layout>,
  );
});

app.get("/profile/:username/following", async (c) => {
  const username = c.req.param("username");
  console.log(`[DEBUG] /profile/:username/following route hit: username=${username}, path=${c.req.path}`);
  
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const followsCollection = getFollowsCollection();
  const user = await usersCollection.findOne({ id: 1 });
  const actor = await actorsCollection.findOne({ user_id: 1 });
  if (!user || !actor) return c.text("Not Found", 404);
  
  const userWithActor: User & Actor = {
    ...(user as User),
    ...(actor as Actor),
  };
  
  console.log(`[DEBUG] Serving following for ${username}`);
  const followingLinks = await followsCollection
    .find({ follower_id: actor.id })
    .toArray();
  const followingIds = followingLinks.map((f) => f.following_id);
  const followingDocs = await actorsCollection
    .find({ id: { $in: followingIds } })
    .toArray();
  const followingActors: Actor[] = followingDocs.map(
    ({ _id, ...rest }) => rest as Actor,
  );
  return c.html(
    <Layout user={userWithActor} isAuthenticated={!!getCurrentUser(c)}>
      <FollowingList following={followingActors} />
    </Layout>,
  );
});

console.log("[DEBUG] /profile/:username/followers and /profile/:username/following routes registered");

// --- Profile route (must be after followers/following) ---
app.get("/@:username", async (c) => {
  console.log(`[DEBUG] /@:username route DEFINED and being called!`);
  const username = c.req.param("username");
  console.log(
    `[DEBUG] /@:username route hit: username=@${username}, path=${c.req.path}`,
  );
  // Always serve the single user, ignore username param for data
  const usersCollection = getUsersCollection();
  await connectToDatabase();
  const user = await usersCollection.findOne({ id: 1 });
  const canonicalUsername = user?.username || "user";
  return handleProfilePage(c, canonicalUsername);
});

// Test route to verify basic routing is working
app.get("/test", async (c) => {
  console.log(`[DEBUG] /test route hit!`);
  return c.text("Test route works!");
});

// Test route to verify profile routing is working
app.get("/profile/test", async (c) => {
  console.log(`[DEBUG] /profile/test route hit!`);
  return c.text("Profile test route works!");
});

// Test route to verify parameterized routing is working
app.get("/profile/:username/test", async (c) => {
  const username = c.req.param("username");
  console.log(`[DEBUG] /profile/:username/test route hit: username=${username}`);
  return c.text(`Profile test route works for ${username}!`);
});

// Test route with exact path to verify routing works
app.get("/profile/ismail/following", async (c) => {
  console.log(`[DEBUG] EXACT /profile/ismail/following route hit!`);
  return c.text("EXACT profile following route works!");
});

console.log("[DEBUG] Test routes registered");

// --- Generic fallback pretty URL routes (for legacy or non-@ patterns) - MOVED TO END ---
app.get(":atAndUsername/posts/:id", async (c) => {
  const atAndUsername = c.req.param("atAndUsername");
  const postId = parseInt(c.req.param("id"));
  console.log(
    `[DEBUG] Pretty URL post route hit: atAndUsername=${atAndUsername}, postId=${postId}, path=${c.req.path}`,
  );
  if (!atAndUsername.startsWith("@")) return c.text("Not Found", 404);

  // Ensure this route doesn't handle .json paths
  if (c.req.path.endsWith(".json")) {
    console.log(
      `[DEBUG] :atAndUsername/posts/:id route rejecting .json path: ${c.req.path}`,
    );
    return c.text("Not Found", 404);
  }

  const username = atAndUsername.slice(1) || "user";
  console.log(
    `[DEBUG] Calling handlePostPage with username=${username}, postId=${postId}`,
  );
  return handlePostPage(c, username, postId);
});

app.get(":atAndUsername/posts/:id.json", async (c) => {
  const atAndUsername = c.req.param("atAndUsername");
  console.log(
    `[DEBUG] :atAndUsername/posts/:id.json route hit: atAndUsername=${atAndUsername}, path=${c.req.path}`,
  );
  if (!atAndUsername.startsWith("@")) return c.text("Not Found", 404);

  // Ensure the path actually ends with .json
  if (!c.req.path.endsWith(".json")) {
    console.log(
      `[DEBUG] :atAndUsername/posts/:id.json route rejecting non-.json path: ${c.req.path}`,
    );
    return c.text("Not Found", 404);
  }

  return serveActivityPubPost(c);
});

app.get(":atAndUsername", async (c) => {
  const atAndUsername = c.req.param("atAndUsername");
  console.log(
    `[DEBUG] :atAndUsername route hit: atAndUsername=${atAndUsername}, path=${c.req.path}`,
  );
  
  // Don't match paths that start with /profile/ - let the specific routes handle them
  if (c.req.path.startsWith("/profile/")) {
    console.log(`[DEBUG] :atAndUsername route rejecting /profile/ path: ${c.req.path}`);
    return c.text("Not Found", 404);
  }
  
  // Only match paths that start with @
  if (!atAndUsername.startsWith("@")) {
    console.log(`[DEBUG] :atAndUsername route rejecting non-@ path: ${atAndUsername}`);
    return c.text("Not Found", 404);
  }

  // Check if atAndUsername contains a slash - if so, this shouldn't match
  if (atAndUsername.includes("/")) {
    console.log(
      `[DEBUG] :atAndUsername route rejecting path with slash: ${atAndUsername}`,
    );
    return c.text("Not Found", 404);
  }

  // Don't handle followers/following paths here - let the specific routes handle them
  if (c.req.path.includes("/followers") || c.req.path.includes("/following")) {
    console.log(
      `[DEBUG] :atAndUsername route skipping followers/following path: ${c.req.path}`,
    );
    return c.text("Not Found", 404);
  }

  // Always serve the single user, ignore username param for data
  const usersCollection = getUsersCollection();
  await connectToDatabase();
  const user = await usersCollection.findOne({ id: 1 });
  const canonicalUsername = user?.username || "user";
  return handleProfilePage(c, canonicalUsername);
});

console.log("[DEBUG] :atAndUsername routes registered (at end)");

// --- Catch-all route for debugging unmatched requests (must be last) ---
app.all("/*", (c) => {
  console.log(
    `[DEBUG] Catch-all route hit: path=${c.req.path}, url=${c.req.url}`,
  );
  return c.text("404 Not Found (catch-all)", 404);
});

export default app;
