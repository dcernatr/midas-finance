import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { categories, debts, financialMonths, spreadsheetSources, systemSettings, transactions } from "../../../db/schema";
import { authErrorResponse, ensureUser } from "../../../lib/auth";

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
  return `${prefix}_${crypto.randomUUID()}`;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function ensureBaseState(user: string, monthKey: string) {
  const db = getDb();
  const [month] = await db.select().from(financialMonths).where(and(eq(financialMonths.userKey, user), eq(financialMonths.monthKey, monthKey))).limit(1);
  if (!month) {
    await db.insert(financialMonths).values({ id: id("month"), userKey: user, monthKey });
  }
  const existingCategories = await db.select({ id: categories.id }).from(categories).where(eq(categories.userKey, user)).limit(1);
  if (!existingCategories.length) {
    await db.insert(categories).values(DEFAULT_CATEGORIES.map(([name, groupName, color, kind]) => ({
      id: id("cat"), userKey: user, name, groupName, color, kind,
    })));
  }
}

async function readState(userKey: string, monthKey: string, currentUser: Awaited<ReturnType<typeof ensureUser>>) {
  await ensureBaseState(userKey, monthKey);
  const db = getDb();
  const [monthRows, categoryRows, transactionRows, debtRows, sourceRows] = await Promise.all([
    db.select().from(financialMonths).where(and(eq(financialMonths.userKey, userKey), eq(financialMonths.monthKey, monthKey))).limit(1),
    db.select().from(categories).where(eq(categories.userKey, userKey)),
    db.select().from(transactions).where(eq(transactions.userKey, userKey)).orderBy(desc(transactions.date), desc(transactions.createdAt)),
    db.select().from(debts).where(eq(debts.userKey, userKey)).orderBy(desc(debts.createdAt)),
    db.select().from(spreadsheetSources).where(eq(spreadsheetSources.userKey, userKey)).limit(1),
  ]);
  return {
    month: monthRows[0], categories: categoryRows, transactions: transactionRows, debts: debtRows,
    spreadsheetSource: sourceRows[0] ?? null,
    currentUser: { email: currentUser.email, displayName: currentUser.displayName, role: currentUser.role, status: currentUser.status },
  };
}

