#!/usr/bin/env node

import fetch from "node-fetch";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:8000";

async function testFollow() {
  console.log("Testing follow request...\n");

  // First, get the actor to see the current state
  console.log("1. Getting actor information...");
  try {
    const actorResponse = await fetch(`${SERVER_URL}/users/ismail`, {
      headers: {
        Accept: "application/activity+json",
      },
    });

    if (actorResponse.ok) {
      const actor = await actorResponse.json();
      console.log("✅ Actor found");
      console.log("   ID:", actor.id);
      console.log("   Inbox:", actor.inbox);
    } else {
      console.log("❌ Failed to get actor:", actorResponse.status);
      return;
    }
  } catch (error) {
    console.log("❌ Error getting actor:", error.message);
    return;
  }

  // Now send a follow request
  console.log("\n2. Sending follow request...");
  const followActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Follow",
    actor: "https://test.example/users/testuser",
    object: "https://b783b045d4593d.lhr.life/users/ismail",
    id: "https://test.example/activities/follow-123",
  };

  try {
    const followResponse = await fetch(`${SERVER_URL}/users/ismail/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        Accept: "application/activity+json",
        Date: new Date().toUTCString(),
        Host: new URL(SERVER_URL).host,
      },
      body: JSON.stringify(followActivity),
    });

    console.log("   Follow response status:", followResponse.status);
    console.log(
      "   Follow response headers:",
      Object.fromEntries(followResponse.headers.entries()),
    );

    if (followResponse.ok) {
      console.log("✅ Follow request accepted");
      const responseText = await followResponse.text();
      console.log("   Response body:", responseText);
    } else {
      console.log("❌ Follow request failed");
      const errorText = await followResponse.text();
      console.log("   Error body:", errorText);
    }
  } catch (error) {
    console.log("❌ Error sending follow:", error.message);
  }
}

testFollow().catch(console.error);
