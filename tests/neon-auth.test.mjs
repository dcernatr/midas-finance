import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import { PGlite } from "@electric-sql/pglite";

// Only the remote session and connection are substituted; auth decisions and
// ownership queries use the actual application code and embedded PostgreSQL.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "./neon-auth" && context.parentURL?.endsWith("/lib/auth.ts")) return { url: "midas-auth-test:session", shortCircuit: true };
  if (specifier === "./pool" && context.parentURL?.endsWith("/postgres/server.ts")) return { url: "midas-auth-test:pool", shortCircuit: true };
  if (context.parentURL?.endsWith(".ts") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
}, load(url, context, next) {
  if (url === "midas-auth-test:session") return { format: "module", shortCircuit: true, source: "export const getAuth = () => ({ getSession: async () => globalThis.__midasSession });" };
  if (url === "midas-auth-test:pool") return { format: "module", shortCircuit: true, source: "export const getPool = () => globalThis.__midasPool;" };
  return next(url, context);
} });
const { ensureContext, requireAdmin } = await import("../lib/auth.ts");
const { TABLES } = await import("../lib/postgres/server.ts");
const { rejectForeignOrigin } = await import("../lib/request-origin.ts");

test("Neon session validation, explicit verified admin and disabled/maintenance access", async t => {
  const db = new PGlite();
  const oldAdmin = process.env.MIDAS_ADMIN_EMAIL;
  t.after(async () => {
    if (oldAdmin === undefined) delete process.env.MIDAS_ADMIN_EMAIL;
    else process.env.MIDAS_ADMIN_EMAIL = oldAdmin;
    delete globalThis.__midasPool;
    delete globalThis.__midasSession;
    await db.close();
  });
  for (const file of (await readdir(new URL("../drizzle-neon/", import.meta.url))).filter(f => f.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL("../drizzle-neon/" + file, import.meta.url), "utf8"));
  globalThis.__midasPool = { query: (sql, values) => db.query(sql, values) };
  process.env.MIDAS_ADMIN_EMAIL = "owner@example.test";
  const session = (id, email = id + "@example.test", verified = true) => { globalThis.__midasSession = { data: { user: { id, email, emailVerified: verified, name: id } }, error: null }; };

  globalThis.__midasSession = { data: null, error: null };
  await assert.rejects(ensureContext, e => e.status === 401);
  globalThis.__midasSession = { data: null, error: { message: "upstream unavailable" } };
  await assert.rejects(ensureContext, e => e.status === 503);
  session("unverified", "owner@example.test", false);
  await assert.rejects(ensureContext, e => e.status === 403);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM midas_private.records")).rows[0].n, 0);

  session("first");
  const first = await ensureContext();
  assert.equal(first.user.role, "user", "the first registrant must not automatically become admin");
  await assert.rejects(requireAdmin, e => e.status === 403);
  session("owner");
  const admin = await requireAdmin();
  assert.equal(admin.user.role, "admin");
  assert.equal((await admin.tables.listRows({ tableId: TABLES.users })).rows.length, 2);
  await admin.tables.updateRow({ tableId: TABLES.users, rowId: "first", data: { status: "disabled" } });
  session("first");
  await assert.rejects(ensureContext, e => e.status === 403);
  await admin.tables.updateRow({ tableId: TABLES.users, rowId: "first", data: { status: "active" } });
  await admin.tables.upsertRow({ tableId: TABLES.settings, rowId: "maintenance_mode", data: { setting_key: "maintenance_mode", value: "true" } });
  await assert.rejects(ensureContext, e => e.status === 503);
  session("owner");
  assert.equal((await requireAdmin()).user.role, "admin");
});

test("browser mutations reject foreign origins before touching data", () => {
  const request = headers => new Request("https://midas.example.test/api/state", { method: "POST", headers });
  assert.equal(rejectForeignOrigin(request({ origin: "https://foreign.example.test" })).status, 403);
  assert.equal(rejectForeignOrigin(request({ origin: "null" })).status, 403);
  assert.equal(rejectForeignOrigin(request({ "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(rejectForeignOrigin(request({ origin: "https://midas.example.test" })), null);
  assert.equal(rejectForeignOrigin(request({})), null);
});
