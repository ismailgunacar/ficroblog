// Database initialization script for MongoDB
// Run this to ensure all required collections and indexes exist

import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

async function initDatabase() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not set in environment variables');
  }

  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    
    // Create collections if they don't exist
    const collections = ['users', 'posts', 'follows', 'keys', 'fedify_kv'];
    
    for (const collectionName of collections) {
      try {
        await db.createCollection(collectionName);
        console.log(`Created collection: ${collectionName}`);
      } catch (error) {
        if (error.code === 48) {
          console.log(`Collection ${collectionName} already exists`);
        } else {
          console.error(`Error creating collection ${collectionName}:`, error.message);
        }
      }
    }
    
    // Create indexes
    try {
      // User indexes
      await db.collection('users').createIndex({ username: 1 }, { unique: true });
      console.log('Created unique index on users.username');
      
      // Keys indexes
      await db.collection('keys').createIndex({ user_id: 1, type: 1 }, { unique: true });
      console.log('Created compound index on keys.user_id and keys.type');
      
      // Follows indexes
      await db.collection('follows').createIndex({ followerId: 1, followingId: 1 }, { unique: true });
      console.log('Created compound index on follows');
      
      // Posts indexes
      await db.collection('posts').createIndex({ createdAt: -1 });
      await db.collection('posts').createIndex({ userId: 1, createdAt: -1 });
      console.log('Created indexes on posts');
      
      // Fedify KV indexes
      await db.collection('fedify_kv').createIndex({ key: 1 }, { unique: true });
      console.log('Created index on fedify_kv.key');
      
    } catch (error) {
      console.error('Error creating indexes:', error.message);
    }
    
    console.log('Database initialization completed successfully');
    
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initDatabase().catch(console.error);
}

export { initDatabase };