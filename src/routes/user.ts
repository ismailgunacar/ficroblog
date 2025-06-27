// src/routes/user.ts
// Mastodon-style user and post route handlers
import { Hono } from "hono";
import { handleProfilePage, handlePostPage, serveActivityPubPost } from "../controllers/user.tsx";

const userRoutes = new Hono();

// Mastodon-style user profile page: /@:username
userRoutes.get("/:username", async (c) => {
  // Always fetch the canonical username from the DB
  const { getUsersCollection } = await import("../db.ts");
  await (await import("../db.ts")).connectToDatabase();
  const usersCollection = getUsersCollection();
  const user = await usersCollection.findOne({ id: 1 });
  const canonicalUsername = user?.username || "user";
  return handleProfilePage(c, canonicalUsername);
});

// Mastodon-style post page: /@:username/posts/:id
userRoutes.get("/:username/posts/:id", async (c) => {
  const username = c.req.param("username")!;
  const postId = parseInt(c.req.param("id"));
  return handlePostPage(c, username, postId);
});

// ActivityPub Note JSON: /@:username/posts/:id.json
userRoutes.get("/:username/posts/:id.json", async (c) => {
  return serveActivityPubPost(c);
});

// (Catch-all route removed to allow other app-level routes like /login to work)

export default userRoutes;
