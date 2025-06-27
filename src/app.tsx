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
import userRoutes from "./routes/user.ts";

const logger = getLogger("fongoblog");

const app = new Hono();
app.use(federation(fedi, () => undefined));

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

  const userWithActor = { ...user, ...actor } as User & Actor;

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
      },
      {
        $match: isAuthenticated ? {
          $or: [
            { actor_id: actor.id },
            { actor_id: { $in: followingIds } }
          ]
        } : {} // Show all posts if not authenticated
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

  // Nest the replies in the posts
  const nestedPosts = nestReplies(postsWithActors);

  return c.html(
    <Layout user={userWithActor} isAuthenticated={isAuthenticated}>
      <Home user={userWithActor} posts={nestedPosts} isAuthenticated={isAuthenticated} />
    </Layout>
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

// Register Mastodon-style user and post routes
app.route("/", userRoutes);

// Logout route
app.get("/logout", async (c) => {
  destroySession(c);
  // Redirect to login after logout
  return c.redirect("/login");
});

// Login page
app.get("/login", redirectIfAuthenticated(), async (c) => {
  // Always destroy any existing session before showing login form
  destroySession(c);
  return c.html(
    <Layout>
      <LoginForm />
    </Layout>
  );
});

// Login form submission
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
    created: user.created
  };
  createSession(c, userForSession);
  // Redirect to home after login
  return c.redirect("/");
});

// Profile edit page
app.get("/profile/edit", requireAuth(), async (c) => {
  await connectToDatabase();
  const currentUser = getCurrentUser(c);
  if (!currentUser) return c.redirect("/login");
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const user = await usersCollection.findOne({ id: currentUser.userId });
  const actor = await actorsCollection.findOne({ user_id: currentUser.userId });
  if (!user || !actor) return c.redirect("/login");

  // Remove _id from user and actor for layout
  const { _id: _userId2, ...userClean2 } = user as any;
  const { _id: _actorId2, ...actorClean2 } = actor as any;
  return c.html(
    <Layout user={{ ...userClean2, ...actorClean2 } as User & Actor} isAuthenticated={true}>
      <ProfileEditForm name={actor.name} bio={actor.summary} />
    </Layout>
  );
});

// Profile edit form submission
app.post("/profile/edit", requireAuth(), async (c) => {
  await connectToDatabase();
  const currentUser = getCurrentUser(c);
  if (!currentUser) return c.redirect("/login");
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const form = await c.req.formData();
  const name = form.get("name")?.toString();
  const summary = form.get("summary")?.toString();
  await actorsCollection.updateOne(
    { user_id: currentUser.userId },
    { $set: { name, summary } }
  );
  // Redirect to the profile edit page after saving
  return c.redirect("/profile/edit");
});

