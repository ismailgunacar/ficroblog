import { serve } from "@hono/node-server";
import { behindProxy } from "x-forwarded-fetch";
import app from "./app.tsx";
import { connectToDatabase, testDatabaseConnection, diagnoseNetworkConnection } from "./db.ts";
import { initializeCounters, createIndexes } from "./utils.ts";
import "./logging.ts";

// Initialize database connection and setup
async function initializeApp() {
  try {
    console.log("🚀 Initializing Marco3 application...");
    
    await connectToDatabase();
    
    // Test database connection
    const connectionOk = await testDatabaseConnection();
    if (!connectionOk) {
      throw new Error("Database connection test failed");
    }
    
    await initializeCounters();
    console.log("📊 Counters initialized");
    console.log("✅ Database initialized successfully");
    
    // Create indexes in background
    createIndexes().catch(err => console.warn("⚠️  Index creation failed:", err));
  } catch (error) {
    console.error("❌ Failed to initialize database:", error);
    
    // Run network diagnostics on deployment
    if (process.env.NODE_ENV === 'production') {
      console.log("🔍 Running network diagnostics for deployment troubleshooting...");
      await diagnoseNetworkConnection();
    }
    
    console.warn("⚠️  Starting server without database connection - some features may not work");
    console.warn("🛠️  To troubleshoot, run: node test-mongodb-connection.js");
    // Don't exit, continue with server startup
  }
}

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
