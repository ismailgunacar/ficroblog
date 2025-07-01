import { Create, Follow, Note, Undo } from "@fedify/fedify";
import { federation } from "@fedify/fedify/x/hono";
import { getLogger } from "@logtape/logtape";
import bcrypt from "bcrypt";
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { stringifyEntities } from "stringify-entities";
import { connectDB } from "./db.js";
import fedi from "./federation.js";
import { Follow as FollowModel, Following, Post, User } from "./models.js";
import {
  FollowerList,
  FollowingList,
  Home,
  Layout,
  PostPage,
  Profile,
  SetupForm,
} from "./views.js";

const logger = getLogger("wendy");

await connectDB();

const app = new Hono();

// Add /@* route to render the user profile page directly (must be before federation middleware)
app.get("/@*", async (c) => {
  const path = c.req.path;
  const username = path.substring(2); // Remove the /@ prefix
  const user = await User.findOne({ username }).exec();
  if (!user) return c.notFound();

  const following = `https://${c.req.header("host")}/users/${username}`;
  const followers = await FollowModel.countDocuments({ following });
  const followingCount = await Following.countDocuments({
    follower: following,
  });

  const url = new URL(c.req.url);
  const handle = `@${username}@${url.host}`;
  const domain = c.req.header("host");

  // Fetch this user's posts
  const posts = await Post.find({ author: username })
    .sort({ createdAt: -1 })
    .exec();

  return c.html(
    <Layout>
      <Home
        user={user}
        handle={handle}
        followers={followers}
        following={followingCount}
        posts={posts}
        isProfilePage={true}
        {...(domain ? { domain } : {})}
      />
    </Layout>,
  );
});

app.use(federation(fedi, () => undefined));

type AppContext = Context<{ Variables: { sessionUser?: string } }>;

// Session middleware
app.use(async (c: AppContext, next) => {
  const session = getCookie(c, "session");
  if (session) {
    // For single-user, just check if session === username
    const user = await User.findOne().exec();
    if (user && session === user.username) {
      c.set("sessionUser", user.username);
    }
  }
  await next();
});

// Account setup
app.get("/setup", async (c) => {
  const user = await User.findOne().exec();
  if (user) return c.redirect("/");

  return c.html(
    <Layout>
      <SetupForm />
    </Layout>,
  );
});

app.post("/setup", async (c) => {
  const user = await User.findOne().exec();
  if (user) return c.redirect("/");

  const form = await c.req.formData();
  const username = form.get("username")?.toString();
  const name = form.get("name")?.toString();
  const password = form.get("password")?.toString();
  const confirmPassword = form.get("confirm_password")?.toString();
  const avatarUrl = form.get("avatarUrl")?.toString() || "";
  const headerUrl = form.get("headerUrl")?.toString() || "";

  if (
    !username ||
    !name ||
    !username.match(/^[a-z0-9_-]{1,50}$/) ||
    !password ||
    !confirmPassword ||
    password.length < 8 ||
    confirmPassword.length < 8 ||
    password !== confirmPassword
  ) {
    return c.redirect("/setup");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await User.create({
    username,
    displayName: name,
    passwordHash,
    avatarUrl,
    headerUrl,
  });

  return c.redirect("/");
});

// Login endpoint
app.post("/login", async (c: AppContext) => {
  const { password } = await c.req.json();
  const user = await User.findOne().exec();
  if (!user || !password) return c.json({ ok: false });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return c.json({ ok: false });
  setCookie(c, "session", user.username, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
  });
  return c.json({ ok: true });
});

// Logout endpoint
app.post("/logout", async (c: AppContext) => {
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});

// Session check endpoint
app.get("/session", async (c: AppContext) => {
  if (c.get("sessionUser")) {
    return c.json({ loggedIn: true });
  }
  return c.json({ loggedIn: false });
});

// Profile update endpoint
app.post("/profile", async (c: AppContext) => {
  if (!c.get("sessionUser")) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }
  const { displayName, bio, avatarUrl, headerUrl, username, password } =
    await c.req.json();
  const user = await User.findOne().exec();
  if (!user) return c.json({ ok: false, error: "User not found" }, 404);
  if (
    typeof displayName !== "string" ||
    displayName.length < 1 ||
    displayName.length > 50
  ) {
    return c.json({ ok: false, error: "Invalid displayName" }, 400);
  }
  if (typeof bio !== "string" || bio.length > 200) {
    return c.json({ ok: false, error: "Invalid bio" }, 400);
  }
  if (typeof avatarUrl !== "string" || avatarUrl.length > 300) {
    return c.json({ ok: false, error: "Invalid avatarUrl" }, 400);
  }
  if (typeof headerUrl !== "string" || headerUrl.length > 300) {
    return c.json({ ok: false, error: "Invalid headerUrl" }, 400);
  }
  // Username is not editable after setup for now
  user.displayName = displayName;
  user.bio = bio;
  user.avatarUrl = avatarUrl;
  user.headerUrl = headerUrl;
  if (typeof password === "string" && password.length >= 8) {
    user.passwordHash = await bcrypt.hash(password, 12);
  }
  await user.save();
  return c.json({ ok: true });
});

