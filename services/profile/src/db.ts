import mongoose from "mongoose";

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/profiledb";

// Connect with retry — Mongo container may not be ready when this boots.
export async function connectDB(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(MONGO_URL);
      console.log(`[profile] connected to mongo: ${MONGO_URL}`);
      return;
    } catch (err) {
      console.warn(`[profile] mongo connect failed (attempt ${attempt}), retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
