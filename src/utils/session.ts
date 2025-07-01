import type { Context } from 'hono';

// Simple session utility for development
// In production, you'd want to use proper session management

export interface UserSession {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

// For now, we'll use a simple hardcoded user
// In production, this would come from cookies, JWT, or session store
export function getCurrentUser(c: Context): UserSession | null {
  // For development, return a default user
  // In production, extract from session/cookies
  const authHeader = c.req.header('authorization');
  const sessionCookie = c.req.header('cookie');
  
  // Simple logic - if any auth is present, return default user
  // Replace with actual session validation
  if (authHeader || sessionCookie) {
    return {
      userId: 'user-1',
      username: 'localuser',
      displayName: 'Local User',
      avatarUrl: '/avatar/default.png'
    };
  }
  
  return null;
}

// Get the current user's actor ID (ActivityPub format)
export function getCurrentUserActorId(c: Context, baseUrl: string): string | null {
  const user = getCurrentUser(c);
  if (!user) {
    return null;
  }
  
  return `${baseUrl}/users/${user.username}`;
}

// Check if user is authenticated
export function isAuthenticated(c: Context): boolean {
  return getCurrentUser(c) !== null;
}

// For development, we'll assume the user is always authenticated
export function getDefaultUser(): UserSession {
  return {
    userId: 'user-1',
    username: 'localuser',
    displayName: 'Local User',
    avatarUrl: '/avatar/default.png'
  };
}