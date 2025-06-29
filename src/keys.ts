import { generateKeyPairSync } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

export function generateRSAKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });
  return { publicKey, privateKey };
}

// Backfill keys for existing users
export async function backfillUserKeys() {
  const uri = process.env.MONGODB_URI || '';
  if (!uri) throw new Error('MONGODB_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const users = db.collection('users');
  const cursor = users.find({ $or: [ { publicKey: { $exists: false } }, { privateKey: { $exists: false } } ] });
  let updated = 0;
  for await (const user of cursor) {
    const { publicKey, privateKey } = generateRSAKeyPair();
    await users.updateOne({ _id: user._id }, { $set: { publicKey, privateKey } });
    updated++;
    console.log(`Updated user ${user.username} (${user._id}) with new keypair.`);
  }
  await client.close();
  console.log(`Backfill complete. Updated ${updated} users.`);
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