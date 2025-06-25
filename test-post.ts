// Test script to create a post and check federation
import { connectToDatabase, getUsersCollection, getActorsCollection, getPostsCollection } from './src/db.ts';
import { getNextSequence } from './src/utils.ts';

async function testPostCreation() {
  try {
    await connectToDatabase();
    
    const usersCollection = getUsersCollection();
    const actorsCollection = getActorsCollection();
    const postsCollection = getPostsCollection();
    
    // Get the user
    const user = await usersCollection.findOne({ username: 'ismail' });
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    // Get the actor
    const actor = await actorsCollection.findOne({ user_id: user.id });
    if (!actor) {
      console.log('❌ Actor not found');
      return;
    }
    
    console.log('✅ User found:', user.username);
    console.log('✅ Actor found:', actor.handle);
    
    // Check recent posts
    const recentPosts = await postsCollection.find({ actor_id: actor.id })
      .sort({ created: -1 })
      .limit(3)
      .toArray();
    
    console.log(`📝 Recent posts (${recentPosts.length}):`);
    for (const post of recentPosts) {
      console.log(`  - ${post.id}: "${post.content.substring(0, 50)}..." (${post.created})`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testPostCreation();
