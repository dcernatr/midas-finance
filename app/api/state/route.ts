import type { SupabaseClient } from "@supabase/supabase-js";
import { authErrorResponse, ensureContext } from "../../../lib/auth";
import {
  dataOrThrow, mapCategory, mapDebt, mapMonth, mapSource, mapTransaction,
} from "../../../lib/midas-data";
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
  return `${prefix}_${crypto.randomUUID()}`;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function ensureBaseState(supabase: SupabaseClient, userId: string, monthKey: string) {
  const monthResult = await supabase.from("midas_financial_months").select("id").eq("user_id", userId).eq("month_key", monthKey).maybeSingle();
  if (monthResult.error) throw new Error(monthResult.error.message);
  if (!monthResult.data) {
    dataOrThrow(await supabase.from("midas_financial_months").insert({ id: id("month"), user_id: userId, month_key: monthKey }));
  }

  const categoriesResult = await supabase.from("midas_categories").select("id").eq("user_id", userId).limit(1);
  const existingCategories = dataOrThrow(categoriesResult);
  if (!existingCategories.length) {
    dataOrThrow(await supabase.from("midas_categories").insert(DEFAULT_CATEGORIES.map(([name, groupName, color, kind]) => ({
      id: id("cat"), user_id: userId, name, group_name: groupName, color, kind,
    }))));
  }
}

