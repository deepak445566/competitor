import "server-only";
import mongoose from "mongoose";
import { config } from "./config";

// Reuse one connection across hot reloads and requests.
const globalForMongoose = globalThis as unknown as {
  __mongoose?: Promise<typeof mongoose>;
};

export function connectDB(): Promise<typeof mongoose> {
  if (!globalForMongoose.__mongoose) {
    globalForMongoose.__mongoose = mongoose
      .connect(config.mongodbUri, { serverSelectionTimeoutMS: 10_000 })
      .catch((err) => {
        globalForMongoose.__mongoose = undefined;
        throw err;
      });
  }
  return globalForMongoose.__mongoose;
}
