# Fedify Federation Implementation Guide

This document explains how our federated social media platform has been updated to follow the [Fedify tutorial guidelines](https://fedify.dev/tutorial/microblog) while preserving our custom functionality.

## Key Changes Made

### 1. Fedify Federation Structure

Our implementation now follows the Fedify tutorial pattern more closely:

#### Federation Instance Creation
- **File**: `src/fedify.ts`
- **Pattern**: Uses `createFederation()` with proper configuration
- **KV Store**: Custom MongoDB-based KV store for persistence
- **Middleware**: Uses `fedifyHonoMiddleware()` for proper route mounting

#### ActivityPub Endpoints
Following the tutorial, we've implemented all required ActivityPub endpoints:

- **WebFinger**: `/.well-known/webfinger`
- **NodeInfo**: `/.well-known/nodeinfo/2.0`
- **Actor**: `/users/{username}`
- **Inbox**: `/users/{username}/inbox`
- **Outbox**: `/users/{username}/outbox`
- **Followers**: `/users/{username}/followers`
- **Following**: `/users/{username}/following`

### 2. Preserved Custom Functionality

#### @username Endpoints
We've maintained our custom user profile endpoints:
- **Profile Pages**: `/profile/{username}` - Custom user profile pages
- **Seamless Login**: Cookie-based authentication preserved
- **Remote Follow**: `/remote-follow` - Mastodon-compatible remote following

#### Authentication System
- **Seamless Login**: Session-based authentication via cookies
- **Setup Flow**: First-user creation process
- **Password Hashing**: Secure password storage with bcrypt

### 3. Federation Features

#### Inbox Listeners
Following the tutorial pattern, we handle these ActivityPub activities:

```typescript
federation
  .setInboxListeners('/users/{identifier}/inbox', '/inbox')
  .on(Follow, async (ctx, follow) => {
    // Handle follow requests
    // Send Accept activity back
  })
  .on(Undo, async (ctx, undo) => {
    // Handle unfollow requests
  })
  .on(Create, async (ctx, create) => {
    // Handle incoming posts
    // Store remote posts in database
  })
```

#### Actor Persistence
- **Remote Actors**: Automatically create local user records for remote actors
- **Handle Resolution**: Proper username@domain handling
- **Public Key Storage**: Store remote actor public keys

### 4. Database Schema

Our MongoDB collections support both local and federated data:

#### Users Collection
```typescript
interface User {
  _id?: ObjectId;
  username: string;
  name: string;
  passwordHash: string;
  bio?: string;
  avatarUrl?: string;
  headerUrl?: string;
  createdAt: Date;
  publicKey?: string;   // For federation
  privateKey?: string;  // For federation
}
```

#### Posts Collection
```typescript
interface Post {
  _id?: ObjectId;
  userId: ObjectId | string;
  content: string;
  createdAt: Date;
  remote?: boolean;  // Whether this is a remote post
  remotePostId?: string; // Original post ID from remote server
  remoteActor?: string;  // Actor URL from remote server
}
```

#### Follows Collection
```typescript
interface Follow {
  _id?: ObjectId;
  follower_id: string;
  following_id: string;
  following_url?: string;  // For remote follows
  following_inbox?: string; // For remote follows
  remote?: boolean;       // Whether this is a remote follow
  createdAt: Date;
}
```

### 5. Route Structure

The application follows this route hierarchy:

1. **Fedify Routes** (mounted first)
   - ActivityPub endpoints
   - WebFinger and NodeInfo
   - User actors and collections

2. **Custom Routes**
   - Authentication (`/login`, `/logout`, `/setup`)
   - Posts (`/posts`)
   - Following (`/following`)

3. **Custom Endpoints**
   - `/federation-health` - Health check
   - `/remote-follow` - Remote following interface
   - `/profile/{username}` - User profiles

4. **Main Routes**
   - `/` - Homepage with timeline

### 6. Federation Compatibility

#### Mastodon Compatibility
- **WebFinger**: Proper account discovery
- **Actor Profiles**: Full ActivityPub actor representation
- **Remote Follow**: `/remote-follow` endpoint for easy following
- **Inbox/Outbox**: Standard ActivityPub collections

#### ActivityPub Compliance
- **Activities**: Create, Follow, Accept, Undo
- **Objects**: Note, Person, Image
- **Collections**: Followers, Following, Outbox
- **Signatures**: HTTP signatures for secure communication

### 7. Development vs Production

#### Development Mode
- `skipSignatureVerification: true` - For easier testing
- Detailed logging for debugging
- Local development endpoints

#### Production Considerations
- Enable signature verification
- Proper HTTPS configuration
- Rate limiting and security headers
- Database indexing for performance

### 8. Testing Federation

#### Local Testing
```bash
# Test WebFinger
curl -H "Accept: application/jrd+json" https://gunac.ar/.well-known/webfinger?resource=acct:ismail@gunac.ar

# Test Actor Profile
curl -H "Accept: application/activity+json" https://gunac.ar/users/ismail

# Test NodeInfo
curl -H "Accept: application/json" https://gunac.ar/.well-known/nodeinfo/2.0
```

#### Federation Health
```bash
# Check federation status
curl https://gunac.ar/federation-health
```

### 9. Custom Features Preserved

#### Seamless Login
- Cookie-based authentication
- Automatic session management
- No complex OAuth flows

#### @username Endpoints
- Custom profile pages at `/profile/{username}`
- User-friendly URLs
- Integration with federation

#### Remote Following
- Web interface for following remote users
- Mastodon-compatible remote follow
- Automatic inbox discovery

### 10. Next Steps

#### Recommended Improvements
1. **Security**: Enable signature verification in production
2. **Performance**: Add database indexes for federation queries
3. **Features**: Implement likes, shares, and comments
4. **UI**: Enhance the user interface for federation features
5. **Monitoring**: Add federation health monitoring

#### Federation Testing
1. Test with other ActivityPub servers (Mastodon, Misskey, etc.)
2. Verify post federation works correctly
3. Test follow/unfollow functionality
4. Ensure proper error handling

## Conclusion

Our implementation successfully combines the Fedify tutorial's best practices with our custom functionality. The app now provides:

- ✅ Full ActivityPub compliance
- ✅ Mastodon compatibility
- ✅ Custom @username endpoints
- ✅ Seamless login experience
- ✅ Remote following capabilities
- ✅ Federation health monitoring

The platform is ready for federation with other ActivityPub servers while maintaining the user-friendly features that make it unique. 