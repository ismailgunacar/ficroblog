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

const logger = getLogger("marco3");

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
    <Layout>
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

    // Send Create(Note) activity to followers
    try {
      const noteArgs = { identifier: user.username, id: postId.toString() };
      console.log("About to get Note object with args:", noteArgs);
      const note = await ctx.getObject(Note, noteArgs);
      console.log("Note object result:", {
        note: !!note,
        id: note?.id?.href,
        attributionId: note?.attributionId?.href,
        published: note?.published?.toString()
      });
      
      if (note) {
        await ctx.sendActivity(
          { identifier: user.username },
          "followers",
          new Create({
            id: new URL(ctx.getObjectUri(Note, { identifier: user.username, id: postId.toString() }).href.replace('/posts/', '/activities/create/')),
            actor: ctx.getActorUri(user.username),
            object: note,
            to: PUBLIC_COLLECTION,
            cc: ctx.getFollowersUri(user.username),
            published: note.published,
          })
        );
        logger.info("ActivityPub Create activity sent successfully", { postId });
      } else {
        logger.error("Failed to get note object for Create activity", { postId });
      }
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

// User profile page
app.get("/users/:username", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();

  const username = c.req.param("username");
  
  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();

  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();

  const userWithActor = { ...user, ...actor };

  // Check if current visitor is authenticated
  const currentUser = getCurrentUser(c);
  const isAuthenticated = !!currentUser;

  // Get follower and following counts
  const followersCount = await followsCollection.countDocuments({ following_id: actor.id });
  const followingCount = await followsCollection.countDocuments({ follower_id: actor.id });

  // Get user's posts
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
        $match: { actor_id: actor.id }
      },
      { $sort: { created: -1 } }
    ])
    .toArray();

  const postsWithActors = posts.map(post => ({
    ...post,
    ...post.actor[0]
  }));

  // Recursively nest replies for each post (profile page)
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
    <Layout>
      <Profile
        name={actor.name ?? user.username}
        username={user.username}
        handle={actor.handle}
        bio={actor.summary}
        following={followingCount}
        followers={followersCount}
      />
      <PostList posts={nestedPosts} isAuthenticated={isAuthenticated} />
    </Layout>
  );
});

// Create new post
app.post("/users/:username/posts", requireAuth(), async (c) => {
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

    // Send Create(Note) activity to followers
    try {
      const noteArgs = { identifier: username, id: postId.toString() };
      const note = await ctx.getObject(Note, noteArgs);
      
      if (note) {
        await ctx.sendActivity(
          { identifier: username },
          "followers",
          new Create({
            id: new URL(ctx.getObjectUri(Note, { identifier: username, id: postId.toString() }).href.replace('/posts/', '/activities/create/')),
            actor: ctx.getActorUri(username),
            object: note,
            to: PUBLIC_COLLECTION,
            cc: ctx.getFollowersUri(username),
            published: note.published,
          })
        );
        logger.info("ActivityPub Create activity sent successfully", { postId });
      } else {
        logger.error("Failed to get note object for Create activity", { postId });
      }
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
app.get("/users/:username/posts/:id", async (c) => {
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

  const post = await postsCollection.findOne({ id: postId, actor_id: actor.id });
  if (!post) return c.notFound();

  const postWithActor = { ...post, ...actor, ...user } as Post & Actor & User;

  // Check if current visitor is authenticated
  const currentUser = getCurrentUser(c);
  const isAuthenticated = !!currentUser;

  // Get follower and following counts
  const followersCount = await followsCollection.countDocuments({ following_id: actor.id });
  const followingCount = await followsCollection.countDocuments({ follower_id: actor.id });

  return c.html(
    <Layout>
      <PostPage
        name={actor.name ?? user.username}
        username={user.username}
        handle={actor.handle}
        bio={actor.summary}
        following={followingCount}
        followers={followersCount}
        post={postWithActor}
        isAuthenticated={isAuthenticated}
      />
    </Layout>
  );
});

// Follow another actor
app.post("/users/:username/following", requireAuth(), async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();

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
    const actor = await ctx.lookupObject(handle.trim());
    if (!isActor(actor)) {
      return c.text("Invalid actor handle or URL", 400);
    }

    await ctx.sendActivity(
      { identifier: username },
      actor,
      new Follow({
        actor: ctx.getActorUri(username),
        object: actor.id,
        to: actor.id,
      })
    );

    return c.text("Successfully sent a follow request");
  } catch (error) {
    logger.error("Failed to send follow request", { error });
    return c.text("Failed to send follow request", 500);
  }
});

// Followers list
app.get("/users/:username/followers", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const followsCollection = getFollowsCollection();

  const username = c.req.param("username");
  
  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();

  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();

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
      // Filter out records where no actor was found
      { $match: { "follower.0": { $exists: true } } },
      { $sort: { created: -1 } }
    ])
    .toArray();

  const followerActors = followers
    .map(f => f.follower[0])
    .filter(actor => actor != null); // Extra safety filter

  return c.html(
    <Layout>
      <FollowerList followers={followerActors} />
    </Layout>
  );
});

