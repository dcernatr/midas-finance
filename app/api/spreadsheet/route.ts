import { authErrorResponse, ensureContext, newLogId } from "../../../lib/auth";
import {
  APPWRITE_DATABASE_ID, APPWRITE_TABLES, Query, createRow, findRow, listRows, listAllRows, updateRow,
} from "../../../lib/appwrite/server";
import { mapCategory, mapSource, mapSyncLog } from "../../../lib/midas-data";
import {
  fetchSpreadsheet, rowObject, suggestMapping, sheetHeaders, validateMapping, parseMappedRow, parseSignedAmount,
  fetchSpreadsheetSheets, withSpreadsheetSheet,
} from "../../../lib/spreadsheet";
import { digest, importIdentity, movementFingerprint, nextOccurrence, normalizedText, sourceScope } from "../../../lib/ledger";
import { withMovementCode } from "../../../lib/ledger-store";

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
      const amountColumn = suggestedMapping.income || suggestedMapping.expense;
      if (amountColumn && !(suggestedMapping.income && suggestedMapping.expense)) {
        suggestedMapping.signed = result.rows.slice(1).some(row => {
          try { return parseSignedAmount(rowObject(allHeaders, row)[amountColumn] || "") < 0; } catch { return false; }
        });
      }
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
      const startedAt = new Date().toISOString();
      const result = await fetchSpreadsheet(source.sourceUrl);
      const headers = sheetHeaders(result.rows[0]);
      let mapping;
      try { mapping = validateMapping(JSON.parse(source.columnMapping), headers); }
      catch { return Response.json({ error: "Actualiza el mapeo: Fecha, Nombre, Ingreso, Gasto y Categoría. MIDAS ya no requiere IDs de la hoja.", remapRequired: true }, { status: 409 }); }
      const scope = sourceScope(source.sourceUrl);

      const categoryRows = (await listRows(tables, APPWRITE_TABLES.categories, [Query.equal("user_id", user.id)])).map(mapCategory);
      const categoryMap = new Map(categoryRows.map(category => [normalizedText(category.name), category.id]));
      const existingRows = await listAllRows(tables, APPWRITE_TABLES.transactions, [
        Query.equal("user_id", user.id), Query.equal("source_type", "spreadsheet"),
      ]);
      const existingIds = new Set(existingRows.map(row => String(row.source_id ?? "")).filter(Boolean));
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

      for (let index = 1; index < result.rows.length; index++) {
        const object = rowObject(headers, result.rows[index]);
        const mappedColumns = [mapping.date, mapping.description, mapping.category, mapping.income, mapping.expense].filter(Boolean) as string[];
        if (!mappedColumns.some(column => object[column]?.trim())) continue;
        if (object[mapping.date] === mapping.date && object[mapping.description] === mapping.description) continue;
        detected++;
        try {
          const movement = parseMappedRow(object, mapping);
          const fingerprint = movementFingerprint(movement);
          const identity = importIdentity(user.id, scope, fingerprint, nextOccurrence(occurrences, fingerprint));
          if (existingIds.has(identity.sourceId)) { ignored++; continue; }
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
              source_type: "spreadsheet", source_id: identity.sourceId, source_name: source.sourceName, source_imported_at: new Date().toISOString(),
            }, transactionId));
            inserted++;
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === 409)) throw error;
            const concurrent = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.transactions, rowId: identity.rowId });
            if (concurrent.user_id !== user.id || concurrent.source_id !== identity.sourceId) throw error;
            ignored++;
          }
          existingIds.add(identity.sourceId);
        } catch (error) {
          errors.push({ row: index + 1, reason: error instanceof Error ? error.message : "fila inválida" });
        }
      }

      const completedAt = new Date().toISOString();
      const status = errors.length ? (inserted ? "partial" : "failed") : "success";
      const currentSource = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.sources, rowId: source.id });
      if (currentSource.source_url === source.sourceUrl && currentSource.column_mapping === source.columnMapping) await updateRow(tables, APPWRITE_TABLES.sources, source.id, {
        last_sync_at: completedAt, last_sync_status: status, last_rows_detected: detected,
        last_rows_inserted: inserted, last_rows_ignored: ignored, last_rows_failed: errors.length, updated_at: completedAt,
      });
      await createRow(tables, APPWRITE_TABLES.syncLogs, id("sync"), {
        source_id: source.id, user_id: user.id, sync_started_at: startedAt, sync_completed_at: completedAt,
        rows_detected: detected, rows_inserted: inserted, rows_ignored: ignored,
        rows_failed: errors.length, status, errors: JSON.stringify(errors.slice(0, 50)),
      });
      await createRow(tables, APPWRITE_TABLES.activity, newLogId(), {
        user_id: user.id, target_user_id: user.id, action: "spreadsheet_sync", status,
        metadata: JSON.stringify({ detected, inserted, ignored, failed: errors.length }),
      });
      return Response.json({ detected, inserted, ignored, failed: errors.length, errors: errors.slice(0, 12), status, completedAt });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
