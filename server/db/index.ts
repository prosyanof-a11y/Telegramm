import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const client = postgres({
  host: "aws-1-eu-north-1.pooler.supabase.com",
  port: 6543,
  database: "postgres",
  username: "postgres.yulhsvpbqnbrrsjlnfab",
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(client, { schema });
export * from "./schema.js";