// Following list
app.get("/users/:username/following", async (c) => {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const followsCollection = getFollowsCollection();

  const username = c.req.param("username");
  
  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();

  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();

  const following = await followsCollection
    .aggregate([
      { $match: { follower_id: actor.id } },
      {
        $lookup: {
          from: "actors",
          localField: "following_id",
          foreignField: "id",
          as: "following"
        }
      },
      // Filter out records where no actor was found
      { $match: { "following.0": { $exists: true } } },
      { $sort: { created: -1 } }
    ])
    .toArray();

  const followingActors = following
    .map(f => f.following[0])
    .filter(actor => actor != null); // Extra safety filter

  return c.html(
    <Layout>
      <FollowingList following={followingActors} />
    </Layout>
  );
});

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
    
    const currentUser = getCurrentUser(c);
    if (!currentUser) {
      return c.redirect("/login");
    }
    
    const actor = await actorsCollection.findOne({ user_id: currentUser.userId });
    if (!actor) {
      logger.error("Actor not found for user", { userId: currentUser.userId });
      return c.text("Actor not found", 404);
    }
    
    const html = (
      <Layout title="Edit Profile" user={currentUser}>
        <ProfileEditForm 
          name={actor.name || actor.handle} 
          bio={actor.summary} 
        />
      </Layout>
    );
    
    return c.html(html);
  } catch (error) {
    logger.error("Profile edit form error", { error: error instanceof Error ? error.message : String(error) });
    return c.text("Internal server error", 500);
  }
});

// Handle profile edit form submission
app.post("/profile/edit", requireAuth(), async (c) => {
  try {
    await connectToDatabase();
    const actorsCollection = getActorsCollection();
    
    const currentUser = getCurrentUser(c);
    if (!currentUser) {
      return c.redirect("/login");
    }
    
    const body = await c.req.parseBody();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    
    if (!name) {
      return c.text("Name is required", 400);
    }
    
    // Update the actor with the new name and bio
    const result = await actorsCollection.updateOne(
      { user_id: currentUser.userId },
      { 
        $set: { 
          name: name,
          summary: bio || "" 
        } 
      }
    );
    
    if (result.matchedCount === 0) {
      logger.error("Actor not found for user during update", { userId: currentUser.userId });
      return c.text("Actor not found", 404);
    }
    
    // Get the updated actor data to send the ActivityPub update
    const updatedActor = await actorsCollection.findOne({ user_id: currentUser.userId });
    if (updatedActor) {
      // Send profile update to followers via ActivityPub
      sendProfileUpdate(currentUser.userId, updatedActor as Actor).catch(error => {
        logger.error("Failed to send ActivityPub profile update", { 
          userId: currentUser.userId, 
          error: error instanceof Error ? error.message : String(error) 
        });
      });
    }
    
    logger.info("Profile updated", { userId: currentUser.userId, name, bio });
    
    // Redirect back to the user's profile page
    return c.redirect(`/users/${currentUser.username}`);
    
  } catch (error) {
    logger.error("Profile edit submission error", { error: error instanceof Error ? error.message : String(error) });
    return c.text("Internal server error", 500);
  }
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
  await sendDeleteActivity(post as Post);
  return c.redirect("/");
});

export default app;
