import { setCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';

// No-op middleware for compatibility
export const sessionMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
};

export function setSessionCookie(c: any, sessionId: string) {
  setCookie(c, 'session', sessionId, { httpOnly: true, path: '/' });
}

export function clearSessionCookie(c: any) {
  deleteCookie(c, 'session', { path: '/' });
}
