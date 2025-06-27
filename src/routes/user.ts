// src/routes/user.ts
// Mastodon-style user and post route handlers
import { Hono } from "hono";
import { handleProfilePage, handlePostPage, serveActivityPubPost } from "../controllers/user.tsx";

const userRoutes = new Hono();

// Mastodon-style user profile page: /@:username
userRoutes.get("/@:username", async (c) => {
  const username = c.req.param("username")!;
  return handleProfilePage(c, username);
});

// Mastodon-style post page: /@:username/:id
userRoutes.get("/@:username/:id", async (c) => {
  const username = c.req.param("username")!;
  const postId = parseInt(c.req.param("id"));
  return handlePostPage(c, username, postId);
});

// ActivityPub Note JSON: /@:username/:id.json
userRoutes.get("/@:username/:id.json", async (c) => {
  return serveActivityPubPost(c);
});

export default userRoutes;
