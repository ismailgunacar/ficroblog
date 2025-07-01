import { Create, Follow, Note, Undo } from "@fedify/fedify";
import { federation } from "@fedify/fedify/x/hono";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
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
app.use(federation(fedi, () => undefined));

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

  if (!username || !name || !username.match(/^[a-z0-9_-]{1,50}$/)) {
    return c.redirect("/setup");
  }

  const url = new URL(c.req.url);
  const handle = `@${username}@${url.host}`;

  await User.create({
    username,
    displayName: name,
  });

  return c.redirect("/");
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

  return c.html(
    <Layout>
      <Home
        user={user}
        handle={handle}
        followers={followers}
        following={followingCount}
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
  const publicUrl = c.req.header("host")?.includes("localhost")
    ? "https://d86c19a367b63a.lhr.life"
    : `https://${c.req.header("host")}`;

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
  const publicUrl = c.req.header("host")?.includes("localhost")
    ? "https://d86c19a367b63a.lhr.life"
    : `https://${c.req.header("host")}`;

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

  return c.html(
    <Layout>
      <Profile
        name={user.displayName}
        username={user.username}
        handle={handle}
        followers={followers}
        following={followingCount}
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
  const content = form.get("content")?.toString();
  if (!content || content.trim() === "") {
    return c.text("Content is required", 400);
  }

  const post = await Post.create({
    content: stringifyEntities(content, { escapeOnly: true }),
    author: username,
  });

  // Send Create activity to followers
  const ctx = fedi.createContext(c.req.raw, undefined);
  const publicUrl = c.req.header("host")?.includes("localhost")
    ? "https://d86c19a367b63a.lhr.life"
    : `https://${c.req.header("host")}`;

  const note = new Note({
    id: new URL(`/users/${username}/posts/${post._id}`, publicUrl),
    attribution: new URL(`/users/${username}`, publicUrl),
    content: post.content,
    mediaType: "text/html",
    to: new URL("https://www.w3.org/ns/activitystreams#Public"),
  });

  logger.info(`Sending Create activity to followers for post ${post._id}`);
  logger.info(`Note ID: ${note.id?.href}`);
  logger.info(`Actor: ${publicUrl}/users/${username}`);

  // Check if we have any followers first
  const followers = await FollowModel.find({
    following: `${publicUrl}/users/${username}`,
  }).exec();
  logger.info(`Found ${followers.length} followers for ${username}`);

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

  return c.redirect("/");
});

// Post detail page
app.get("/users/:username/posts/:id", async (c) => {
  const username = c.req.param("username");
  const postId = c.req.param("id");

  const user = await User.findOne({ username }).exec();
  if (!user) return c.notFound();

  const post = await Post.findOne({ _id: postId, author: username }).exec();
  if (!post) return c.notFound();

  const following = `https://${c.req.header("host")}/users/${username}`;
  const followers = await FollowModel.countDocuments({ following });
  const followingCount = await Following.countDocuments({
    follower: following,
  });

  const url = new URL(c.req.url);
  const handle = `@${username}@${url.host}`;

  return c.html(
    <Layout>
      <PostPage
        name={user.displayName}
        username={user.username}
        handle={handle}
        followers={followers}
        following={followingCount}
        post={post}
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

export default app;
