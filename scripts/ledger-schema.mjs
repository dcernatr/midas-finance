export async function ensureLedgerSchema(tables, databaseId) {
  const tableId = "midas_transactions";
  try {
    await tables.getColumn({ databaseId, tableId, key: "midas_code" });
  } catch (error) {
    if (error?.code !== 404) throw error;
    try { await tables.createVarcharColumn({ databaseId, tableId, key: "midas_code", size: 32, required: false }); }
    catch (createError) { if (createError?.code !== 409) throw createError; }
  }
  let available = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const column = await tables.getColumn({ databaseId, tableId, key: "midas_code" });
    if (column.status === "available") { available = true; break; }
    if (column.status === "failed") throw new Error("No se pudo preparar midas_code.");
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!available) throw new Error("midas_code sigue preparándose. Repite la migración antes de publicar.");
  try {
    await tables.getTable({ databaseId, tableId: "midas_transaction_sequences" });
  } catch (error) {
    if (error?.code !== 404) throw error;
    try {
      await tables.createTable({ databaseId, tableId: "midas_transaction_sequences", name: "MIDAS Transaction Sequences",
        permissions: [], rowSecurity: false, enabled: true,
        columns: [
          { key: "user_id", type: "varchar", size: 36, required: true },
          { key: "period", type: "varchar", size: 7, required: true },
          { key: "kind", type: "varchar", size: 1, required: true },
          { key: "last_number", type: "integer", required: true },
        ], indexes: [{ key: "sequence_user_period_kind", type: "unique", attributes: ["user_id", "period", "kind"] }],
      });
    } catch (createError) { if (createError?.code !== 409) throw createError; }
  }
  const required = ["user_id", "period", "kind", "last_number"];
  let sequenceReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const table = await tables.getTable({ databaseId, tableId: "midas_transaction_sequences" });
    const columns = required.map(key => table.columns?.find(column => column.key === key));
    if (columns.some(column => column?.status === "failed")) throw new Error("No se pudo preparar la secuencia MIDAS.");
    if (columns.every(column => column?.status === "available")) { sequenceReady = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!sequenceReady) throw new Error("La secuencia sigue preparándose. Repite la migración antes de publicar.");
  console.log("Codificación MIDAS preparada; datos anteriores conservados.");
}
