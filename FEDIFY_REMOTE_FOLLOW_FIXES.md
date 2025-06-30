# Fedify Remote Follow Implementation Fixes

## Overview
This document outlines the fixes made to your remote follow functionality based on the official Fedify microblog tutorial and documentation.

## Key Issues Fixed

### 1. **Missing HTTP Signatures** ❌ → ✅
**Problem**: Your original implementation sent unsigned ActivityPub requests, which most servers reject.

**Solution**: 
- Added proper key pair generation and storage using Fedify's `generateCryptoKeyPair()`
- Implemented `setKeyPairsDispatcher()` to handle RSA and Ed25519 keys
- Updated actor dispatcher to include public keys for signature verification

### 2. **Manual ActivityPub Handling** ❌ → ✅
**Problem**: You were manually crafting Follow activities and HTTP requests.

**Solution**:
- Used Fedify's `Follow` class to create properly formatted activities
- Used `ctx.sendActivity()` for automatic signing and delivery
- Used `ctx.lookupObject()` for WebFinger discovery

### 3. **Incorrect Context Usage** ❌ → ✅
**Problem**: Not properly using Fedify's context system for ActivityPub operations.

**Solution**:
- Created proper Fedify context using `federation.createContext()`
- Used context methods like `getActorUri()`, `getInboxUri()`, etc.
- Proper recipient handling in inbox listeners

### 4. **Incomplete Inbox Handling** ❌ → ✅
**Problem**: Follow activity handling didn't properly process incoming requests or send Accept responses.

**Solution**:
- Fixed inbox listener to use `ctx.getRecipient()` for proper recipient identification
- Added proper Accept activity creation and sending
- Added Accept activity listener to handle follow request confirmations

## Key Code Changes

### New Key Management (fedify.ts)
```typescript
federation.setKeyPairsDispatcher(async (ctx, identifier) => {
  // Generate and store RSA and Ed25519 key pairs
  // Return properly formatted key pairs for signing
});
```

### Proper Follow Activity Creation (remoteFollow.ts)
```typescript
const followActivity = new Follow({
  id: new URL(`https://${ctx.hostname}/activities/${new ObjectId()}`),
  actor: ctx.getActorUri(currentUser.username),
  object: remoteActor.id,
  to: remoteActor.id,
});

await ctx.sendActivity({ username: currentUser.username }, remoteActor.id?.href, followActivity);
```

### Fixed Inbox Listeners (fedify.ts)
```typescript
.on(Follow, async (ctx, follow) => {
  const recipient = ctx.getRecipient();
  // Proper recipient handling
  
  const accept = new Accept({
    id: new URL(`https://${ctx.hostname}/activities/${new ObjectId()}`),
    actor: ctx.getActorUri(username),
    object: follow,
    to: from.id,
  });
  
  await ctx.sendActivity({ username }, from.id?.href, accept);
})
```

## Database Schema Updates

### New Keys Collection
```typescript
interface Key {
  _id?: ObjectId;
  user_id: ObjectId;
  type: 'RSASSA-PKCS1-v1_5' | 'Ed25519';
  private_key: string; // JSON stringified JWK
  public_key: string;  // JSON stringified JWK
  created: string;
}
```

## Testing Your Remote Follow

### Setup
1. Run the database initialization:
   ```bash
   node init-db.js
   ```

2. Start your server:
   ```bash
   npm run dev
   ```

### Test with Fedify CLI
```bash
# Test your actor endpoint
fedify lookup http://localhost:3000/users/yourusername

# Test WebFinger
fedify lookup acct:yourusername@localhost:3000
```

### Test Remote Follow
1. Try following a real Mastodon/Misskey user from your interface
2. Check server logs for proper activity sending
3. Verify database entries are created with `pending: true`
4. When the remote server accepts, `pending` should change to `false`

## Common Debugging Tips

### Check Actor Keys
```bash
fedify lookup http://localhost:3000/users/yourusername
# Should show publicKey and assertionMethods fields
```

### Monitor Activity Logs
```javascript
// Check your server logs for:
console.log(`Received follow request from ${from.preferredUsername} to ${username}`);
console.log(`Sent Accept activity to ${from.preferredUsername}`);
```

### Verify HTTP Signatures
- Ensure your server can sign requests (keys are generated)
- Check that remote servers can verify your signatures (public keys are exposed)

## Important Notes

1. **Domain Configuration**: Make sure your domain is properly configured for production
2. **SSL/TLS**: ActivityPub requires HTTPS in production
3. **Firewall**: Ensure your server can make outbound HTTPS requests
4. **Key Storage**: Private keys are sensitive - secure your database appropriately

## What Should Work Now

✅ Sending follow requests to remote ActivityPub servers  
✅ Receiving and auto-accepting follow requests  
✅ Proper HTTP signature verification  
✅ WebFinger discovery  
✅ Activity delivery with proper formatting  

Your remote follow functionality should now be compatible with Mastodon, Misskey, Pleroma, and other ActivityPub servers!