// Auth-required middleware for POST routes (except /setup and /login)
app.use("/*", async (c: AppContext, next) => {
  if (c.req.method === "POST" && !["/setup", "/login"].includes(c.req.path)) {
    if (!c.get("sessionUser")) {
      return c.json({ ok: false, error: "Unauthorized" }, 401);
    }
  }
  await next();
});

// Home page
app.get("/", async (c) => {
  const user = await User.findOne().exec();
  if (!user) return c.redirect("/setup");

  const following = `https://${c.req.header("host")}/users/${user.username}`;
  const followers = await FollowModel.countDocuments({ following });
  const followingCount = await Following.countDocuments({
    follower: following,
  });
  const url = new URL(c.req.url);
  const handle = `@${user.username}@${url.host}`;
  const domain = c.req.header("host");

  return c.html(
    <Layout>
      <Home
        user={user}
        handle={handle}
        followers={followers}
        following={followingCount}
        {...(domain ? { domain } : {})}
      />
    </Layout>,
  );
});

// Follow someone
app.post("/follow", async (c) => {
  const user = await User.findOne().exec();
  if (!user) return c.redirect("/setup");

  const form = await c.req.formData();
  const handle = form.get("handle")?.toString();

  if (!handle || !handle.includes("@")) {
    return c.redirect("/");
  }

  const [username, domain] = handle.substring(1).split("@");
  if (!username || !domain) {
    return c.redirect("/");
  }

  const targetUrl = `https://${domain}/users/${username}`;
  const followerUrl = `https://${c.req.header("host")}/users/${user.username}`;

  // Check if already following
  const existing = await Following.findOne({
    follower: followerUrl,
    following: targetUrl,
  }).exec();

  if (existing) {
    return c.redirect("/");
  }

  // Store following relationship
  await Following.create({
    follower: followerUrl,
    following: targetUrl,
  });

  // Send Follow activity
  const ctx = fedi.createContext(c.req.raw, undefined);
  const publicUrl = `https://${c.req.header("host")}`;

  await ctx.sendActivity(
    { identifier: user.username },
    { id: new URL(targetUrl), inboxId: new URL(`${targetUrl}/inbox`) },
    new Follow({
      id: new URL(
        `#follow-${Date.now()}`,
        `${publicUrl}/users/${user.username}`,
      ),
      actor: new URL(followerUrl),
      object: new URL(targetUrl),
    }),
  );

  return c.redirect("/");
});

// Unfollow someone
app.post("/unfollow", async (c) => {
  const user = await User.findOne().exec();
  if (!user) return c.redirect("/setup");

  const form = await c.req.formData();
  const followingUrl = form.get("following")?.toString();

  if (!followingUrl) {
    return c.redirect("/");
  }

  const followerUrl = `https://${c.req.header("host")}/users/${user.username}`;

  // Check if actually following
  const existing = await Following.findOne({
    follower: followerUrl,
    following: followingUrl,
  }).exec();

  if (!existing) {
    return c.redirect("/");
  }

  // Remove following relationship
  await Following.deleteOne({
    follower: followerUrl,
    following: followingUrl,
  });

  // Send Undo(Follow) activity
  const ctx = fedi.createContext(c.req.raw, undefined);
  const publicUrl = `https://${c.req.header("host")}`;

  await ctx.sendActivity(
    { identifier: user.username },
    { id: new URL(followingUrl), inboxId: new URL(`${followingUrl}/inbox`) },
    new Undo({
      id: new URL(
        `#undo-follow-${Date.now()}`,
        `${publicUrl}/users/${user.username}`,
      ),
      actor: new URL(followerUrl),
      object: new Follow({
        actor: new URL(followerUrl),
        object: new URL(followingUrl),
      }),
    }),
  );

  return c.redirect(`/users/${user.username}/following`);
});

