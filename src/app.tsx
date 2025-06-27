import { Hono } from "hono";
import { federation } from "@fedify/fedify/x/hono";
import { getLogger } from "@logtape/logtape";
import { stringifyEntities } from "stringify-entities";
import { Create, Follow, isActor, Note, Like, Announce, Undo, PUBLIC_COLLECTION } from "@fedify/fedify";
import * as bcrypt from "bcrypt";
import fedi, { sendProfileUpdate, sendPostToFollowers, createCanonicalContext, sendDeleteActivity } from "./federation.ts";
import { connectToDatabase, getUsersCollection, getActorsCollection, getPostsCollection, getFollowsCollection, getLikesCollection, getRepostsCollection } from "./db.ts";
import { getNextSequence } from "./utils.ts";
import type { Actor, Post, User } from "./schema.ts";
import { authenticateUser, requireAuth, redirectIfAuthenticated, createSession, destroySession, getCurrentUser } from "./auth.ts";
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
import type { Collection, Document } from "mongodb";

const logger = getLogger("fongoblog");

const app = new Hono();
app.use(federation(fedi, () => undefined));

// Global error handler middleware for logging and user-friendly error page
app.onError((err, c) => {
  logger.error("Unhandled error in request", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: c.req.path,
    method: c.req.method,
  });
  // Show stack trace in development, generic message in production
  const isDev = process.env.NODE_ENV !== "production";
  const errorMessage = isDev && err instanceof Error ? `${err.message}\n\n${err.stack}` : "Internal Server Error";
  return c.html(
    `<html><body><h1>500 Internal Server Error</h1><pre>${stringifyEntities(errorMessage)}</pre></body></html>`,
    500
  );
});

// Log all unhandled promise rejections and uncaught exceptions
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Promise Rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise
  });
});
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  });
});

