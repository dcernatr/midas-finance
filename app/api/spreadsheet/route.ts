import { authErrorResponse, ensureContext, newLogId } from "../../../lib/auth";
import {
  APPWRITE_TABLES, Query, createRow, findRow, listRows, updateRow,
} from "../../../lib/appwrite/server";
import { mapCategory, mapSource, mapSyncLog } from "../../../lib/midas-data";
import {
  ColumnMapping, fetchSpreadsheet, normalizeAmount, normalizeDate, rowObject, suggestMapping,
} from "../../../lib/spreadsheet";

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 35 - prefix.length)}`;
}

function sourceLabel(url: string) {
  const match = url.match(/\/spreadsheets\/d\/(?:e\/)?([^/]+)/);
  return `Google Spreadsheet ${match?.[1]?.slice(0, 8) ?? ""}`;
}

function requiredMapping(mapping: Partial<ColumnMapping>): mapping is ColumnMapping {
  return Boolean(mapping.source_id && mapping.date && mapping.description && mapping.amount);
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

    if (action === "preview") {
      const rawUrl = String(payload.url ?? "");
      const result = await fetchSpreadsheet(rawUrl);
      const headers = result.rows[0].map(header => header.trim());
      return Response.json({
        sourceName: sourceLabel(rawUrl), headers,
        preview: result.rows.slice(1, 6).map(row => rowObject(headers, row)),
        suggestedMapping: suggestMapping(headers),
      });
    }

    if (action === "save_source") {
      const rawUrl = String(payload.url ?? "");
      const mapping = payload.mapping as Partial<ColumnMapping>;
      if (!requiredMapping(mapping)) return Response.json({ error: "Mapea ID, fecha, descripción y monto." }, { status: 400 });
      const result = await fetchSpreadsheet(rawUrl);
      const headers = result.rows[0].map(header => header.trim());
      const missing = Object.values(mapping).filter(Boolean).filter(column => !headers.includes(String(column)));
      if (missing.length) return Response.json({ error: "La estructura cambió. Revisa el mapeo de columnas." }, { status: 400 });
      const existing = await findRow(tables, APPWRITE_TABLES.sources, [Query.equal("user_id", user.id)]);
      const name = String(payload.sourceName ?? sourceLabel(rawUrl)).trim() || sourceLabel(rawUrl);
      const now = new Date().toISOString();
      const sourceData = {
        user_id: user.id, source_name: name, source_url: rawUrl, column_mapping: JSON.stringify(mapping),
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
        status: "success", metadata: JSON.stringify({ sourceName: name }),
      });
      return Response.json({ source: mapSource(saved) });
    }

    if (action === "sync") {
      const sourceRow = await findRow(tables, APPWRITE_TABLES.sources, [Query.equal("user_id", user.id)]);
      if (!sourceRow) return Response.json({ error: "Configura primero una fuente Spreadsheet." }, { status: 400 });
      const source = mapSource(sourceRow);
      const startedAt = new Date().toISOString();
      const result = await fetchSpreadsheet(source.sourceUrl);
      const headers = result.rows[0].map(header => header.trim());
      const mapping = JSON.parse(source.columnMapping) as ColumnMapping;
      if (!requiredMapping(mapping) || [mapping.source_id, mapping.date, mapping.description, mapping.amount].some(column => !headers.includes(column))) {
        return Response.json({ error: "La estructura de la hoja cambió. Configura nuevamente el mapeo." }, { status: 409 });
      }

      const categoryRows = (await listRows(tables, APPWRITE_TABLES.categories, [Query.equal("user_id", user.id)])).map(mapCategory);
      let fallback = categoryRows.find(category => category.name.toLowerCase() === "sin categorizar");
      if (!fallback) {
        const fallbackId = id("cat");
        const created = await createRow(tables, APPWRITE_TABLES.categories, fallbackId, {
          user_id: user.id, name: "Sin categorizar", group_name: "Otros", budget: 0,
          color: "#8490A3", kind: "variable", archived: false,
        });
        fallback = mapCategory(created);
        categoryRows.push(fallback);
      }
      const categoryMap = new Map(categoryRows.map(category => [category.name.trim().toLowerCase(), category.id]));
      const existingRows = await listRows(tables, APPWRITE_TABLES.transactions, [
        Query.equal("user_id", user.id), Query.equal("source_type", "spreadsheet"),
      ]);
      const existingIds = new Set(existingRows.map(row => String(row.source_id ?? "")).filter(Boolean));
      const seenIds = new Set<string>();
      let detected = 0;
      let inserted = 0;
      let ignored = 0;
      const errors: Array<{ row: number; reason: string }> = [];

      for (let index = 1; index < result.rows.length; index++) {
        const object = rowObject(headers, result.rows[index]);
        if (!Object.values(object).some(value => value.trim())) continue;
        if (object[mapping.source_id]?.trim() === mapping.source_id) continue;
        detected++;
        try {
          const sourceId = object[mapping.source_id]?.trim();
          if (!sourceId) throw new Error("ID_MOVIMIENTO vacío");
          if (existingIds.has(sourceId) || seenIds.has(sourceId)) { ignored++; continue; }
          const date = normalizeDate(object[mapping.date] ?? "");
          const amount = normalizeAmount(object[mapping.amount] ?? "");
          const description = object[mapping.description]?.trim();
          if (!description) throw new Error("descripción vacía");
          const categoryName = mapping.category ? object[mapping.category]?.trim().toLowerCase() : "";
          await createRow(tables, APPWRITE_TABLES.transactions, id("txn"), {
            user_id: user.id, date, description, amount,
            category_id: categoryMap.get(categoryName) ?? fallback.id,
            subcategory: mapping.subcategory ? object[mapping.subcategory]?.trim() || undefined : undefined,
            type: "expense", account: mapping.account ? object[mapping.account]?.trim() || "Spreadsheet" : "Spreadsheet",
            payment_method: mapping.payment_method ? object[mapping.payment_method]?.trim() || undefined : undefined,
            notes: mapping.notes ? object[mapping.notes]?.trim() || undefined : undefined,
            source_type: "spreadsheet", source_id: sourceId, source_name: source.sourceName, source_imported_at: new Date().toISOString(),
          });
          inserted++;
          seenIds.add(sourceId);
        } catch (error) {
          errors.push({ row: index + 1, reason: error instanceof Error ? error.message : "fila inválida" });
        }
      }

      const completedAt = new Date().toISOString();
      const status = errors.length ? (inserted ? "partial" : "failed") : "success";
      await updateRow(tables, APPWRITE_TABLES.sources, source.id, {
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
