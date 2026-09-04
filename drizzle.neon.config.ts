import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/postgres/schema.ts",
  out: "./drizzle-neon",
  schemaFilter: ["midas_private"],
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED || "" },
});
