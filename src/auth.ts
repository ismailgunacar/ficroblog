import type { Context } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import * as bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getUsersCollection } from "./db.ts";
import type { User } from "./schema.ts";

// JWT secret (in production, this should be from environment variable)
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

// Session interface
export interface SessionData {
  userId: number;
  username: string;
}

// Get session from JWT cookie
function getSessionFromCookie(c: Context): SessionData | null {
  const token = getCookie(c, "session");
  console.log("Getting session from cookie, token exists:", !!token);
  
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionData;
    console.log("Session decoded successfully:", decoded);
    return decoded;
  } catch (error) {
    console.log("Failed to decode session:", error);
    return null;
  }
}

// Create session and set cookie
export function createSession(c: Context, user: User): void {
  console.log("Creating session for user:", user.username, user.id);
  
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }
  
  const sessionData: SessionData = {
    userId: user.id,
    username: user.username
  };
  
  console.log("Session data:", sessionData);
  
  try {
    const token = jwt.sign(sessionData, JWT_SECRET, { expiresIn: "7d" });
    console.log("JWT token created, length:", token.length);
    
    console.log("Setting session cookie");
    
    setCookie(c, "session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 // 7 days
    });
    
    console.log("Session created successfully");
  } catch (jwtError) {
    console.error("Failed to create JWT:", jwtError);
    throw jwtError;
  }
}

// Destroy session
export function destroySession(c: Context): void {
  deleteCookie(c, "session");
}

// Check if user is authenticated
export function isAuthenticated(c: Context): boolean {
  const session = getSessionFromCookie(c);
  return !!session;
}

// Get current user from session
export function getCurrentUser(c: Context): SessionData | null {
  return getSessionFromCookie(c);
}

// Authenticate user with username and password
export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const usersCollection = getUsersCollection();
  
  console.log("Auth attempt for username:", username);
  
  const user = await usersCollection.findOne({ username }) as User | null;
  
  console.log("User found:", !!user);
  
  if (!user || !user.password) {
    console.log("No user or no password");
    return null;
  }

  const isValid = await bcrypt.compare(password, user.password);
  console.log("Password valid:", isValid);
  
  return isValid ? user : null;
}

// Middleware to require authentication
export function requireAuth() {
  return async (c: Context, next: () => Promise<void>) => {
    if (!isAuthenticated(c)) {
      return c.redirect("/login");
    }
    await next();
  };
}

// Middleware to redirect authenticated users (for login/setup pages)
export function redirectIfAuthenticated() {
  return async (c: Context, next: () => Promise<void>) => {
    if (isAuthenticated(c)) {
      return c.redirect("/");
    }
    await next();
  };
}