async function readState(supabase: SupabaseClient, userId: string, monthKey: string, currentUser: MidasUser) {
  await ensureBaseState(supabase, userId, monthKey);
  const [monthsResult, categoriesResult, transactionsResult, debtsResult, sourcesResult] = await Promise.all([
    supabase.from("midas_financial_months").select("*").eq("user_id", userId).eq("month_key", monthKey).limit(1),
    supabase.from("midas_categories").select("*").eq("user_id", userId),
    supabase.from("midas_transactions").select("*").eq("user_id", userId).order("date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("midas_debts").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("midas_spreadsheet_sources").select("*").eq("user_id", userId).limit(1),
  ]);
  const months = dataOrThrow(monthsResult).map(mapMonth);
  const categories = dataOrThrow(categoriesResult).map(mapCategory);
  const transactions = dataOrThrow(transactionsResult).map(mapTransaction);
  const debts = dataOrThrow(debtsResult).map(mapDebt);
  const sources = dataOrThrow(sourcesResult).map(mapSource);
  return {
    month: months[0], categories, transactions, debts,
    spreadsheetSource: sources[0] ?? null,
    currentUser: { email: currentUser.email, displayName: currentUser.displayName, role: currentUser.role, status: currentUser.status },
  };
}

export async function GET(request: Request) {
  try {
    const { user, supabase } = await ensureContext({ logAccess: true });
    const monthKey = new URL(request.url).searchParams.get("month") ?? currentMonthKey();
    return Response.json(await readState(supabase, user.id, monthKey, user));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await ensureContext();
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const monthKey = String(payload.monthKey ?? currentMonthKey());

    if (action === "set_month") {
      await ensureBaseState(supabase, user.id, monthKey);
      dataOrThrow(await supabase.from("midas_financial_months").update({ income: Number(payload.income) || 0, savings_target: Number(payload.savingsTarget) || 0 }).eq("user_id", user.id).eq("month_key", monthKey));
    } else if (action === "add_category") {
      const name = String(payload.name ?? "").trim();
      if (!name) return Response.json({ error: "El nombre de categoría es obligatorio." }, { status: 400 });
      dataOrThrow(await supabase.from("midas_categories").insert({ id: id("cat"), user_id: user.id, name, group_name: String(payload.groupName ?? "Otros"), color: String(payload.color ?? "#CBA65B"), kind: String(payload.kind ?? "variable"), budget: Number(payload.budget) || 0 }));
    } else if (action === "update_category") {
      const color = String(payload.color ?? "");
      const kind = String(payload.kind ?? "");
      const changes: Record<string, unknown> = { budget: Math.max(0, Number(payload.budget) || 0) };
      const name = String(payload.name ?? "").trim();
      const groupName = String(payload.groupName ?? "").trim();
      if (name) changes.name = name;
      if (groupName) changes.group_name = groupName;
      if (/^#[0-9a-f]{6}$/i.test(color)) changes.color = color;
      if (["fixed", "variable", "discretionary"].includes(kind)) changes.kind = kind;
      dataOrThrow(await supabase.from("midas_categories").update(changes).eq("id", String(payload.id ?? "")).eq("user_id", user.id));
    } else if (action === "archive_category") {
      dataOrThrow(await supabase.from("midas_categories").update({ archived: true }).eq("id", String(payload.id ?? "")).eq("user_id", user.id));
    } else if (action === "add_transaction") {
      const amount = Number(payload.amount);
      if (!(amount > 0)) return Response.json({ error: "Ingresa un monto mayor a cero." }, { status: 400 });
      const type = String(payload.type ?? "expense");
      const debtId = payload.debtId ? String(payload.debtId) : null;
      const values = {
        id: id("txn"), user_id: user.id,
        date: String(payload.date ?? new Date().toISOString().slice(0, 10)),
        description: String(payload.description ?? "Movimiento").trim() || "Movimiento",
        amount, category_id: payload.categoryId ? String(payload.categoryId) : null,
        debt_id: debtId, type, account: String(payload.account ?? "Efectivo"), source_type: "manual",
      };
      if (type === "debt_payment" && debtId) {
        dataOrThrow(await supabase.rpc("midas_record_debt_payment", {
          p_transaction_id: values.id, p_debt_id: debtId, p_date: values.date,
          p_description: values.description, p_amount: amount, p_account: values.account,
        }));
      } else {
        dataOrThrow(await supabase.from("midas_transactions").insert(values));
      }
    } else if (action === "delete_transaction") {
      dataOrThrow(await supabase.rpc("midas_delete_transaction", { p_transaction_id: String(payload.id ?? "") }));
    } else if (action === "update_transaction") {
      const transactionId = String(payload.id ?? "");
      const existingResult = await supabase.from("midas_transactions").select("*").eq("id", transactionId).eq("user_id", user.id).maybeSingle();
      if (existingResult.error) throw new Error(existingResult.error.message);
      if (!existingResult.data) return Response.json({ error: "El movimiento no existe." }, { status: 404 });
      const transaction = mapTransaction(existingResult.data);
      if (transaction.type === "debt_payment") return Response.json({ error: "Para modificar un pago de deuda, elimínalo y regístralo nuevamente." }, { status: 400 });
      const amount = Number(payload.amount);
      if (!(amount > 0)) return Response.json({ error: "Ingresa un monto mayor a cero." }, { status: 400 });
      dataOrThrow(await supabase.from("midas_transactions").update({
        date: String(payload.date ?? transaction.date),
        description: String(payload.description ?? transaction.description).trim() || transaction.description,
        amount, category_id: payload.categoryId ? String(payload.categoryId) : null,
        type: String(payload.type ?? transaction.type), account: String(payload.account ?? transaction.account),
      }).eq("id", transactionId).eq("user_id", user.id));
    } else if (action === "add_debt") {
      const name = String(payload.name ?? "").trim();
      const currentBalance = Number(payload.currentBalance);
      if (!name || !(currentBalance > 0)) return Response.json({ error: "Completa nombre y saldo actual." }, { status: 400 });
      dataOrThrow(await supabase.from("midas_debts").insert({
        id: id("debt"), user_id: user.id, name, entity: String(payload.entity ?? ""),
        original_amount: Number(payload.originalAmount) || currentBalance, current_balance: currentBalance,
        annual_rate: Math.max(0, Number(payload.annualRate) || 0), minimum_payment: Math.max(0, Number(payload.minimumPayment) || 0),
        planned_payment: Math.max(0, Number(payload.plannedPayment) || 0), due_day: Math.min(31, Math.max(1, Number(payload.dueDay) || 1)),
        acquired_at: String(payload.acquiredAt ?? new Date().toISOString().slice(0, 10)),
      }));
    } else {
      return Response.json({ error: "Acción no reconocida." }, { status: 400 });
    }

    return Response.json(await readState(supabase, user.id, monthKey, user));
  } catch (error) {
    return authErrorResponse(error);
  }
}
