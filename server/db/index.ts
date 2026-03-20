import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('WARNING: DATABASE_URL is not set. Database operations will fail.');
}

const client = postgres(connectionString || 'postgresql://localhost:5432/placeholder', {
  ssl: { rejectUnauthorized: false },
  connection: { options: "-c search_path=public" },
  max: 10,
});

export const db = drizzle(client, { schema });
export * from "./schema.js";
