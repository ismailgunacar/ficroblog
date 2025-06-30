# fongoblog2

A federated microblog webapp based on the microblog project, but using MongoDB Atlas as the backend database.

## Features
- Node.js + TypeScript + Hono web framework
- MongoDB Atlas for data storage
- Environment variable support for MongoDB URI and domain configuration
- Ready to port microblog features to MongoDB

## Setup
1. Create a `.env` file in the root directory with the following variables:
   ```
   DOMAIN=localhost:3000
   MONGODB_URI=mongodb://localhost:27017/fongoblog2
   ```
2. Run `npm install` to install dependencies.
3. Start the development server with `npm run dev`.

## Environment Variables
- `DOMAIN`: The domain for your Fediverse instance (e.g., `localhost:3000` for development, `yourdomain.com` for production)
- `MONGODB_URI`: Your MongoDB connection string

## MongoDB Atlas
- Sign up at https://www.mongodb.com/cloud/atlas and create a cluster.
- Get your connection string (URI) from the Atlas dashboard.
- Paste it into your `.env` file as `MONGODB_URI`.

## License
MIT
