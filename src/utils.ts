import { getDatabase } from "./db.ts";
import type { Counter } from "./schema.ts";

// Helper function to get next sequence number for auto-incrementing IDs
export async function getNextSequence(name: string): Promise<number> {
  const db = getDatabase();
  const counters = db.collection<Counter>("counters");
  
  const result = await counters.findOneAndUpdate(
    { _id: name },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  
  return result?.sequence || 1;
}

// Initialize counters if they don't exist
export async function initializeCounters(): Promise<void> {
  try {
    const db = getDatabase();
    const counters = db.collection<Counter>("counters");
    
    const counterNames = ["users", "actors", "posts", "likes", "reposts"];
    
    for (const name of counterNames) {
      const exists = await counters.findOne({ _id: name });
      if (!exists) {
        await counters.insertOne({ _id: name, sequence: 0 });
      }
    }
    console.log("Counters initialized");
  } catch (error) {
    console.error("Failed to initialize counters:", error);
    throw error;
  }
}

// Helper to create indexes for better performance
export async function createIndexes(): Promise<void> {
  try {
    const db = getDatabase();
    
    // Create indexes with proper typing
    const collections = [
      {
        name: "users",
        indexes: [
          { key: { id: 1 }, options: { unique: true } },
          { key: { username: 1 }, options: { unique: true } }
        ]
      },
      {
        name: "actors", 
        indexes: [
          { key: { id: 1 }, options: { unique: true } },
          { key: { uri: 1 }, options: { unique: true } },
          { key: { handle: 1 }, options: { unique: true } },
          { key: { user_id: 1 }, options: {} }
        ]
      },
      {
        name: "keys",
        indexes: [
          { key: { user_id: 1, type: 1 }, options: { unique: true } }
        ]
      },
      {
        name: "follows",
        indexes: [
          { key: { following_id: 1, follower_id: 1 }, options: { unique: true } },
          { key: { following_id: 1 }, options: {} },
          { key: { follower_id: 1 }, options: {} }
        ]
      },
      {
        name: "posts",
        indexes: [
          { key: { id: 1 }, options: { unique: true } },
          { key: { uri: 1 }, options: { unique: true } },
          { key: { actor_id: 1 }, options: {} },
          { key: { created: -1 }, options: {} }
        ]
      }
    ];

    for (const collection of collections) {
      const coll = db.collection(collection.name);
      for (const index of collection.indexes) {
        try {
          await coll.createIndex(index.key as any, index.options);
        } catch (error: any) {
          // Ignore index already exists errors
          if (!error.message?.includes("already exists")) {
            console.warn(`Failed to create index for ${collection.name}:`, error.message);
          }
        }
      }
    }
    console.log("Indexes created");
  } catch (error) {
    console.error("Failed to create indexes:", error);
    throw error;
  }
}
