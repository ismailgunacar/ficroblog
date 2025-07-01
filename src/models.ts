import { Schema, model } from "mongoose";
import type { Document } from "mongoose";

export interface IUser extends Document {
  username: string;
  displayName: string;
  passwordHash: string;
  bio?: string;
  avatarUrl?: string;
  headerUrl?: string;
}

const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  passwordHash: { type: String, required: true },
  bio: { type: String, required: false, default: "" },
  avatarUrl: { type: String, required: false, default: "" },
  headerUrl: { type: String, required: false, default: "" },
});

export const User = model<IUser>("User", UserSchema);

export interface IPost extends Document {
  content: string;
  createdAt: Date;
  author: string; // username or actor URL for remote posts
  remote?: boolean; // whether this is a remote post
  objectId?: string; // ActivityPub object ID for remote posts
}

const PostSchema = new Schema<IPost>({
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  author: { type: String, required: true },
  remote: { type: Boolean, default: false },
  objectId: { type: String },
});

export const Post = model<IPost>("Post", PostSchema);

export interface IFollow extends Document {
  following: string; // actor URI being followed
  follower: string; // actor URI of the follower
  createdAt: Date;
}

const FollowSchema = new Schema<IFollow>({
  following: { type: String, required: true },
  follower: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

FollowSchema.index({ following: 1, follower: 1 }, { unique: true });

export const Follow = model<IFollow>("Follow", FollowSchema);

export interface IFollowing extends Document {
  follower: string; // actor URI of the follower (our user)
  following: string; // actor URI being followed
  createdAt: Date;
  accepted?: boolean; // whether the follow was accepted
  acceptedAt?: Date; // when the follow was accepted
}

const FollowingSchema = new Schema<IFollowing>({
  follower: { type: String, required: true },
  following: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  accepted: { type: Boolean, default: false },
  acceptedAt: { type: Date },
});

FollowingSchema.index({ follower: 1, following: 1 }, { unique: true });

export const Following = model<IFollowing>("Following", FollowingSchema);

export interface IKey extends Document {
  user_id: number;
  type: "RSASSA-PKCS1-v1_5" | "Ed25519";
  private_key: string; // JWK format
  public_key: string; // JWK format
  created: Date;
}

const KeySchema = new Schema<IKey>({
  user_id: { type: Number, required: true },
  type: {
    type: String,
    required: true,
    enum: ["RSASSA-PKCS1-v1_5", "Ed25519"],
  },
  private_key: { type: String, required: true },
  public_key: { type: String, required: true },
  created: { type: Date, default: Date.now },
});

KeySchema.index({ user_id: 1, type: 1 }, { unique: true });

export const Key = model<IKey>("Key", KeySchema);
