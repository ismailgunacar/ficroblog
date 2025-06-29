import { MongoClient, ObjectId } from 'mongodb';
import { generateKeyPairSync } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

// MongoDB connection
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error('MONGODB_URI environment variable is required');
}
const client = new MongoClient(mongoUri);

/**
 * Generate a new RSA key pair for ActivityPub signing
 */
export function generateKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  
  return { privateKey, publicKey };
}

/**
 * Generate and store keys for a specific user
 */
export async function generateKeysForUser(userId: string | ObjectId) {
  await client.connect();
  const db = client.db();
  const users = db.collection('users');
  
  const user = await users.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    throw new Error('User not found');
  }
  
  const { privateKey, publicKey } = generateKeyPair();
  
  await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { privateKey, publicKey } }
  );
  
  console.log(`✅ Generated keys for user: ${user.username}`);
  return { privateKey, publicKey };
}

/**
 * Generate keys for all users that don't have them
 */
export async function generateKeysForAllUsers() {
  await client.connect();
  const db = client.db();
  const users = db.collection('users');
  
  const usersWithoutKeys = await users.find({ 
    $or: [
      { privateKey: { $exists: false } },
      { privateKey: null },
      { privateKey: '' }
    ]
  }).toArray();
  
  console.log(`🔑 Found ${usersWithoutKeys.length} users without keys`);
  
  for (const user of usersWithoutKeys) {
    try {
      await generateKeysForUser(user._id);
    } catch (error) {
      console.error(`❌ Failed to generate keys for ${user.username}:`, error);
    }
  }
  
  console.log(`✅ Key generation complete for ${usersWithoutKeys.length} users`);
}

/**
 * Ensure a user has keys, generate if missing
 */
export async function ensureUserHasKeys(userId: string | ObjectId) {
  await client.connect();
  const db = client.db();
  const users = db.collection('users');
  
  const user = await users.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    throw new Error('User not found');
  }
  
  if (!user.privateKey || !user.publicKey) {
    console.log(`🔑 User ${user.username} missing keys, generating...`);
    return await generateKeysForUser(userId);
  }
  
  return { privateKey: user.privateKey, publicKey: user.publicKey };
}

/**
 * Get user's keys, ensuring they exist
 */
export async function getUserKeys(userId: string | ObjectId) {
  return await ensureUserHasKeys(userId);
}

/**
 * Script to run key generation for all users
 */
export async function main() {
  try {
    console.log('🔑 Starting key generation for all users...');
    await generateKeysForAllUsers();
    console.log('✅ Key generation script completed');
  } catch (error) {
    console.error('❌ Key generation script failed:', error);
  } finally {
    await client.close();
  }
}

// Run the script if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Utility to import PEM private key as CryptoKey
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binaryDer = Buffer.from(pemContents, 'base64');
  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
} 