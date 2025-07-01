// ActivityPub activity types
export interface ActivityPubActivity {
  '@context': string | string[];
  id: string;
  type: string;
  actor: string;
  object: string | object;
  published?: string;
}

export interface LikeActivity extends ActivityPubActivity {
  type: 'Like';
}

export interface AnnounceActivity extends ActivityPubActivity {
  type: 'Announce';
}

export interface UndoActivity extends ActivityPubActivity {
  type: 'Undo';
  object: LikeActivity | AnnounceActivity;
}

// Utility to create a Like activity
export function createLikeActivity(actorId: string, objectId: string, domain: string): LikeActivity {
  const activityId = `https://${domain}/activities/like/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityId,
    type: 'Like',
    actor: actorId,
    object: objectId,
    published: new Date().toISOString()
  };
}

// Utility to create an Announce activity
export function createAnnounceActivity(actorId: string, objectId: string, domain: string): AnnounceActivity {
  const activityId = `https://${domain}/activities/announce/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityId,
    type: 'Announce',
    actor: actorId,
    object: objectId,
    published: new Date().toISOString()
  };
}

// Utility to create an Undo activity
export function createUndoActivity(actorId: string, originalActivity: LikeActivity | AnnounceActivity, domain: string): UndoActivity {
  const activityId = `https://${domain}/activities/undo/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityId,
    type: 'Undo',
    actor: actorId,
    object: originalActivity,
    published: new Date().toISOString()
  };
}

// Utility to send an activity to a remote inbox
export async function sendActivityToInbox(activity: ActivityPubActivity, inboxUrl: string): Promise<boolean> {
  try {
    console.log(`Sending ${activity.type} activity to ${inboxUrl}:`, JSON.stringify(activity, null, 2));
    
    const response = await fetch(inboxUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/activity+json',
        'Accept': 'application/activity+json',
        'User-Agent': 'MicroblogBot/1.0'
      },
      body: JSON.stringify(activity)
    });

    if (response.ok) {
      console.log(`Successfully sent ${activity.type} activity to ${inboxUrl}`);
      return true;
    } else {
      console.error(`Failed to send ${activity.type} activity to ${inboxUrl}:`, response.status, response.statusText);
      return false;
    }
  } catch (error) {
    console.error(`Error sending ${activity.type} activity to ${inboxUrl}:`, error);
    return false;
  }
}

// Utility to discover an actor's inbox URL
export async function discoverActorInbox(actorId: string): Promise<string | null> {
  try {
    console.log(`Discovering inbox for actor: ${actorId}`);
    
    const response = await fetch(actorId, {
      headers: {
        'Accept': 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        'User-Agent': 'MicroblogBot/1.0'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch actor ${actorId}:`, response.status, response.statusText);
      return null;
    }

    const actor = await response.json();
    const inboxUrl = actor.inbox;

    if (!inboxUrl) {
      console.error(`No inbox found for actor ${actorId}`);
      return null;
    }

    console.log(`Found inbox for ${actorId}: ${inboxUrl}`);
    return inboxUrl;
  } catch (error) {
    console.error(`Error discovering inbox for actor ${actorId}:`, error);
    return null;
  }
}

// Utility to send federation activity to all relevant inboxes
export async function federateActivity(activity: ActivityPubActivity, recipientActorIds: string[]): Promise<void> {
  const inboxPromises = recipientActorIds.map(async (actorId) => {
    const inboxUrl = await discoverActorInbox(actorId);
    if (inboxUrl) {
      return sendActivityToInbox(activity, inboxUrl);
    }
    return false;
  });

  const results = await Promise.allSettled(inboxPromises);
  
  const successCount = results.filter(result => 
    result.status === 'fulfilled' && result.value === true
  ).length;
  
  console.log(`Federation complete: ${successCount}/${recipientActorIds.length} activities sent successfully`);
}

// Extract domain from actor ID
export function extractDomainFromActorId(actorId: string): string | null {
  try {
    const url = new URL(actorId);
    return url.hostname;
  } catch {
    return null;
  }
}

// Check if an actor is local (same domain)
export function isLocalActor(actorId: string, localDomain: string): boolean {
  const actorDomain = extractDomainFromActorId(actorId);
  return actorDomain === localDomain;
}
