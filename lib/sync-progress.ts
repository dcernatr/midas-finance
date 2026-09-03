import type { MidasTables } from "./postgres/server";
import { DATABASE_ID, TABLES, createRow, updateRow, type MidasRow } from "./postgres/server";
import { digest } from "./ledger";

export const SYNC_BATCH_SIZE = 8;
export type SyncRowError = { row: number; reason: string };
type Progress = { version: 1; snapshot: string; cursor: number; total: number; errors: SyncRowError[] };
export type SyncRun = { row: MidasRow; progress: Progress };
export class SyncRestartError extends Error {}
const statusCode = (error: unknown) => error && typeof error === "object" && "code" in error ? Number(error.code) : 0;

function decode(row: MidasRow): Progress {
  const parsed = JSON.parse(String(row.errors));
  if (parsed?.version !== 1 || !Number.isInteger(parsed.cursor) || !Array.isArray(parsed.errors)) throw new SyncRestartError("Inicia una nueva sincronización.");
  return parsed;
}

export async function openSyncRun(tables: MidasTables, userId: string, sourceId: string, requestId: string, snapshot: string, total: number): Promise<SyncRun> {
  if (!/^[a-z0-9-]{1,64}$/i.test(requestId)) throw new SyncRestartError("Inicia una nueva sincronización.");
  const rowId = `run_${digest(userId + ":" + requestId)}`;
  let row: MidasRow;
  try { row = await tables.getRow<MidasRow>({ databaseId: DATABASE_ID, tableId: TABLES.syncLogs, rowId }); }
  catch (error) {
    if (statusCode(error) !== 404) throw error;
    const now = new Date().toISOString();
    const progress: Progress = { version: 1, snapshot, cursor: 1, total, errors: [] };
    try {
      row = await createRow(tables, TABLES.syncLogs, rowId, {
        user_id: userId, source_id: sourceId, sync_started_at: now, sync_completed_at: now,
        rows_detected: 0, rows_inserted: 0, rows_ignored: 0, rows_failed: 0, status: "running", errors: JSON.stringify(progress),
      });
    } catch (createError) {
      if (statusCode(createError) !== 409) throw createError;
      row = await tables.getRow<MidasRow>({ databaseId: DATABASE_ID, tableId: TABLES.syncLogs, rowId });
    }
  }
  if (row.user_id !== userId || row.source_id !== sourceId) throw new SyncRestartError("La fuente cambió. Inicia una nueva sincronización.");
  const progress = decode(row);
  if (progress.snapshot !== snapshot) throw new SyncRestartError("La hoja o la pestaña cambió durante la importación. Vuelve a sincronizar; los movimientos guardados se conservan.");
  return { row, progress };
}

export function syncSummary(run: SyncRun) {
  return {
    detected: Number(run.row.rows_detected), inserted: Number(run.row.rows_inserted), ignored: Number(run.row.rows_ignored),
    failed: Number(run.row.rows_failed), errors: run.progress.errors.slice(0, 12), status: String(run.row.status),
    completedAt: String(run.row.sync_completed_at), done: run.progress.cursor > run.progress.total,
    processed: Math.min(run.progress.cursor - 1, run.progress.total), total: run.progress.total,
  };
}

export async function checkpointSync(tables: MidasTables, run: SyncRun,
  batch: { cursor: number; detected: number; inserted: number; ignored: number; failed: number; errors: SyncRowError[] },
  source: { id: string; sourceUrl: string; columnMapping: string }): Promise<SyncRun> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const tx = await tables.createTransaction();
    try {
      const current = await tables.getRow<MidasRow>({ databaseId: DATABASE_ID, tableId: TABLES.syncLogs, rowId: run.row.$id, transactionId: tx.$id });
      const prior = decode(current);
      if (prior.cursor !== run.progress.cursor) {
        await tables.updateTransaction({ transactionId: tx.$id, rollback: true });
        return { row: current, progress: prior }; // Another request already committed this batch.
      }
      const progress: Progress = { ...prior, cursor: batch.cursor, errors: [...prior.errors, ...batch.errors].slice(0, 50) };
      const now = new Date().toISOString();
      const detected = Number(current.rows_detected) + batch.detected;
      const inserted = Number(current.rows_inserted) + batch.inserted;
      const ignored = Number(current.rows_ignored) + batch.ignored;
      const failed = Number(current.rows_failed) + batch.failed;
      const status = progress.cursor <= progress.total ? "running" : failed ? (inserted ? "partial" : "failed") : "success";
      const currentSource = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLES.sources, rowId: source.id, transactionId: tx.$id });
      if (currentSource.source_url !== source.sourceUrl || currentSource.column_mapping !== source.columnMapping) throw new SyncRestartError("La fuente cambió. Inicia una nueva sincronización.");
      const row = await updateRow(tables, TABLES.syncLogs, run.row.$id, {
        rows_detected: detected, rows_inserted: inserted, rows_ignored: ignored, rows_failed: failed,
        status, sync_completed_at: now, errors: JSON.stringify(progress),
      }, tx.$id);
      await updateRow(tables, TABLES.sources, source.id, {
        last_sync_at: now, last_sync_status: status, last_rows_detected: detected,
        last_rows_inserted: inserted, last_rows_ignored: ignored, last_rows_failed: failed, updated_at: now,
      }, tx.$id);
      if (status !== "running") await createRow(tables, TABLES.activity, `act_${digest(run.row.$id)}`, {
        user_id: String(current.user_id), target_user_id: String(current.user_id), action: "spreadsheet_sync", status,
        metadata: JSON.stringify({ detected, inserted, ignored, failed }),
      }, tx.$id);
      await tables.updateTransaction({ transactionId: tx.$id, commit: true });
      return { row, progress };
    } catch (error) {
      await tables.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => undefined);
      if (statusCode(error) !== 409 || attempt === 3) throw error;
    }
  }
  throw new Error("No se pudo guardar el avance. Vuelve a sincronizar.");
}
