import { sql } from "drizzle-orm";
import { pgSchema, text, jsonb, timestamp, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";

// Private, server-only records. No browser receives the database credential.
export const midasSchema = pgSchema("midas_private");
export const records = midasSchema.table("records", {
  tableId: text("table_id").notNull(),
  id: text("id").notNull(),
  ownerId: text("owner_id").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  primaryKey({ columns: [t.tableId, t.id] }),
  index("records_owner").on(t.tableId, t.ownerId, t.id),
  uniqueIndex("one_month_per_user").on(t.ownerId, sql`(${t.data}->>'month_key')`).where(sql`${t.tableId} = 'midas_financial_months'`),
  uniqueIndex("one_source_per_user").on(t.ownerId).where(sql`${t.tableId} = 'midas_spreadsheet_sources'`),
  uniqueIndex("one_profile_per_user").on(t.ownerId).where(sql`${t.tableId} = 'midas_budget_profiles'`),
  uniqueIndex("unique_movement_code").on(t.ownerId, sql`(${t.data}->>'midas_code')`).where(sql`${t.tableId} = 'midas_transactions'`),
]).enableRLS();
