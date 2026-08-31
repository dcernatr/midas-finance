import { Client, TablesDB } from "node-appwrite";

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const databaseId = process.env.APPWRITE_DATABASE_ID || "midas";

if (!endpoint || !projectId || !apiKey) {
  throw new Error("Define NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID y APPWRITE_API_KEY.");
}

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const tables = new TablesDB(client);

const varchar = (key, size, required = true) => ({ key, type: "varchar", size, required });
const text = (key, required = false) => ({ key, type: "text", required });
const double = (key, required = true) => ({ key, type: "double", required });
const integer = (key, required = true) => ({ key, type: "integer", required });
const boolean = (key, required = true) => ({ key, type: "boolean", required });
const datetime = (key, required = false) => ({ key, type: "datetime", required });
const keyIndex = (key, attributes) => ({ key, type: "key", attributes });
const uniqueIndex = (key, attributes) => ({ key, type: "unique", attributes });

const definitions = [
  {
    id: "midas_users", name: "MIDAS Users",
    columns: [varchar("auth_user_id", 36), { key: "email", type: "email", required: true }, varchar("display_name", 128, false), varchar("role", 16), varchar("status", 16), datetime("last_login_at")],
    indexes: [uniqueIndex("auth_user_unique", ["auth_user_id"]), uniqueIndex("email_unique", ["email"])],
  },
  {
    id: "midas_financial_months", name: "Financial Months",
    columns: [varchar("user_id", 36), varchar("month_key", 7), double("income"), double("savings_target"), varchar("status", 16)],
    indexes: [uniqueIndex("user_month_unique", ["user_id", "month_key"])],
  },
  {
    id: "midas_categories", name: "Categories",
    columns: [varchar("user_id", 36), varchar("name", 128), varchar("group_name", 128), double("budget"), varchar("color", 7), varchar("kind", 24), boolean("archived")],
    indexes: [keyIndex("categories_user", ["user_id"])],
  },
  {
    id: "midas_debts", name: "Debts",
    columns: [varchar("user_id", 36), varchar("name", 128), varchar("entity", 128), double("original_amount"), double("current_balance"), double("annual_rate"), double("minimum_payment"), double("planned_payment"), integer("due_day"), varchar("acquired_at", 10), varchar("status", 16)],
    indexes: [keyIndex("debts_user", ["user_id"])],
  },
  {
    id: "midas_transactions", name: "Transactions",
    columns: [varchar("user_id", 36), varchar("date", 10), varchar("description", 255), double("amount"), varchar("category_id", 36, false), varchar("subcategory", 128, false), varchar("debt_id", 36, false), varchar("type", 24), varchar("account", 128), varchar("payment_method", 64, false), text("notes"), varchar("source_type", 24), varchar("source_id", 255, false), varchar("source_name", 128, false), datetime("source_imported_at")],
    indexes: [keyIndex("transactions_user_date", ["user_id", "date"]), keyIndex("transactions_source", ["user_id", "source_type", "source_id"])],
  },
  {
    id: "midas_spreadsheet_sources", name: "Spreadsheet Sources",
    columns: [varchar("user_id", 36), varchar("source_name", 128), { key: "source_url", type: "url", required: true }, text("column_mapping", true), datetime("last_sync_at"), varchar("last_sync_status", 24), integer("last_rows_detected"), integer("last_rows_inserted"), integer("last_rows_ignored"), integer("last_rows_failed"), datetime("updated_at")],
    indexes: [uniqueIndex("source_user_unique", ["user_id"])],
  },
  {
    id: "midas_spreadsheet_sync_logs", name: "Spreadsheet Sync Logs",
    columns: [varchar("source_id", 36), varchar("user_id", 36), datetime("sync_started_at", true), datetime("sync_completed_at", true), integer("rows_detected"), integer("rows_inserted"), integer("rows_ignored"), integer("rows_failed"), varchar("status", 24), text("errors", true)],
    indexes: [keyIndex("sync_user", ["user_id"]), keyIndex("sync_source", ["source_id"])],
  },
  {
    id: "midas_activity_logs", name: "Activity Logs",
    columns: [varchar("user_id", 36), varchar("target_user_id", 36, false), varchar("action", 64), varchar("status", 24), text("metadata", true)],
    indexes: [keyIndex("activity_user", ["user_id"])],
  },
  {
    id: "midas_system_settings", name: "System Settings",
    columns: [varchar("setting_key", 64), text("value", true), varchar("updated_by", 36), datetime("updated_at", true)],
    indexes: [uniqueIndex("setting_key_unique", ["setting_key"])],
  },
];

async function ensureDatabase() {
  try {
    await tables.get({ databaseId });
  } catch (error) {
    if (error?.code !== 404) throw error;
    await tables.create({ databaseId, name: "MIDAS Finance", enabled: true });
  }
}

async function ensureTable(definition) {
  try {
    await tables.getTable({ databaseId, tableId: definition.id });
    console.log(`✓ ${definition.id}`);
  } catch (error) {
    if (error?.code !== 404) throw error;
    await tables.createTable({
      databaseId, tableId: definition.id, name: definition.name,
      permissions: [], rowSecurity: false, enabled: true,
      columns: definition.columns, indexes: definition.indexes,
    });
    console.log(`+ ${definition.id}`);
  }
}

await ensureDatabase();
for (const definition of definitions) await ensureTable(definition);
console.log("Appwrite quedó preparado para MIDAS.");
