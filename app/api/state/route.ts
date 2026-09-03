import { rejectForeignOrigin } from "../../../lib/request-origin";
import type { MidasTables } from "../../../lib/postgres/server";
import { authErrorResponse, ensureContext } from "../../../lib/auth";
import {
  DATABASE_ID, TABLES, Query, createRow, deleteRow, findRow,
  listRows, listAllRows, updateRow,
} from "../../../lib/postgres/server";
import { mapCategory, mapDebt, mapMonth, mapSource, mapTransaction } from "../../../lib/midas-data";
import type { MidasUser } from "../../../lib/midas-data";
import { withMovementCode, ensureMovementCodes } from "../../../lib/ledger-store";
import { codePrefix, digest } from "../../../lib/ledger";
import { normalizeDate } from "../../../lib/spreadsheet";
import { loadBudgetProfile, budgetAction } from "../../../lib/budget-store";
import { validPeriod, planFor, periodWindow, resolveCategory } from "../../../lib/budgeting";

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 35 - prefix.length)}`;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function ensureBaseState(tables: MidasTables, userId: string, monthKey: string) {
  const month = await findRow(tables, TABLES.months, [
    Query.equal("user_id", userId), Query.equal("month_key", monthKey),
  ]);
  if (!month) {
    try { await createRow(tables, TABLES.months, `month_${digest(userId + ":" + monthKey)}`, {
      user_id: userId, month_key: monthKey, income: 0, savings_target: 0, status: "open",
    }); } catch (error) { if ((error as { code?: number }).code !== 409) throw error; }
  }

}

async function readState(tables: MidasTables, userId: string, monthKey: string, currentUser: MidasUser) {
  validPeriod(monthKey);
  await ensureBaseState(tables, userId, monthKey);
  const [months, categories, transactions, debts, sources] = await Promise.all([
    listRows(tables, TABLES.months, [Query.equal("user_id", userId), Query.equal("month_key", monthKey)], 1),
    listAllRows(tables, TABLES.categories, [Query.equal("user_id", userId)]),
    listAllRows(tables, TABLES.transactions, [Query.equal("user_id", userId), Query.orderDesc("date")]),
    listRows(tables, TABLES.debts, [Query.equal("user_id", userId), Query.orderDesc("$createdAt")]),
    listRows(tables, TABLES.sources, [Query.equal("user_id", userId)], 1),
  ]);
  const mappedCategories = categories.map(mapCategory);
  const budgetProfile = await loadBudgetProfile(tables, userId, mappedCategories);
  const plan = planFor(budgetProfile, monthKey);
  return {
    budgetProfile, period: periodWindow(monthKey, budgetProfile.starts),
    month: months[0] ? mapMonth(months[0]) : null,
    categories: mappedCategories.map(c => ({ ...c, budget: plan[c.id] ?? 0, planned: Object.hasOwn(plan, c.id) })),
    transactions: (await ensureMovementCodes(tables, userId, transactions)).map(row => { const movement = mapTransaction(row); return { ...movement, ...resolveCategory(movement, mappedCategories, budgetProfile) }; }),
    debts: debts.map(mapDebt),
    spreadsheetSource: sources[0] ? mapSource(sources[0]) : null,
    currentUser: { email: currentUser.email, displayName: currentUser.displayName, role: currentUser.role, status: currentUser.status },
  };
}

async function recordDebtPayment(tables: MidasTables, userId: string, values: {
  id: string; debtId: string; date: string; description: string; amount: number; account: string;
}) {
  const debt = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLES.debts, rowId: values.debtId });
  if (debt.user_id !== userId) throw new Error("La deuda no existe.");
  await withMovementCode(tables, userId, values.date, "debt_payment", async (code, transactionId) => {
    const currentDebt = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLES.debts, rowId: values.debtId, transactionId });
    await updateRow(tables, TABLES.debts, values.debtId, {
      current_balance: Math.max(0, Number(currentDebt.current_balance) - values.amount),
    }, transactionId);
    await createRow(tables, TABLES.transactions, values.id, {
      user_id: userId, date: values.date, description: values.description, amount: values.amount,
      debt_id: values.debtId, type: "debt_payment", account: values.account, source_type: "manual", midas_code: code,
    }, transactionId);
  });
}

async function deleteTransaction(tables: MidasTables, userId: string, transactionId: string) {
  const transaction = await tables.createTransaction();
  try {
    const row = await tables.getRow({ tableId: TABLES.transactions, rowId: transactionId, transactionId: transaction.$id });
    if (row.user_id !== userId) throw new Error("El movimiento no existe.");
    if (row.type === "debt_payment" && row.debt_id) {
      const debt = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLES.debts, rowId: String(row.debt_id), transactionId: transaction.$id });
      if (debt.user_id === userId) {
        await updateRow(tables, TABLES.debts, String(row.debt_id), {
          current_balance: Number(debt.current_balance) + Number(row.amount),
        }, transaction.$id);
      }
    }
    await deleteRow(tables, TABLES.transactions, transactionId, transaction.$id);
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const { user, tables } = await ensureContext({ logAccess: true });
    const monthKey = new URL(request.url).searchParams.get("month") ?? currentMonthKey();
    return Response.json(await readState(tables, user.id, monthKey, user), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  try {
    const { user, tables } = await ensureContext();
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const monthKey = validPeriod(String(payload.monthKey ?? currentMonthKey()));

    if (action.startsWith("budget_")) {
      await budgetAction(tables, user.id, payload);
    } else if (["add_category", "update_category"].includes(action)) {
      await budgetAction(tables, user.id, { ...payload, action: "budget_category" });
    } else if (action === "set_month") {
      await ensureBaseState(tables, user.id, monthKey);
      const month = await findRow(tables, TABLES.months, [Query.equal("user_id", user.id), Query.equal("month_key", monthKey)]);
      const fields: Record<string, number> = {};
      for (const [input, column] of [["income", "income"], ["savingsTarget", "savings_target"]]) {
        if (payload[input] === undefined) continue;
        const value = Number(payload[input]);
        if (payload[input] === "" || payload[input] === null || !Number.isFinite(value) || value < 0) throw new Error("Indica un importe válido mayor o igual a cero.");
        fields[column] = Math.round(value * 100) / 100;
      }
      if (month && Object.keys(fields).length) await updateRow(tables, TABLES.months, month.$id, fields);
    } else if (action === "archive_category") {
      await budgetAction(tables, user.id, { ...payload, action: "budget_remove" });
    } else if (action === "add_transaction") {
      const amount = Number(payload.amount);
      if (!Number.isFinite(amount) || !(amount > 0)) return Response.json({ error: "Ingresa un monto válido mayor a cero." }, { status: 400 });
      const type = String(payload.type ?? "expense");
      if (!["income", "expense", "debt_payment"].includes(type)) return Response.json({ error: "Tipo de movimiento inválido." }, { status: 400 });
      const debtId = payload.debtId ? String(payload.debtId) : "";
      if (type === "debt_payment" && !debtId) return Response.json({ error: "Selecciona una deuda." }, { status: 400 });
      if (payload.categoryId && type !== "debt_payment") {
        const category = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLES.categories, rowId: String(payload.categoryId) });
        if (category.user_id !== user.id || category.archived) return Response.json({ error: "La categoría no está disponible para tu cuenta." }, { status: 400 });
      }
      const values = {
        id: id("txn"), debtId,
        date: normalizeDate(String(payload.date ?? new Date().toISOString().slice(0, 10))),
        description: String(payload.description ?? "Movimiento").trim() || "Movimiento",
        amount, account: String(payload.account ?? "Efectivo"),
      };
      if (type === "debt_payment" && debtId) {
        await recordDebtPayment(tables, user.id, values);
      } else {
        await withMovementCode(tables, user.id, values.date, type, (code, transactionId) => createRow(tables, TABLES.transactions, values.id, {
          user_id: user.id, date: values.date, description: values.description, amount,
          category_id: payload.categoryId ? String(payload.categoryId) : undefined,
          debt_id: debtId || undefined, type, account: values.account, source_type: "manual", midas_code: code,
        }, transactionId));
      }
    } else if (action === "delete_transaction") {
      await deleteTransaction(tables, user.id, String(payload.id ?? ""));
    } else if (action === "update_transaction") {
      const transactionId = String(payload.id ?? "");
      const row = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLES.transactions, rowId: transactionId });
      if (row.user_id !== user.id) return Response.json({ error: "El movimiento no existe." }, { status: 404 });
      const existing = mapTransaction(row);
      if (existing.type === "debt_payment") return Response.json({ error: "Para modificar un pago de deuda, elimínalo y regístralo nuevamente." }, { status: 400 });
      const amount = Number(payload.amount);
      if (!Number.isFinite(amount) || !(amount > 0)) return Response.json({ error: "Ingresa un monto válido mayor a cero." }, { status: 400 });
      const date = normalizeDate(String(payload.date ?? existing.date));
      const type = String(payload.type ?? existing.type);
      if (!["income", "expense"].includes(type)) return Response.json({ error: "Tipo de movimiento inválido." }, { status: 400 });
      if (payload.categoryId) {
        const category = await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLES.categories, rowId: String(payload.categoryId) });
        if (category.user_id !== user.id || category.archived) return Response.json({ error: "La categoría no está disponible para tu cuenta." }, { status: 400 });
      }
      const originalCategory = row.source_category || (row.category_id ? (await tables.getRow({ databaseId: DATABASE_ID, tableId: TABLES.categories, rowId: String(row.category_id) })).name : "");
      const changes = {
        source_category: String(originalCategory), category_override: true,
        date, description: String(payload.description ?? existing.description).trim() || existing.description,
        amount, category_id: payload.categoryId ? String(payload.categoryId) : null,
        type, account: String(payload.account ?? existing.account),
      };
      if (!existing.code || !existing.code.startsWith(codePrefix(date, type) + "-")) {
        await withMovementCode(tables, user.id, date, type, (code, txId) => updateRow(tables, TABLES.transactions, transactionId, { ...changes, midas_code: code }, txId));
      } else await updateRow(tables, TABLES.transactions, transactionId, changes);
    } else if (action === "add_debt") {
      const name = String(payload.name ?? "").trim();
      const currentBalance = Number(payload.currentBalance);
      if (!name || !(currentBalance > 0)) return Response.json({ error: "Completa nombre y saldo actual." }, { status: 400 });
      await createRow(tables, TABLES.debts, id("debt"), {
        user_id: user.id, name, entity: String(payload.entity ?? ""),
        original_amount: Number(payload.originalAmount) || currentBalance, current_balance: currentBalance,
        annual_rate: Math.max(0, Number(payload.annualRate) || 0), minimum_payment: Math.max(0, Number(payload.minimumPayment) || 0),
        planned_payment: Math.max(0, Number(payload.plannedPayment) || 0), due_day: Math.min(31, Math.max(1, Number(payload.dueDay) || 1)),
        acquired_at: String(payload.acquiredAt ?? new Date().toISOString().slice(0, 10)), status: "active",
      });
    } else {
      return Response.json({ error: "Acción no reconocida." }, { status: 400 });
    }

    return Response.json(await readState(tables, user.id, monthKey, user));
  } catch (error) {
    return authErrorResponse(error);
  }
}
