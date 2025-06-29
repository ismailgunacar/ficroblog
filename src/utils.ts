export function getDomainFromRequest(c: { req: { header: (name: string) => string | undefined } }): string {
  const host = c.req.header('host') || c.req.header('x-forwarded-host') || 'localhost:8000';
  return host.includes('localhost') ? 'localhost:8000' : host;
} 