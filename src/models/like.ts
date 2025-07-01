import { ObjectId } from 'mongodb';

export interface Like {
  _id?: ObjectId;
  actorId: string; // The actor who liked (full ActivityPub actor URL)
  objectId: string; // The post/note being liked (full ActivityPub object URL)
  activityId: string; // The Like activity ID
  createdAt: Date;
  // Optional: store actor info for display
  actorUsername?: string;
  actorDisplayName?: string;
  actorAvatar?: string;
}
