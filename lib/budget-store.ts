import type { TablesDB } from "node-appwrite";
import { APPWRITE_DATABASE_ID, APPWRITE_TABLES, createRow, updateRow, listAllRows, Query, type AppwriteRow } from "./appwrite/server";
import { digest, sourceScope } from "./ledger";
import { mapCategory } from "./midas-data";
import { emptyProfile, type BudgetProfile, type BudgetCategory, categoryKey, planFor, validPeriod, confirmPeriod, INITIAL_PLAN, shiftPeriod, periodForDate, aliasKey, originalScope, isPlanned } from "./budgeting";

const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? Number(error.code) : 0;
const profileId = (userId: string) => `bp_${digest(userId)}`;
export async function loadBudgetProfile(tables: TablesDB, userId: string, categories: BudgetCategory[], transactionId?: string): Promise<BudgetProfile> {
  try {
    const row = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.budgetProfiles, rowId: profileId(userId), transactionId });
    if (row.user_id !== userId) throw new Error("El presupuesto no pertenece a esta cuenta.");
    const profile = JSON.parse(String(row.data)) as BudgetProfile;
    if (profile.version !== 1) throw new Error("Formato de presupuesto no compatible.");
    return profile;
  } catch (error) {
    if (errorCode(error) !== 404) throw error;
    return emptyProfile(categories, new Date().toISOString().slice(0, 7));
  }
}
function amount(value: unknown) {
  if (value === "" || value == null || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100000000) throw new Error("Indica un presupuesto válido mayor o igual a cero.");
  return Math.round(Number(value) * 100) / 100;
}
export async function budgetAction(tables: TablesDB, userId: string, payload: Record<string, unknown>) {
  const action = String(payload.action);
  const key = validPeriod(String(payload.targetPeriod || payload.monthKey));
  const rawCategories = await listAllRows(tables, APPWRITE_TABLES.categories, [Query.equal("user_id", userId)]);
  const categories = rawCategories.map(mapCategory);
  // A single private profile serializes period/plan/alias changes. Categories and
  // individual assignments commit in the same transaction; conflicts retry.
  for (let attempt = 0; attempt < 4; attempt++) {
    const tx = await tables.createTransaction();
    try {
      const profile = await loadBudgetProfile(tables, userId, categories, tx.$id);
      const plan = () => profile.budgets[key] ??= { ...planFor(profile, key) };
      const ownedCategory = async (id: string) => {
        const row = await tables.getRow<AppwriteRow>({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.categories, rowId: id, transactionId: tx.$id });
        if (row.user_id !== userId || row.archived) throw new Error("Selecciona una categoría activa de tu cuenta.");
        return row;
      };
      const ensureCategory = async (name: string, color: string, preserveColor = false) => {
        name = name.trim();
        if (!name || name.length > 128 || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Completa nombre y color válidos.");
        const equivalent = categories.find(c => categoryKey(c.name) === categoryKey(name));
        if (equivalent) {
          if (equivalent.archived) throw new Error("Ya existe una categoría archivada con ese nombre. Elige una categoría activa.");
          await ownedCategory(equivalent.id);
          if (!preserveColor) await updateRow(tables, APPWRITE_TABLES.categories, equivalent.id, { color }, tx.$id);
          return equivalent.id;
        }
        const id = `cat_${digest(userId + ":plan:" + categoryKey(name))}`;
        try { await createRow(tables, APPWRITE_TABLES.categories, id, { user_id: userId, name, color, group_name: "Programadas", kind: "variable", budget: 0, archived: false }, tx.$id); }
        catch (error) { if (errorCode(error) !== 409) throw error; await ownedCategory(id); }
        return id;
      };
      if (action === "budget_period") {
        confirmPeriod(profile, key, String(payload.start));
        if (payload.payrollNames !== undefined) {
          const names = String(payload.payrollNames).split(",").map(s => s.trim()).filter(Boolean);
          if (!names.length || names.length > 10 || names.some(s => s.length > 80)) throw new Error("Indica entre 1 y 10 nombres de sueldo, separados por comas.");
          profile.payrollNames = names;
        }
      } else if (action === "budget_initial") {
        if (key !== "2026-09") throw new Error("El presupuesto inicial corresponde a septiembre de 2026.");
        if (!profile.initialApplied) {
          for (const item of INITIAL_PLAN) {
            const id = await ensureCategory(item.name, item.color, true);
            if (Object.hasOwn(plan(), id) && plan()[id] !== item.budget) throw new Error(`Ya hay un presupuesto distinto para ${item.name}. Revísalo antes de aplicar el inicial.`);
            plan()[id] = item.budget;
          }
          if (profile.starts[key] && profile.starts[key] !== "2026-08-28") throw new Error("Septiembre ya tiene otra fecha de inicio. Revísala antes de aplicar el inicial.");
          confirmPeriod(profile, key, "2026-08-28");
          profile.initialApplied = true;
        }
      } else if (action === "budget_copy") {
        const previous = shiftPeriod(key, -1);
        if (Object.keys(planFor(profile, key)).length) throw new Error("El periodo ya tiene presupuesto. No se sobrescribirá.");
        const copy = Object.fromEntries(Object.entries(planFor(profile, previous)).filter(([id]) => categories.some(c => c.id === id && !c.archived)));
        if (!Object.keys(copy).length) throw new Error("El periodo anterior no tiene categorías programadas para copiar.");
        profile.budgets[key] = copy;
      } else if (action === "budget_category") {
        let id = String(payload.id || "");
        if (id) {
          const row = await ownedCategory(id);
          const name = String(payload.name || row.name).trim(), color = String(payload.color || row.color);
          if (!name || name.length > 128 || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Nombre o color inválido.");
          if (categories.some(c => c.id !== id && categoryKey(c.name) === categoryKey(name))) throw new Error("Ya existe una categoría con ese nombre.");
          const kind = String(payload.kind || row.kind);
          if (!["fixed", "variable", "discretionary"].includes(kind)) throw new Error("Tipo de categoría inválido.");
          await updateRow(tables, APPWRITE_TABLES.categories, id, { name, color, group_name: String(payload.groupName || row.group_name).slice(0, 128), kind }, tx.$id);
        } else {
          id = await ensureCategory(String(payload.name || ""), String(payload.color || "#CBA65B"));
          const kind = String(payload.kind || "variable");
          if (!["fixed", "variable", "discretionary"].includes(kind)) throw new Error("Tipo de categoría inválido.");
          await updateRow(tables, APPWRITE_TABLES.categories, id, { kind, group_name: String(payload.groupName || "Programadas").slice(0, 128) }, tx.$id);
        }
        plan()[id] = amount(payload.budget);
      } else if (action === "budget_remove") {
        await ownedCategory(String(payload.id));
        delete plan()[String(payload.id)];
      } else if (action === "budget_link") {
        let movement: AppwriteRow | undefined;
        let original: string, scope: string, period: string;
        if (payload.transactionId) {
          movement = await tables.getRow<AppwriteRow>({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.transactions, rowId: String(payload.transactionId), transactionId: tx.$id });
          if (movement.user_id !== userId || movement.type !== "expense") throw new Error("El gasto no existe o no pertenece a tu cuenta.");
          original = String(movement.source_category || categories.find(c => c.id === movement!.category_id)?.name || "");
          scope = originalScope(String(movement.source_id || ""));
          period = periodForDate(String(movement.date), profile.starts);
        } else {
          original = String(payload.original || "").trim();
          scope = sourceScope(String(payload.sourceUrl));
          const date = String(payload.date);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("Fecha de vista previa inválida.");
          period = periodForDate(date, profile.starts);
        }
        if (!original || original.length > 128) throw new Error("La categoría original no está disponible. Edita el gasto para asignarla.");
        if (period !== key) throw new Error("El gasto pertenece a otro periodo. Actualiza la vista y vuelve a vincularlo.");
        let target = String(payload.categoryId || "");
        if (payload.mode === "current" || payload.mode === "new") {
          const value = amount(payload.budget);
          target = await ensureCategory(payload.mode === "current" ? original : String(payload.name || ""), String(payload.color || "#CBA65B"));
          if (isPlanned(profile, key, target) && plan()[target] !== value) throw new Error("La categoría ya tiene presupuesto. Elígela de la lista; los importes no se aumentan al vincular.");
          plan()[target] = value;
        } else {
          await ownedCategory(target);
          if (!isPlanned(profile, key, target)) throw new Error("Selecciona una categoría programada para este periodo.");
        }
        if (payload.applyGroup === true || !movement) {
          if (!scope) throw new Error("Este registro no identifica archivo y pestaña. Vincúlalo individualmente.");
          profile.aliases[aliasKey(scope, original)] = target;
        }
        if (movement) await updateRow(tables, APPWRITE_TABLES.transactions, movement.$id, {
          source_category: original, category_id: target, category_override: true,
        }, tx.$id);
      } else throw new Error("Acción de presupuesto no reconocida.");
      const serialized = JSON.stringify(profile);
      if (new TextEncoder().encode(serialized).length > 60000) throw new Error("El historial de configuración alcanzó su límite. No se ha modificado nada.");
      try {
        await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.budgetProfiles, rowId: profileId(userId), transactionId: tx.$id });
        await updateRow(tables, APPWRITE_TABLES.budgetProfiles, profileId(userId), { data: serialized }, tx.$id);
      } catch (error) {
        if (errorCode(error) !== 404) throw error;
        await createRow(tables, APPWRITE_TABLES.budgetProfiles, profileId(userId), { user_id: userId, data: serialized }, tx.$id);
      }
      await tables.updateTransaction({ transactionId: tx.$id, commit: true });
      return;
    } catch (error) {
      await tables.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => undefined);
      if (errorCode(error) !== 409 || attempt === 3) throw error;
    }
  }
}
