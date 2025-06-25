# Marco3 - Single User Microblog

A federated single-user microblog built with Fedify and MongoDB Atlas. This application implements the ActivityPub protocol, allowing it to interact with other federated social media platforms like Mastodon, Misskey, and others.

## Features

- **Single User Design**: Only one account can be created, making it perfect for personal microblogging
- **ActivityPub Federation**: Full support for ActivityPub protocol for interoperability with the fediverse
- **MongoDB Atlas**: Cloud-based database storage for scalability and reliability
- **Real-time Activities**: Send and receive follows, posts, and other activities in real-time
- **Responsive UI**: Clean, modern interface using PicoCSS

## Technology Stack

- **[Fedify](https://fedify.dev/)**: ActivityPub server framework
- **[Hono](https://hono.dev/)**: Fast web framework for TypeScript
- **[MongoDB Atlas](https://www.mongodb.com/atlas)**: Cloud database service
- **TypeScript**: Type-safe JavaScript development
- **JSX**: Server-side rendering for UI components

## Prerequisites

- Node.js 22.0.0 or higher
- MongoDB Atlas account and connection string
- Fedify CLI installed globally (`npm install -g @fedify/cli`)

## Installation

1. Clone or initialize the project:
   ```bash
   fedify init .
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your MongoDB Atlas connection string in `src/db.ts`

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Visit `http://localhost:8000` to set up your account

## Configuration

The MongoDB connection string is configured in `src/db.ts`. Update this with your MongoDB Atlas credentials:

```typescript
const MONGODB_URI = "mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority";
```

## Usage

### Initial Setup

1. Navigate to `http://localhost:8000/setup`
2. Enter your desired username and display name
3. Click "Setup" to create your account

### Creating Posts

1. Go to the home page (`http://localhost:8000`)
2. Type your message in the text area
3. Click "Post" to publish

### Following Others

1. Enter a fediverse handle (e.g., `@user@mastodon.social`) in the follow field
2. Click "Follow" to send a follow request

### Federation

To test federation with other ActivityPub servers:

1. Expose your local server to the internet using `fedify tunnel`:
   ```bash
   fedify tunnel 8000
   ```

2. Use the provided public URL to interact with your microblog from other ActivityPub servers

## API Endpoints

- `GET /` - Home page with timeline
- `GET /setup` - Initial account setup page
- `POST /setup` - Create user account
- `GET /users/{username}` - User profile page
- `GET /users/{username}/posts/{id}` - Individual post page
- `POST /users/{username}/posts` - Create new post
- `GET /users/{username}/followers` - Followers list
- `GET /users/{username}/following` - Following list
- `POST /users/{username}/following` - Follow another user

## ActivityPub Implementation

The application implements the following ActivityPub features:

- **Actor**: User profile with cryptographic keys
- **Inbox**: Receives activities from other servers
- **Outbox**: Sends activities to followers
- **Collections**: Followers and following lists
- **Activities**: Create, Follow, Accept, Undo
- **Objects**: Note (posts)

## Database Schema

### Collections

- **users**: User account information
- **actors**: ActivityPub actor data
- **keys**: Cryptographic key pairs for signing
- **follows**: Follow relationships
- **posts**: User posts and remote content
- **counters**: Auto-incrementing sequences

## Development

### Running in Development Mode

```bash
npm run dev
```

### Running in Production Mode

```bash
npm run prod
```

### Testing ActivityPub

Use the Fedify CLI to test ActivityPub objects:

```bash
fedify lookup http://localhost:8000/users/yourusername
```

## Deployment

For production deployment:

1. Set up environment variables for your MongoDB connection
2. Configure your domain and SSL certificates
3. Use a process manager like PM2 for Node.js
4. Set up reverse proxy with nginx or similar

## Contributing

This project is based on the [Fedify tutorial](https://fedify.dev/tutorial/microblog) and adapted for single-user use with MongoDB Atlas. Feel free to extend and modify as needed.

## License

MIT License - see the original Fedify documentation for more details.

## Acknowledgments

- [Fedify](https://fedify.dev/) team for the excellent ActivityPub framework
- [ActivityPub.Academy](https://activitypub.academy/) for testing and debugging tools
- The ActivityPub and fediverse community
