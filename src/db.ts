import type { Db } from "mongodb";
import { MongoClient } from "mongodb";

// process.env is available in Node.js. For TypeScript, install @types/node if needed.
const uri = process.env.MONGODB_URI || "";
if (!uri) {
  throw new Error("MONGODB_URI environment variable not set");
}

let client: MongoClient;
let db: Db;

export async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db();
  }
  return db;
}
