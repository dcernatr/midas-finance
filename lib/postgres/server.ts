import type { Pool, PoolClient } from "pg";
import { getPool } from "./pool";

export const DATABASE_ID = "midas";
export const TABLES = {
  users: "midas_users", months: "midas_financial_months", categories: "midas_categories",
  debts: "midas_debts", transactions: "midas_transactions", sequences: "midas_transaction_sequences",
  sources: "midas_spreadsheet_sources", syncLogs: "midas_spreadsheet_sync_logs",
  activity: "midas_activity_logs", settings: "midas_system_settings", budgetProfiles: "midas_budget_profiles",
} as const;
export type MidasRow = Record<string, unknown> & { $id: string; $createdAt: string; $updatedAt: string };
type Args = { databaseId?: string; tableId: string; rowId: string; transactionId?: string };
type Filter = { method: string; attribute?: string; values: unknown[] };
const encode = (method: string, values: unknown[], attribute?: string) => JSON.stringify({ method, values, attribute });
export const Query = {
  equal: (attribute: string, value: unknown) => encode("equal", Array.isArray(value) ? value : [value], attribute),
  orderDesc: (attribute: string) => encode("orderDesc", [], attribute),
  limit: (n: number) => encode("limit", [n]),
  cursorAfter: (id: string) => encode("cursorAfter", [id]),
};
export class StoreError extends Error {
  code: number;
  constructor(message: string, code: number) { super(message); this.code = code; }
}
function storeError(error: unknown): Error {
  if (error instanceof StoreError) return error;
  const code = (error as { code?: string })?.code;
  if (["23505", "40001", "40P01"].includes(code || "")) return new StoreError("Conflicto de guardado. Vuelve a intentar.", 409);
  // Never return SQL, database names, credentials or raw driver errors to users.
  return new StoreError("No se pudo completar la operación en Neon. Vuelve a intentar.", 503);
}
function map(row: Record<string, unknown>): MidasRow {
  return { ...(row.data as Record<string, unknown>), $id: String(row.id),
    $createdAt: new Date(row.created_at as string).toISOString(), $updatedAt: new Date(row.updated_at as string).toISOString() };
}

