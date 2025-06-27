<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# Fongoblog - Federated MongoDB Atlas-based Single-User Microblog

This is a single-user microblog application built with:
- **Fedify**: ActivityPub server framework for TypeScript/JavaScript
- **MongoDB Atlas**: Cloud database for data persistence
- **Hono**: Fast web framework for TypeScript
- **TypeScript**: For type safety and better development experience

## Project Structure

- `src/app.tsx`: Main application with HTTP routes and handlers
- `src/federation.ts`: ActivityPub protocol implementation using Fedify
- `src/db.ts`: MongoDB Atlas connection and collection helpers
- `src/schema.ts`: TypeScript interfaces for data models
- `src/utils.ts`: Utility functions for database operations
- `src/views.tsx`: JSX components for UI rendering
- `src/index.ts`: Server entry point
- `src/logging.ts`: Logging configuration
- `src/auth.ts`: Authentication utilities and session management

## Key Features

- Single user microblog (only one account can be created - strictly enforced)
- Password-based authentication with session management using JWT cookies
- Login/logout functionality
- ActivityPub protocol support for federation with Mastodon, Misskey, etc.
- MongoDB Atlas for cloud data storage
- User authentication and profile management
- Post creation and timeline
- Follow/unfollow functionality
- Followers and following lists
- Real-time activity processing

## Database Schema

The application uses MongoDB with the following collections:
- `users`: Single user account information (with hashed password)
- `actors`: ActivityPub actor data
- `keys`: Cryptographic keys for ActivityPub signing
- `follows`: Follow relationships
- `posts`: User posts and timeline content
- `counters`: Auto-incrementing ID sequences

## Authentication

- Uses JWT tokens stored in HTTP-only cookies for session management
- Passwords are hashed using bcrypt with salt rounds of 12
- Session expiry is set to 7 days
- Routes are protected with authentication middleware
- Setup is only available when no user exists in the database

## Development Notes

- The application is designed for a single user only (user ID is always 1)
- Multiple user creation is strictly prevented with database checks
- Uses MongoDB Atlas connection string for cloud database
- Implements ActivityPub protocol for federation
- JSX components for server-side rendering
- TypeScript for type safety throughout the application
