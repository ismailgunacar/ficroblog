import { client as mongoClient } from './index';
import { ObjectId } from 'mongodb';
import type { MongoClient } from 'mongodb';
import type { User, Follow } from './models';
import { getUserKeys } from './keys';

// Utility functions for federation

/**
 * Get federated posts from the database
 */
export async function getFederatedPosts(limit = 20, skip = 0) {
  const db = mongoClient.db();
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
  const db = mongoClient.db();
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
  const db = mongoClient.db();
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
  const db = mongoClient.db();
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
  const db = mongoClient.db();
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
  const db = mongoClient.db();
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
  const db = mongoClient.db();
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
  const db = mongoClient.db();
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
  const db = mongoClient.db();
  const posts = db.collection('posts');
  const follows = db.collection('follows');

  const recentPosts = await posts
    .find({ federated: true })
    .sort({ federatedAt: -1 })
    .limit(limit)
    .toArray();

  const recentFollows = await follows
    .find({ remote: true })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return {
    posts: recentPosts,
    follows: recentFollows
  };
}

// Helper function to extract database name from MongoDB URI
function getDatabaseNameFromUri(uri: string): string {
  try {
    const url = new URL(uri);
    // Remove leading slash and get database name
    const dbName = url.pathname.substring(1);
    return dbName || 'fongoblog2'; // fallback to default if no database specified
  } catch (error) {
    console.warn('Could not parse MongoDB URI, using default database name');
    return 'fongoblog2';
  }
}

export async function getRemoteUserInfo(username: string, domain: string): Promise<any> {
  const db = mongoClient.db();
  const users = db.collection('users');
  
  // First check if we already have this remote user cached
  const cachedUser = await users.findOne({ 
    username: `${username}@${domain}`,
    remote: true 
  });
  
  if (cachedUser) {
    console.log(`📋 Found cached remote user: ${username}@${domain}`);
    return cachedUser;
  }

  // If not cached, fetch from remote server
  console.log(`🌐 Fetching remote user info for ${username}@${domain}`);
  
  try {
    // Try to fetch the actor profile
    const actorUrl = `https://${domain}/users/${username}`;
    console.log(`🔗 Fetching actor from: ${actorUrl}`);
    
    const response = await fetch(actorUrl, {
      headers: {
        'Accept': 'application/activity+json'
      }
    });

    if (!response.ok) {
      console.log(`❌ Failed to fetch actor: ${response.status} ${response.statusText}`);
      return null;
    }

    const actor = await response.json();
    console.log(`✅ Fetched actor data:`, actor);

    // Extract user info from actor
    const remoteUser = {
      _id: new ObjectId(),
      username: `${username}@${domain}`,
      name: actor.name || username,
      bio: actor.summary || '',
      avatarUrl: actor.icon?.url || '',
      headerUrl: actor.image?.url || '',
      remote: true,
      remoteDomain: domain,
      remoteUsername: username,
      remoteActorUrl: actor.id,
      remoteInboxUrl: actor.inbox,
      remoteOutboxUrl: actor.outbox,
      createdAt: new Date()
    };

    // Cache the remote user
    await users.insertOne(remoteUser);
    console.log(`💾 Cached remote user: ${username}@${domain}`);

    return remoteUser;
  } catch (error) {
    console.error(`❌ Error fetching remote user ${username}@${domain}:`, error);
    return null;
  }
}

export async function createRemoteFollow(followerId: string, followingUsername: string, followingDomain: string): Promise<boolean> {
  const db = mongoClient.db();
  const follows = db.collection('follows');
  const users = db.collection('users');

  console.log(`🔗 Creating remote follow: ${followerId} -> ${followingUsername}@${followingDomain}`);

  // Get the remote user info
  const remoteUser = await getRemoteUserInfo(followingUsername, followingDomain);
  if (!remoteUser) {
    console.log(`❌ Could not get remote user info for ${followingUsername}@${followingDomain}`);
    return false;
  }

  // Check if already following
  const existingFollow = await follows.findOne({
    follower_id: followerId,
    following_id: remoteUser._id.toString(),
    remote: true
  });

  if (existingFollow) {
    console.log(`⚠️ Already following ${followingUsername}@${followingDomain}`);
    return false;
  }

  // Create the follow relationship
  const follow = {
    _id: new ObjectId(),
    follower_id: followerId,
    following_id: remoteUser._id.toString(),
    remote: true,
    remoteDomain: followingDomain,
    remoteUsername: followingUsername,
    followingUrl: remoteUser.remoteActorUrl,
    followingInboxUrl: remoteUser.remoteInboxUrl,
    createdAt: new Date()
  };

  try {
    await follows.insertOne(follow);
    console.log(`✅ Created remote follow: ${followerId} -> ${followingUsername}@${followingDomain}`);
    return true;
  } catch (error) {
    console.error(`❌ Error creating remote follow:`, error);
    return false;
  }
}