// Home page
app.get("/", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();

  // Get the single user (local user)
  const user = await usersCollection.findOne({});
  if (!user) return c.notFound();
  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();

  // Get all followed actor IDs (local and remote)
  const following = await followsCollection.find({ follower_id: actor.id }).toArray();
  const followingIds = following.map(f => f.following_id);

  // Get follower/following counts
  const followingCount = await followsCollection.countDocuments({ follower_id: actor.id });
  const followersCount = await followsCollection.countDocuments({ following_id: actor.id });

  // Aggregate posts from local user and all followed actors
  const posts = await postsCollection.aggregate([
    {
      $match: {
        deleted: { $ne: true },
        $or: [
          { actor_id: actor.id },
          { actor_id: { $in: followingIds } }
        ]
      }
    },
    { $sort: { created: -1 } },
    {
      $lookup: {
        from: "actors",
        localField: "actor_id",
        foreignField: "id",
        as: "actor"
      }
    },
    {
      $lookup: {
        from: "likes",
        localField: "id",
        foreignField: "post_id",
        as: "likes"
      }
    },
    {
      $lookup: {
        from: "actors",
        localField: "likes.actor_id",
        foreignField: "id",
        as: "like_actors"
      }
    },
    {
      $lookup: {
        from: "reposts",
        localField: "id",
        foreignField: "post_id",
        as: "reposts"
      }
    },
    // Ensure reposts.actor_id is always a number for the join
    {
      $addFields: {
        reposts: {
          $map: {
            input: "$reposts",
            as: "r",
            in: {
              $mergeObjects: ["$$r", { actor_id: { $toInt: "$$r.actor_id" } }]
            }
          }
        }
      }
    },
    {
      $lookup: {
        from: "actors",
        let: { repostActorIds: "$reposts.actor_id" },
        pipeline: [
          { $match: { $expr: { $in: ["$id", "$$repostActorIds"] } } }
        ],
        as: "repost_actors"
      }
    },
    {
      $lookup: {
        from: "posts",
        localField: "id",
        foreignField: "reply_to",
        as: "replies"
      }
    },
    {
      $addFields: {
        likesCount: { $size: "$likes" },
        repostsCount: { $size: "$reposts" },
        isLikedByUser: true ? {
          $in: [actor.id, "$likes.actor_id"]
        } : false,
        isRepostedByUser: true ? {
          $in: [actor.id, "$reposts.actor_id"]
        } : false
      }
    },
    // { $match: isAuthenticated ? {
    //   $or: [
    //     { actor_id: actor.id },
    //     { actor_id: { $in: followingIds } }
    //   ]
    // } : {} }, // Show all posts if not authenticated
    { $limit: 1000 }, // Load many more posts initially
    // Filter out deleted posts and replies to deleted posts
    { $match: { deleted: { $ne: true } } },
  ])
  .toArray();

  // Attach actor fields for UI compatibility
  const postsWithActors = posts.map(post => {
    const postActor = post.actor && post.actor[0] ? post.actor[0] : {};
    return {
      ...post,
      uri: postActor.uri || post.uri,
      handle: postActor.handle || post.handle,
      name: postActor.name || post.name,
      user_id: postActor.user_id || post.user_id,
      inbox_url: postActor.inbox_url || post.inbox_url,
      shared_inbox_url: postActor.shared_inbox_url || post.shared_inbox_url,
      url: postActor.url || post.url,
    };
  });

  // Recursively nest replies for each post (if needed)
  function nestReplies(posts: any[]): any[] {
    const postMap = new Map<number, any>();
    posts.forEach(post => postMap.set(post.id, { ...post, replies: [] }));
    const roots: any[] = [];
    posts.forEach(post => {
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
  const nestedPosts = nestReplies(postsWithActors);

  logger.info("[DEBUG] Home route loaded user, actor, posts, about to render JSX");
  console.log("[DEBUG] Home route loaded user, actor, posts, about to render JSX");
  try {
    // Remove _id for type compatibility
    const { _id, ...userWithActorRaw } = { ...user, ...actor };
    const userWithActor = userWithActorRaw as User & Actor;
    return c.html(
      <Layout user={userWithActor} isAuthenticated={true}>
        <Home
          user={userWithActor}
          posts={nestedPosts}
          isAuthenticated={true}
          following={followingCount}
          followers={followersCount}
        />
      </Layout>
    );
  } catch (err) {
    logger.error("JSX render error in home page", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    console.error("[DEBUG] Home route JSX render error", err);
    throw err;
  }
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
        as: "actor"
      }
    },
    {
      $lookup: {
        from: "likes",
        localField: "id",
        foreignField: "post_id",
        as: "likes"
      }
    },
    {
      $lookup: {
        from: "actors",
        localField: "likes.actor_id",
        foreignField: "id",
        as: "like_actors"
      }
    },
    {
      $lookup: {
        from: "reposts",
        localField: "id",
        foreignField: "post_id",
        as: "reposts"
      }
    },
    // Ensure reposts.actor_id is always a number for the join
    {
      $addFields: {
        reposts: {
          $map: {
            input: "$reposts",
            as: "r",
            in: {
              $mergeObjects: ["$$r", { actor_id: { $toInt: "$$r.actor_id" } }]
            }
          }
        }
      }
    },
    {
      $lookup: {
        from: "actors",
        let: { repostActorIds: "$reposts.actor_id" },
        pipeline: [
          { $match: { $expr: { $in: ["$id", "$$repostActorIds"] } } }
        ],
        as: "repost_actors"
      }
    },
    {
      $lookup: {
        from: "posts",
        localField: "id",
        foreignField: "reply_to",
        as: "replies"
      }
    },
    {
      $addFields: {
        likesCount: { $size: "$likes" },
        repostsCount: { $size: "$reposts" },
        isLikedByUser: isAuthenticated ? {
          $in: [actor.id, "$likes.actor_id"]
        } : false,
        isRepostedByUser: isAuthenticated ? {
          $in: [actor.id, "$reposts.actor_id"]
        } : false
      }
    }
  ];

  // Add cursor-based pagination
  if (cursor) {
    pipeline.push({
      $match: {
        id: { $lt: parseInt(cursor) }
      }
    });
  }

  // Add filtering for authenticated users
  pipeline.push({
    $match: isAuthenticated ? {
      $or: [
        { actor_id: actor.id },
        { actor_id: { $in: followingIds } }
      ]
    } : {} // Show all posts if not authenticated
  });

  // Add sorting and limit
  pipeline.push(
    { $sort: { created: -1 } },
    { $limit: limit + 1 } // Get one extra to check if there are more
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
    nextCursor: posts.length > 0 ? posts[posts.length - 1].id : null
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
    const reply_to = replyToRaw ? parseInt(replyToRaw.toString(), 10) : undefined;
    
    logger.info(`Received post content from ${user.username}: "${content}"${reply_to ? ` (reply to ${reply_to})` : ''}`);
    
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
      ...(reply_to ? { reply_to } : {})
    };

    logger.info("Inserting post into database...", { newPost });
    await postsCollection.insertOne(newPost);
    logger.info(`Post created successfully: ${postId} by user ${user.username}`);

    // Send Create(Note) activity to followers using robust federation logic
    try {
      await sendPostToFollowers(user.id, newPost as Post, actor as Actor);
      logger.info("ActivityPub Create activity sent successfully", { postId });
    } catch (activityError) {
      logger.error("Failed to send ActivityPub Create activity", { 
        activityError: activityError instanceof Error ? activityError.message : String(activityError),
        activityErrorStack: activityError instanceof Error ? activityError.stack : undefined,
        postId,
        username: user.username
      });
      console.error("Full ActivityPub error:", activityError);
      // Continue anyway - the post was created successfully
    }

    // Redirect back to home page
    return c.redirect("/");
    
  } catch (error) {
    logger.error("Failed to create post", { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
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
    </Layout>
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
      created: new Date()
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
      created: new Date()
    });

    // Create session for the new user
    const newUser = { id: 1, username, password: hashedPassword, created: new Date() } as User;
    createSession(c, newUser);

    return c.redirect("/");
  } catch (error) {
    logger.error("Failed to create user", { error });
    return c.redirect("/setup");
  }
});

// --- SPECIAL ROUTES MOVED UP ---
// Login page
app.get("/login", redirectIfAuthenticated(), async (c) => {
  return c.html(
    <Layout>
      <LoginForm />
    </Layout>
  );
});

// Login form submission
app.post("/login", async (c) => {
  logger.info("Login POST handler started");
  try {
    await connectToDatabase();
    const form = await c.req.formData();
    const password = form.get("password");
    logger.info("Login attempt (single user mode)");
    if (typeof password !== "string") {
      logger.warn("Invalid form data: password missing");
      return c.redirect("/login");
    }
    // Always use the only user in the database
    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({}) as User | null;
    if (!user) {
      logger.warn("No user found in database");
      return c.redirect("/login");
    }
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      logger.warn("Authentication failed for single user");
      return c.redirect("/login");
    }
    logger.info("Authentication successful", { userId: user.id });
    createSession(c, user);
    logger.info("Session created, redirecting to home");
    return c.redirect("/");
  } catch (error) {
    logger.error("Login handler error", { error: error instanceof Error ? error.message : String(error) });
    return c.redirect("/login");
  }
});

