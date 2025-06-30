import { Hono } from 'hono';

const homeRoutes = new Hono();

// Example home route
homeRoutes.get('/', (c) => c.text('Welcome to your microblog!'));

export default homeRoutes;