export async function removeRemoteFollow(followerId: string, followingUsername: string, followingDomain: string): Promise<boolean> {
  const db = mongoClient.db();
  const follows = db.collection('follows');
  const users = db.collection('users');

  console.log(`🗑️ Removing remote follow: ${followerId} -> ${followingUsername}@${followingDomain}`);

  // Find the remote user
  const remoteUser = await users.findOne({
    username: `${followingUsername}@${followingDomain}`,
    remote: true
  });

  if (!remoteUser) {
    console.log(`❌ Remote user not found: ${followingUsername}@${followingDomain}`);
    return false;
  }

  // Remove the follow relationship
  const result = await follows.deleteOne({
    follower_id: followerId,
    following_id: remoteUser._id.toString(),
    remote: true
  });

  if (result.deletedCount > 0) {
    console.log(`✅ Removed remote follow: ${followerId} -> ${followingUsername}@${followingDomain}`);
    return true;
  } else {
    console.log(`⚠️ No follow relationship found to remove`);
    return false;
  }
}

export async function signRequest(url: string, method: string, body?: string, userId?: string): Promise<Response> {
  const db = mongoClient.db();
  const users = db.collection('users');

  console.log(`🔐 Signing request: ${method} ${url}`);
  console.log(`👤 User ID: ${userId}`);

  if (!userId) {
    console.log(`❌ No user ID provided for signing`);
    // Send unsigned request
    return fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/activity+json',
        'Accept': 'application/activity+json'
      },
      body,
      duplex: 'half'
    });
  }

  try {
    // Get user and ensure they have keys
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      console.log(`❌ User not found: ${userId}`);
      throw new Error('User not found');
    }

    console.log(`✅ User found: ${user.username}`);
    
    // Get user's keys, generating if missing
    const { privateKey, publicKey } = await getUserKeys(userId);
    console.log(`✅ User has keys, signing request...`);

    // Create the signature
    const date = new Date().toUTCString();
    const digest = body ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)) : null;
    const digestHeader = digest ? `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(digest)))}` : '';

    // Create the signature string
    const signatureParts = [
      `(request-target): ${method.toLowerCase()} ${new URL(url).pathname}`,
      `host: ${new URL(url).host}`,
      `date: ${date}`
    ];

    if (digestHeader) {
      signatureParts.push(`digest: ${digestHeader}`);
    }

    const signatureString = signatureParts.join('\n');

    // Sign the signature string
    const privateKeyBuffer = new Uint8Array(Buffer.from(privateKey, 'utf8'));
    const key = await crypto.subtle.importKey(
      'pkcs8',
      privateKeyBuffer,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256'
      },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signatureString));
    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

    // Create the Authorization header
    const keyId = `https://gunac.ar/users/${user.username}#main-key`;
    const headers = signatureParts.map(part => part.split(': ')[0]).join(' ');
    
    const authorization = `Signature keyId="${keyId}",algorithm="rsa-sha256",headers="${headers}",signature="${signatureB64}"`;

    console.log(`✅ Request signed successfully`);

    // Send the signed request
    return fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/activity+json',
        'Accept': 'application/activity+json',
        'Date': date,
        'Authorization': authorization,
        ...(digestHeader && { 'Digest': digestHeader })
      },
      body,
      duplex: 'half'
    });
  } catch (error) {
    console.error(`❌ Error signing request:`, error);
    // Send unsigned request as fallback
    return fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/activity+json',
        'Accept': 'application/activity+json'
      },
      body,
      duplex: 'half'
    });
  }
}

export async function sendFollowActivity(followerId: string, followingUsername: string, followingDomain: string): Promise<boolean> {
  const db = mongoClient.db();
  const users = db.collection('users');
  const follows = db.collection('follows');

  console.log(`📤 Sending follow activity: ${followerId} -> ${followingUsername}@${followingDomain}`);

  // Get the follower user
  const follower = await users.findOne({ _id: new ObjectId(followerId) });
  if (!follower) {
    console.log(`❌ Follower not found: ${followerId}`);
    return false;
  }

  // Get the follow relationship
  const follow = await follows.findOne({
    follower_id: followerId,
    remote: true,
    remoteDomain: followingDomain,
    remoteUsername: followingUsername
  });

  if (!follow) {
    console.log(`❌ Follow relationship not found`);
    return false;
  }

  // Create the Follow activity
  const followActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": `https://gunac.ar/follows/${follow._id}`,
    "type": "Follow",
    "actor": `https://gunac.ar/users/${follower.username}`,
    "object": `https://${followingDomain}/users/${followingUsername}`,
    "to": [`https://${followingDomain}/users/${followingUsername}`]
  };

  console.log(`📝 Follow activity:`, followActivity);

  try {
    // Send the follow activity to the remote user's inbox
    const response = await signRequest(
      follow.followingInboxUrl,
      'POST',
      JSON.stringify(followActivity),
      followerId
    );

    console.log(`📤 Follow activity response: ${response.status} ${response.statusText}`);

    if (response.ok) {
      console.log(`✅ Follow activity sent successfully`);
      return true;
    } else {
      const errorText = await response.text();
      console.log(`❌ Follow activity failed: ${errorText}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error sending follow activity:`, error);
    return false;
  }
} 