import {
  boolean, date, doublePrecision, index, integer, pgTableCreator, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();
const midasTable = pgTableCreator((name) => `midas_${name}`);

export const users = midasTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  role: text("role").notNull().default("user"),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("midas_users_email_idx").on(table.email)]);

export const financialMonths = midasTable("financial_months", {
  id: text("id").primaryKey(),
  userKey: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  monthKey: text("month_key").notNull(),
  income: doublePrecision("income").notNull().default(0),
  savingsTarget: doublePrecision("savings_target").notNull().default(0),
  status: text("status").notNull().default("open"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("midas_financial_month_user_idx").on(table.userKey, table.monthKey)]);

export const categories = midasTable("categories", {
  id: text("id").primaryKey(),
  userKey: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  groupName: text("group_name").notNull(),
  budget: doublePrecision("budget").notNull().default(0),
  color: text("color").notNull().default("#CBA65B"),
  kind: text("kind").notNull().default("variable"),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
}, (table) => [index("midas_categories_user_idx").on(table.userKey)]);

export const debts = midasTable("debts", {
  id: text("id").primaryKey(),
  userKey: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  entity: text("entity").notNull().default(""),
  originalAmount: doublePrecision("original_amount").notNull(),
  currentBalance: doublePrecision("current_balance").notNull(),
  annualRate: doublePrecision("annual_rate").notNull().default(0),
  minimumPayment: doublePrecision("minimum_payment").notNull().default(0),
  plannedPayment: doublePrecision("planned_payment").notNull().default(0),
  dueDay: integer("due_day").notNull().default(1),
  acquiredAt: date("acquired_at", { mode: "string" }).notNull(),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
}, (table) => [index("midas_debts_user_idx").on(table.userKey)]);

export const transactions = midasTable("transactions", {
  id: text("id").primaryKey(),
  userKey: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  amount: doublePrecision("amount").notNull(),
  categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
  subcategory: text("subcategory"),
  debtId: text("debt_id").references(() => debts.id, { onDelete: "set null" }),
  type: text("type").notNull().default("expense"),
  account: text("account").notNull().default("Efectivo"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  sourceType: text("source_type").notNull().default("manual"),
  sourceId: text("source_id"),
  sourceName: text("source_name"),
  sourceImportedAt: timestamp("source_imported_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("midas_transaction_source_unique_idx").on(table.userKey, table.sourceType, table.sourceId),
  index("midas_transaction_user_date_idx").on(table.userKey, table.date),
  index("midas_transactions_category_id_idx").on(table.categoryId),
  index("midas_transactions_debt_id_idx").on(table.debtId),
]);

export const spreadsheetSources = midasTable("spreadsheet_sources", {
  id: text("id").primaryKey(),
  userKey: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  columnMapping: text("column_mapping").notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "string" }),
  lastSyncStatus: text("last_sync_status").notNull().default("configured"),
  lastRowsDetected: integer("last_rows_detected").notNull().default(0),
  lastRowsInserted: integer("last_rows_inserted").notNull().default(0),
  lastRowsIgnored: integer("last_rows_ignored").notNull().default(0),
  lastRowsFailed: integer("last_rows_failed").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("midas_spreadsheet_source_user_idx").on(table.userKey)]);

export const spreadsheetSyncLogs = midasTable("spreadsheet_sync_logs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => spreadsheetSources.id, { onDelete: "cascade" }),
  userKey: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  syncStartedAt: timestamp("sync_started_at", { withTimezone: true, mode: "string" }).notNull(),
  syncCompletedAt: timestamp("sync_completed_at", { withTimezone: true, mode: "string" }).notNull(),
  rowsDetected: integer("rows_detected").notNull().default(0),
  rowsInserted: integer("rows_inserted").notNull().default(0),
  rowsIgnored: integer("rows_ignored").notNull().default(0),
  rowsFailed: integer("rows_failed").notNull().default(0),
  status: text("status").notNull(),
  errors: text("errors").notNull().default("[]"),
  createdAt: createdAt(),
}, (table) => [
  index("midas_spreadsheet_logs_user_idx").on(table.userKey, table.createdAt),
  index("midas_spreadsheet_sync_logs_source_id_idx").on(table.sourceId),
]);

export const activityLogs = midasTable("activity_logs", {
  id: text("id").primaryKey(),
  userKey: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetUserKey: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  status: text("status").notNull().default("success"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: createdAt(),
}, (table) => [
  index("midas_activity_logs_created_idx").on(table.createdAt),
  index("midas_activity_logs_user_id_idx").on(table.userKey),
  index("midas_activity_logs_target_user_id_idx").on(table.targetUserKey),
]);

export const systemSettings = midasTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: uuid("updated_by").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("midas_system_settings_updated_by_idx").on(table.updatedBy)]);