// Logout
app.get("/logout", async (c) => {
  destroySession(c);
  return c.redirect("/");
});

// Profile edit form
app.get("/profile/edit", requireAuth(), async (c) => {
  try {
    await connectToDatabase();
    const actorsCollection = getActorsCollection();
    const usersCollection = getUsersCollection();
    const currentUser = getCurrentUser(c);
    if (!currentUser) {
      return c.redirect("/login");
    }
    const user = await usersCollection.findOne({ id: currentUser.userId });
    if (!user) {
      return c.redirect("/login");
    }
    const actor = await actorsCollection.findOne({ user_id: currentUser.userId });
    if (!actor) {
      logger.error("Actor not found for user", { userId: currentUser.userId });
      return c.text("Actor not found", 404);
    }
    const { _id, ...userWithActorEditRaw } = { ...user, ...actor };
    const userWithActorEdit = userWithActorEditRaw as User & Actor;
    const html = (
      <Layout user={userWithActorEdit}>
        <ProfileEditForm 
          name={actor.name || actor.handle} 
          bio={actor.summary} 
        />
      </Layout>
    );
    return c.html(html);
  } catch (error) {
    logger.error("Profile edit form error", { error });
    return c.text("Failed to load profile edit form", 500);
  }
});
// --- END SPECIAL ROUTES ---

// Profile page
app.get("/:username", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();
  const likesCollection = getLikesCollection();
  const repostsCollection = getRepostsCollection();

  const username = c.req.param("username");
  
  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();

  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();

  const userWithActor = { ...user, ...actor };

  // Check if current visitor is authenticated
  const currentUser = getCurrentUser(c);
  const isAuthenticated = !!currentUser;

  // Get follower/following counts
  const followingCount = await followsCollection.countDocuments({ follower_id: actor.id });
  const followersCount = await followsCollection.countDocuments({ following_id: actor.id });

  // Aggregate posts with likes, reposts, and their actors
  const posts = await postsCollection.aggregate([
    { $match: { actor_id: actor.id, deleted: { $ne: true } } },
    { $sort: { created: -1 } },
    {
      $lookup: {
        from: "likes",
        localField: "id",
        foreignField: "post_id",
        as: "likes"
      }
    },
    {
      $lookup: {
        from: "actors",
        localField: "likes.actor_id",
        foreignField: "id",
        as: "like_actors"
      }
    },
    {
      $lookup: {
        from: "reposts",
        localField: "id",
        foreignField: "post_id",
        as: "reposts"
      }
    },
    {
      $addFields: {
        reposts: {
          $map: {
            input: "$reposts",
            as: "r",
            in: {
              $mergeObjects: ["$$r", { actor_id: { $toInt: "$$r.actor_id" } }]
            }
          }
        }
      }
    },
    {
      $lookup: {
        from: "actors",
        let: { repostActorIds: "$reposts.actor_id" },
        pipeline: [
          { $match: { $expr: { $in: ["$id", "$$repostActorIds"] } } }
        ],
        as: "repost_actors"
      }
    },
    {
      $lookup: {
        from: "posts",
        localField: "id",
        foreignField: "reply_to",
        as: "replies"
      }
    },
    {
      $addFields: {
        likesCount: { $size: "$likes" },
        repostsCount: { $size: "$reposts" },
        isLikedByUser: isAuthenticated ? { $in: [actor.id, "$likes.actor_id"] } : false,
        isRepostedByUser: isAuthenticated ? { $in: [actor.id, "$reposts.actor_id"] } : false
      }
    }
  ]).toArray();

  // Attach actor fields to each post for UI compatibility
  const postsWithActor = posts.map(post => ({
    ...post,
    uri: actor.uri,
    handle: actor.handle,
    name: actor.name,
    user_id: actor.user_id,
    inbox_url: actor.inbox_url,
    shared_inbox_url: actor.shared_inbox_url,
    url: actor.url || post.url,
  }));

  // Remove _id from userWithActor for type compatibility
  const { _id, ...userWithActorClean } = userWithActor;

  // Remove _id from posts for type compatibility
  const postsWithActorClean = postsWithActor.map((rest: any) => rest);

  // Only show root posts (not replies) at the top level
  const rootPosts = (postsWithActorClean as any[]).filter(post => !post.reply_to);

  // --- Optimized: Batch-fetch all replies for all root posts and build tree in memory ---
  const rootPostIds = rootPosts.map(post => post.id);

  // Fetch all replies (and their replies, etc.) for these root posts
  const allReplies = await postsCollection.aggregate([
    { $match: { reply_to: { $in: rootPostIds }, deleted: { $ne: true } } },
    { $sort: { created: 1 } },
    {
      $lookup: {
        from: "actors",
        localField: "actor_id",
        foreignField: "id",
        as: "actor"
      }
    },
    {
      $lookup: {
        from: "likes",
        localField: "id",
        foreignField: "post_id",
        as: "likes"
      }
    },
    {
      $lookup: {
        from: "actors",
        localField: "likes.actor_id",
        foreignField: "id",
        as: "like_actors"
      }
    },
    {
      $lookup: {
        from: "reposts",
        localField: "id",
        foreignField: "post_id",
        as: "reposts"
      }
    },
    {
      $addFields: {
        reposts: {
          $map: {
            input: "$reposts",
            as: "r",
            in: {
              $mergeObjects: ["$$r", { actor_id: { $toInt: "$$r.actor_id" } }]
            }
          }
        }
      }
    },
    {
      $lookup: {
        from: "actors",
        let: { repostActorIds: "$reposts.actor_id" },
        pipeline: [
          { $match: { $expr: { $in: ["$id", "$$repostActorIds"] } } }
        ],
        as: "repost_actors"
      }
    },
    {
      $addFields: {
        likesCount: { $size: "$likes" },
        repostsCount: { $size: "$reposts" }
      }
    }
  ]).toArray();

  // Remove _id and flatten actor fields for replies
  const repliesWithActor = allReplies.map(reply => {
    const replyActor = reply.actor && reply.actor[0] ? reply.actor[0] : {};
    const { _id, actor: _actorArr, ...rest } = reply;
    return {
      ...rest,
      uri: replyActor.uri || rest.uri,
      handle: replyActor.handle || rest.handle,
      name: replyActor.name || rest.name,
      user_id: replyActor.user_id || rest.user_id,
      inbox_url: replyActor.inbox_url || rest.inbox_url,
      shared_inbox_url: replyActor.shared_inbox_url || rest.shared_inbox_url,
      url: replyActor.url || rest.url,
      id: rest.id,
      actor_id: rest.actor_id,
      content: rest.content,
      created: rest.created,
      reply_to: rest.reply_to,
      likesCount: rest.likesCount,
      repostsCount: rest.repostsCount,
      like_actors: rest.like_actors,
      repost_actors: rest.repost_actors,
      isLikedByUser: rest.isLikedByUser,
      isRepostedByUser: rest.isRepostedByUser,
      replies: [] // will be filled in tree
    };
  });

  // Build a map of replies by id
  const replyMap = new Map<number, any>();
  for (const reply of repliesWithActor) {
    replyMap.set(reply.id, reply);
  }

  // Attach replies to their parent reply or root post
  for (const reply of repliesWithActor) {
    if (reply.reply_to && replyMap.has(reply.reply_to)) {
      // Attach as a child reply
      replyMap.get(reply.reply_to).replies.push(reply);
    }
  }

  // Attach replies to root posts
  for (const post of rootPosts) {
    post.replies = repliesWithActor.filter(r => r.reply_to === post.id);
  }

  return c.html(
    <Layout user={userWithActorClean as User & Actor} isAuthenticated={isAuthenticated}>
      <Profile
        name={actor.name ?? user.username}
        username={user.username}
        handle={actor.handle}
        bio={actor.summary}
        following={followingCount}
        followers={followersCount}
        isAuthenticated={isAuthenticated}
      />
      <PostList posts={rootPosts as (Post & Actor)[]} isAuthenticated={isAuthenticated} />
    </Layout>
  );
});