export async function GET(request: Request) {
  try {
    const currentUser = await ensureUser({ logAccess: true });
    const user = currentUser.id;
    const db = getDb();
    const [maintenance] = await db.select().from(systemSettings).where(eq(systemSettings.key, "maintenance_mode")).limit(1);
    if (maintenance?.value === "true" && currentUser.role !== "admin") {
      return Response.json({ error: "MIDAS se encuentra temporalmente en mantenimiento." }, { status: 503 });
    }
    const monthKey = new URL(request.url).searchParams.get("month") ?? currentMonthKey();
    return Response.json(await readState(user, monthKey, currentUser));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await ensureUser();
    const user = currentUser.id;
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const monthKey = String(payload.monthKey ?? currentMonthKey());
    const db = getDb();

    if (action === "set_month") {
      await ensureBaseState(user, monthKey);
      await db.update(financialMonths).set({ income: Number(payload.income) || 0, savingsTarget: Number(payload.savingsTarget) || 0 })
        .where(and(eq(financialMonths.userKey, user), eq(financialMonths.monthKey, monthKey)));
    } else if (action === "add_category") {
      const name = String(payload.name ?? "").trim();
      if (!name) return Response.json({ error: "El nombre de categoría es obligatorio." }, { status: 400 });
      await db.insert(categories).values({ id: id("cat"), userKey: user, name, groupName: String(payload.groupName ?? "Otros"), color: String(payload.color ?? "#CBA65B"), kind: String(payload.kind ?? "variable"), budget: Number(payload.budget) || 0 });
    } else if (action === "update_category") {
      const categoryId = String(payload.id ?? "");
      const color = String(payload.color ?? "");
      const kind = String(payload.kind ?? "");
      await db.update(categories).set({
        budget: Math.max(0, Number(payload.budget) || 0),
        name: String(payload.name ?? "").trim() || undefined,
        groupName: String(payload.groupName ?? "").trim() || undefined,
        color: /^#[0-9a-f]{6}$/i.test(color) ? color : undefined,
        kind: ["fixed", "variable", "discretionary"].includes(kind) ? kind : undefined,
      })
        .where(and(eq(categories.id, categoryId), eq(categories.userKey, user)));
    } else if (action === "archive_category") {
      await db.update(categories).set({ archived: true }).where(and(eq(categories.id, String(payload.id ?? "")), eq(categories.userKey, user)));
    } else if (action === "add_transaction") {
      const amount = Number(payload.amount);
      if (!(amount > 0)) return Response.json({ error: "Ingresa un monto mayor a cero." }, { status: 400 });
      const type = String(payload.type ?? "expense");
      const debtId = payload.debtId ? String(payload.debtId) : null;
      const transactionId = id("txn");
      const values = { id: transactionId, userKey: user, date: String(payload.date ?? new Date().toISOString().slice(0, 10)), description: String(payload.description ?? "Movimiento").trim() || "Movimiento", amount, categoryId: payload.categoryId ? String(payload.categoryId) : null, debtId, type, account: String(payload.account ?? "Efectivo"), sourceType: "manual" };
      if (type === "debt_payment" && debtId) {
        const [debt] = await db.select().from(debts).where(and(eq(debts.id, debtId), eq(debts.userKey, user))).limit(1);
        if (!debt) return Response.json({ error: "La deuda seleccionada no existe." }, { status: 400 });
        await db.transaction(async tx => {
          await tx.insert(transactions).values(values);
          await tx.update(debts).set({ currentBalance: Math.max(0, debt.currentBalance - amount) }).where(and(eq(debts.id, debtId), eq(debts.userKey, user)));
        });
      } else {
        await db.insert(transactions).values(values);
      }
    } else if (action === "delete_transaction") {
      const transactionId = String(payload.id ?? "");
      const [transaction] = await db.select().from(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.userKey, user))).limit(1);
      if (transaction?.type === "debt_payment" && transaction.debtId) {
        const [debt] = await db.select().from(debts).where(and(eq(debts.id, transaction.debtId), eq(debts.userKey, user))).limit(1);
        if (debt) {
          await db.transaction(async tx => {
            await tx.update(debts).set({ currentBalance: debt.currentBalance + transaction.amount }).where(and(eq(debts.id, debt.id), eq(debts.userKey, user)));
            await tx.delete(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.userKey, user)));
          });
        }
      } else {
        await db.delete(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.userKey, user)));
      }
    } else if (action === "update_transaction") {
      const transactionId = String(payload.id ?? "");
      const [transaction] = await db.select().from(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.userKey, user))).limit(1);
      if (!transaction) return Response.json({ error: "El movimiento no existe." }, { status: 404 });
      if (transaction.type === "debt_payment") return Response.json({ error: "Para modificar un pago de deuda, elimínalo y regístralo nuevamente." }, { status: 400 });
      const amount = Number(payload.amount);
      if (!(amount > 0)) return Response.json({ error: "Ingresa un monto mayor a cero." }, { status: 400 });
      await db.update(transactions).set({
        date: String(payload.date ?? transaction.date),
        description: String(payload.description ?? transaction.description).trim() || transaction.description,
        amount,
        categoryId: payload.categoryId ? String(payload.categoryId) : null,
        type: String(payload.type ?? transaction.type),
        account: String(payload.account ?? transaction.account),
      }).where(and(eq(transactions.id, transactionId), eq(transactions.userKey, user)));
    } else if (action === "add_debt") {
      const name = String(payload.name ?? "").trim();
      const currentBalance = Number(payload.currentBalance);
      if (!name || !(currentBalance > 0)) return Response.json({ error: "Completa nombre y saldo actual." }, { status: 400 });
      await db.insert(debts).values({ id: id("debt"), userKey: user, name, entity: String(payload.entity ?? ""), originalAmount: Number(payload.originalAmount) || currentBalance, currentBalance, annualRate: Math.max(0, Number(payload.annualRate) || 0), minimumPayment: Math.max(0, Number(payload.minimumPayment) || 0), plannedPayment: Math.max(0, Number(payload.plannedPayment) || 0), dueDay: Math.min(31, Math.max(1, Number(payload.dueDay) || 1)), acquiredAt: String(payload.acquiredAt ?? new Date().toISOString().slice(0, 10)) });
    } else {
      return Response.json({ error: "Acción no reconocida." }, { status: 400 });
    }

    return Response.json(await readState(user, monthKey, currentUser));
  } catch (error) {
    return authErrorResponse(error);
  }
}
