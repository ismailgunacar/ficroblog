# fongoblog2

A federated microblog webapp based on the microblog project, but using MongoDB Atlas as the backend database.

## Features
- Node.js + TypeScript + Hono web framework
- MongoDB Atlas for data storage
- Environment variable support for MongoDB URI
- Ready to port microblog features to MongoDB

## Setup
1. Copy `.env.example` to `.env` and fill in your MongoDB Atlas connection string.
2. Run `npm install` to install dependencies.
3. Start the development server with `npm run dev`.

## MongoDB Atlas
- Sign up at https://www.mongodb.com/cloud/atlas and create a cluster.
- Get your connection string (URI) from the Atlas dashboard.
- Paste it into your `.env` file as `MONGODB_URI`.

## License
MIT
