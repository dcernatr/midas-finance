import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type GlobalDb = typeof globalThis & { __midasSql?: ReturnType<typeof postgres> };

export function getDb() {
  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("Falta SUPABASE_DB_URL o POSTGRES_URL en la configuración del servidor.");
  const globalDb = globalThis as GlobalDb;
  const client = globalDb.__midasSql ?? postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  if (process.env.NODE_ENV !== "production") globalDb.__midasSql = client;
  return drizzle(client, { schema });
}
