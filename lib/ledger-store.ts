import type { TablesDB } from "node-appwrite";
import { APPWRITE_DATABASE_ID, APPWRITE_TABLES, createRow, updateRow, type AppwriteRow } from "./appwrite/server";
import { codePrefix, digest, formatCode } from "./ledger";

function conflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 409;
}

// Counter increments and the financial write commit together. A failed write
// never consumes a number; deletions never decrement or reuse existing numbers.
export async function withMovementCode<T>(tables: TablesDB, userId: string, date: string, type: string,
  write: (code: string, transactionId: string) => Promise<T>) {
  const prefix = codePrefix(date, type);
  const sequenceId = `seq_${digest(userId + ":" + date.slice(0, 7) + ":" + prefix.slice(-1))}`;
  try {
    await createRow(tables, APPWRITE_TABLES.sequences, sequenceId, { user_id: userId, period: date.slice(0, 7), kind: prefix.slice(-1), last_number: 0 });
  } catch (error) {
    if (!conflict(error)) throw error;
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const transaction = await tables.createTransaction();
    try {
      const counter = await tables.incrementRowColumn({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.sequences,
        rowId: sequenceId, column: "last_number", value: 1, transactionId: transaction.$id });
      const result = await write(formatCode(date, type, Number(counter.last_number)), transaction.$id);
      await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
      return result;
    } catch (error) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
      if (!conflict(error) || attempt === 7) throw error;
    }
  }
  throw new Error("No se pudo asignar el código. Intenta nuevamente.");
}

export async function ensureMovementCodes(tables: TablesDB, userId: string, rows: AppwriteRow[]) {
  const missing = rows.filter(row => !row.midas_code).sort((a, b) => a.$createdAt.localeCompare(b.$createdAt) || a.$id.localeCompare(b.$id));
  for (const row of missing) {
    // Recheck within the transaction to serialize simultaneous legacy backfills.
    row.midas_code = await withMovementCode(tables, userId, String(row.date), String(row.type), async (code, transactionId) => {
      const current = await tables.getRow<AppwriteRow>({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.transactions, rowId: row.$id, transactionId });
      if (current.user_id !== userId) throw new Error("El movimiento no existe.");
      if (current.midas_code) return current.midas_code;
      await updateRow(tables, APPWRITE_TABLES.transactions, row.$id, { midas_code: code }, transactionId);
      return code;
    });
  }
  return rows;
}
