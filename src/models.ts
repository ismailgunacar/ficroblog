import type { ObjectId } from "mongodb";
import { getDb } from "./db.js";

export interface User {
  _id?: ObjectId;
  username: string;
  name?: string;
  password?: string;
}

export interface Post {
  _id?: ObjectId;
  username: string;
  content: string;
  createdAt: Date;
}

export async function createUser(
  username: string,
  name?: string,
  password?: string,
) {
  const db = await getDb();
  const user = { username, name, password };
  await db.collection("users").insertOne(user);
  return user;
}

export async function getUser(username: string): Promise<User | null> {
  const db = await getDb();
  return (await db.collection("users").findOne({ username })) as User | null;
}

export async function verifyUser(
  username: string,
  password: string,
): Promise<User | null> {
  const db = await getDb();
  return (await db
    .collection("users")
    .findOne({ username, password })) as User | null;
}

export async function followUser(follower: string, following: string) {
  const db = await getDb();
  await db
    .collection("follows")
    .updateOne(
      { follower, following },
      { $set: { follower, following } },
      { upsert: true },
    );
}

export async function getFollowing(username: string): Promise<string[]> {
  const db = await getDb();
  const docs = await db
    .collection("follows")
    .find({ follower: username })
    .toArray();
  return docs.map((doc: unknown) => (doc as { following: string }).following);
}

export async function getFollowers(username: string): Promise<string[]> {
  const db = await getDb();
  const docs = await db
    .collection("follows")
    .find({ following: username })
    .toArray();
  return docs.map((doc: unknown) => (doc as { follower: string }).follower);
}

export async function createPost(
  username: string,
  content: string,
): Promise<Post> {
  const db = await getDb();
  const post: Post = {
    username,
    content,
    createdAt: new Date(),
  };
  await db.collection("posts").insertOne(post);
  return post;
}

export async function getPostsByUser(username: string): Promise<Post[]> {
  const db = await getDb();
  const posts = await db
    .collection("posts")
    .find({ username })
    .sort({ createdAt: -1 })
    .toArray();
  return posts as Post[];
}

export async function getPostsFromFollowedUsers(
  username: string,
): Promise<Post[]> {
  const db = await getDb();
  const following = await getFollowing(username);
  if (following.length === 0) return [];

  const posts = await db
    .collection("posts")
    .find({ username: { $in: following } })
    .sort({ createdAt: -1 })
    .toArray();
  return posts as Post[];
}