// Create new post
app.post("/:username/posts", requireAuth(), async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();

  const username = c.req.param("username");
  
  const user = await usersCollection.findOne({ username });
  if (!user) return c.redirect("/setup");

  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.redirect("/setup");

  const form = await c.req.formData();
  const content = form.get("content")?.toString();
  
  if (!content || content.trim() === "") {
    return c.text("Content is required", 400);
  }

  const ctx = createCanonicalContext(c.req.raw, undefined);
  
  try {
    const postId = await getNextSequence("posts");
    const postUri = ctx.getObjectUri(Note, {
      identifier: username,
      id: postId.toString(),
    }).href;

    // Create post
    const newPost = {
      id: postId,
      uri: postUri,
      actor_id: actor.id,
      content: stringifyEntities(content, { escapeOnly: true }),
      url: postUri,
      created: new Date()
    };

    await postsCollection.insertOne(newPost);

    // Send Create(Note) activity to followers using robust federation logic
    try {
      await sendPostToFollowers(user.id, newPost as Post, actor as Actor);
      logger.info("ActivityPub Create activity sent successfully", { postId });
    } catch (activityError) {
      logger.error("Failed to send ActivityPub Create activity", { 
        activityError: activityError instanceof Error ? activityError.message : String(activityError),
        postId,
        username
      });
    }

    return c.redirect(postUri);
  } catch (error) {
    logger.error("Failed to create post", { error });
    return c.text("Failed to create post", 500);
  }
});

