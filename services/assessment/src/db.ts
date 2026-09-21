import mongoose from "mongoose";

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/assessmentdb";

export async function connectDB(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(MONGO_URL);
      console.log(`[assessment] connected to mongo: ${MONGO_URL}`);
      return;
    } catch {
      console.warn(`[assessment] mongo connect failed (attempt ${attempt}), retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
