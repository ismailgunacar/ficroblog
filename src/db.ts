import { MongoClient, Db, Collection } from "mongodb";

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI;

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (db && client) {
    return db;
  }

  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db("marco3");
    console.log("Connected to MongoDB Atlas");
    return db;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    throw error;
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  if (client) {
    try {
      await client.close();
      client = null;
      db = null;
      console.log("Disconnected from MongoDB Atlas");
    } catch (error) {
      console.error("Error closing database connection:", error);
    }
  }
}

export function getDatabase(): Db {
  if (!db) {
    throw new Error("Database not connected. Call connectToDatabase() first.");
  }
  return db;
}

// Helper functions for collections
export function getUsersCollection(): Collection {
  return getDatabase().collection("users");
}

export function getActorsCollection(): Collection {
  return getDatabase().collection("actors");
}

export function getKeysCollection(): Collection {
  return getDatabase().collection("keys");
}

export function getFollowsCollection(): Collection {
  return getDatabase().collection("follows");
}

export function getPostsCollection(): Collection {
  return getDatabase().collection("posts");
}

export function getLikesCollection(): Collection {
  return getDatabase().collection("likes");
}

export function getRepostsCollection(): Collection {
  return getDatabase().collection("reposts");
}

export function getCountersCollection(): Collection {
  return getDatabase().collection("counters");
}