// Individual post page
app.get("/:username/posts/:id", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();

  const username = c.req.param("username");
  const postId = parseInt(c.req.param("id"));

  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();

  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();

  // Ensure we only get the post for this actor and id
  const post = await postsCollection.findOne({ id: postId, actor_id: actor.id });
  if (!post) return c.notFound();

  // Get follower and following counts
  const followersCount = await followsCollection.countDocuments({ following_id: actor.id });
  const followingCount = await followsCollection.countDocuments({ follower_id: actor.id });

  // Check if current visitor is authenticated
  const currentUserSession = getCurrentUser(c);
  const isAuthenticated = !!currentUserSession;

  // If authenticated, fetch the user and actor for the session
  let currentActorId: number | undefined = undefined;
  if (currentUserSession && currentUserSession.username) {
    const currentUserDb = await usersCollection.findOne({ username: currentUserSession.username });
    if (currentUserDb) {
      const currentActor = await actorsCollection.findOne({ user_id: currentUserDb.id });
      if (currentActor) currentActorId = currentActor.id;
    }
  }

  const likesCollection = getLikesCollection();
  const repostsCollection = getRepostsCollection();

  // Get likes and reposts for this post
  const likes = await likesCollection.find({ post_id: post.id }).toArray();
  const reposts = await repostsCollection.find({ post_id: post.id }).toArray();

  // Get like and repost actors
  const likeActorIds = likes.map(l => l.actor_id);
  const repostActorIds = reposts.map(r => r.actor_id);
  const like_actors = likeActorIds.length > 0 ? await actorsCollection.find({ id: { $in: likeActorIds } }).toArray() as Actor[] : [];
  const repost_actors = repostActorIds.length > 0 ? await actorsCollection.find({ id: { $in: repostActorIds } }).toArray() as Actor[] : [];

  // Compose the post object with all required fields, then remove _id
  const postWithActor = {
    ...actor,
    ...user,
    likesCount: likes.length,
    repostsCount: reposts.length,
    like_actors,
    repost_actors,
    isLikedByUser: currentActorId ? likes.some(l => l.actor_id === currentActorId) : false,
    isRepostedByUser: currentActorId ? reposts.some(r => r.actor_id === currentActorId) : false,
    ...post, // Spread post last so its fields (like created) are not overwritten
  };
  // Remove only the _id field if present
  const { _id, ...postWithActorClean } = postWithActor;

  // --- Fetch and attach replies with actor info recursively ---
  async function fetchRepliesWithActor(
    postId: number,
    postsCollection: Collection<Document>,
    actorsCollection: Collection<Document>,
    likesCollection: Collection<Document>,
    repostsCollection: Collection<Document>,
    currentActorId?: number
  ): Promise<any[]> {
    // Fetch direct replies to this post
    const replies = await postsCollection.aggregate([
      { $match: { reply_to: postId, deleted: { $ne: true } } },
      { $sort: { created: 1 } },
      {
        $lookup: {
          from: "actors",
          localField: "actor_id",
          foreignField: "id",
          as: "actor"
        }
      },
      {
        $lookup: {
          from: "likes",
          localField: "id",
          foreignField: "post_id",
          as: "likes"
        }
      },
      {
        $lookup: {
          from: "actors",
          localField: "likes.actor_id",
          foreignField: "id",
          as: "like_actors"
        }
      },
      {
        $lookup: {
          from: "reposts",
          localField: "id",
          foreignField: "post_id",
          as: "reposts"
        }
      },
      {
        $addFields: {
          reposts: {
            $map: {
              input: "$reposts",
              as: "r",
              in: {
                $mergeObjects: ["$$r", { actor_id: { $toInt: "$$r.actor_id" } }]
              }
            }
          }
        }
      },
      {
        $lookup: {
          from: "actors",
          let: { repostActorIds: "$reposts.actor_id" },
          pipeline: [
            { $match: { $expr: { $in: ["$id", "$$repostActorIds"] } } }
          ],
          as: "repost_actors"
        }
      },
      {
        $addFields: {
          likesCount: { $size: "$likes" },
          repostsCount: { $size: "$reposts" }
        }
      }
    ]).toArray();

    // For each reply, recursively fetch its replies
    const repliesWithActor: any[] = [];
    for (const reply of replies) {
      const replyActor = reply.actor && reply.actor[0] ? reply.actor[0] : {};
      const { _id, actor: _actorArr, ...rest } = reply;
      const nestedReplies = await fetchRepliesWithActor(
        reply.id,
        postsCollection,
        actorsCollection,
        likesCollection,
        repostsCollection,
        currentActorId
      );
      repliesWithActor.push({
        ...rest,
        uri: replyActor.uri || rest.uri,
        handle: replyActor.handle || rest.handle,
        name: replyActor.name || rest.name,
        user_id: replyActor.user_id || rest.user_id,
        inbox_url: replyActor.inbox_url || rest.inbox_url,
        shared_inbox_url: replyActor.shared_inbox_url || rest.shared_inbox_url,
        url: replyActor.url || rest.url,
        id: rest.id,
        actor_id: rest.actor_id,
        content: rest.content,
        created: rest.created,
        reply_to: rest.reply_to,
        likesCount: rest.likesCount,
        repostsCount: rest.repostsCount,
        like_actors: rest.like_actors,
        repost_actors: rest.repost_actors,
        isLikedByUser: rest.isLikedByUser,
        isRepostedByUser: rest.isRepostedByUser,
        replies: nestedReplies
      });
    }
    return repliesWithActor;
  }

  // Get replies with actor info
  const repliesWithActor = await fetchRepliesWithActor(post.id, postsCollection, actorsCollection, likesCollection, repostsCollection, currentActorId);

  // Compose the final post object with replies
  const postWithReplies = {
    // --- Required Post fields ---
    id: post.id,
    uri: post.uri,
    actor_id: post.actor_id,
    content: post.content,
    url: post.url,
    created: post.created,
    repost_of: post.repost_of,
    is_repost: post.is_repost,
    reply_to: post.reply_to,
    deleted: post.deleted,
    // --- Required Actor fields ---
    user_id: actor.user_id,
    handle: actor.handle,
    name: actor.name,
    summary: actor.summary,
    inbox_url: actor.inbox_url,
    shared_inbox_url: actor.shared_inbox_url,
    // url already included above
    // --- Extra fields for UI ---
    likesCount: likes.length,
    repostsCount: reposts.length,
    like_actors,
    repost_actors,
    isLikedByUser: currentActorId ? likes.some(l => l.actor_id === currentActorId) : false,
    isRepostedByUser: currentActorId ? reposts.some(r => r.actor_id === currentActorId) : false,
    replies: repliesWithActor,
  };

  // Ensure the canonical URL matches the current request
  const canonicalUrl = `/${username}/posts/${postId}`;
  if (c.req.path !== canonicalUrl) {
    return c.redirect(canonicalUrl);
  }

  return c.html(
    <Layout>
      <PostPage
        name={actor.name ?? user.username}
        username={user.username}
        handle={actor.handle}
        bio={actor.summary}
        following={followingCount}
        followers={followersCount}
        post={postWithReplies}
        isAuthenticated={isAuthenticated}
      />
    </Layout>
  );
});

