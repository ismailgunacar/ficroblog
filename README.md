# Fongoblog

A single-user federated microblog built with Node.js, designed for simplicity and easy deployment on MongoDB Atlas.

## 🌟 Features

- **Federated Microblogging**: Full ActivityPub compatibility for interacting with Mastodon, Pleroma, and other fediverse platforms
- **Single User Design**: Perfect for personal blogs and simple deployments
- **MongoDB Atlas Ready**: Optimized for cloud MongoDB deployment
- **Modern UI**: Clean, responsive interface with real-time interactions
- **Like & Repost Support**: Full federation of likes and announces (reposts)
- **Thread Support**: Create threaded conversations
- **Follow/Unfollow**: Connect with other fediverse users
- **Remote Post Display**: View and interact with posts from other instances

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- MongoDB Atlas account (or local MongoDB)
- Domain name (for federation)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd fongoblog
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/fongoblog
   
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Set up your account**
   Visit `http://localhost:3000` and follow the setup wizard to create your account.

## 🏗️ Architecture

### Tech Stack

- **Backend**: Node.js with Hono framework
- **Database**: MongoDB with Mongoose ODM
- **Federation**: Fedify library for ActivityPub
- **Frontend**: JSX with vanilla JavaScript
- **Styling**: CSS with modern design principles

### Key Components

- **`src/app.tsx`**: Main application server with API endpoints
- **`src/federation.ts`**: ActivityPub federation handlers
- **`src/models.ts`**: MongoDB schemas and models
- **`src/views.tsx`**: UI components and templates
- **`src/db.ts`**: Database connection and configuration

## 📡 Federation Features

### ActivityPub Support

Wendy implements the full ActivityPub specification for seamless integration with the fediverse:

- **Create**: Publish posts that federate to followers
- **Follow/Unfollow**: Connect with other fediverse users
- **Like**: Heart posts from any fediverse instance
- **Announce**: Repost content from across the fediverse
- **Accept/Reject**: Handle follow requests

### Federation Flow

1. **Outgoing Activities**: When you like, repost, or follow, Wendy sends ActivityPub activities to the target instance
2. **Incoming Activities**: Wendy receives and processes activities from other instances
3. **Remote Posts**: Posts from other instances are stored and displayed in your timeline
4. **Real-time Updates**: Like and repost counts update without page reloads

## 🎨 User Interface

### Modern Design

- Clean, minimalist interface
- Responsive design for mobile and desktop
- Real-time interactions (no page reloads)
- Threaded conversations
- Profile pages with follower counts

### Key UI Features

- **Timeline**: View posts from you and people you follow
- **Profile Pages**: Visit `/@username` for user profiles
- **Post Actions**: Like, repost, and reply to posts
- **Thread Composer**: Create multi-post threads
- **Follow Management**: Follow/unfollow other users

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | Required |
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment mode | development |

### MongoDB Atlas Setup

1. Create a MongoDB Atlas cluster
2. Create a database user with read/write permissions
3. Get your connection string
4. Add it to your `.env` file

### Domain Configuration

For federation to work properly:

1. Point your domain to your server
2. Ensure HTTPS is configured (required for ActivityPub)
3. Update your server configuration with the domain

## 🚀 Deployment

### Simple Node.js Deployment

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start production server
npm start
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment Considerations

- **HTTPS Required**: ActivityPub requires HTTPS for federation
- **Domain Setup**: Configure your domain for proper federation
- **MongoDB Atlas**: Use MongoDB Atlas for managed database hosting

## 🔌 API Endpoints

### REST API

- `POST /api/like` - Like a post
- `POST /api/unlike` - Unlike a post  
- `POST /api/announce` - Repost content
- `POST /api/unannounce` - Remove repost
- `GET /api/post/:id/stats` - Get post statistics

### ActivityPub Endpoints

- `GET /users/:username` - Actor profile
- `GET /users/:username/followers` - Followers collection
- `GET /users/:username/following` - Following collection
- `POST /inbox` - ActivityPub inbox
- `GET /outbox` - ActivityPub outbox

## 🤝 Contributing

This is a single-user microblog designed for simplicity. If you find bugs or have suggestions:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- Built with [Fedify](https://fedify.dev/) for ActivityPub federation
- Inspired by the simplicity of single-user blogs
- Designed for easy deployment on modern cloud platforms

---

**Fongoblog - "Wendy"**: Your personal corner of the fediverse, simplified. 