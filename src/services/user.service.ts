import { MongoClient, ObjectId } from 'mongodb';
import type { User } from '../models';
import { hashPassword } from '../auth';

export class UserService {
  constructor(private client: MongoClient) {}

  async findById(id: string | ObjectId): Promise<User | null> {
    await this.client.connect();
    const db = this.client.db();
    const objectId = typeof id === 'string' ? new ObjectId(id) : id;
    return await db.collection<User>('users').findOne({ _id: objectId });
  }

  async findByUsername(username: string): Promise<User | null> {
    await this.client.connect();
    const db = this.client.db();
    return await db.collection<User>('users').findOne({ username });
  }

  async getFirstUser(): Promise<User | null> {
    await this.client.connect();
    const db = this.client.db();
    return await db.collection<User>('users').findOne();
  }

  async createUser(userData: {
    name: string;
    username: string;
    password: string;
    bio?: string;
    avatarUrl?: string;
    headerUrl?: string;
  }): Promise<User> {
    await this.client.connect();
    const db = this.client.db();
    
    const passwordHash = await hashPassword(userData.password);
    
    const user: User = {
      _id: new ObjectId(),
      name: userData.name,
      username: userData.username,
      passwordHash,
      bio: userData.bio || '',
      avatarUrl: userData.avatarUrl || '',
      headerUrl: userData.headerUrl || '',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('users').insertOne(user);
    return user;
  }

  async updateUser(userId: ObjectId, updates: {
    name?: string;
    username?: string;
    bio?: string;
    avatarUrl?: string;
    headerUrl?: string;
  }): Promise<boolean> {
    await this.client.connect();
    const db = this.client.db();
    
    const result = await db.collection('users').updateOne(
      { _id: userId },
      { 
        $set: { 
          ...updates, 
          updatedAt: new Date() 
        } 
      }
    );

    return result.modifiedCount > 0;
  }

  async getUserStats(userId: ObjectId): Promise<{
    postCount: number;
    followerCount: number;
    followingCount: number;
  }> {
    await this.client.connect();
    const db = this.client.db();
    
    const [postCount, followerCount, followingCount] = await Promise.all([
      db.collection('posts').countDocuments({ userId }),
      db.collection('follows').countDocuments({ followingId: userId }),
      db.collection('follows').countDocuments({ followerId: userId })
    ]);

    return { postCount, followerCount, followingCount };
  }

  async getAllUsers(): Promise<User[]> {
    await this.client.connect();
    const db = this.client.db();
    return await db.collection<User>('users').find().toArray();
  }

  async getUserMap(): Promise<Map<string, User>> {
    const users = await this.getAllUsers();
    return new Map(users.map(u => [u._id.toString(), u]));
  }
}