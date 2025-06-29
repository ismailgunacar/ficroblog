import { MongoClient, ObjectId } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

const OLD_MONGODB_URI = process.env.OLDMONGODB_URI;
const NEW_MONGODB_URI = process.env.MONGODB_URI;

if (!OLD_MONGODB_URI) {
  throw new Error('OLDMONGODB_URI is not set in environment variables');
}

if (!NEW_MONGODB_URI) {
  throw new Error('MONGODB_URI is not set in environment variables');
}

async function migratePosts() {
  console.log('Starting post migration...');
  
  const oldClient = new MongoClient(OLD_MONGODB_URI);
  const newClient = new MongoClient(NEW_MONGODB_URI);
  
  try {
    // Connect to both databases
    await oldClient.connect();
    await newClient.connect();
    
    console.log('Connected to both databases');
    
    const oldDb = oldClient.db();
    const newDb = newClient.db();
    
    // Get collections
    const oldPosts = oldDb.collection('posts');
    const newPosts = newDb.collection('posts');
    const newUsers = newDb.collection('users');
    
    // Get the user from the new database
    const user = await newUsers.findOne({});
    if (!user) {
      throw new Error('No user found in new database. Please set up a user first.');
    }
    
    console.log(`Found user: ${user.username} (${user._id})`);
    
    // Get all posts from old database
    const oldPostsData = await oldPosts.find({}).toArray();
    console.log(`Found ${oldPostsData.length} posts in old database`);
    
    // Debug: Show structure of first few posts
    console.log('\n=== DEBUG: First 3 posts structure ===');
    for (let i = 0; i < Math.min(3, oldPostsData.length); i++) {
      console.log(`Post ${i + 1}:`, JSON.stringify(oldPostsData[i], null, 2));
    }
    console.log('=== END DEBUG ===\n');
    
    if (oldPostsData.length === 0) {
      console.log('No posts to migrate');
      return;
    }
    
    // Transform and insert posts
    let migratedCount = 0;
    let skippedCount = 0;
    
    for (const oldPost of oldPostsData) {
      try {
        // Check if post already exists (by content and user)
        const existingPost = await newPosts.findOne({
          content: oldPost.content,
          userId: user._id
        });
        
        if (existingPost) {
          console.log(`Skipping duplicate post: "${oldPost.content.substring(0, 50)}..."`);
          skippedCount++;
          continue;
        }
        
        // Transform the old post to new format
        const newPost = {
          userId: user._id,
          content: oldPost.content || oldPost.text || oldPost.message || 'Migrated post',
          createdAt: oldPost.createdAt || oldPost.timestamp || oldPost.date || new Date(),
          // Add any other fields you want to preserve
          ...(oldPost.updatedAt && { updatedAt: oldPost.updatedAt }),
          ...(oldPost._id && { oldId: oldPost._id.toString() }) // Keep reference to old ID
        };
        
        // Insert into new database
        await newPosts.insertOne(newPost);
        migratedCount++;
        
        console.log(`Migrated post: "${newPost.content.substring(0, 50)}..."`);
        
      } catch (error) {
        console.error(`Error migrating post:`, error);
        console.error('Post data:', oldPost);
      }
    }
    
    console.log('\nMigration completed!');
    console.log(`✅ Migrated: ${migratedCount} posts`);
    console.log(`⏭️  Skipped: ${skippedCount} posts (duplicates)`);
    console.log(`📊 Total processed: ${oldPostsData.length} posts`);
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await oldClient.close();
    await newClient.close();
    console.log('Database connections closed');
  }
}

// Run the migration
migratePosts().catch(console.error); 