import { ObjectId } from "mongodb";

export interface User {
  _id?: ObjectId;
  id: number; // Single user will always have id: 1
  username: string;
  password: string; // Hashed password for authentication
  created?: Date;
}

export interface Actor {
  _id?: ObjectId;
  id: number;
  user_id: number | null;
  uri: string;
  handle: string;
  name: string | null;
  summary?: string; // Bio/description for fediverse compatibility
  inbox_url: string;
  shared_inbox_url: string | null;
  url: string | null;
  created: Date;
}

export interface Key {
  _id?: ObjectId;
  user_id: number;
  type: "RSASSA-PKCS1-v1_5" | "Ed25519";
  private_key: string;
  public_key: string;
  created: Date;
}

export interface Follow {
  _id?: ObjectId;
  following_id: number;
  follower_id: number;
  created: Date;
}

export interface Post {
  _id?: ObjectId;
  id: number;
  uri: string;
  actor_id: number;
  content: string;
  url: string | null;
  created: Date;
  // Optional repost fields
  repost_of?: number; // If this is a repost, the original post ID
  is_repost?: boolean;
  // Optional reply field
  reply_to?: number; // If this is a reply, the parent post ID
}

export interface Like {
  _id?: ObjectId;
  id: number;
  uri: string;
  actor_id: number;
  post_id: number;
  created: Date;
}

export interface Repost {
  _id?: ObjectId;
  id: number;
  uri: string;
  actor_id: number;
  post_id: number;
  created: Date;
}

// Counter for auto-incrementing IDs
export interface Counter {
  _id: string;
  sequence: number;
}