// ActivityPub JSON endpoint for posts
app.get("/:username/posts/:id.json", async (c) => {
  c.req.raw.headers.set("Accept", "application/activity+json");
  return await serveActivityPubPost(c);
});
app.get("/:username/posts/:id", async (c) => {
  if (c.req.header("accept")?.includes("application/activity+json")) {
    return await serveActivityPubPost(c);
  }

  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();

  const username = c.req.param("username");
  const postId = parseInt(c.req.param("id"));

  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();

  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();

  // Ensure we only get the post for this actor and id
  const post = await postsCollection.findOne({ id: postId, actor_id: actor.id });
  if (!post) return c.notFound();

  // Get follower and following counts
  const followersCount = await followsCollection.countDocuments({ following_id: actor.id });
  const followingCount = await followsCollection.countDocuments({ follower_id: actor.id });

  // Check if current visitor is authenticated
  const currentUserSession = getCurrentUser(c);
  const isAuthenticated = !!currentUserSession;

  // If authenticated, fetch the user and actor for the session
  let currentActorId: number | undefined = undefined;
  if (currentUserSession && currentUserSession.username) {
    const currentUserDb = await usersCollection.findOne({ username: currentUserSession.username });
    if (currentUserDb) {
      const currentActor = await actorsCollection.findOne({ user_id: currentUserDb.id });
      if (currentActor) currentActorId = currentActor.id;
    }
  }

  const likesCollection = getLikesCollection();
  const repostsCollection = getRepostsCollection();

  // Get likes and reposts for this post
  const likes = await likesCollection.find({ post_id: post.id }).toArray();
  const reposts = await repostsCollection.find({ post_id: post.id }).toArray();

  // Get like and repost actors
  const likeActorIds = likes.map(l => l.actor_id);
  const repostActorIds = reposts.map(r => r.actor_id);
  const like_actors = likeActorIds.length > 0 ? await actorsCollection.find({ id: { $in: likeActorIds } }).toArray() as Actor[] : [];
  const repost_actors = repostActorIds.length > 0 ? await actorsCollection.find({ id: { $in: repostActorIds } }).toArray() as Actor[] : [];

  // Compose the post object with all required fields, then remove _id
  const postWithActor = {
    ...actor,
    ...user,
    likesCount: likes.length,
    repostsCount: reposts.length,
    like_actors,
    repost_actors,
    isLikedByUser: currentActorId ? likes.some(l => l.actor_id === currentActorId) : false,
    isRepostedByUser: currentActorId ? reposts.some(r => r.actor_id === currentActorId) : false,
    ...post, // Spread post last so its fields (like created) are not overwritten
  };
  // Remove only the _id field if present
  const { _id, ...postWithActorClean } = postWithActor;

  // --- Fetch and attach replies with actor info recursively ---
  async function fetchRepliesWithActor(
    postId: number,
    postsCollection: Collection<Document>,
    actorsCollection: Collection<Document>,
    likesCollection: Collection<Document>,
    repostsCollection: Collection<Document>,
    currentActorId?: number
  ): Promise<any[]> {
    // Fetch direct replies to this post
    const replies = await postsCollection.aggregate([
      { $match: { reply_to: postId, deleted: { $ne: true } } },
      { $sort: { created: 1 } },
      {
        $lookup: {
          from: "actors",
          localField: "actor_id",
          foreignField: "id",
          as: "actor"
        }
      },
      {
        $lookup: {
          from: "likes",
          localField: "id",
          foreignField: "post_id",
          as: "likes"
        }
      },
      {
        $lookup: {
          from: "actors",
          localField: "likes.actor_id",
          foreignField: "id",
          as: "like_actors"
        }
      },
      {
        $lookup: {
          from: "reposts",
          localField: "id",
          foreignField: "post_id",
          as: "reposts"
        }
      },
      {
        $addFields: {
          reposts: {
            $map: {
              input: "$reposts",
              as: "r",
              in: {
                $mergeObjects: ["$$r", { actor_id: { $toInt: "$$r.actor_id" } }]
              }
            }
          }
        }
      },
      {
        $lookup: {
          from: "actors",
          let: { repostActorIds: "$reposts.actor_id" },
          pipeline: [
            { $match: { $expr: { $in: ["$id", "$$repostActorIds"] } } }
          ],
          as: "repost_actors"
        }
      },
      {
        $addFields: {
          likesCount: { $size: "$likes" },
          repostsCount: { $size: "$reposts" }
        }
      }
    ]).toArray();

    // For each reply, recursively fetch its replies
    const repliesWithActor: any[] = [];
    for (const reply of replies) {
      const replyActor = reply.actor && reply.actor[0] ? reply.actor[0] : {};
      const { _id, actor: _actorArr, ...rest } = reply;
      const nestedReplies = await fetchRepliesWithActor(
        reply.id,
        postsCollection,
        actorsCollection,
        likesCollection,
        repostsCollection,
        currentActorId
      );
      repliesWithActor.push({
        ...rest,
        uri: replyActor.uri || rest.uri,
        handle: replyActor.handle || rest.handle,
        name: replyActor.name || rest.name,
        user_id: replyActor.user_id || rest.user_id,
        inbox_url: replyActor.inbox_url || rest.inbox_url,
        shared_inbox_url: replyActor.shared_inbox_url || rest.shared_inbox_url,
        url: replyActor.url || rest.url,
        id: rest.id,
        actor_id: rest.actor_id,
        content: rest.content,
        created: rest.created,
        reply_to: rest.reply_to,
        likesCount: rest.likesCount,
        repostsCount: rest.repostsCount,
        like_actors: rest.like_actors,
        repost_actors: rest.repost_actors,
        isLikedByUser: rest.isLikedByUser,
        isRepostedByUser: rest.isRepostedByUser,
        replies: nestedReplies
      });
    }
    return repliesWithActor;
  }

  // Get replies with actor info
  const repliesWithActor = await fetchRepliesWithActor(post.id, postsCollection, actorsCollection, likesCollection, repostsCollection, currentActorId);

  // Compose the final post object with replies
  const postWithReplies = {
    // --- Required Post fields ---
    id: post.id,
    uri: post.uri,
    actor_id: post.actor_id,
    content: post.content,
    url: post.url,
    created: post.created,
    repost_of: post.repost_of,
    is_repost: post.is_repost,
    reply_to: post.reply_to,
    deleted: post.deleted,
    // --- Required Actor fields ---
    user_id: actor.user_id,
    handle: actor.handle,
    name: actor.name,
    summary: actor.summary,
    inbox_url: actor.inbox_url,
    shared_inbox_url: actor.shared_inbox_url,
    // url already included above
    // --- Extra fields for UI ---
    likesCount: likes.length,
    repostsCount: reposts.length,
    like_actors,
    repost_actors,
    isLikedByUser: currentActorId ? likes.some(l => l.actor_id === currentActorId) : false,
    isRepostedByUser: currentActorId ? reposts.some(r => r.actor_id === currentActorId) : false,
    replies: repliesWithActor,
  };

  // Ensure the canonical URL matches the current request
  const canonicalUrl = `/${username}/posts/${postId}`;
  if (c.req.path !== canonicalUrl) {
    return c.redirect(canonicalUrl);
  }

  return c.html(
    <Layout>
      <PostPage
        name={actor.name ?? user.username}
        username={user.username}
        handle={actor.handle}
        bio={actor.summary}
        following={followingCount}
        followers={followersCount}
        post={postWithReplies}
        isAuthenticated={isAuthenticated}
      />
    </Layout>
  );
});

