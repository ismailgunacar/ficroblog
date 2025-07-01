#!/usr/bin/env node

import mongoose from "mongoose";
import { connectDB } from "./src/db.ts";
import { Follow, Following } from "./src/models.ts";

async function cleanupDatabase() {
  console.log("Cleaning up old HTTP URLs from database...\n");

  await connectDB();

  // Remove old following relationships with HTTP URLs
  const oldFollowing = await Following.find({
    follower: { $regex: /^http:\/\// },
  }).exec();

  console.log(
    `Found ${oldFollowing.length} following relationships with HTTP URLs:`,
  );
  for (const f of oldFollowing) {
    console.log(`   - ${f.follower} -> ${f.following}`);
  }

  if (oldFollowing.length > 0) {
    const result = await Following.deleteMany({
      follower: { $regex: /^http:\/\// },
    });
    console.log(
      `\n✅ Deleted ${result.deletedCount} old following relationships`,
    );
  } else {
    console.log("\n✅ No old HTTP URLs found to clean up");
  }

  // --- NEW: Fix double slashes in Follow.following ---
  const doubleSlashFollows = await Follow.find({
    following: { $regex: /\/\/users\// },
  }).exec();
  console.log(
    `\nFound ${doubleSlashFollows.length} follows with double slashes in 'following':`,
  );
  for (const follow of doubleSlashFollows) {
    const fixed = follow.following.replace(/\/\/users\//, "/users/");
    await Follow.updateOne({ _id: follow._id }, { $set: { following: fixed } });
    console.log(`   - Fixed: ${follow.follower} -> ${fixed}`);
  }
  if (doubleSlashFollows.length === 0) {
    console.log("\n✅ No double slashes found in 'following' field");
  }

  await mongoose.disconnect();
}

cleanupDatabase().catch((err) => {
  console.error(err);
  process.exit(1);
});
