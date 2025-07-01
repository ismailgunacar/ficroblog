# Fedify Microblog Tutorial Checklist (MongoDB Atlas Version)

This will be a single-user federated microblog. At first we want to follow the tutorial at https://fedify.dev/tutorial/microblog, adapting to MongoDB Atlas. Then we will add a seamless authentication and /@username support for user pages.

Make sure to write concise, modular code. 

## Project Setup ✅
- [x] Initialize Fedify project with `fedify init`
- [x] Install MongoDB dependencies (`mongodb`, `mongoose`, `dotenv`)
- [x] Install Node.js type definitions (`@types/node`)
- [x] Set up MongoDB Atlas connection in `src/db.ts`
- [x] Configure environment variables for MongoDB URI

## Database Models ✅
- [x] Create `User` model (single user constraint)
- [x] Create `Post` model (content, author, timestamps)
- [x] Create `Follow` model (federated followers)
- [x] Set up proper indexes and constraints

## Federation Foundation ✅
- [x] Set up basic federation with `createFederation()`
- [x] Configure actor dispatcher for `/users/{identifier}`
- [x] Set up inbox listeners for `/users/{identifier}/inbox`
- [x] Configure shared inbox at `/inbox`

## Follow/Unfollow Implementation ✅
- [x] Handle incoming `Follow` activities
- [x] Store followers in MongoDB using `Follow` model
- [x] Send `Accept` activities back to followers
- [x] Handle incoming `Undo(Follow)` activities (unfollow)
- [x] Remove followers from MongoDB on unfollow
- [x] Expose followers collection at `/users/{identifier}/followers`
- [x] Link followers collection in actor object
- [x] Implement followers counter

## Cryptographic Keys ✅
- [x] Use in-memory key storage (like tutorial)
- [x] Remove custom key pairs dispatcher
- [x] Let Fedify handle key generation automatically
- [x] Keys are generated on first request and stored in memory
- [x] No MongoDB key storage needed for development

## Web Interface - Account Setup ✅
- [x] Create account setup page (`/setup`)
- [x] Implement account creation form
- [x] Create user record in MongoDB
- [x] Redirect to home page after setup

## Web Interface - Profile & Home ✅
- [x] Create profile page (`/users/{username}`)
- [x] Display user information and follower count
- [x] Create home page (`/`)
- [x] Add post creation form
- [x] Show user's posts on home page

## Post Creation & Federation ✅
- [x] Handle post creation (`POST /users/{username}/posts`)
- [x] Store posts in MongoDB
- [x] Implement Note object dispatcher
- [x] Expose posts as ActivityPub Note objects
- [x] Send `Create(Note)` activities to followers
- [x] Create post detail pages (`/users/{username}/posts/{id}`)

## Following Other Users ✅
- [x] Implement `Follow` activity sending
- [x] Store following relationships in MongoDB
- [x] Create following list page
- [x] Handle incoming posts from followed users
- [x] Display timeline of posts from followed users

## Web Interface - Followers/Following Lists ✅
- [x] Create followers list page (`/users/{username}/followers`)
- [x] Display list of followers with links
- [x] Create following list page (`/users/{username}/following`)
- [x] Display list of followed users

## Testing & Federation ✅
- [x] Test local federation with `fedify lookup`
- [x] Expose server to internet with `fedify tunnel`
- [x] Test follow/unfollow from ActivityPub.Academy
- [x] Test follow/unfollow from Mastodon
- [x] Verify posts appear in federated timelines
- [x] Test receiving posts from other servers

## Error Handling & Edge Cases ✅
- [x] Handle duplicate follow requests
- [x] Handle invalid actor URIs
- [x] Handle missing cryptographic keys
- [x] Add proper error responses
- [x] Add logging for debugging

## Production Readiness
- [ ] Replace in-memory stores with persistent ones
- [ ] Add proper authentication (future enhancement)
- [ ] Add rate limiting
- [ ] Add input validation
- [ ] Add proper HTTP status codes
- [ ] Add security headers

## Current Status: ✅ Complete Basic Federation
**Next Step:** Production deployment and authentication

## Notes
- Using MongoDB Atlas for data persistence (users, posts, follows)
- Using in-memory key storage for federation (like tutorial)
- Following Fedify tutorial conventions and structure
- Single-user microblog as specified
- Modular code structure maintained
- Ready for seamless auth and @username endpoints later
- Fixed URL consistency issues (all HTTPS)
- Added Accept activity handling
- Added comprehensive logging

## Testing Commands
```bash
# Test local federation
fedify lookup http://localhost:8000/users/username

# Expose to internet for testing
fedify tunnel 8000

# Test from ActivityPub.Academy
# Search for @{username}@your-tunnel-domain

# Test ActivityPub endpoints
node test-activitypub.js

# Check database state
npx tsx check-db.js
```

## Recent Fixes Applied
- ✅ Fixed URL scheme inconsistencies (HTTP → HTTPS)
- ✅ Added Accept activity handler for incoming accepts
- ✅ Switched to in-memory key storage (tutorial style)
- ✅ Added comprehensive logging for debugging
- ✅ Fixed first-follow connection drop issue
- ✅ Added accepted/acceptedAt fields to Following model 

## Environment Variables

- `PUBLIC_URL`: The public base URL of your server (used by backend for ActivityPub actor/follow URLs). Example:
  
  ```env
  PUBLIC_URL=https://b783b045d4593d.lhr.life
  ```
  Set this in your `.env` file for local development or deployment.

- `SERVER_URL`: The base URL used by test scripts (e.g., `test-follow.js`). Example:
  
  ```sh
  SERVER_URL=https://b783b045d4593d.lhr.life node test-follow.js
  ```
  You can also set this as an environment variable in your shell. 