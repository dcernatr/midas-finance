import test from "node:test";
import assert from "node:assert/strict";
import { ensureBudgetSchema } from "../scripts/budget-schema.mjs";
test("budget migration is additive, private and idempotent without seeding personal data", async () => {
  let profile; const columns = new Map();
  const tables = {
    async getTable() { if (!profile) throw { code: 404 }; return profile; },
    async createTable(args) { profile = { ...args, columns: args.columns.map(c => ({ ...c, status: "available" })) }; },
    async getColumn({ key }) { if (!columns.has(key)) throw { code: 404 }; return columns.get(key); },
    async createVarcharColumn(args) { columns.set(args.key, { ...args, status: "available" }); },
    async createBooleanColumn(args) { columns.set(args.key, { ...args, status: "available" }); },
    async createRow() { throw new Error("Never seed personal data during migration"); },
  };
  await ensureBudgetSchema(tables, "midas");
  assert.deepEqual(profile.permissions, []);
  assert.equal(profile.tableId, "midas_budget_profiles");
  assert.equal(columns.get("source_category").required, false);
  assert.equal(columns.get("category_override").required, false);
  await ensureBudgetSchema(tables, "midas");
  await assert.rejects(ensureBudgetSchema({ getTable: async () => { throw { code: 403 }; } }, "midas"), e => e.code === 403);
});
