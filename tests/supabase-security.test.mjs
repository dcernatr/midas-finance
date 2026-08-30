import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260830174317_initial_midas_shared_terran.sql",
  import.meta.url,
);

test("enables RLS on every exposed MIDAS table", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const tables = [
    "users", "financial_months", "categories", "debts", "transactions",
    "spreadsheet_sources", "spreadsheet_sync_logs", "activity_logs", "system_settings",
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.midas_${table} enable row level security;`));
  }
  assert.doesNotMatch(sql, /revoke all on all tables in schema public/i);
  assert.match(sql, /revoke all on table\s+public\.midas_users,/);
});

test("scopes user-owned rows and protects admin lookup", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /create or replace function midas_private\.is_admin\(\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke all on function midas_private\.is_admin\(\) from public, anon;/);
  assert.doesNotMatch(sql, /auth\.role\(\)/);
});

test("namespaces every MIDAS database object away from TERRAN", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(sql, /create table public\.(?!midas_)/i);
  assert.doesNotMatch(sql, /\b(?:alter|drop|truncate) table public\.(?!midas_)/i);
  assert.doesNotMatch(sql, /\b(?:insert into|update|delete from) public\.(?!midas_)/i);
});
