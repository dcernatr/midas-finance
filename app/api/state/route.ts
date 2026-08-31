import type { TablesDB } from "node-appwrite";
import { authErrorResponse, ensureContext } from "../../../lib/auth";
import {
  APPWRITE_DATABASE_ID, APPWRITE_TABLES, Query, createRow, deleteRow, findRow,
  listRows, updateRow,
} from "../../../lib/appwrite/server";
import { mapCategory, mapDebt, mapMonth, mapSource, mapTransaction } from "../../../lib/midas-data";
import type { MidasUser } from "../../../lib/midas-data";

const DEFAULT_CATEGORIES = [
  ["Vivienda", "Necesidades", "#CBA65B", "fixed"],
  ["Alimentación", "Necesidades", "#54C7A0", "variable"],
  ["Transporte", "Necesidades", "#55A7E8", "variable"],
  ["Salud", "Bienestar", "#B879E0", "variable"],
  ["Educación", "Familia", "#F09B62", "fixed"],
  ["Entretenimiento", "Estilo de vida", "#E77070", "discretionary"],
  ["Otros", "Otros", "#8490A3", "variable"],
] as const;

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 35 - prefix.length)}`;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function ensureBaseState(tables: TablesDB, userId: string, monthKey: string) {
  const month = await findRow(tables, APPWRITE_TABLES.months, [
    Query.equal("user_id", userId), Query.equal("month_key", monthKey),
  ]);
  if (!month) {
    await createRow(tables, APPWRITE_TABLES.months, id("month"), {
      user_id: userId, month_key: monthKey, income: 0, savings_target: 0, status: "open",
    });
  }

  const category = await findRow(tables, APPWRITE_TABLES.categories, [Query.equal("user_id", userId)]);
  if (!category) {
    await Promise.all(DEFAULT_CATEGORIES.map(([name, groupName, color, kind]) => createRow(
      tables, APPWRITE_TABLES.categories, id("cat"),
      { user_id: userId, name, group_name: groupName, budget: 0, color, kind, archived: false },
    )));
  }
}

async function readState(tables: TablesDB, userId: string, monthKey: string, currentUser: MidasUser) {
  await ensureBaseState(tables, userId, monthKey);
  const [months, categories, transactions, debts, sources] = await Promise.all([
    listRows(tables, APPWRITE_TABLES.months, [Query.equal("user_id", userId), Query.equal("month_key", monthKey)], 1),
    listRows(tables, APPWRITE_TABLES.categories, [Query.equal("user_id", userId)]),
    listRows(tables, APPWRITE_TABLES.transactions, [Query.equal("user_id", userId), Query.orderDesc("date")]),
    listRows(tables, APPWRITE_TABLES.debts, [Query.equal("user_id", userId), Query.orderDesc("$createdAt")]),
    listRows(tables, APPWRITE_TABLES.sources, [Query.equal("user_id", userId)], 1),
  ]);
  return {
    month: months[0] ? mapMonth(months[0]) : null,
    categories: categories.map(mapCategory),
    transactions: transactions.map(mapTransaction),
    debts: debts.map(mapDebt),
    spreadsheetSource: sources[0] ? mapSource(sources[0]) : null,
    currentUser: { email: currentUser.email, displayName: currentUser.displayName, role: currentUser.role, status: currentUser.status },
  };
}

async function recordDebtPayment(tables: TablesDB, userId: string, values: {
  id: string; debtId: string; date: string; description: string; amount: number; account: string;
}) {
  const debt = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.debts, rowId: values.debtId });
  if (debt.user_id !== userId) throw new Error("La deuda no existe.");
  const transaction = await tables.createTransaction();
  try {
    await updateRow(tables, APPWRITE_TABLES.debts, values.debtId, {
      current_balance: Math.max(0, Number(debt.current_balance) - values.amount),
    }, transaction.$id);
    await createRow(tables, APPWRITE_TABLES.transactions, values.id, {
      user_id: userId, date: values.date, description: values.description, amount: values.amount,
      debt_id: values.debtId, type: "debt_payment", account: values.account, source_type: "manual",
    }, transaction.$id);
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    throw error;
  }
}

async function deleteTransaction(tables: TablesDB, userId: string, transactionId: string) {
  const row = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.transactions, rowId: transactionId });
  if (row.user_id !== userId) throw new Error("El movimiento no existe.");
  const transaction = await tables.createTransaction();
  try {
    if (row.type === "debt_payment" && row.debt_id) {
      const debt = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.debts, rowId: String(row.debt_id) });
      if (debt.user_id === userId) {
        await updateRow(tables, APPWRITE_TABLES.debts, String(row.debt_id), {
          current_balance: Number(debt.current_balance) + Number(row.amount),
        }, transaction.$id);
      }
    }
    await deleteRow(tables, APPWRITE_TABLES.transactions, transactionId, transaction.$id);
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
    return Response.json(await readState(tables, user.id, monthKey, user));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, tables } = await ensureContext();
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const monthKey = String(payload.monthKey ?? currentMonthKey());

    if (action === "set_month") {
      await ensureBaseState(tables, user.id, monthKey);
      const month = await findRow(tables, APPWRITE_TABLES.months, [Query.equal("user_id", user.id), Query.equal("month_key", monthKey)]);
      if (month) await updateRow(tables, APPWRITE_TABLES.months, month.$id, { income: Number(payload.income) || 0, savings_target: Number(payload.savingsTarget) || 0 });
    } else if (action === "add_category") {
      const name = String(payload.name ?? "").trim();
      if (!name) return Response.json({ error: "El nombre de categoría es obligatorio." }, { status: 400 });
      await createRow(tables, APPWRITE_TABLES.categories, id("cat"), {
        user_id: user.id, name, group_name: String(payload.groupName ?? "Otros"),
        color: String(payload.color ?? "#CBA65B"), kind: String(payload.kind ?? "variable"),
        budget: Number(payload.budget) || 0, archived: false,
      });
    } else if (action === "update_category") {
      const categoryId = String(payload.id ?? "");
      const category = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.categories, rowId: categoryId });
      if (category.user_id !== user.id) return Response.json({ error: "La categoría no existe." }, { status: 404 });
      const color = String(payload.color ?? "");
      const kind = String(payload.kind ?? "");
      const changes: Record<string, unknown> = { budget: Math.max(0, Number(payload.budget) || 0) };
      const name = String(payload.name ?? "").trim();
      const groupName = String(payload.groupName ?? "").trim();
      if (name) changes.name = name;
      if (groupName) changes.group_name = groupName;
      if (/^#[0-9a-f]{6}$/i.test(color)) changes.color = color;
      if (["fixed", "variable", "discretionary"].includes(kind)) changes.kind = kind;
      await updateRow(tables, APPWRITE_TABLES.categories, categoryId, changes);
    } else if (action === "archive_category") {
      const categoryId = String(payload.id ?? "");
      const category = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.categories, rowId: categoryId });
      if (category.user_id === user.id) await updateRow(tables, APPWRITE_TABLES.categories, categoryId, { archived: true });
    } else if (action === "add_transaction") {
      const amount = Number(payload.amount);
      if (!(amount > 0)) return Response.json({ error: "Ingresa un monto mayor a cero." }, { status: 400 });
      const type = String(payload.type ?? "expense");
      const debtId = payload.debtId ? String(payload.debtId) : "";
      const values = {
        id: id("txn"), debtId,
        date: String(payload.date ?? new Date().toISOString().slice(0, 10)),
        description: String(payload.description ?? "Movimiento").trim() || "Movimiento",
        amount, account: String(payload.account ?? "Efectivo"),
      };
      if (type === "debt_payment" && debtId) {
        await recordDebtPayment(tables, user.id, values);
      } else {
        await createRow(tables, APPWRITE_TABLES.transactions, values.id, {
          user_id: user.id, date: values.date, description: values.description, amount,
          category_id: payload.categoryId ? String(payload.categoryId) : undefined,
          debt_id: debtId || undefined, type, account: values.account, source_type: "manual",
        });
      }
    } else if (action === "delete_transaction") {
      await deleteTransaction(tables, user.id, String(payload.id ?? ""));
    } else if (action === "update_transaction") {
      const transactionId = String(payload.id ?? "");
      const row = await tables.getRow({ databaseId: APPWRITE_DATABASE_ID, tableId: APPWRITE_TABLES.transactions, rowId: transactionId });
      if (row.user_id !== user.id) return Response.json({ error: "El movimiento no existe." }, { status: 404 });
      const existing = mapTransaction(row);
      if (existing.type === "debt_payment") return Response.json({ error: "Para modificar un pago de deuda, elimínalo y regístralo nuevamente." }, { status: 400 });
      const amount = Number(payload.amount);
      if (!(amount > 0)) return Response.json({ error: "Ingresa un monto mayor a cero." }, { status: 400 });
      await updateRow(tables, APPWRITE_TABLES.transactions, transactionId, {
        date: String(payload.date ?? existing.date), description: String(payload.description ?? existing.description).trim() || existing.description,
        amount, category_id: payload.categoryId ? String(payload.categoryId) : null,
        type: String(payload.type ?? existing.type), account: String(payload.account ?? existing.account),
      });
    } else if (action === "add_debt") {
      const name = String(payload.name ?? "").trim();
      const currentBalance = Number(payload.currentBalance);
      if (!name || !(currentBalance > 0)) return Response.json({ error: "Completa nombre y saldo actual." }, { status: 400 });
      await createRow(tables, APPWRITE_TABLES.debts, id("debt"), {
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
