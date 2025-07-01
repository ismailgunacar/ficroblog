#!/usr/bin/env node

import fetch from "node-fetch";

const BASE_URL = "https://c06ee010ba35e2.lhr.life";

async function testActivityPub() {
  console.log("Testing ActivityPub endpoints...\n");

  // Test 1: Actor endpoint
  console.log("1. Testing actor endpoint...");
  try {
    const actorResponse = await fetch(`${BASE_URL}/users/ismail`, {
      headers: {
        Accept: "application/activity+json",
      },
    });

    if (actorResponse.ok) {
      const actor = await actorResponse.json();
      console.log("✅ Actor endpoint works");
      console.log("   ID:", actor.id);
      console.log("   Inbox:", actor.inbox);
      console.log("   Followers:", actor.followers);
      console.log("   Public Key:", actor.publicKey ? "Present" : "Missing");
    } else {
      console.log(
        "❌ Actor endpoint failed:",
        actorResponse.status,
        actorResponse.statusText,
      );
    }
  } catch (error) {
    console.log("❌ Actor endpoint error:", error.message);
  }

  console.log("\n2. Testing followers endpoint...");
  try {
    const followersResponse = await fetch(
      `${BASE_URL}/users/ismail/followers`,
      {
        headers: {
          Accept: "application/activity+json",
        },
      },
    );

    if (followersResponse.ok) {
      const followers = await followersResponse.json();
      console.log("✅ Followers endpoint works");
      console.log("   Total items:", followers.totalItems || "unknown");
      console.log("   Items:", followers.orderedItems?.length || 0);
    } else {
      console.log(
        "❌ Followers endpoint failed:",
        followersResponse.status,
        followersResponse.statusText,
      );
    }
  } catch (error) {
    console.log("❌ Followers endpoint error:", error.message);
  }

  console.log("\n3. Testing inbox endpoint...");
  try {
    const inboxResponse = await fetch(`${BASE_URL}/users/ismail/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        Accept: "application/activity+json",
      },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        actor: "https://test.example/users/test",
        object: "https://c06ee010ba35e2.lhr.life/users/ismail",
      }),
    });

    console.log("   Inbox response status:", inboxResponse.status);
    if (inboxResponse.status === 401) {
      console.log("✅ Inbox endpoint requires authentication (expected)");
    } else if (inboxResponse.status === 200) {
      console.log("✅ Inbox endpoint works");
    } else {
      console.log(
        "❌ Inbox endpoint unexpected response:",
        inboxResponse.status,
      );
    }
  } catch (error) {
    console.log("❌ Inbox endpoint error:", error.message);
  }

  console.log("\n4. Testing shared inbox endpoint...");
  try {
    const sharedInboxResponse = await fetch(`${BASE_URL}/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        Accept: "application/activity+json",
      },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        actor: "https://test.example/users/test",
        object: "https://c06ee010ba35e2.lhr.life/users/ismail",
      }),
    });

    console.log("   Shared inbox response status:", sharedInboxResponse.status);
    if (sharedInboxResponse.status === 401) {
      console.log(
        "✅ Shared inbox endpoint requires authentication (expected)",
      );
    } else if (sharedInboxResponse.status === 200) {
      console.log("✅ Shared inbox endpoint works");
    } else {
      console.log(
        "❌ Shared inbox endpoint unexpected response:",
        sharedInboxResponse.status,
      );
    }
  } catch (error) {
    console.log("❌ Shared inbox endpoint error:", error.message);
  }

  console.log("\n5. Testing webfinger...");
  try {
    const webfingerResponse = await fetch(
      `${BASE_URL}/.well-known/webfinger?resource=acct:ismail@c06ee010ba35e2.lhr.life`,
      {
        headers: {
          Accept: "application/jrd+json",
        },
      },
    );

    if (webfingerResponse.ok) {
      const webfinger = await webfingerResponse.json();
      console.log("✅ Webfinger endpoint works");
      console.log("   Subject:", webfinger.subject);
      console.log("   Links:", webfinger.links?.length || 0);
    } else {
      console.log(
        "❌ Webfinger endpoint failed:",
        webfingerResponse.status,
        webfingerResponse.statusText,
      );
    }
  } catch (error) {
    console.log("❌ Webfinger endpoint error:", error.message);
  }
}

testActivityPub().catch(console.error);
