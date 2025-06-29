import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is not set in environment variables');
}

async function debugPosts() {
  console.log('Debugging current posts...');
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to database');
    
    const db = client.db();
    const posts = db.collection('posts');
    
    // Get all posts
    const allPosts = await posts.find({}).sort({ createdAt: -1 }).limit(10).toArray();
    console.log(`Found ${allPosts.length} posts in database`);
    
    // Show structure of posts
    console.log('\n=== DEBUG: Current posts structure ===');
    for (let i = 0; i < allPosts.length; i++) {
      const post = allPosts[i];
      console.log(`Post ${i + 1}:`);
      console.log(`  ID: ${post._id}`);
      console.log(`  Content: ${post.content?.substring(0, 50)}...`);
      console.log(`  Created At: ${post.createdAt}`);
      console.log(`  Created At Type: ${typeof post.createdAt}`);
      console.log(`  All fields: ${Object.keys(post).join(', ')}`);
      console.log('');
    }
    console.log('=== END DEBUG ===\n');
    
  } catch (error) {
    console.error('Debug failed:', error);
  } finally {
    await client.close();
    console.log('Database connection closed');
  }
}

// Run the debug
debugPosts().catch(console.error); 