// Helper to serve ActivityPub JSON for a post
async function serveActivityPubPost(c: any) {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();

  const username = c.req.param("username");
  const postId = parseInt(c.req.param("id"));

  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();
  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();
  const post = await postsCollection.findOne({ id: postId, actor_id: actor.id });
  if (!post) return c.notFound();

  // Compose ActivityPub Note object
  const domain = process.env.DOMAIN || "gunac.ar";
  const canonicalUrl = `https://${domain}/${username}/posts/${postId}`;
  const note = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    id: canonicalUrl,
    type: 'Note',
    attributedTo: actor.uri,
    content: post.content,
    published: post.created instanceof Date ? post.created.toISOString() : new Date(post.created).toISOString(),
    url: canonicalUrl,
    ...(post.reply_to ? { inReplyTo: post.reply_to && typeof post.reply_to === 'number' ? `https://${domain}/${username}/posts/${post.reply_to}` : post.reply_to } : {}),
    to: ['https://www.w3.org/ns/activitystreams#Public'],
  };
  return c.json(note);
}

// Follow another actor
app.post(":username/following", requireAuth(), async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const followsCollection = getFollowsCollection();

  const username = c.req.param("username");
  const form = await c.req.formData();
  const handle = form.get("actor");

  if (typeof handle !== "string") {
    return c.text("Invalid actor handle or URL", 400);
  }

  const user = await usersCollection.findOne({ username });
  if (!user) return c.text("User not found", 404);

  const ctx = createCanonicalContext(c.req.raw, undefined);
  try {
    const remoteActor = await ctx.lookupObject(handle.trim());
    if (!isActor(remoteActor)) {
      return c.text("Invalid actor handle or URL", 400);
    }
    const localActor = await actorsCollection.findOne({ user_id: user.id });
    if (!localActor) return c.text("Local actor not found", 404);

    await ctx.sendActivity(
      { identifier: username },
      remoteActor,
      new Follow({
        actor: ctx.getActorUri(username),
        object: remoteActor.id,
        to: remoteActor.id,
      })
    );

    // Insert local follow record
    await followsCollection.updateOne(
      { follower_id: localActor.id, following_id: remoteActor.id },
      { $setOnInsert: { created: new Date() } },
      { upsert: true }
    );

    return c.text("Successfully sent a follow request");
  } catch (error) {
    logger.error("Failed to send follow request", { error });
    return c.text("Failed to send follow request", 500);
  }
});

