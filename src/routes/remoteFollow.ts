import { Hono } from 'hono';

const remoteFollowRoutes = new Hono();

// Remote follow page (placeholder)
remoteFollowRoutes.get('/remote-follow', async (c) => {
  return c.html(`
    <html>
      <head>
        <title>Remote Follow</title>
      </head>
      <body>
        <h1>Remote Follow</h1>
        <p>Remote follow functionality not yet implemented.</p>
        <a href="/">← Back to Home</a>
      </body>
    </html>
  `);
});

export default remoteFollowRoutes;