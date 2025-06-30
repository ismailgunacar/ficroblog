// Function to get domain from request context
export function getDomainFromRequest(c: { req: { header: (name: string) => string | undefined } }): string {
  const host = c.req.header('host') || c.req.header('Host');
  if (host) {
    // Remove port if present (e.g., "localhost:3000" -> "localhost")
    return host.split(':')[0];
  }
  // Fallback for development
  return 'localhost';
}