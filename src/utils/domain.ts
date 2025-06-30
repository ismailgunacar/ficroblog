export function getDomainFromRequest(c) {
  // Try X-Forwarded-Host, then Host header, then fallback
  return (
    c.req.header('x-forwarded-host') ||
    c.req.header('host') ||
    'localhost:8000'
  ).replace(/^https?:\/\//, '').replace(/\/$/, '');
}
