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
}

export interface Post {
  _id?: ObjectId;
  userId: ObjectId | string;
  content: string;
  createdAt: Date;
}

export interface Follow {
  _id?: ObjectId;
  followerId: string;
  followingId: string;
  createdAt: Date;
}
