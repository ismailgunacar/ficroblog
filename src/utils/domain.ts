import type { Context } from 'hono';

// Extract domain from request
export function getDomainFromRequest(c: Context): string {
  const host = c.req.header('host');
  if (host) {
    return host.split(':')[0]; // Remove port if present
  }
  
  // Fallback to localhost for development
  return 'localhost:8000';
}

// Get the full base URL from request
export function getBaseUrlFromRequest(c: Context): string {
  const host = c.req.header('host');
  const protocol = c.req.header('x-forwarded-proto') || 'http';
  
  if (host) {
    return `${protocol}://${host}`;
  }
  
  // Fallback for development
  return 'http://localhost:8000';
}

// Check if a URL is from the same domain
export function isSameDomain(url: string, domain: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === domain;
  } catch {
    return false;
  }
}

// Extract domain from URL
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}