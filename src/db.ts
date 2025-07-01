import { configDotenv } from "dotenv";
import { MongoClient, Db, Collection } from "mongodb";

// Load environment variables from .env file
configDotenv();

// Ensure environment variables are available
if (!process.env.MONGODB_URI) {
  console.warn("MONGODB_URI not found, using fallback");
}

// MongoDB connection string from environment variable
const MONGODB_URI = process.env.MONGODB_URI;

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (db && client) {
    return db;
  }

  // Validate MongoDB URI
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  console.log("🔌 Attempting to connect to MongoDB...");
  console.log("📍 MongoDB URI format:", MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')); // Hide credentials in logs

  try {
    client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
      retryReads: true,
      retryWrites: true,
      tls: true,
      tlsAllowInvalidCertificates: false,
      tlsAllowInvalidHostnames: false,
    });
    
    console.log("🔄 Connecting to MongoDB client...");
    await client.connect();
    
    console.log("🏓 Testing connection with ping...");
    await client.db("admin").command({ ping: 1 });
    
    db = client.db();
    console.log("✅ Successfully connected to MongoDB Atlas");
    return db;
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error);
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

// Alias for compatibility
export const connectDB = connectToDatabase;

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

export function getAnnouncesCollection(): Collection {
  return getDatabase().collection("announces");
}

export function getCountersCollection(): Collection {
  return getDatabase().collection("counters");
}
