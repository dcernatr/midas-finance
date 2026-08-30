import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  activityLogs, categories, spreadsheetSources, spreadsheetSyncLogs,
  systemSettings, transactions,
} from "../../../db/schema";
import { authErrorResponse, ensureUser, newLogId } from "../../../lib/auth";
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
    const user = await ensureUser();
    const db = getDb();
    const [source, logs] = await Promise.all([
      db.select().from(spreadsheetSources).where(eq(spreadsheetSources.userKey, user.id)).limit(1),
      db.select().from(spreadsheetSyncLogs).where(eq(spreadsheetSyncLogs.userKey, user.id)).orderBy(desc(spreadsheetSyncLogs.createdAt)).limit(5),
    ]);
    return Response.json({ source: source[0] ?? null, logs });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await ensureUser();
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const db = getDb();

    const [feature] = await db.select().from(systemSettings).where(eq(systemSettings.key, "spreadsheet_enabled")).limit(1);
    if (feature?.value === "false") return Response.json({ error: "La integración Spreadsheet está desactivada por ADMIN." }, { status: 503 });

    if (action === "preview") {
      const rawUrl = String(payload.url ?? "");
      const result = await fetchSpreadsheet(rawUrl);
      const headers = result.rows[0].map(header => header.trim());
      const preview = result.rows.slice(1, 6).map(row => rowObject(headers, row));
      return Response.json({
        sourceName: sourceLabel(rawUrl),
        headers,
        preview,
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
      const [existing] = await db.select().from(spreadsheetSources).where(eq(spreadsheetSources.userKey, user.id)).limit(1);
      const name = String(payload.sourceName ?? sourceLabel(rawUrl)).trim() || sourceLabel(rawUrl);
      const now = new Date().toISOString();
      if (existing) {
        await db.transaction(async tx => {
          await tx.update(spreadsheetSources).set({ sourceName: name, sourceUrl: rawUrl, columnMapping: JSON.stringify(mapping), lastSyncStatus: "configured", updatedAt: now }).where(eq(spreadsheetSources.id, existing.id));
          await tx.insert(activityLogs).values({ id: newLogId(), userKey: user.id, targetUserKey: user.id, action: "spreadsheet_source_changed", status: "success", metadata: JSON.stringify({ sourceName: name }) });
        });
      } else {
        await db.transaction(async tx => {
          await tx.insert(spreadsheetSources).values({ id: id("src"), userKey: user.id, sourceName: name, sourceUrl: rawUrl, columnMapping: JSON.stringify(mapping), updatedAt: now });
          await tx.insert(activityLogs).values({ id: newLogId(), userKey: user.id, targetUserKey: user.id, action: "spreadsheet_configured", status: "success", metadata: JSON.stringify({ sourceName: name }) });
        });
      }
      const [saved] = await db.select().from(spreadsheetSources).where(eq(spreadsheetSources.userKey, user.id)).limit(1);
      return Response.json({ source: saved });
    }

    if (action === "sync") {
      const [source] = await db.select().from(spreadsheetSources).where(eq(spreadsheetSources.userKey, user.id)).limit(1);
      if (!source) return Response.json({ error: "Configura primero una fuente Spreadsheet." }, { status: 400 });
      const startedAt = new Date().toISOString();
      const result = await fetchSpreadsheet(source.sourceUrl);
      const headers = result.rows[0].map(header => header.trim());
      const mapping = JSON.parse(source.columnMapping) as ColumnMapping;
      if (!requiredMapping(mapping) || [mapping.source_id, mapping.date, mapping.description, mapping.amount].some(column => !headers.includes(column))) {
        return Response.json({ error: "La estructura de la hoja cambió. Configura nuevamente el mapeo." }, { status: 409 });
      }

      const categoryRows = await db.select().from(categories).where(eq(categories.userKey, user.id));
      let fallback = categoryRows.find(category => category.name.toLowerCase() === "sin categorizar");
      if (!fallback) {
        fallback = { id: id("cat"), userKey: user.id, name: "Sin categorizar", groupName: "Otros", budget: 0, color: "#8490A3", kind: "variable", archived: false, createdAt: startedAt };
        await db.insert(categories).values(fallback);
        categoryRows.push(fallback);
      }
      const categoryMap = new Map(categoryRows.map(category => [category.name.trim().toLowerCase(), category.id]));
      const existingTransactions = await db.select({ sourceId: transactions.sourceId }).from(transactions)
        .where(and(eq(transactions.userKey, user.id), eq(transactions.sourceType, "spreadsheet")));
      const existingIds = new Set(existingTransactions.map(row => row.sourceId).filter(Boolean));
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
          if (existingIds.has(sourceId) || seenIds.has(sourceId)) {
            ignored++;
            continue;
          }
          const date = normalizeDate(object[mapping.date] ?? "");
          const amount = normalizeAmount(object[mapping.amount] ?? "");
          const description = object[mapping.description]?.trim();
          if (!description) throw new Error("descripción vacía");
          const categoryName = mapping.category ? object[mapping.category]?.trim().toLowerCase() : "";
          const categoryId = categoryMap.get(categoryName) ?? fallback.id;
          await db.insert(transactions).values({
            id: id("txn"),
            userKey: user.id,
            date,
            description,
            amount,
            categoryId,
            subcategory: mapping.subcategory ? object[mapping.subcategory]?.trim() || null : null,
            type: "expense",
            account: mapping.account ? object[mapping.account]?.trim() || "Spreadsheet" : "Spreadsheet",
            paymentMethod: mapping.payment_method ? object[mapping.payment_method]?.trim() || null : null,
            notes: mapping.notes ? object[mapping.notes]?.trim() || null : null,
            sourceType: "spreadsheet",
            sourceId,
            sourceName: source.sourceName,
            sourceImportedAt: new Date().toISOString(),
          });
          inserted++;
          seenIds.add(sourceId);
        } catch (error) {
          errors.push({ row: index + 1, reason: error instanceof Error ? error.message : "fila inválida" });
        }
      }

      const completedAt = new Date().toISOString();
      const status = errors.length ? (inserted ? "partial" : "failed") : "success";
      const logId = id("sync");
      await db.transaction(async tx => {
        await tx.update(spreadsheetSources).set({
          lastSyncAt: completedAt,
          lastSyncStatus: status,
          lastRowsDetected: detected,
          lastRowsInserted: inserted,
          lastRowsIgnored: ignored,
          lastRowsFailed: errors.length,
          updatedAt: completedAt,
        }).where(eq(spreadsheetSources.id, source.id));
        await tx.insert(spreadsheetSyncLogs).values({
          id: logId,
          sourceId: source.id,
          userKey: user.id,
          syncStartedAt: startedAt,
          syncCompletedAt: completedAt,
          rowsDetected: detected,
          rowsInserted: inserted,
          rowsIgnored: ignored,
          rowsFailed: errors.length,
          status,
          errors: JSON.stringify(errors.slice(0, 50)),
        });
        await tx.insert(activityLogs).values({
          id: newLogId(),
          userKey: user.id,
          targetUserKey: user.id,
          action: "spreadsheet_sync",
          status,
          metadata: JSON.stringify({ detected, inserted, ignored, failed: errors.length }),
        });
      });
      return Response.json({ detected, inserted, ignored, failed: errors.length, errors: errors.slice(0, 12), status, completedAt });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
