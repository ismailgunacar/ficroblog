// src/controllers/user.ts
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

  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();
  const actor = await actorsCollection.findOne({ user_id: user.id });
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

  // Remove _id from userWithActor for type compatibility
  const userWithActorClean = { ...userWithActor };
  // Only show root posts (not replies) at the top level
  const rootPosts = postsWithActor.filter(post => !("reply_to" in post) || !post.reply_to);

  return c.html(
    <Layout user={userWithActorClean as User & Actor} isAuthenticated={isAuthenticated}>
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
}

// --- Shared handler for post page ---
export async function handlePostPage(c: any, username: string, postId: number) {
  await connectToDatabase();
  const usersCollection = getUsersCollection();
  const actorsCollection = getActorsCollection();
  const postsCollection = getPostsCollection();
  const followsCollection = getFollowsCollection();

  const user = await usersCollection.findOne({ username });
  if (!user) return c.notFound();
  const actor = await actorsCollection.findOne({ user_id: user.id });
  if (!actor) return c.notFound();
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
  const likesCollection = getLikesCollection();
  const repostsCollection = getRepostsCollection();
  const likes = await likesCollection.find({ post_id: post.id }).toArray();
  const reposts = await repostsCollection.find({ post_id: post.id }).toArray();
  const likeActorIds = likes.map(l => l.actor_id);
  const repostActorIds = reposts.map(r => r.actor_id);
  const like_actors = likeActorIds.length > 0 ? await actorsCollection.find({ id: { $in: likeActorIds } }).toArray() as Actor[] : [];
  const repost_actors = repostActorIds.length > 0 ? await actorsCollection.find({ id: { $in: repostActorIds } }).toArray() as Actor[] : [];
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
  const { _id, ...postWithActorClean } = postWithActor;
  const replies = await postsCollection.aggregate([
    { $match: { reply_to: postId, deleted: { $ne: true } } },
    { $sort: { created: 1 } },
    { $lookup: { from: "actors", localField: "actor_id", foreignField: "id", as: "actor" } },
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
    { $addFields: {
        likesCount: { $size: "$likes" },
        repostsCount: { $size: "$reposts" }
      }
    }
  ]).toArray();
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
  const canonicalUrl = `/users/${username}/posts/${postId}`;
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
