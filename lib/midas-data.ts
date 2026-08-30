type QueryResult<T> = { data: T; error: { message: string } | null };

export function dataOrThrow<T>(result: QueryResult<T>): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}

export type MidasUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string;
};

export type FinancialMonth = {
  id: string;
  userKey: string;
  monthKey: string;
  income: number;
  savingsTarget: number;
  status: string;
  createdAt: string;
};

export type CategoryRow = {
  id: string;
  userKey: string;
  name: string;
  groupName: string;
  budget: number;
  color: string;
  kind: string;
  archived: boolean;
  createdAt: string;
};

export type DebtRow = {
  id: string;
  userKey: string;
  name: string;
  entity: string;
  originalAmount: number;
  currentBalance: number;
  annualRate: number;
  minimumPayment: number;
  plannedPayment: number;
  dueDay: number;
  acquiredAt: string;
  status: string;
  createdAt: string;
};

export type TransactionRow = {
  id: string;
  userKey: string;
  date: string;
  description: string;
  amount: number;
  categoryId: string | null;
  subcategory: string | null;
  debtId: string | null;
  type: string;
  account: string;
  paymentMethod: string | null;
  notes: string | null;
  sourceType: string;
  sourceId: string | null;
  sourceName: string | null;
  sourceImportedAt: string | null;
  createdAt: string;
};

export type SpreadsheetSourceRow = {
  id: string;
  userKey: string;
  sourceName: string;
  sourceUrl: string;
  columnMapping: string;
  lastSyncAt: string | null;
  lastSyncStatus: string;
  lastRowsDetected: number;
  lastRowsInserted: number;
  lastRowsIgnored: number;
  lastRowsFailed: number;
  createdAt: string;
  updatedAt: string;
};

export type SpreadsheetSyncLogRow = {
  id: string;
  sourceId: string;
  userKey: string;
  syncStartedAt: string;
  syncCompletedAt: string;
  rowsDetected: number;
  rowsInserted: number;
  rowsIgnored: number;
  rowsFailed: number;
  status: string;
  errors: string;
  createdAt: string;
};

export type ActivityLogRow = {
  id: string;
  userKey: string;
  targetUserKey: string | null;
  action: string;
  status: string;
  metadata: string;
  createdAt: string;
};

export type SystemSettingRow = {
  key: string;
  value: string;
  updatedBy: string;
  updatedAt: string;
};

type DbRow = Record<string, unknown>;
const text = (row: DbRow, key: string) => String(row[key] ?? "");
const nullableText = (row: DbRow, key: string) => row[key] == null ? null : String(row[key]);
const number = (row: DbRow, key: string) => Number(row[key] ?? 0);

export function mapUser(row: DbRow): MidasUser {
  return { id: text(row, "id"), email: text(row, "email"), displayName: nullableText(row, "display_name"), role: text(row, "role"), status: text(row, "status"), createdAt: text(row, "created_at"), lastLoginAt: text(row, "last_login_at") };
}

export function mapMonth(row: DbRow): FinancialMonth {
  return { id: text(row, "id"), userKey: text(row, "user_id"), monthKey: text(row, "month_key"), income: number(row, "income"), savingsTarget: number(row, "savings_target"), status: text(row, "status"), createdAt: text(row, "created_at") };
}

export function mapCategory(row: DbRow): CategoryRow {
  return { id: text(row, "id"), userKey: text(row, "user_id"), name: text(row, "name"), groupName: text(row, "group_name"), budget: number(row, "budget"), color: text(row, "color"), kind: text(row, "kind"), archived: Boolean(row.archived), createdAt: text(row, "created_at") };
}

export function mapDebt(row: DbRow): DebtRow {
  return { id: text(row, "id"), userKey: text(row, "user_id"), name: text(row, "name"), entity: text(row, "entity"), originalAmount: number(row, "original_amount"), currentBalance: number(row, "current_balance"), annualRate: number(row, "annual_rate"), minimumPayment: number(row, "minimum_payment"), plannedPayment: number(row, "planned_payment"), dueDay: number(row, "due_day"), acquiredAt: text(row, "acquired_at"), status: text(row, "status"), createdAt: text(row, "created_at") };
}

export function mapTransaction(row: DbRow): TransactionRow {
  return { id: text(row, "id"), userKey: text(row, "user_id"), date: text(row, "date"), description: text(row, "description"), amount: number(row, "amount"), categoryId: nullableText(row, "category_id"), subcategory: nullableText(row, "subcategory"), debtId: nullableText(row, "debt_id"), type: text(row, "type"), account: text(row, "account"), paymentMethod: nullableText(row, "payment_method"), notes: nullableText(row, "notes"), sourceType: text(row, "source_type"), sourceId: nullableText(row, "source_id"), sourceName: nullableText(row, "source_name"), sourceImportedAt: nullableText(row, "source_imported_at"), createdAt: text(row, "created_at") };
}

export function mapSource(row: DbRow): SpreadsheetSourceRow {
  return { id: text(row, "id"), userKey: text(row, "user_id"), sourceName: text(row, "source_name"), sourceUrl: text(row, "source_url"), columnMapping: text(row, "column_mapping"), lastSyncAt: nullableText(row, "last_sync_at"), lastSyncStatus: text(row, "last_sync_status"), lastRowsDetected: number(row, "last_rows_detected"), lastRowsInserted: number(row, "last_rows_inserted"), lastRowsIgnored: number(row, "last_rows_ignored"), lastRowsFailed: number(row, "last_rows_failed"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at") };
}

export function mapSyncLog(row: DbRow): SpreadsheetSyncLogRow {
  return { id: text(row, "id"), sourceId: text(row, "source_id"), userKey: text(row, "user_id"), syncStartedAt: text(row, "sync_started_at"), syncCompletedAt: text(row, "sync_completed_at"), rowsDetected: number(row, "rows_detected"), rowsInserted: number(row, "rows_inserted"), rowsIgnored: number(row, "rows_ignored"), rowsFailed: number(row, "rows_failed"), status: text(row, "status"), errors: text(row, "errors"), createdAt: text(row, "created_at") };
}

export function mapActivity(row: DbRow): ActivityLogRow {
  return { id: text(row, "id"), userKey: text(row, "user_id"), targetUserKey: nullableText(row, "target_user_id"), action: text(row, "action"), status: text(row, "status"), metadata: text(row, "metadata"), createdAt: text(row, "created_at") };
}

export function mapSetting(row: DbRow): SystemSettingRow {
  return { key: text(row, "key"), value: text(row, "value"), updatedBy: text(row, "updated_by"), updatedAt: text(row, "updated_at") };
}
