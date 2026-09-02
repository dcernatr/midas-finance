// Additive, private configuration only. No financial rows or budgets are seeded
// during deployment; each signed-in account confirms its own initialization.
export async function ensureBudgetSchema(tables, databaseId) {
  const tableId = "midas_budget_profiles";
  const columns = [{ key: "user_id", type: "varchar", size: 36, required: true }, { key: "data", type: "text", required: true }];
  try { await tables.getTable({ databaseId, tableId }); }
  catch (error) {
    if (error?.code !== 404) throw error;
    try { await tables.createTable({ databaseId, tableId, name: "MIDAS Budget Profiles", permissions: [], rowSecurity: false, enabled: true, columns,
      indexes: [{ key: "budget_profile_user", type: "unique", attributes: ["user_id"] }] }); }
    catch (createError) { if (createError?.code !== 409) throw createError; }
  }
  for (const column of [{ key: "source_category", size: 128 }, { key: "category_override", type: "boolean" }]) {
    const args = { databaseId, tableId: "midas_transactions", key: column.key };
    try { await tables.getColumn(args); }
    catch (error) {
      if (error?.code !== 404) throw error;
      try {
        if (column.type === "boolean") await tables.createBooleanColumn({ ...args, required: false });
        else await tables.createVarcharColumn({ ...args, size: column.size, required: false });
      } catch (createError) { if (createError?.code !== 409) throw createError; }
    }
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const profile = await tables.getTable({ databaseId, tableId });
    const extra = await Promise.all(["source_category", "category_override"].map(key => tables.getColumn({ databaseId, tableId: "midas_transactions", key })));
    const all = [...columns.map(c => profile.columns?.find(p => p.key === c.key)), ...extra];
    if (all.some(c => c?.status === "failed")) throw new Error("No se pudo preparar el presupuesto por periodo.");
    if (all.every(c => c?.status === "available")) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("El esquema de presupuestos aún no está disponible.");
}
