import { MongoClient, Db, Collection } from "mongodb";

// MongoDB connection string from environment variable
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/marco3";

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
      
      if (error.message.includes('ENOTFOUND') || error.message.includes('timeout')) {
        console.error("🌐 Network Error: Cannot reach MongoDB Atlas");
        console.error("📝 Possible causes:");
        console.error("   - Server IP not whitelisted in Atlas Network Access");
        console.error("   - Firewall blocking outbound connections on port 27017");
        console.error("   - DNS resolution issues");
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

// Test database connection and verify collections
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const database = getDatabase();
    
    // Test basic connection
    await database.command({ ping: 1 });
    console.log("📊 Database ping successful");
    
    // List all collections
    const collections = await database.listCollections().toArray();
    console.log("📂 Available collections:", collections.map(c => c.name));
    
    // Test access to main collections
    const mainCollections = ['users', 'actors', 'keys', 'follows', 'posts', 'counters'];
    for (const collectionName of mainCollections) {
      const collection = database.collection(collectionName);
      const count = await collection.countDocuments();
      console.log(`   ${collectionName}: ${count} documents`);
    }
    
    return true;
  } catch (error) {
    console.error("❌ Database connection test failed:", error);
    return false;
  }
}

// Network diagnostics for deployment troubleshooting
export async function diagnoseNetworkConnection(): Promise<void> {
  console.log("🔍 Running network diagnostics...");
  
  try {
    // Get server's public IP
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    try {
      const { stdout } = await execAsync('curl -s ifconfig.me || curl -s ipinfo.io/ip || echo "Could not detect IP"');
      console.log("🌐 Server public IP:", stdout.trim());
    } catch (error) {
      console.log("⚠️  Could not detect server IP");
    }
    
    // Test DNS resolution for MongoDB Atlas
    try {
      const { lookup } = await import('dns');
      const lookupAsync = promisify(lookup);
      const atlasHost = 'cluster0.isg22.mongodb.net';
      const result = await lookupAsync(atlasHost);
      console.log(`🔍 DNS resolution for ${atlasHost}:`, result.address);
    } catch (error) {
      console.error("❌ DNS resolution failed for MongoDB Atlas:", error);
    }
    
  } catch (error) {
    console.error("❌ Network diagnostics failed:", error);
  }
}
