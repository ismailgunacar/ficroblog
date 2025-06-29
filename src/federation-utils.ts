import { client as mongoClient } from './index';
import { ObjectId } from 'mongodb';

// Utility functions for federation

/**
 * Get federated posts from the database
 */
export async function getFederatedPosts(limit = 20, skip = 0) {
  const db = mongoClient.db('fongoblog2');
  const posts = db.collection('posts');
  const users = db.collection('users');

  const federatedPosts = await posts
    .find({ federated: true })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  // Populate user information
  const postsWithUsers = await Promise.all(
    federatedPosts.map(async (post) => {
      const user = await users.findOne({ _id: post.userId });
      return {
        ...post,
        user: user ? {
          username: user.username,
          name: user.name,
          avatarUrl: user.avatarUrl
        } : null
      };
    })
  );

  return postsWithUsers;
}

/**
 * Get followers for a user
 */
export async function getFollowers(username: string) {
  const db = mongoClient.db('fongoblog2');
  const users = db.collection('users');
  const follows = db.collection('follows');

  const user = await users.findOne({ username });
  if (!user) return [];

  const followers = await follows.find({ following_id: user._id?.toString() }).toArray();
  
  return followers.map(f => ({
    follower_id: f.follower_id,
    createdAt: f.createdAt
  }));
}

/**
 * Get users that a user is following
 */
export async function getFollowing(username: string) {
  const db = mongoClient.db('fongoblog2');
  const users = db.collection('users');
  const follows = db.collection('follows');

  const user = await users.findOne({ username });
  if (!user) return [];

  const following = await follows.find({ follower_id: user._id?.toString() }).toArray();
  
  return following.map(f => ({
    following_id: f.following_id,
    createdAt: f.createdAt
  }));
}

/**
 * Check if a user is following another user
 */
export async function isFollowing(followerUsername: string, followingUsername: string) {
  const db = mongoClient.db('fongoblog2');
  const users = db.collection('users');
  const follows = db.collection('follows');

  const follower = await users.findOne({ username: followerUsername });
  const following = await users.findOne({ username: followingUsername });

  if (!follower || !following) return false;

  const follow = await follows.findOne({
    follower_id: follower._id?.toString(),
    following_id: following._id?.toString()
  });

  return !!follow;
}

/**
 * Create a follow relationship
 */
export async function createFollow(followerUsername: string, followingUsername: string) {
  const db = mongoClient.db('fongoblog2');
  const users = db.collection('users');
  const follows = db.collection('follows');

  const follower = await users.findOne({ username: followerUsername });
  const following = await users.findOne({ username: followingUsername });

  if (!follower || !following) {
    throw new Error('User not found');
  }

  // Check if already following
  const existingFollow = await follows.findOne({
    follower_id: follower._id?.toString(),
    following_id: following._id?.toString()
  });

  if (existingFollow) {
    return existingFollow;
  }

  // Create follow relationship
  const follow = await follows.insertOne({
    follower_id: follower._id?.toString(),
    following_id: following._id?.toString(),
    createdAt: new Date()
  });

  console.log(`Created follow relationship: ${followerUsername} -> ${followingUsername}`);

  return follow;
}

/**
 * Remove a follow relationship
 */
export async function removeFollow(followerUsername: string, followingUsername: string) {
  const db = mongoClient.db('fongoblog2');
  const users = db.collection('users');
  const follows = db.collection('follows');

  const follower = await users.findOne({ username: followerUsername });
  const following = await users.findOne({ username: followingUsername });

  if (!follower || !following) {
    throw new Error('User not found');
  }

  const result = await follows.deleteOne({
    follower_id: follower._id?.toString(),
    following_id: following._id?.toString()
  });

  console.log(`Removed follow relationship: ${followerUsername} -> ${followingUsername}`);

  return result.deletedCount > 0;
}

/**
 * Mark a post as federated and store federation metadata
 */
export async function markPostAsFederated(postId: string, federatedFrom?: string) {
  const db = mongoClient.db('fongoblog2');
  const posts = db.collection('posts');

  await posts.updateOne(
    { _id: new ObjectId(postId) },
    { 
      $set: { 
        federated: true,
        federatedFrom: federatedFrom || null,
        federatedAt: new Date()
      } 
    }
  );

  console.log(`Marked post ${postId} as federated`);
}

/**
 * Get federation statistics
 */
export async function getFederationStats() {
  const db = mongoClient.db('fongoblog2');
  const users = db.collection('users');
  const posts = db.collection('posts');
  const follows = db.collection('follows');

  const totalUsers = await users.countDocuments();
  const totalPosts = await posts.countDocuments();
  const federatedPosts = await posts.countDocuments({ federated: true });
  const totalFollows = await follows.countDocuments();

  return {
    totalUsers,
    totalPosts,
    federatedPosts,
    totalFollows,
    federationPercentage: totalPosts > 0 ? (federatedPosts / totalPosts) * 100 : 0
  };
}

/**
 * Get recent federation activity
 */
export async function getRecentFederationActivity(limit = 10) {
  const db = mongoClient.db('fongoblog2');
  const posts = db.collection('posts');
  const follows = db.collection('follows');

  const recentPosts = await posts
    .find({ federated: true })
    .sort({ federatedAt: -1 })
    .limit(limit)
    .toArray();

  const recentFollows = await follows
    .find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return {
    recentPosts,
    recentFollows
  };
}

/**
 * Sign an HTTP request for federation
 */
export async function signRequest(request: {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}, username: string) {
  console.log('🔍 signRequest called for username:', username);
  
  // Ensure MongoDB connection
  await mongoClient.connect();
  console.log('🔍 MongoDB connected');
  
  const db = mongoClient.db('fongoblog2');
  const users = db.collection('users');
  
  console.log('🔍 Looking for user in database...');
  const user = await users.findOne({ username });
  console.log('🔍 User found:', user ? 'Yes' : 'No');
  
  if (!user) {
    console.log('❌ User not found in database. Available users:');
    const allUsers = await users.find({}).toArray();
    console.log('All users:', allUsers.map(u => ({ username: u.username, _id: u._id })));
    throw new Error('User not found');
  }
  
  // For now, return the request as-is since we don't have proper key signing implemented
  // In a real implementation, you would use the user's private key to sign the request
  console.log('🔐 Signing request for user:', username);
  
  // If user has no private key, just return the request without signing
  if (!user.privateKey || user.privateKey === 'placeholder-private-key') {
    console.log('⚠️ User has no private key, sending unsigned request');
    return {
      method: request.method,
      url: request.url,
      body: request.body,
      headers: {
        ...request.headers,
        'User-Agent': 'fongoblog2/1.0.0',
        'Date': new Date().toUTCString()
      }
    };
  }
  
  // TODO: Implement proper HTTP signature signing here
  // For now, return the request as-is
  return {
    method: request.method,
    url: request.url,
    body: request.body,
    headers: {
      ...request.headers,
      'User-Agent': 'fongoblog2/1.0.0',
      'Date': new Date().toUTCString()
    }
  };
} 