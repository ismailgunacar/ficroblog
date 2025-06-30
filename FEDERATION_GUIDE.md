# ActivityPub Federation Guide

This guide documents the complete ActivityPub federation integration using Fedify in the fongoblog2 microblog application.

## 🌐 Overview

The application now supports full ActivityPub federation, allowing it to communicate with other federated social media platforms like Mastodon, Pleroma, and other ActivityPub-compatible services.

## 🏗️ Architecture

### Fedify Integration

We're using [Fedify](https://fedify.dev/), a modern ActivityPub server framework that provides:

- **NodeInfo 2.0** support for server discovery
- **WebFinger** for user discovery
- **ActivityPub** endpoints (actors, inbox, outbox, collections)
- **HTTP Signatures** for secure communication
- **JSON-LD** processing for ActivityPub objects

### Core Components

1. **`src/fedify.ts`** - Main Fedify integration with MongoDB storage
2. **`src/federation-utils.ts`** - Federation utilities and database operations
3. **`src/index.ts`** - Main application with federation integration
4. **`test-federation.js`** - Comprehensive federation testing script

## ✅ Implemented Features

### 1. ActivityPub Endpoints

- **NodeInfo Discovery**: `/.well-known/nodeinfo` and `/.well-known/nodeinfo/2.0`
- **WebFinger**: `/.well-known/webfinger?resource=acct:username@domain`
- **User Actor**: `/users/{username}` - Returns ActivityPub Person object
- **User Outbox**: `/users/{username}/outbox` - Returns user's activities
- **User Followers**: `/users/{username}/followers` - Returns followers collection
- **User Following**: `/users/{username}/following` - Returns following collection
- **User Inbox**: `/users/{username}/inbox` - Receives incoming activities

### 2. MongoDB Integration

- **Federation KV Store**: MongoDB-based key-value store for Fedify
- **Post Federation**: Posts are marked as federated with metadata
- **Follow Relationships**: Stored in MongoDB with federation tracking
- **User Discovery**: WebFinger integration with MongoDB user data

### 3. Federation Utilities

- **`createFollow()`** - Create follow relationships with federation
- **`removeFollow()`** - Remove follow relationships
- **`isFollowing()`** - Check if user is following another
- **`getFollowers()`** - Get user's followers
- **`getFollowing()`** - Get users that a user is following
- **`markPostAsFederated()`** - Mark posts as federated
- **`getFederationStats()`** - Get federation statistics
- **`getFederatedPosts()`** - Get federated posts with user data

### 4. Federation Dashboard

Access the federation dashboard at `/federation` (requires login) to view:

- **Federation Statistics**: Users, posts, follows, federation rate
- **Recent Activity**: Recent federated posts and follows
- **ActivityPub Endpoints**: Links to all federation endpoints
- **Real-time Monitoring**: Live federation activity tracking

### 5. Inbox Listeners

The application handles incoming ActivityPub activities:

- **Follow**: Accepts follow requests and creates relationships
- **Create**: Stores incoming posts from other servers
- **Like**: Tracks likes on posts
- **Announce**: Tracks reposts/boosts

## 🚀 Getting Started

### 1. Prerequisites

- Node.js 18+ and npm
- MongoDB database
- Fedify package installed (`npm install @fedify/fedify`)

### 2. Configuration

The federation is configured in `src/fedify.ts`:

```typescript
const federation = createFederation({
  kv: kvStore, // MongoDB-based KV store
  skipSignatureVerification: true, // For development only
});
```

### 3. Running the Application

```bash
npm run dev
```

The server will start on port 8000 with federation enabled.

### 4. Testing Federation

Run the comprehensive test script:

```bash
node test-federation.js
```

This will test all federation endpoints and features.

## 🔗 Federation Endpoints

### Discovery Endpoints

```bash
# NodeInfo discovery
curl http://localhost:8000/.well-known/nodeinfo

# NodeInfo 2.0
curl http://localhost:8000/.well-known/nodeinfo/2.0

# WebFinger (replace with actual username)
curl "http://localhost:8000/.well-known/webfinger?resource=acct:username@localhost"
```

### User Endpoints

```bash
# User Actor
curl http://localhost:8000/users/username

# User Outbox
curl http://localhost:8000/users/username/outbox

# User Followers
curl http://localhost:8000/users/username/followers

# User Following
curl http://localhost:8000/users/username/following
```

### ActivityPub Inbox