// Each request owns its store and transactions. Ownership is enforced in SQL in
// addition to route checks; transaction handles can never cross request instances.
export class MidasTables {
  private transactions = new Map<string, { client: PoolClient; timer: ReturnType<typeof setTimeout> }>();
  private serial = 0;
  private ownerId: string;
  private admin: boolean;
  private pool?: Pool;
  constructor(ownerId: string, admin = false, pool?: Pool) { this.ownerId = ownerId; this.admin = admin; this.pool = pool; }
  private table(tableId: string) {
    if (!(Object.values(TABLES) as string[]).includes(tableId)) throw new StoreError("Tabla no válida.", 400);
  }
  private scope(tableId: string, params: unknown[], write = false) {
    this.table(tableId);
    if (tableId === TABLES.settings) {
      if (write && !this.admin) throw new StoreError("Acceso no autorizado.", 403);
      return "TRUE";
    }
    if (this.admin) return "TRUE";
    params.push(this.ownerId);
    return `owner_id = $${params.length}`;
  }
  private async query(text: string, params: unknown[], transactionId?: string) {
    const tx = transactionId ? this.transactions.get(transactionId) : undefined;
    if (transactionId && !tx) throw new StoreError("Transacción no disponible.", 409);
    const db = tx?.client || this.pool || getPool();
    const savepoint = `midas_${++this.serial}`;
    try {
      if (tx) await db.query(`SAVEPOINT ${savepoint}`);
      const result = await db.query(text, params);
      if (tx) await db.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      if (tx) await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
      throw storeError(error);
    }
  }
  async createTransaction() {
    const client = await (this.pool || getPool()).connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query("SET LOCAL statement_timeout = '20s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
      const $id = crypto.randomUUID();
      const timer = setTimeout(() => { this.transactions.delete($id); client.release(true); }, 60000);
      timer.unref();
      this.transactions.set($id, { client, timer });
      return { $id };
    } catch (error) { client.release(true); throw storeError(error); }
  }
  async updateTransaction({ transactionId, commit }: { transactionId: string; commit?: boolean; rollback?: boolean }) {
    const tx = this.transactions.get(transactionId);
    if (!tx) { if (commit) throw new StoreError("Transacción vencida.", 409); return; }
    this.transactions.delete(transactionId);
    clearTimeout(tx.timer);
    try { await tx.client.query(commit ? "COMMIT" : "ROLLBACK"); }
    catch (error) { await tx.client.query("ROLLBACK").catch(() => undefined); throw storeError(error); }
    finally { tx.client.release(); }
  }
  async getRow<T extends MidasRow = MidasRow>(args: Args): Promise<T> {
    const params: unknown[] = [args.tableId, args.rowId];
    const scope = this.scope(args.tableId, params);
    const result = await this.query(`SELECT * FROM midas_private.records WHERE table_id=$1 AND id=$2 AND ${scope}${args.transactionId ? " FOR UPDATE" : ""}`, params, args.transactionId);
    if (!result.rows[0]) throw new StoreError("El registro no existe.", 404);
    return map(result.rows[0]) as T;
  }
  private dataOwner(tableId: string, rowId: string, data: Record<string, unknown>) {
    if (tableId === TABLES.settings) { if (!this.admin) throw new StoreError("Acceso no autorizado.", 403); return "system"; }
    const owner = tableId === TABLES.users ? rowId : String(data.user_id || "");
    if (!owner || (!this.admin && owner !== this.ownerId)) throw new StoreError("El registro no pertenece a esta cuenta.", 403);
    return owner;
  }
  async createRow<T extends MidasRow = MidasRow>(args: Args & { data: Record<string, unknown> }): Promise<T> {
    this.table(args.tableId);
    const owner = this.dataOwner(args.tableId, args.rowId, args.data);
    const result = await this.query("INSERT INTO midas_private.records(table_id,id,owner_id,data) VALUES($1,$2,$3,$4::jsonb) RETURNING *", [args.tableId,args.rowId,owner,JSON.stringify(args.data)],args.transactionId);
    return map(result.rows[0]) as T;
  }
  async updateRow<T extends MidasRow = MidasRow>(args: Args & { data: Record<string, unknown> }): Promise<T> {
    if (Object.hasOwn(args.data, "user_id") || Object.hasOwn(args.data, "auth_user_id")) throw new StoreError("No se puede cambiar el propietario.", 400);
    const params: unknown[] = [args.tableId,args.rowId,JSON.stringify(args.data)];
    const scope = this.scope(args.tableId, params, true);
    const result = await this.query(`UPDATE midas_private.records SET data=data || $3::jsonb, updated_at=now() WHERE table_id=$1 AND id=$2 AND ${scope} RETURNING *`,params,args.transactionId);
    if (!result.rows[0]) throw new StoreError("El registro no existe.",404);
    return map(result.rows[0]) as T;
  }
  async upsertRow<T extends MidasRow = MidasRow>(args: Args & { data: Record<string, unknown> }): Promise<T> {
    this.table(args.tableId);
    const owner = this.dataOwner(args.tableId,args.rowId,args.data);
    const result = await this.query("INSERT INTO midas_private.records(table_id,id,owner_id,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(table_id,id) DO UPDATE SET data=records.data || EXCLUDED.data,updated_at=now() WHERE records.owner_id=EXCLUDED.owner_id RETURNING *",[args.tableId,args.rowId,owner,JSON.stringify(args.data)],args.transactionId);
    if (!result.rows[0]) throw new StoreError("Acceso no autorizado.",403);
    return map(result.rows[0]) as T;
  }
  async deleteRow(args: Args) {
    const params: unknown[] = [args.tableId,args.rowId];
    const scope = this.scope(args.tableId,params,true);
    const result = await this.query(`DELETE FROM midas_private.records WHERE table_id=$1 AND id=$2 AND ${scope} RETURNING id`,params,args.transactionId);
    if (!result.rows[0]) throw new StoreError("El registro no existe.",404);
  }
  async incrementRowColumn(args: Args & { column: string; value: number }) {
    if (args.tableId !== TABLES.sequences || args.column !== "last_number" || args.value !== 1) throw new StoreError("Contador no válido.",400);
    const params: unknown[] = [args.tableId,args.rowId];
    const scope = this.scope(args.tableId,params,true);
    const result = await this.query(`UPDATE midas_private.records SET data=jsonb_set(data,'{last_number}',to_jsonb(COALESCE((data->>'last_number')::bigint,0)+1)),updated_at=now() WHERE table_id=$1 AND id=$2 AND ${scope} RETURNING *`,params,args.transactionId);
    if (!result.rows[0]) throw new StoreError("El contador no existe.",404);
    return map(result.rows[0]);
  }
  async listRows<T extends MidasRow = MidasRow>({ tableId, queries = [] }: { databaseId?: string; tableId: string; queries?: string[]; total?: boolean }) {
    const params: unknown[] = [tableId];
    const where = ["table_id=$1", this.scope(tableId,params)];
    let limit = 500, cursor = "", order = "id", descending = false;
    const field = (key: string) => {
      if (key === "$createdAt") return "created_at";
      if (key === "$updatedAt") return "updated_at";
      if (key === "$id") return "id";
      if (!/^[a-z_][a-z0-9_]*$/.test(key)) throw new StoreError("Columna no válida.",400);
      return `COALESCE(data->>'${key}','')`;
    };
    for (const raw of queries) {
      const q = JSON.parse(raw) as Filter;
      if (q.method === "equal") {
        const column = field(q.attribute!);
        const clauses = q.values.map(value => { params.push(String(value)); return `${column}=$${params.length}`; });
        where.push(clauses.length ? `(${clauses.join(" OR ")})` : "FALSE");
      } else if (q.method === "limit") limit = Math.min(500,Math.max(1,Number(q.values[0]) || 1));
      else if (q.method === "cursorAfter") cursor = String(q.values[0]);
      else if (q.method === "orderDesc") { order = field(q.attribute!); descending = true; }
      else throw new StoreError("Consulta no compatible.",400);
    }
    if (cursor) {
      params.push(cursor);
      const n = params.length;
      // Cursor is scoped to the same owner and table, with an id tie-breaker.
      const cursorScope = this.scope(tableId, params);
      where.push(`(${order},id) ${descending ? "<" : ">"} (SELECT ${order},id FROM midas_private.records WHERE table_id=$1 AND id=$${n} AND ${cursorScope})`);
    }
    params.push(limit);
    const direction = descending ? "DESC" : "ASC";
    const result = await this.query(`SELECT * FROM midas_private.records WHERE ${where.join(" AND ")} ORDER BY ${order} ${direction},id ${direction} LIMIT $${params.length}`,params);
    return { rows: result.rows.map(map) as T[] };
  }
}
export async function listRows(tables: MidasTables, tableId: string, queries: string[] = [], limit = 500) {
  return (await tables.listRows({ tableId, queries: [...queries,Query.limit(limit)] })).rows;
}
export async function findRow(tables: MidasTables, tableId: string, queries: string[]) { return (await listRows(tables,tableId,queries,1))[0] ?? null; }
export async function listAllRows(tables: MidasTables, tableId: string, queries: string[] = []) {
  const rows: MidasRow[] = [];
  for (;;) {
    const page = await listRows(tables,tableId,[...queries,...(rows.length ? [Query.cursorAfter(rows[rows.length-1].$id)] : [])],100);
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}
export const createRow = (tables: MidasTables, tableId: string, rowId: string, data: Record<string,unknown>, transactionId?: string) => tables.createRow({tableId,rowId,data,transactionId});
export const updateRow = (tables: MidasTables, tableId: string, rowId: string, data: Record<string,unknown>, transactionId?: string) => tables.updateRow({tableId,rowId,data,transactionId});
export const upsertRow = (tables: MidasTables, tableId: string, rowId: string, data: Record<string,unknown>) => tables.upsertRow({tableId,rowId,data});
export const deleteRow = (tables: MidasTables, tableId: string, rowId: string, transactionId?: string) => tables.deleteRow({tableId,rowId,transactionId});
