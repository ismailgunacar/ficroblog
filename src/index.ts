import { serve } from "@hono/node-server";
import { behindProxy } from "x-forwarded-fetch";
import app from "./app.tsx";
import { connectToDatabase } from "./db.ts";
import { initializeCounters, createIndexes } from "./utils.ts";
import "./logging.ts";
import profileRoutes from './routes/profile';
import activitypubRoutes from './routes/activitypub';

// Initialize database connection and setup
async function initializeApp() {
  try {
    await connectToDatabase();
    await initializeCounters();
    console.log("Counters initialized");
    console.log("Database initialized successfully");
    
    // Create indexes in background
    createIndexes().catch(err => console.warn("Index creation failed:", err));
  } catch (error) {
    console.error("Failed to initialize database:", error);
    console.warn("Starting server without database connection - some features may not work");
    // Don't exit, continue with server startup
  }
}

// Mount profile routes
app.route('/@', profileRoutes);
app.route('/', activitypubRoutes);

// Start the server
initializeApp().then(() => {
  serve(
    {
      port: 8000,
      fetch: behindProxy(app.fetch.bind(app)),
    },
    (info) =>
      console.log("Server started at http://" + info.address + ":" + info.port)
  );
});
