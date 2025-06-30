import type { ObjectId } from 'mongodb';

export interface User {
  _id?: ObjectId;
  username: string;
  name: string;
  passwordHash: string;
  bio?: string;
  avatarUrl?: string;
  headerUrl?: string;
  createdAt: Date;
  publicKey?: string;   // PEM-encoded public key
  privateKey?: string;  // PEM-encoded private key (keep this secret!)
}

export interface Post {
  _id?: ObjectId;
  userId: ObjectId | string;
  content: string;
  createdAt: Date;
  replyTo?: ObjectId;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  remote?: boolean;  // Whether this is a remote post
  remotePostId?: string; // Original post ID from remote server
  remoteActor?: string;  // Actor URL from remote server
  federated?: boolean;   // Whether this post has been federated
  federatedFrom?: string; // Where this post was federated from
}

export interface Follow {
  _id?: ObjectId;
  followerId: string;
  followingId: string;
  followingUrl?: string;  // For remote follows
  followingInbox?: string; // For remote follows
  remote?: boolean;       // Whether this is a remote follow
  createdAt: Date;
}
