import { authErrorResponse, ensureContext, newLogId } from "../../../lib/auth";
import {
  APPWRITE_DATABASE_ID, APPWRITE_TABLES, Query, createRow, findRow, listRows, listAllRows, updateRow,
} from "../../../lib/appwrite/server";
import { mapCategory, mapSource, mapSyncLog } from "../../../lib/midas-data";
import {
  fetchSpreadsheet, rowObject, suggestMapping, sheetHeaders, validateMapping, parseMappedRow,
  fetchSpreadsheetSheets, withSpreadsheetSheet,
} from "../../../lib/spreadsheet";
import { digest, importIdentity, movementFingerprint, nextOccurrence, normalizedText, sourceScope } from "../../../lib/ledger";
import { withMovementCode } from "../../../lib/ledger-store";
import { openSyncRun, checkpointSync, syncSummary, SyncRestartError, SYNC_BATCH_SIZE } from "../../../lib/sync-progress";
import { isProtocolError, safeApiError } from "../../../lib/api-response";

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 35 - prefix.length)}`;
}

function sourceLabel(url: string) {
  const match = url.match(/\/spreadsheets\/d\/(?:e\/)?([^/]+)/);
  return `Google Spreadsheet ${match?.[1]?.slice(0, 8) ?? ""}`;
}

export async function GET() {
  try {
    const { user, tables } = await ensureContext();
    const [sources, logs] = await Promise.all([
      listRows(tables, APPWRITE_TABLES.sources, [Query.equal("user_id", user.id)], 1),
      listRows(tables, APPWRITE_TABLES.syncLogs, [Query.equal("user_id", user.id), Query.orderDesc("$createdAt")], 5),
    ]);
    return Response.json({ source: sources[0] ? mapSource(sources[0]) : null, logs: logs.map(mapSyncLog) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const requestStarted = Date.now();
  try {
    const { user, tables } = await ensureContext();
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");

    const feature = await findRow(tables, APPWRITE_TABLES.settings, [Query.equal("setting_key", "spreadsheet_enabled")]);
    if (feature?.value === "false") return Response.json({ error: "La integración Spreadsheet está desactivada por ADMIN." }, { status: 503 });

    if (action === "list_sheets") {
      const rawUrl = String(payload.url ?? "");
      const sheets = await fetchSpreadsheetSheets(rawUrl);
      return Response.json({ sheets });
    }

    if (action === "preview") {
      const rawUrl = String(payload.url ?? "");
      const sheetName = String(payload.sheetName ?? "").trim();
      const selectedUrl = withSpreadsheetSheet(rawUrl, sheetName);
      const result = await fetchSpreadsheet(selectedUrl);
      const allHeaders = sheetHeaders(result.rows[0]);
      const headers = allHeaders.filter(Boolean);
      const suggestedMapping = suggestMapping(headers);
      return Response.json({
        sourceName: `${sourceLabel(rawUrl)} · ${sheetName}`, sheetName, headers,
        preview: result.rows.slice(1, 6).map(row => rowObject(allHeaders, row)),
        suggestedMapping,
      });
    }

    if (action === "save_source") {
      const rawUrl = String(payload.url ?? "");
      const sheetName = String(payload.sheetName ?? "").trim();
      const selectedUrl = withSpreadsheetSheet(rawUrl, sheetName);
      const result = await fetchSpreadsheet(selectedUrl);
      const headers = sheetHeaders(result.rows[0]);
      let mapping;
      try { mapping = validateMapping(payload.mapping, headers); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Mapeo inválido." }, { status: 400 }); }
      const existing = await findRow(tables, APPWRITE_TABLES.sources, [Query.equal("user_id", user.id)]);
      const name = `${sourceLabel(rawUrl)} · ${sheetName}`.slice(0, 128);
      const now = new Date().toISOString();
      const sourceData = {
        user_id: user.id, source_name: name, source_url: selectedUrl, column_mapping: JSON.stringify(mapping),
        last_sync_status: "configured", updated_at: now,
      };
      const saved = existing
        ? await updateRow(tables, APPWRITE_TABLES.sources, existing.$id, sourceData)
        : await createRow(tables, APPWRITE_TABLES.sources, id("src"), {
          ...sourceData, last_rows_detected: 0, last_rows_inserted: 0, last_rows_ignored: 0, last_rows_failed: 0,
        });
      await createRow(tables, APPWRITE_TABLES.activity, newLogId(), {
        user_id: user.id, target_user_id: user.id,
        action: existing ? "spreadsheet_source_changed" : "spreadsheet_configured",
        status: "success", metadata: JSON.stringify({ sourceName: name, sheetName }),
      });
      return Response.json({ source: mapSource(saved) });
    }

    if (action === "sync") {
      const sourceRow = await findRow(tables, APPWRITE_TABLES.sources, [Query.equal("user_id", user.id)]);
      if (!sourceRow) return Response.json({ error: "Configura primero una fuente Spreadsheet." }, { status: 400 });
      const source = mapSource(sourceRow);
      const result = await fetchSpreadsheet(source.sourceUrl);
      const headers = sheetHeaders(result.rows[0]);
      let mapping;
      try { mapping = validateMapping(JSON.parse(source.columnMapping), headers); }
      catch { return Response.json({ error: "Actualiza el mapeo: Fecha, Nombre, Ingreso, Gasto y Categoría. MIDAS ya no requiere IDs de la hoja.", remapRequired: true }, { status: 409 }); }
      const scope = sourceScope(source.sourceUrl);
      const snapshot = digest(JSON.stringify([source.sourceUrl, mapping, result.rows]));
      const run = await openSyncRun(tables, user.id, source.id, String(payload.requestId || crypto.randomUUID()), snapshot, result.rows.length - 1);
      if (run.progress.cursor > run.progress.total && run.row.status !== "running") return Response.json(syncSummary(run));
      const startedAt = String(run.row.sync_started_at);

      const [rawCategories, existingRows] = await Promise.all([
        listRows(tables, APPWRITE_TABLES.categories, [Query.equal("user_id", user.id)]),
        listAllRows(tables, APPWRITE_TABLES.transactions, [Query.equal("user_id", user.id), Query.equal("source_type", "spreadsheet")]),
      ]);
      const categoryRows = rawCategories.map(mapCategory);
      const categoryMap = new Map(categoryRows.map(category => [normalizedText(category.name), category.id]));
      const existingIds = new Set(existingRows.map(row => String(row.source_id ?? "")).filter(Boolean));
      const insertedInThisRun = new Set(existingRows.filter(row => row.source_imported_at === startedAt).map(row => String(row.source_id)));
      // Legacy records had no workbook/tab key. Only match an explicitly named
      // identical source, never manual entries or rows from other tabs.
      const legacy = new Map<string, typeof existingRows>();
      for (const row of existingRows) {
        if (String(row.source_id ?? "").startsWith("v2:") || row.source_name !== source.sourceName || !source.sourceName.includes(" · ")) continue;
        const category = categoryRows.find(item => item.id === row.category_id)?.name;
        if (!category) continue;
        const fingerprint = movementFingerprint({ date: String(row.date), description: String(row.description), amount: Number(row.amount), type: String(row.type), category });
        const group = legacy.get(fingerprint) ?? [];
        group.push(row);
        legacy.set(fingerprint, group);
      }
      const occurrences = new Map<string, number>();
      let detected = 0;
      let inserted = 0;
      let ignored = 0;
      const errors: Array<{ row: number; reason: string }> = [];
      let cursor = run.progress.cursor;
      const end = Math.min(result.rows.length, cursor + SYNC_BATCH_SIZE);

      for (let index = 1; index < end; index++) {
        const object = rowObject(headers, result.rows[index]);
        if (index < run.progress.cursor) {
          try { nextOccurrence(occurrences, movementFingerprint(parseMappedRow(object, mapping))); } catch { /* Invalid rows have no identity. */ }
          continue;
        }
        if (index > run.progress.cursor && Date.now() - requestStarted > 10000) break;
        cursor = index + 1;
        const mappedColumns = [mapping.date, mapping.description, mapping.category, mapping.income, mapping.expense].filter(Boolean) as string[];
        if (!mappedColumns.some(column => object[column]?.trim())) continue;
        if (object[mapping.date] === mapping.date && object[mapping.description] === mapping.description) continue;
        detected++;
        try {
          const movement = parseMappedRow(object, mapping);
          const fingerprint = movementFingerprint(movement);
          const identity = importIdentity(user.id, scope, fingerprint, nextOccurrence(occurrences, fingerprint));
          if (existingIds.has(identity.sourceId)) { if (insertedInThisRun.has(identity.sourceId)) inserted++; else ignored++; continue; }
          const prior = legacy.get(fingerprint)?.shift();
          if (prior) {
            await updateRow(tables, APPWRITE_TABLES.transactions, prior.$id, { source_id: identity.sourceId });
            existingIds.add(identity.sourceId);
            ignored++;
            continue;
          }
          const categoryName = normalizedText(movement.category);
          if (!categoryMap.has(categoryName)) {
            const categoryId = `cat_${digest(user.id + ":" + categoryName)}`;
            try { await createRow(tables, APPWRITE_TABLES.categories, categoryId, { user_id: user.id, name: movement.category, group_name: "Importadas", budget: 0, color: "#8490A3", kind: "variable", archived: false }); }
            catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === 409)) throw error; }
            categoryMap.set(categoryName, categoryId);
          }
          try {
            await withMovementCode(tables, user.id, movement.date, movement.type, (code, transactionId) => createRow(tables, APPWRITE_TABLES.transactions, identity.rowId, {
              user_id: user.id, date: movement.date, description: movement.description, amount: movement.amount,
              category_id: categoryMap.get(categoryName), type: movement.type, account: "Spreadsheet", midas_code: code,
              source_type: "spreadsheet", source_id: identity.sourceId, source_name: source.sourceName, source_imported_at: startedAt,
            }, transactionId));
            inserted++;
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === 409)) throw error;
            const concurrent = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.transactions, rowId: identity.rowId });
            if (concurrent.user_id !== user.id || concurrent.source_id !== identity.sourceId) throw error;
            if (concurrent.source_imported_at === startedAt) inserted++; else ignored++;
          }
          existingIds.add(identity.sourceId);
        } catch (error) {
          if (error instanceof Error && isProtocolError(error.message)) throw error;
          const code = error && typeof error === "object" && "code" in error ? Number(error.code) : 0;
          if ([401, 403, 429, 500, 502, 503, 504].includes(code)) throw error;
          errors.push({ row: index + 1, reason: error instanceof Error ? safeApiError(error.message) : "fila inválida" });
        }
      }

      const checkpoint = await checkpointSync(tables, run, { cursor, detected, inserted, ignored, failed: errors.length, errors }, source);
      return Response.json(syncSummary(checkpoint));
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    if (error instanceof SyncRestartError) return Response.json({ error: error.message, restartRequired: true }, { status: 409 });
    return authErrorResponse(error);
  }
}
