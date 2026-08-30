import { authErrorResponse, ensureContext, newLogId } from "../../../lib/auth";
import { dataOrThrow, mapCategory, mapSource, mapSyncLog } from "../../../lib/midas-data";
import {
  ColumnMapping, fetchSpreadsheet, normalizeAmount, normalizeDate, rowObject,
  suggestMapping,
} from "../../../lib/spreadsheet";

function id(prefix: string) {
  return prefix + "_" + crypto.randomUUID();
}

function sourceLabel(url: string) {
  const match = url.match(/\/spreadsheets\/d\/(?:e\/)?([^/]+)/);
  return "Google Spreadsheet " + (match?.[1]?.slice(0, 8) ?? "");
}

function requiredMapping(mapping: Partial<ColumnMapping>): mapping is ColumnMapping {
  return Boolean(mapping.source_id && mapping.date && mapping.description && mapping.amount);
}

export async function GET() {
  try {
    const { user, supabase } = await ensureContext();
    const [sourceResult, logsResult] = await Promise.all([
      supabase.from("midas_spreadsheet_sources").select("*").eq("user_id", user.id).limit(1),
      supabase.from("midas_spreadsheet_sync_logs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
    ]);
    const sources = dataOrThrow(sourceResult).map(mapSource);
    const logs = dataOrThrow(logsResult).map(mapSyncLog);
    return Response.json({ source: sources[0] ?? null, logs });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await ensureContext();
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");

    const featureResult = await supabase.from("midas_system_settings").select("value").eq("key", "spreadsheet_enabled").maybeSingle();
    if (featureResult.error) throw new Error(featureResult.error.message);
    if (featureResult.data?.value === "false") return Response.json({ error: "La integración Spreadsheet está desactivada por ADMIN." }, { status: 503 });

    if (action === "preview") {
      const rawUrl = String(payload.url ?? "");
      const result = await fetchSpreadsheet(rawUrl);
      const headers = result.rows[0].map(header => header.trim());
      const preview = result.rows.slice(1, 6).map(row => rowObject(headers, row));
      return Response.json({ sourceName: sourceLabel(rawUrl), headers, preview, suggestedMapping: suggestMapping(headers) });
    }

    if (action === "save_source") {
      const rawUrl = String(payload.url ?? "");
      const mapping = payload.mapping as Partial<ColumnMapping>;
      if (!requiredMapping(mapping)) return Response.json({ error: "Mapea ID, fecha, descripción y monto." }, { status: 400 });
      const result = await fetchSpreadsheet(rawUrl);
      const headers = result.rows[0].map(header => header.trim());
      const missing = Object.values(mapping).filter(Boolean).filter(column => !headers.includes(String(column)));
      if (missing.length) return Response.json({ error: "La estructura cambió. Revisa el mapeo de columnas." }, { status: 400 });
      const existingResult = await supabase.from("midas_spreadsheet_sources").select("*").eq("user_id", user.id).maybeSingle();
      if (existingResult.error) throw new Error(existingResult.error.message);
      const existing = existingResult.data ? mapSource(existingResult.data) : null;
      const name = String(payload.sourceName ?? sourceLabel(rawUrl)).trim() || sourceLabel(rawUrl);
      const now = new Date().toISOString();
      dataOrThrow(await supabase.from("midas_spreadsheet_sources").upsert({
        id: existing?.id ?? id("src"), user_id: user.id, source_name: name, source_url: rawUrl,
        column_mapping: JSON.stringify(mapping), last_sync_status: "configured", updated_at: now,
      }, { onConflict: "user_id" }));
      dataOrThrow(await supabase.from("midas_activity_logs").insert({
        id: newLogId(), user_id: user.id, target_user_id: user.id,
        action: existing ? "spreadsheet_source_changed" : "spreadsheet_configured",
        status: "success", metadata: JSON.stringify({ sourceName: name }),
      }));
      const savedResult = await supabase.from("midas_spreadsheet_sources").select("*").eq("user_id", user.id).single();
      return Response.json({ source: mapSource(dataOrThrow(savedResult)) });
    }

    if (action === "sync") {
      const sourceResult = await supabase.from("midas_spreadsheet_sources").select("*").eq("user_id", user.id).maybeSingle();
      if (sourceResult.error) throw new Error(sourceResult.error.message);
      if (!sourceResult.data) return Response.json({ error: "Configura primero una fuente Spreadsheet." }, { status: 400 });
      const source = mapSource(sourceResult.data);
      const startedAt = new Date().toISOString();
      const result = await fetchSpreadsheet(source.sourceUrl);
      const headers = result.rows[0].map(header => header.trim());
      const mapping = JSON.parse(source.columnMapping) as ColumnMapping;
      if (!requiredMapping(mapping) || [mapping.source_id, mapping.date, mapping.description, mapping.amount].some(column => !headers.includes(column))) {
        return Response.json({ error: "La estructura de la hoja cambió. Configura nuevamente el mapeo." }, { status: 409 });
      }

      const categoryRows = dataOrThrow(await supabase.from("midas_categories").select("*").eq("user_id", user.id)).map(mapCategory);
      let fallback = categoryRows.find(category => category.name.toLowerCase() === "sin categorizar");
      if (!fallback) {
        const fallbackId = id("cat");
        dataOrThrow(await supabase.from("midas_categories").insert({ id: fallbackId, user_id: user.id, name: "Sin categorizar", group_name: "Otros", budget: 0, color: "#8490A3", kind: "variable", archived: false }));
        fallback = { id: fallbackId, userKey: user.id, name: "Sin categorizar", groupName: "Otros", budget: 0, color: "#8490A3", kind: "variable", archived: false, createdAt: startedAt };
        categoryRows.push(fallback);
      }
      const categoryMap = new Map(categoryRows.map(category => [category.name.trim().toLowerCase(), category.id]));
      const existingRows = dataOrThrow(await supabase.from("midas_transactions").select("source_id").eq("user_id", user.id).eq("source_type", "spreadsheet"));
      const existingIds = new Set(existingRows.map(row => row.source_id as string | null).filter(Boolean));
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
          dataOrThrow(await supabase.from("midas_transactions").insert({
            id: id("txn"), user_id: user.id, date, description, amount,
            category_id: categoryMap.get(categoryName) ?? fallback.id,
            subcategory: mapping.subcategory ? object[mapping.subcategory]?.trim() || null : null,
            type: "expense", account: mapping.account ? object[mapping.account]?.trim() || "Spreadsheet" : "Spreadsheet",
            payment_method: mapping.payment_method ? object[mapping.payment_method]?.trim() || null : null,
            notes: mapping.notes ? object[mapping.notes]?.trim() || null : null,
            source_type: "spreadsheet", source_id: sourceId, source_name: source.sourceName,
            source_imported_at: new Date().toISOString(),
          }));
          inserted++;
          seenIds.add(sourceId);
        } catch (error) {
          errors.push({ row: index + 1, reason: error instanceof Error ? error.message : "fila inválida" });
        }
      }

      const completedAt = new Date().toISOString();
      const status = errors.length ? (inserted ? "partial" : "failed") : "success";
      dataOrThrow(await supabase.from("midas_spreadsheet_sources").update({
        last_sync_at: completedAt, last_sync_status: status, last_rows_detected: detected,
        last_rows_inserted: inserted, last_rows_ignored: ignored, last_rows_failed: errors.length, updated_at: completedAt,
      }).eq("id", source.id).eq("user_id", user.id));
      dataOrThrow(await supabase.from("midas_spreadsheet_sync_logs").insert({
        id: id("sync"), source_id: source.id, user_id: user.id, sync_started_at: startedAt,
        sync_completed_at: completedAt, rows_detected: detected, rows_inserted: inserted,
        rows_ignored: ignored, rows_failed: errors.length, status, errors: JSON.stringify(errors.slice(0, 50)),
      }));
      dataOrThrow(await supabase.from("midas_activity_logs").insert({
        id: newLogId(), user_id: user.id, target_user_id: user.id, action: "spreadsheet_sync", status,
        metadata: JSON.stringify({ detected, inserted, ignored, failed: errors.length }),
      }));
      return Response.json({ detected, inserted, ignored, failed: errors.length, errors: errors.slice(0, 12), status, completedAt });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
