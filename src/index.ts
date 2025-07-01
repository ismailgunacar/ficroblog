import { serve } from "@hono/node-server";
import { behindProxy } from "x-forwarded-fetch";
import app from "./app.tsx";
import "./logging.ts";
import profileRoutes from './routes/profile.js';
import activitypubRoutes from './routes/activitypub.js';
import homeRoutes from './routes/home.js';
import remoteFollowRoutes from './routes/remoteFollow.js';
import likesRoutes from './routes/likes.js';
import announcesRoutes from './routes/announces.js';
import federationRoutes from './routes/federation.js';
import fs from 'fs/promises';
import path from 'path';

app.get('/likes-announces.js', async (c) => {
  const filePath = path.join(process.cwd(), 'src/public/likes-announces.js');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return c.text(content, 200, { 'Content-Type': 'application/javascript' });
  } catch (error) {
    return c.text('File not found', 404);
  }
});

app.route('/@', profileRoutes);
app.route('/', activitypubRoutes);
app.route('/', homeRoutes);
app.route('/', remoteFollowRoutes);
app.route('/', likesRoutes);
app.route('/', announcesRoutes);
app.route('/federation', federationRoutes);

serve(
  {
    port: 8000,
    fetch: behindProxy(app.fetch.bind(app)),
  },
  (info) =>
    console.log("Server started at http://" + info.address + ":" + info.port),
);
