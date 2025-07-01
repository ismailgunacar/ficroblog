#!/usr/bin/env node

import mongoose from "mongoose";
import { connectDB } from "./src/db.ts";
import { Follow, Following, Key, User } from "./src/models.ts";

async function checkDatabase() {
  console.log("Checking database state...\n");

  await connectDB();

  // Check users
  console.log("1. Users:");
  const users = await User.find().exec();
  console.log(`   Found ${users.length} users:`);
  for (const user of users) {
    console.log(`   - ${user.username} (${user.displayName})`);
  }

  // Check follows (incoming)
  console.log("\n2. Follows (incoming):");
  const follows = await Follow.find().exec();
  console.log(`   Found ${follows.length} follows:`);
  for (const follow of follows) {
    console.log(`   - ${follow.follower} -> ${follow.following}`);
    console.log(`     Created: ${follow.createdAt}`);
  }

  // Check following (outgoing)
  console.log("\n3. Following (outgoing):");
  const following = await Following.find().exec();
  console.log(`   Found ${following.length} following relationships:`);
  for (const f of following) {
    console.log(`   - ${f.follower} -> ${f.following}`);
    console.log(`     Created: ${f.createdAt}`);
  }

  // Check keys
  console.log("\n4. Cryptographic Keys:");
  const keys = await Key.find().exec();
  console.log(`   Found ${keys.length} keys:`);
  for (const key of keys) {
    console.log(`   - ${key.type} for user ${key.user_id}`);
    console.log(`     Created: ${key.created}`);
  }

  await mongoose.disconnect();
}

checkDatabase().catch(console.error);
