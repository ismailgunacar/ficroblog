import { ObjectId } from 'mongodb';

export interface Announce {
  _id?: ObjectId;
  actorId: string; // The actor who announced/boosted (full ActivityPub actor URL)
  objectId: string; // The post/note being announced (full ActivityPub object URL)
  activityId: string; // The Announce activity ID
  createdAt: Date;
  // Optional: store actor info for display
  actorUsername?: string;
  actorDisplayName?: string;
  actorAvatar?: string;
}
