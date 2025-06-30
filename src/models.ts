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
}

export interface Follow {
  _id?: ObjectId;
  followerId: string;
  followingId: string;
  createdAt: Date;
}

export interface Key {
  _id?: ObjectId;
  user_id: ObjectId;
  type: 'RSASSA-PKCS1-v1_5' | 'Ed25519';
  private_key: string; // JSON stringified JWK
  public_key: string;  // JSON stringified JWK
  created: string;
}