// --- Profile page for single user ---
app.get("/profile", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();
  const likesCollection = getLikesCollection();
  const repostsCollection = getRepostsCollection();

  const user = await usersCollection.findOne({ id: 1 });
  if (!user) return c.notFound();
  const actor = await actorsCollection.findOne({ user_id: 1 });
  if (!actor) return c.notFound();
  const userWithActor = { ...user, ...actor };
  const currentUser = getCurrentUser(c);
  const isAuthenticated = !!currentUser;
  const followingCount = await followsCollection.countDocuments({ follower_id: actor.id });
  const followersCount = await followsCollection.countDocuments({ following_id: actor.id });
  const posts = await postsCollection.aggregate([
    { $match: { actor_id: actor.id, deleted: { $ne: true } } },
    { $sort: { created: -1 } },
    { $lookup: { from: "likes", localField: "id", foreignField: "post_id", as: "likes" } },
    { $lookup: { from: "actors", localField: "likes.actor_id", foreignField: "id", as: "like_actors" } },
    { $lookup: { from: "reposts", localField: "id", foreignField: "post_id", as: "reposts" } },
    { $addFields: {
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
    { $lookup: {
        from: "actors",
        let: { repostActorIds: "$reposts.actor_id" },
        pipeline: [
          { $match: { $expr: { $in: ["$id", "$$repostActorIds"] } } }
        ],
        as: "repost_actors"
      }
    },
    { $lookup: { from: "posts", localField: "id", foreignField: "reply_to", as: "replies" } },
    { $addFields: {
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

  // Only show root posts (not replies) at the top level
  const rootPosts = postsWithActor.filter(post => !("reply_to" in post) || !post.reply_to);

  return c.html(
    <Layout user={userWithActor as User & Actor} isAuthenticated={isAuthenticated}>
      <Profile
        name={actor.name ?? user.username}
        username={user.username}
        handle={actor.handle}
        bio={actor.summary}
        following={followingCount}
        followers={followersCount}
      />
      <PostList posts={rootPosts as (Post & Actor)[]} isAuthenticated={isAuthenticated} />
    </Layout>
  );
});

// --- Single-user post page ---
app.get("/posts/:id", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();
  const likesCollection = getLikesCollection();
  const repostsCollection = getRepostsCollection();

  const user = await usersCollection.findOne({ id: 1 });
  if (!user) return c.notFound();
  const actor = await actorsCollection.findOne({ user_id: 1 });
  if (!actor) return c.notFound();

  // Ensure we only get the post for this actor and id
  const postId = parseInt(c.req.param("id"));
  const post = await postsCollection.findOne({ id: postId, actor_id: actor.id });
  if (!post) return c.notFound();

  // Get follower and following counts
  const followersCount = await followsCollection.countDocuments({ following_id: actor.id });
  const followingCount = await followsCollection.countDocuments({ follower_id: actor.id });

  // Check if current visitor is authenticated
  const currentUserSession = getCurrentUser(c);
  const isAuthenticated = !!currentUserSession;
  let currentActorId: number | undefined = undefined;
  if (currentUserSession) {
    currentActorId = actor.id;
  }

  // Get likes and reposts for this post
  const likes = await likesCollection.find({ post_id: post.id }).toArray();
  const reposts = await repostsCollection.find({ post_id: post.id }).toArray();
  const likeActorIds = likes.map(l => l.actor_id);
  const repostActorIds = reposts.map(r => r.actor_id);
  const like_actors = likeActorIds.length > 0 ? await actorsCollection.find({ id: { $in: likeActorIds } }).toArray() as Actor[] : [];
  const repost_actors = repostActorIds.length > 0 ? await actorsCollection.find({ id: { $in: repostActorIds } }).toArray() as Actor[] : [];

  // Compose the post object with all required fields
  const postWithActor = {
    ...actor,
    ...user,
    likesCount: likes.length,
    repostsCount: reposts.length,
    like_actors,
    repost_actors,
    isLikedByUser: currentActorId ? likes.some(l => l.actor_id === currentActorId) : false,
    isRepostedByUser: currentActorId ? reposts.some(r => r.actor_id === currentActorId) : false,
    ...post,
  };

  // --- Fetch and attach replies with aggregation ---
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
  // Attach actor fields to each reply for UI compatibility
  const repliesWithActor = replies.map(reply => {
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
    };
  });
  const postWithReplies = {
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
    user_id: actor.user_id,
    handle: actor.handle,
    name: actor.name,
    summary: actor.summary,
    inbox_url: actor.inbox_url,
    shared_inbox_url: actor.shared_inbox_url,
    likesCount: likes.length,
    repostsCount: reposts.length,
    like_actors,
    repost_actors,
    isLikedByUser: currentActorId ? likes.some(l => l.actor_id === currentActorId) : false,
    isRepostedByUser: currentActorId ? reposts.some(r => r.actor_id === currentActorId) : false,
    replies: repliesWithActor,
  };

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

// --- ActivityPub JSON endpoints for federation (keep username in path for compatibility) ---
app.get("/users/:username", async (c) => {
  // Always serve ActivityPub JSON for federation
  // (do not render HTML or redirect)
  const { serveActivityPubProfile } = await import("./controllers/user.tsx");
  return serveActivityPubProfile(c);
});
app.get("/users/:username/posts/:id.json", async (c) => {
  c.req.raw.headers.set("Accept", "application/activity+json");
  const { serveActivityPubPost } = await import("./controllers/user.tsx");
  return serveActivityPubPost(c);
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

    const actor = await actorsCollection.findOne({ user_id: currentUser.userId });
    if (!actor) {
      return c.json({ error: "Actor not found" }, 404);
    }

    // Check if already liked
    const existingLike = await likesCollection.findOne({
      actor_id: actor.id,
      post_id: postId
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
          undoActivity
        );
      } catch (activityError) {
        logger.warn("Failed to send Undo Like activity", { activityError });
      }
      
      // Get updated count
      const likesCount = await likesCollection.countDocuments({ post_id: postId });
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
        created: new Date()
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
          likeActivity
        );
      } catch (activityError) {
        logger.warn("Failed to send Like activity", { activityError });
      }

      // Get updated count
      const likesCount = await likesCollection.countDocuments({ post_id: postId });
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

    const actor = await actorsCollection.findOne({ user_id: currentUser.userId });
    if (!actor) {
      return c.json({ error: "Actor not found" }, 404);
    }

    // Check if already reposted
    const existingRepost = await repostsCollection.findOne({
      actor_id: actor.id,
      post_id: postId
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
          undoActivity
        );
      } catch (activityError) {
        logger.warn("Failed to send Undo Announce activity", { activityError });
      }
      
      // Get updated count
      const repostsCount = await repostsCollection.countDocuments({ post_id: postId });
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
        created: new Date()
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
          announceActivity
        );
      } catch (activityError) {
        logger.warn("Failed to send Announce activity", { activityError });
      }

      // Get updated count
      const repostsCount = await repostsCollection.countDocuments({ post_id: postId });
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
    const actor = await actorsCollection.findOne({ user_id: currentUser.userId });
    if (!actor || post.actor_id !== actor.id) return c.text("Forbidden", 403);
    // Soft delete: set deleted flag and clear content
    await postsCollection.updateOne({ id }, { $set: { deleted: true, content: "(deleted)" } });
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
  if (!resource || (resource.toLowerCase() !== expectedAcct1 && resource.toLowerCase() !== expectedAcct2)) {
    logger.warn("WebFinger: Resource not found", { resource, expectedAcct1, expectedAcct2 });
    return c.json({ error: "Resource not found" },  404);
  }
  // Compose WebFinger response
  const response = {
    subject: resource,
    aliases: [actor.uri, actor.url].filter(Boolean),
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: actor.uri,
      },
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: actor.url,
      },
    ],
  };
  logger.info("WebFinger: Responding", response);
  return c.json(response);
});

export default app;
