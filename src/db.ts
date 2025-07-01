import dotenv from "dotenv";
import mongoose from "mongoose";
import type { ConnectOptions } from "mongoose";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "";

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(MONGODB_URI, {} as ConnectOptions);
}
