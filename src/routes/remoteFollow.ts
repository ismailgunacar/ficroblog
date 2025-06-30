import { Hono } from 'hono';

const remoteFollowRoutes = new Hono();

// Example remote follow route (placeholder)
remoteFollowRoutes.post('/', (c) => c.text('Remote follow endpoint'));

export default remoteFollowRoutes;
