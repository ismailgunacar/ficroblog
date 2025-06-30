import { MongoClient, ObjectId } from 'mongodb';
import type { Post, User } from '../models';

export class PostService {
  constructor(private client: MongoClient) {}

  async createPost(userId: ObjectId, content: string): Promise<Post> {
    await this.client.connect();
    const db = this.client.db();
    
    const post: Post = {
      _id: new ObjectId(),
      userId,
      content: content.trim(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('posts').insertOne(post);
    return post;
  }

  async findById(postId: string | ObjectId): Promise<Post | null> {
    await this.client.connect();
    const db = this.client.db();
    const objectId = typeof postId === 'string' ? new ObjectId(postId) : postId;
    return await db.collection<Post>('posts').findOne({ _id: objectId });
  }

  async getTimelinePosts(limit: number = 50): Promise<Post[]> {
    await this.client.connect();
    const db = this.client.db();
    
    return await db.collection<Post>('posts')
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  async getUserPosts(userId: ObjectId, limit: number = 50): Promise<Post[]> {
    await this.client.connect();
    const db = this.client.db();
    
    return await db.collection<Post>('posts')
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  async deletePost(postId: ObjectId, userId: ObjectId): Promise<boolean> {
    await this.client.connect();
    const db = this.client.db();
    
    const result = await db.collection('posts').deleteOne({ 
      _id: postId, 
      userId 
    });

    return result.deletedCount > 0;
  }

  async toggleLike(postId: ObjectId, userId: ObjectId): Promise<{
    liked: boolean;
    likeCount: number;
  }> {
    await this.client.connect();
    const db = this.client.db();
    
    const existingLike = await db.collection('likes').findOne({
      postId,
      userId
    });

    if (existingLike) {
      // Remove like
      await db.collection('likes').deleteOne({ _id: existingLike._id });
    } else {
      // Add like
      await db.collection('likes').insertOne({
        _id: new ObjectId(),
        postId,
        userId,
        createdAt: new Date()
      });
    }

    const likeCount = await db.collection('likes').countDocuments({ postId });
    
    return {
      liked: !existingLike,
      likeCount
    };
  }

  async toggleRepost(postId: ObjectId, userId: ObjectId): Promise<{
    reposted: boolean;
    repostCount: number;
  }> {
    await this.client.connect();
    const db = this.client.db();
    
    const existingRepost = await db.collection('reposts').findOne({
      postId,
      userId
    });

    if (existingRepost) {
      // Remove repost
      await db.collection('reposts').deleteOne({ _id: existingRepost._id });
    } else {
      // Add repost
      await db.collection('reposts').insertOne({
        _id: new ObjectId(),
        postId,
        userId,
        createdAt: new Date()
      });
    }

    const repostCount = await db.collection('reposts').countDocuments({ postId });
    
    return {
      reposted: !existingRepost,
      repostCount
    };
  }

  async getPostStats(postId: ObjectId): Promise<{
    likeCount: number;
    repostCount: number;
    replyCount: number;
  }> {
    await this.client.connect();
    const db = this.client.db();
    
    const [likeCount, repostCount, replyCount] = await Promise.all([
      db.collection('likes').countDocuments({ postId }),
      db.collection('reposts').countDocuments({ postId }),
      db.collection('posts').countDocuments({ replyTo: postId })
    ]);

    return { likeCount, repostCount, replyCount };
  }
}