```bash
# Send a Follow activity
curl -X POST http://localhost:8000/users/username/inbox \
  -H "Content-Type: application/activity+json" \
  -d '{
    "@context": "https://www.w3.org/ns/activitystreams",
    "type": "Follow",
    "actor": "https://mastodon.social/users/testuser",
    "object": "https://localhost/users/username"
  }'
```

## 📊 Federation Dashboard

Access the federation dashboard at `/federation` to monitor:

- **Total Users**: Number of registered users
- **Total Posts**: Number of posts in the system
- **Federated Posts**: Number of posts marked as federated
- **Follow Relationships**: Number of follow relationships
- **Federation Rate**: Percentage of posts that are federated

## 🔧 Development

### Adding New Activities

To add support for new ActivityPub activities:

1. Import the activity class in `src/fedify.ts`:
```typescript
import { Like, Announce } from '@fedify/fedify';
```

2. Add inbox listener:
```typescript
federation
  .setInboxListeners('/users/{identifier}/inbox', '/inbox')
  .on(Like, async (ctx, like) => {
    // Handle like activity
  });
```

### Customizing Actor Data

Modify the actor dispatcher in `src/fedify.ts` to customize user profiles:

```typescript
federation.setActorDispatcher('/users/{identifier}', async (ctx, identifier) => {
  // Customize the Person object returned
  return new Person({
    // ... custom fields
  });
});
```

### Federation Utilities

Use the federation utilities in your application code:

```typescript
import { createFollow, getFederationStats } from './federation-utils';

// Create a follow relationship
await createFollow('follower', 'following');

// Get federation statistics
const stats = await getFederationStats();
```

## 🔒 Security Considerations

### Development Mode

The current implementation uses `skipSignatureVerification: true` for development. For production:

1. **Enable HTTP Signatures**: Remove the skip option
2. **Configure Keys**: Set up proper cryptographic keys for users
3. **Domain Verification**: Restrict allowed domains
4. **Rate Limiting**: Implement rate limiting for federation endpoints

### Production Checklist

- [ ] Enable HTTP signature verification
- [ ] Configure proper domain and HTTPS
- [ ] Set up user cryptographic keys
- [ ] Implement rate limiting
- [ ] Add proper error handling
- [ ] Configure allowed domains
- [ ] Set up monitoring and logging

## 🧪 Testing with Real Servers

### Testing with Mastodon

1. **Find a Mastodon instance** (e.g., mastodon.social)
2. **Search for your user**: `@username@localhost`
3. **Follow the user** from Mastodon
4. **Check the federation dashboard** for incoming follow activity

### Testing with Pleroma

1. **Find a Pleroma instance**
2. **Search for your user**: `@username@localhost`
3. **Follow the user** from Pleroma
4. **Verify the follow relationship** is created

## 📈 Monitoring and Debugging

### Federation Dashboard

The federation dashboard provides real-time monitoring of:

- Federation statistics
- Recent activity
- Endpoint status
- User relationships

### Logs

Check the console logs for federation activity:

```
Created follow relationship: user1 -> user2
Marked post 507f1f77bcf86cd799439011 as federated
Sent Create activity for post 507f1f77bcf86cd799439011 by user1
```

### Testing Script

Use the test script to verify all endpoints:

```bash
node test-federation.js
```

## 🚀 Next Steps

### Immediate Improvements

1. **HTTP Signatures**: Enable proper signature verification
2. **Error Handling**: Add comprehensive error handling
3. **Retry Logic**: Implement retry logic for failed deliveries
4. **Activity Types**: Add support for more activity types (Undo, Delete, etc.)

### Advanced Features

1. **Federation Groups**: Support for group federation
2. **Media Federation**: Share images and media across servers
3. **Search Federation**: Federated search capabilities
4. **Moderation**: Federation-level moderation tools

### Integration

1. **Mastodon Integration**: Test with popular Mastodon instances
2. **Pleroma Integration**: Test with Pleroma servers
3. **Other Platforms**: Test with other ActivityPub implementations

## 📚 Resources

- [Fedify Documentation](https://fedify.dev/)
- [ActivityPub Specification](https://www.w3.org/TR/activitypub/)
- [NodeInfo Specification](https://nodeinfo.diaspora.software/)
- [WebFinger Specification](https://tools.ietf.org/html/rfc7033)

## 🤝 Contributing

To contribute to the federation implementation:

1. **Fork the repository**
2. **Create a feature branch**
3. **Implement your changes**
4. **Add tests**
5. **Submit a pull request**

## 📄 License

This federation implementation is part of the fongoblog2 project and follows the same license terms.

---

**🌐 Happy Federating!** 

Your microblog is now part of the federated social web. Connect with users across different platforms and build a more open, decentralized social media experience. 