// Profile page
app.get("/users/:username", async (c) => {
  const username = c.req.param("username");
  const user = await User.findOne({ username }).exec();
  if (!user) return c.notFound();

  const following = `https://${c.req.header("host")}/users/${username}`;
  const followers = await FollowModel.countDocuments({ following });
  const followingCount = await Following.countDocuments({
    follower: following,
  });

  const url = new URL(c.req.url);
  const handle = `@${username}@${url.host}`;
  const domain = c.req.header("host");

  // Fetch this user's posts
  const posts = await Post.find({ author: username })
    .sort({ createdAt: -1 })
    .exec();

  return c.html(
    <Layout>
      <Home
        user={user}
        handle={handle}
        followers={followers}
        following={followingCount}
        posts={posts}
        isProfilePage={true}
        {...(domain ? { domain } : {})}
      />
    </Layout>,
  );
});

// Post creation
app.post("/users/:username/posts", async (c) => {
  const username = c.req.param("username");
  const user = await User.findOne({ username }).exec();
  if (!user) return c.redirect("/setup");

  const form = await c.req.formData();
  // Accept multiple content[] fields for threads
  let contents = form
    .getAll("content[]")
    .map((v) => v.toString())
    .filter((v) => v.trim() !== "");
  const replyTo = form.get("replyTo")?.toString() || undefined;
  if (!contents.length) {
    return c.text("Content is required", 400);
  }

  let lastPostId = replyTo;
  const ctx = fedi.createContext(c.req.raw, undefined);
  const publicUrl = `https://${c.req.header("host")}`;

  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];
    // Create the post, linking to previous as replyTo
    const post = await Post.create({
      content: stringifyEntities(content, { escapeOnly: true }),
      author: username,
      replyTo: lastPostId,
    });

    // Prepare ActivityPub Note
    const noteData = {
      id: new URL(`/users/${username}/posts/${post._id}`, publicUrl),
      attribution: new URL(`/users/${username}`, publicUrl),
      content: post.content,
      mediaType: "text/html",
      to: new URL("https://www.w3.org/ns/activitystreams#Public"),
    };
    if (lastPostId) {
      noteData.inReplyTo = new URL(
        `/users/${username}/posts/${lastPostId}`,
        publicUrl,
      );
    }
    const note = new Note(noteData);
    logger.info(`Sending Create activity to followers for post ${post._id}`);
    logger.info(`Note ID: ${note.id?.href}`);
    logger.info(`Actor: ${publicUrl}/users/${username}`);

    // Check if we have any followers first
    const followers = await FollowModel.find({
      following: publicUrl + "/users/" + username,
    }).exec();
    logger.info(`Followers: ${followers.map((f) => f.follower).join(", ")}`);
    if (followers.length === 0) {
      logger.info(`No followers found, skipping delivery`);
    } else {
      logger.info(`Followers: ${followers.map((f) => f.follower).join(", ")}`);
    }

    await ctx.sendActivity(
      { identifier: username },
      "followers",
      new Create({
        id: new URL(`#create-${post._id}`, `${publicUrl}/users/${username}`),
        actor: new URL(`/users/${username}`, publicUrl),
        object: note,
      }),
    );

    logger.info(`Successfully sent Create activity to followers`);
    lastPostId = post._id;
  }

  return c.redirect("/");
});

// Post detail page
app.get("/users/:username/posts/:id", async (c) => {
  const username = c.req.param("username");
  const postId = c.req.param("id");

  const user = await User.findOne({ username }).exec();
  if (!user) return c.notFound();

  // Validate ObjectId format
  if (!postId || typeof postId !== "string" || postId.length !== 24) {
    logger.warn(`Invalid ObjectId format in post detail page: ${postId}`);
    return c.notFound();
  }

  let post;
  try {
    post = await Post.findOne({ _id: postId, author: username }).exec();
    if (!post) return c.notFound();
  } catch (error) {
    logger.error(`Error fetching post ${postId}: ${error}`);
    return c.notFound();
  }

  const following = `https://${c.req.header("host")}/users/${username}`;
  const followers = await FollowModel.countDocuments({ following });
  const followingCount = await Following.countDocuments({
    follower: following,
  });

  const url = new URL(c.req.url);
  const handle = `@${username}@${url.host}`;
  const domain = c.req.header("host");

  return c.html(
    <Layout>
      <PostPage
        name={user.displayName}
        username={user.username}
        handle={handle}
        followers={followers}
        following={followingCount}
        post={post}
        user={user}
        domain={domain}
      />
    </Layout>,
  );
});

// Followers list
app.get("/users/:username/followers", async (c) => {
  const username = c.req.param("username");
  const user = await User.findOne({ username }).exec();
  if (!user) return c.notFound();

  const following = `https://${c.req.header("host")}/users/${username}`;
  const followers = await FollowModel.find({ following })
    .sort({ createdAt: -1 })
    .exec();

  return c.html(
    <Layout>
      <FollowerList followers={followers} />
    </Layout>,
  );
});

