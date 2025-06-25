import { MongoClient, Db, Collection } from "mongodb";

// Ensure environment variables are available
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = "mongodb+srv://igunacar:fbVBpdpDuyTHxB5t@cluster0.isg22.mongodb.net/marco3?retryWrites=true&w=majority&appName=Cluster0";
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
  console.log("🌍 NODE_ENV:", process.env.NODE_ENV);

  try {
    client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000, // Increased timeout for remote connections
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
      retryReads: true,
      retryWrites: true,
      // Additional options for better Atlas connectivity
      tls: true,
      tlsAllowInvalidCertificates: false,
      tlsAllowInvalidHostnames: false,
    });
    
    console.log("🔄 Connecting to MongoDB client...");
    await client.connect();
    
    console.log("🏓 Testing connection with ping...");
    await client.db("admin").command({ ping: 1 });
    
    db = client.db("marco3");
    console.log("✅ Successfully connected to MongoDB Atlas");
    return db;
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error);
    if (error instanceof Error) {
      console.error("💥 Error details:", error.message);
      console.error("🔍 Error code:", (error as any).code);
      console.error("🏷️  Error name:", error.name);
      
      // Specific error handling for common deployment issues
      if (error.message.includes('authentication failed')) {
        console.error("🔐 Authentication Error: Check your MongoDB Atlas credentials");
        console.error("📝 Possible causes:");
        console.error("   - Wrong username/password in connection string");
        console.error("   - Database user doesn't exist or lacks permissions");
        console.error("   - IP address not whitelisted in Atlas Network Access");
      }
      
      if (error.message.includes('timeout')) {
        console.error("⏰ Timeout Error: Connection timeout");
        console.error("📝 Possible causes:");
        console.error("   - Network connectivity issues");
        console.error("   - IP address not whitelisted in Atlas Network Access");
        console.error("   - MongoDB Atlas cluster may be paused or unavailable");
      }
    }
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
