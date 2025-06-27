// src/controllers/user.tsx
// Shared handler functions for Mastodon-style user and post routes
import { getUsersCollection, getActorsCollection, getPostsCollection, getFollowsCollection, getLikesCollection, getRepostsCollection, connectToDatabase } from "../db";
import { getCurrentUser } from "../auth";
import { Layout, Profile, PostList, PostPage } from "../views";
import type { Actor, Post, User } from "../schema";

// --- Shared handler for profile page ---
export async function handleProfilePage(c: any, username: string) {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();
  const likesCollection = getLikesCollection();
  const repostsCollection = getRepostsCollection();

  // Always fetch the single user (id: 1)
  const user = await usersCollection.findOne({ id: 1 });
  if (!user) return c.notFound();
  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();
  // Attach canonical username to actor for pretty URLs
  const actorWithUsername = { ...actor, username: user.username };
  const userWithActor = { ...user, ...actorWithUsername };
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
  const postsWithActor = posts.map((post: any) => ({
    ...post,
    uri: actorWithUsername.uri,
    handle: actorWithUsername.handle,
    name: actorWithUsername.name,
    user_id: actorWithUsername.user_id,
    inbox_url: actorWithUsername.inbox_url,
    shared_inbox_url: actorWithUsername.shared_inbox_url,
    url: actorWithUsername.url || post.url,
    username: user.username, // Ensure username is present on post actor
  }));

  // Remove _id from userWithActor for type compatibility
  const userWithActorClean = { ...userWithActor };
  // Only show root posts (not replies) at the top level
  const rootPosts = postsWithActor.filter((post: any) => !("reply_to" in post) || !post.reply_to);

  return c.html(
    <Layout user={userWithActor as User & Actor} isAuthenticated={isAuthenticated}>
      <Profile
        name={actorWithUsername.name ?? user.username}
        username={user.username}
        handle={actorWithUsername.handle}
        bio={actorWithUsername.summary}
        following={followingCount}
        followers={followersCount}
      />
      <PostList posts={rootPosts as (Post & Actor)[]} isAuthenticated={isAuthenticated} />
    </Layout>
  );
}

// --- Shared handler for post page ---
export async function handlePostPage(c: any, username: string, postId: number) {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();

  // Always fetch the single user (id: 1)
  const user = await usersCollection.findOne({ id: 1 });
  if (!user) return c.notFound();
  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();
  const actorWithUsername = { ...actor, username: user.username };
  const post = await postsCollection.findOne({ id: postId, actor_id: actor.id });
  if (!post) return c.notFound();
  const followersCount = await followsCollection.countDocuments({ following_id: actor.id });
  const followingCount = await followsCollection.countDocuments({ follower_id: actor.id });
  const currentUserSession = getCurrentUser(c);
  const isAuthenticated = !!currentUserSession;
  let currentActorId: number | undefined = undefined;
  if (currentUserSession && currentUserSession.username) {
    const currentUserDb = await usersCollection.findOne({ username: currentUserSession.username });
    if (currentUserDb) {
      const currentActor = await actorsCollection.findOne({ user_id: currentUserDb.id });
      if (currentActor) currentActorId = currentActor.id;
    }
  }
  return c.html(
    <Layout user={{ ...user, ...actorWithUsername }} isAuthenticated={isAuthenticated}>
      <PostPage
        post={{ ...post, ...actorWithUsername, username: user.username }}
        isAuthenticated={isAuthenticated}
        followersCount={followersCount}
        followingCount={followingCount}
        currentActorId={currentActorId}
      />
    </Layout>
  );
}

// --- Helper to serve ActivityPub JSON for a post ---
export async function serveActivityPubPost(c: any) {
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

// --- Serve ActivityPub JSON for /users/:username ---
export async function serveActivityPubProfile(c: any) {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const username = c.req.param("username");
  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();
  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();
  // Compose ActivityPub actor JSON
  // (You may want to adjust this to match your federation needs)
  return c.json({
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    id: actor.uri,
    type: 'Person',
    preferredUsername: user.username,
    name: actor.name,
    summary: actor.summary,
    inbox: actor.inbox_url,
    outbox: `${actor.uri}/outbox`,
    followers: `${actor.uri}/followers`,
    following: `${actor.uri}/following`,
    url: actor.url,
    icon: actor.icon,
    publicKey: actor.publicKey,
    // ...add more fields as needed
  });
}
