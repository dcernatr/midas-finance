import { Account, Client, Query, TablesDB } from "node-appwrite";
import type { Models } from "node-appwrite";
import { cookies } from "next/headers";

export const APPWRITE_DATABASE_ID = process.env.APPWRITE_DATABASE_ID || "midas";

export const APPWRITE_TABLES = {
  users: "midas_users",
  months: "midas_financial_months",
  categories: "midas_categories",
  debts: "midas_debts",
  transactions: "midas_transactions",
  sequences: "midas_transaction_sequences",
  sources: "midas_spreadsheet_sources",
  syncLogs: "midas_spreadsheet_sync_logs",
  activity: "midas_activity_logs",
  settings: "midas_system_settings",
  budgetProfiles: "midas_budget_profiles",
} as const;

function config() {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const apiKey = process.env.APPWRITE_API_KEY;
  if (!endpoint || !projectId || !apiKey) {
    throw new Error("MIDAS todavía no está conectado con Appwrite Cloud.");
  }
  return { endpoint, projectId, apiKey };
}

export function appwriteSessionCookieName() {
  return `a_session_${process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || "midas"}`;
}

export function createAdminServices() {
  const { endpoint, projectId, apiKey } = config();
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  return { account: new Account(client), tables: new TablesDB(client) };
}

export async function createSessionAccount() {
  const { endpoint, projectId } = config();
  const cookieStore = await cookies();
  const session = cookieStore.get(appwriteSessionCookieName())?.value;
  if (!session) return null;
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setSession(session);
  return new Account(client);
}

export type AppwriteRow = Models.Row & Record<string, unknown>;

export async function listRows(
  tables: TablesDB,
  tableId: string,
  queries: string[] = [],
  limit = 500,
) {
  const result = await tables.listRows<AppwriteRow>({
    databaseId: APPWRITE_DATABASE_ID,
    tableId,
    queries: [...queries, Query.limit(limit)],
    total: false,
  });
  return result.rows;
}

export async function findRow(tables: TablesDB, tableId: string, queries: string[]) {
  return (await listRows(tables, tableId, queries, 1))[0] ?? null;
}

export async function listAllRows(tables: TablesDB, tableId: string, queries: string[] = []) {
  const rows: AppwriteRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listRows(tables, tableId, [...queries, ...(cursor ? [Query.cursorAfter(cursor)] : [])], 100);
    rows.push(...page);
    if (page.length < 100) return rows;
    cursor = page[page.length - 1].$id;
  }
}

export function createRow(tables: TablesDB, tableId: string, rowId: string, data: Record<string, unknown>, transactionId?: string) {
  return tables.createRow<AppwriteRow>({ databaseId: APPWRITE_DATABASE_ID, tableId, rowId, data, transactionId });
}

export function updateRow(tables: TablesDB, tableId: string, rowId: string, data: Record<string, unknown>, transactionId?: string) {
  return tables.updateRow<AppwriteRow>({ databaseId: APPWRITE_DATABASE_ID, tableId, rowId, data, transactionId });
}

export function upsertRow(tables: TablesDB, tableId: string, rowId: string, data: Record<string, unknown>) {
  return tables.upsertRow<AppwriteRow>({ databaseId: APPWRITE_DATABASE_ID, tableId, rowId, data });
}

export function deleteRow(tables: TablesDB, tableId: string, rowId: string, transactionId?: string) {
  return tables.deleteRow({ databaseId: APPWRITE_DATABASE_ID, tableId, rowId, transactionId });
}

export { Query };
