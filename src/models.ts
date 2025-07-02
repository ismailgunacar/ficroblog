import { type Document, Schema, model } from "mongoose";

export interface IUser extends Document {
  username: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  headerUrl?: string;
  passwordHash: string;
}

const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  bio: { type: String },
  avatarUrl: { type: String },
  headerUrl: { type: String },
  passwordHash: { type: String, required: true },
});

export const User = model<IUser>("User", UserSchema);

export interface IPost extends Document {
  content: string;
  createdAt: Date;
  author: string; // username or actor URL for remote posts
  remote?: boolean; // whether this is a remote post
  objectId?: string; // ActivityPub object ID for remote posts
  replyTo?: string; // parent post ID for threading
  // Remote author info (for remote posts)
  remoteAuthorName?: string;
  remoteAuthorAvatar?: string;
  remoteAuthorUrl?: string;
}

const PostSchema = new Schema<IPost>({
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  author: { type: String, required: true },
  remote: { type: Boolean, default: false },
  objectId: { type: String },
  replyTo: { type: String, required: false },
  // Remote author info
  remoteAuthorName: { type: String },
  remoteAuthorAvatar: { type: String },
  remoteAuthorUrl: { type: String },
});

export const Post = model<IPost>("Post", PostSchema);

export interface IFollow extends Document {
  follower: string; // actor URL
  following: string; // actor URL
  createdAt: Date;
}

const FollowSchema = new Schema<IFollow>({
  follower: { type: String, required: true },
  following: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const Follow = model<IFollow>("Follow", FollowSchema);

export interface IFollowing extends Document {
  follower: string; // actor URL
  following: string; // actor URL
  accepted: boolean;
  acceptedAt?: Date;
  createdAt: Date;
}

const FollowingSchema = new Schema<IFollowing>({
  follower: { type: String, required: true },
  following: { type: String, required: true },
  accepted: { type: Boolean, default: false },
  acceptedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

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

export interface ILike extends Document {
  actor: string; // actor URL who liked
  object: string; // post ID that was liked
  createdAt: Date;
}

const LikeSchema = new Schema<ILike>({
  actor: { type: String, required: true },
  object: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Ensure unique likes per actor per post
LikeSchema.index({ actor: 1, object: 1 }, { unique: true });

export const Like = model<ILike>("Like", LikeSchema);

export interface IAnnounce extends Document {
  actor: string; // actor URL who announced
  object: string; // post ID that was announced
  createdAt: Date;
}

const AnnounceSchema = new Schema<IAnnounce>({
  actor: { type: String, required: true },
  object: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Ensure unique announces per actor per post
AnnounceSchema.index({ actor: 1, object: 1 }, { unique: true });

export const Announce = model<IAnnounce>("Announce", AnnounceSchema);