// Following list
app.get("/users/:username/following", async (c) => {
  const username = c.req.param("username");
  const user = await User.findOne({ username }).exec();
  if (!user) return c.notFound();

  const follower = `https://${c.req.header("host")}/users/${username}`;
  const following = await Following.find({ follower })
    .sort({ createdAt: -1 })
    .exec();

  return c.html(
    <Layout>
      <FollowingList following={following} />
    </Layout>,
  );
});

// Helper to fetch remote actor's inbox from their actor object
async function fetchRemoteInbox(actorUrl: string): Promise<string | null> {
  try {
    const res = await fetch(actorUrl, {
      headers: { Accept: "application/activity+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.inbox === "string" ? data.inbox : null;
  } catch (e) {
    return null;
  }
}

// Like a post
app.post("/like", async (c) => {
  const user = await User.findOne().exec();
  if (!user) return c.redirect("/setup");
  const form = await c.req.formData();
  const postId = form.get("postId")?.toString();
  const objectId = form.get("objectId")?.toString();
  if (!postId) return c.redirect("/");
  const post = await Post.findById(postId).exec();
  if (!post) return c.redirect("/");
  const actorUrl = `https://${c.req.header("host")}/users/${user.username}`;
  if (post.likes?.includes(actorUrl))
    return c.redirect(c.req.header("referer") || "/");
  post.likes = post.likes || [];
  post.likes.push(actorUrl);
  await post.save();
  // Federation: send Like activity
  const ctx = fedi.createContext(c.req.raw, undefined);
  const publicUrl = `https://${c.req.header("host")}`;
  const targetObject = objectId
    ? new URL(objectId)
    : new URL(`/users/${user.username}/posts/${post._id}`, publicUrl);
  if (post.remote && post.author && post.author.startsWith("http")) {
    // Remote post: fetch actor inbox
    const inbox = await fetchRemoteInbox(post.author);
    if (inbox) {
      await ctx.sendActivity(
        { identifier: user.username },
        { id: new URL(post.author), inboxId: new URL(inbox) },
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Like",
          id: new URL(`#like-${Date.now()}`, actorUrl),
          actor: actorUrl,
          object: targetObject,
        },
      );
    } else {
      logger.error(`Could not fetch inbox for remote actor: ${post.author}`);
    }
  } else if (!post.remote) {
    // Local post: federate Like to followers
    await ctx.sendActivity({ identifier: user.username }, "followers", {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Like",
      id: new URL(`#like-${Date.now()}`, actorUrl),
      actor: actorUrl,
      object: targetObject,
    });
  }
  return c.redirect(c.req.header("referer") || "/");
});

// Repost (Announce) a post
app.post("/repost", async (c) => {
  const user = await User.findOne().exec();
  if (!user) return c.redirect("/setup");
  const form = await c.req.formData();
  const postId = form.get("postId")?.toString();
  const objectId = form.get("objectId")?.toString();
  if (!postId) return c.redirect("/");
  const post = await Post.findById(postId).exec();
  if (!post) return c.redirect("/");
  const actorUrl = `https://${c.req.header("host")}/users/${user.username}`;
  if (post.reposts?.includes(actorUrl))
    return c.redirect(c.req.header("referer") || "/");
  post.reposts = post.reposts || [];
  post.reposts.push(actorUrl);
  await post.save();
  // Federation: send Announce activity
  const ctx = fedi.createContext(c.req.raw, undefined);
  const publicUrl = `https://${c.req.header("host")}`;
  const targetObject = objectId
    ? new URL(objectId)
    : new URL(`/users/${user.username}/posts/${post._id}`, publicUrl);
  if (post.remote && post.author && post.author.startsWith("http")) {
    // Remote post: fetch actor inbox
    const inbox = await fetchRemoteInbox(post.author);
    if (inbox) {
      await ctx.sendActivity(
        { identifier: user.username },
        { id: new URL(post.author), inboxId: new URL(inbox) },
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Announce",
          id: new URL(`#announce-${Date.now()}`, actorUrl),
          actor: actorUrl,
          object: targetObject,
        },
      );
    } else {
      logger.error(`Could not fetch inbox for remote actor: ${post.author}`);
    }
  } else if (!post.remote) {
    // Local post: federate Announce to followers
    await ctx.sendActivity({ identifier: user.username }, "followers", {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Announce",
      id: new URL(`#announce-${Date.now()}`, actorUrl),
      actor: actorUrl,
      object: targetObject,
    });
  }
  return c.redirect(c.req.header("referer") || "/");
});

export default app;