// --- ActivityPub Inbox Handler: Persist remote posts and follows from Mastodon and other servers ---
app.post("/inbox", async (c) => {
  try {
    await connectToDatabase();
    const actorsCollection = getActorsCollection();
    const postsCollection = getPostsCollection();
    const followsCollection = getFollowsCollection();
    const usersCollection = getUsersCollection();
    const body = await c.req.json();

    // Handle Follow activity
    if (body.type === "Follow" && body.actor && body.object) {
      // body.object is the local actor URI
      const localActor = await actorsCollection.findOne({ uri: body.object });
      if (!localActor) return c.text("Local actor not found", 400);
      // body.actor is the remote actor URI
      let remoteActor = await actorsCollection.findOne({ uri: body.actor });
      if (!remoteActor) {
        // Fetch remote actor profile if not present
        try {
          const res = await fetch(body.actor, { headers: { Accept: "application/activity+json" } });
          if (res.ok) {
            const actorJson = await res.json();
            const newRemoteActor = {
              id: actorJson.id || actorJson.url,
              uri: actorJson.id || actorJson.url,
              handle: actorJson.preferredUsername ? `@${actorJson.preferredUsername}@${new URL(actorJson.id || actorJson.url).host}` : actorJson.id || actorJson.url,
              name: actorJson.name || actorJson.preferredUsername || actorJson.id || actorJson.url,
              inbox_url: actorJson.inbox,
              shared_inbox_url: actorJson.endpoints?.sharedInbox || actorJson.inbox,
              url: actorJson.url || actorJson.id,
              summary: actorJson.summary,
              created: new Date(),
              user_id: null // remote actors have no user_id
            };
            await actorsCollection.insertOne(newRemoteActor);
            remoteActor = newRemoteActor as any;
          } else {
            return c.text("Failed to fetch remote actor", 400);
          }
        } catch (err) {
          return c.text("Error fetching remote actor", 400);
        }
      }
      if (!remoteActor) return c.text("Could not resolve remote actor", 400);
      // Insert follower record
      await followsCollection.updateOne(
        { follower_id: remoteActor.id, following_id: localActor.id },
        { $setOnInsert: { created: new Date() } },
        { upsert: true }
      );
      return c.text("OK", 200);
    }

    // Only handle Create activities for Note objects
    if (body.type !== "Create" || !body.object || body.object.type !== "Note") {
      return c.text("Not a Create/Note activity", 400);
    }

    const note = body.object;
    const remoteActorId = typeof body.actor === "string" ? body.actor : (body.actor.id || body.actor.url);
    if (!remoteActorId) return c.text("Missing actor", 400);

    // Upsert remote actor in actors collection
    let remoteActor = await actorsCollection.findOne({ uri: remoteActorId });
    if (!remoteActor) {
      // Fetch remote actor profile if not present
      try {
        const res = await fetch(remoteActorId, { headers: { Accept: "application/activity+json" } });
        if (res.ok) {
          const actorJson = await res.json();
          const newRemoteActor = {
            id: actorJson.id || actorJson.url,
            uri: actorJson.id || actorJson.url,
            handle: actorJson.preferredUsername ? `@${actorJson.preferredUsername}@${new URL(actorJson.id || actorJson.url).host}` : actorJson.id || actorJson.url,
            name: actorJson.name || actorJson.preferredUsername || actorJson.id || actorJson.url,
            inbox_url: actorJson.inbox,
            shared_inbox_url: actorJson.endpoints?.sharedInbox || actorJson.inbox,
            url: actorJson.url || actorJson.id,
            summary: actorJson.summary,
            created: new Date(),
            user_id: null // remote actors have no user_id
          };
          await actorsCollection.insertOne(newRemoteActor);
          remoteActor = newRemoteActor as any;
        } else {
          return c.text("Failed to fetch remote actor", 400);
        }
      } catch (err) {
        return c.text("Error fetching remote actor", 400);
      }
    }
    if (!remoteActor) return c.text("Could not resolve remote actor", 400);

    // Check if post already exists (by URI or id)
    const existing = await postsCollection.findOne({ uri: note.id || note.url });
    if (existing) return c.text("Already exists", 200);

    // Always assign a unique numeric id for remote posts
    const newPostId = await getNextSequence("posts");

    // If this is a reply, try to resolve the parent post's numeric id
    let replyToId: number | undefined = undefined;
    if (note.inReplyTo && typeof note.inReplyTo === "string") {
      const parent = await postsCollection.findOne({ uri: note.inReplyTo });
      if (parent && typeof parent.id === "number") {
        replyToId = parent.id;
      }
    }

    // Insert the remote post
    await postsCollection.insertOne({
      id: newPostId,
      uri: note.id || note.url,
      actor_id: remoteActor.id,
      content: note.content,
      url: note.url || note.id,
      created: note.published ? new Date(note.published) : new Date(),
      reply_to: replyToId,
      deleted: false
    });
    return c.text("OK", 200);
  } catch (err) {
    return c.text("Inbox error: " + (err instanceof Error ? err.message : String(err)), 500);
  }
});

export default app;