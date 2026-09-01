"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, Calculator, Check,
  ChevronRight, CircleDollarSign, CircleHelp, CreditCard, Database, Download,
  FileUp, Landmark, LayoutDashboard, Lightbulb, Link2, LogOut, Moon, Plus,
  Pencil, ReceiptText, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Sun, Target,
  Trash2, TrendingUp, UserCircle, WalletCards, X,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MidasCatIcon } from "@/components/midas-cat-icon";

type Month = { id: string; monthKey: string; income: number; savingsTarget: number; status: string };
type Category = { id: string; name: string; groupName: string; budget: number; color: string; kind: string; archived: boolean };
type Transaction = { id: string; date: string; description: string; amount: number; categoryId: string | null; debtId: string | null; type: string; account: string; subcategory: string | null; paymentMethod: string | null; notes: string | null; sourceType: string; sourceId: string | null; sourceName: string | null; sourceImportedAt: string | null };
type Debt = { id: string; name: string; entity: string; originalAmount: number; currentBalance: number; annualRate: number; minimumPayment: number; plannedPayment: number; dueDay: number; acquiredAt: string; status: string };
type SpreadsheetSource = { id: string; sourceName: string; sourceUrl: string; columnMapping: string; lastSyncAt: string | null; lastSyncStatus: string; lastRowsDetected: number; lastRowsInserted: number; lastRowsIgnored: number; lastRowsFailed: number };
type CurrentUser = { email: string; displayName: string | null; role: string; status: string };
type FinanceState = { month: Month; categories: Category[]; transactions: Transaction[]; debts: Debt[]; spreadsheetSource: SpreadsheetSource | null; currentUser: CurrentUser };
type SheetMapping = { source_id?: string; date?: string; description?: string; category?: string; subcategory?: string; amount?: string; payment_method?: string; account?: string; notes?: string };
type SheetPreview = { sourceName: string; sheetName: string; headers: string[]; preview: Array<Record<string, string>>; suggestedMapping: SheetMapping };
type SyncResult = { detected: number; inserted: number; ignored: number; failed: number; errors: Array<{ row: number; reason: string }>; status: string; completedAt: string };
type CategoryMetric = Category & { actual: number; available: number; percent: number; status: { label: string; tone: string } };
type Metrics = {
  monthTx: Transaction[]; actualIncome: number; spent: number; debtPaid: number;
  budget: number; totalDebt: number; available: number; forecast: number;
  projectedSavings: number; score: number | null; setupComplete: boolean;
  categoryRows: CategoryMetric[];
  factors: { budget: number; savings: number; discretion: number; debt: number };
};

const currency = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 });
const currency2 = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 });
const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const today = new Date().toISOString().slice(0, 10);
const monthKey = today.slice(0, 7);
const HELP_SECTIONS = [
  { id: "start", title: "Primeros pasos", summary: "Qué es MIDAS y cómo preparar tu primer mes.", items: ["Define tu ingreso esperado y objetivo de ahorro.", "Asigna presupuestos a las categorías.", "Registra gastos manualmente o conecta un Spreadsheet.", "Revisa Dashboard, MIDAS Score y Advisor para corregir el rumbo."] },
  { id: "plan", title: "Gastos programados", summary: "Categorías, colores, presupuestos y comparación.", items: ["Cada categoría tiene un monto programado y un color identificador.", "Usa el lápiz para editar nombre, grupo, tipo, color y monto programado.", "Los cambios rápidos de presupuesto se guardan al salir del campo.", "Plan vs. Real utiliza los Gastos Efectivos del mismo mes.", "Las categorías con historial se archivan para preservar trazabilidad."] },
  { id: "ledger", title: "Gastos efectivos", summary: "Registro real consolidado de ingresos y gastos.", items: ["Cada movimiento usa cinco campos claros: Fecha, Nombre, Ingreso, Gasto y Categoría.", "Los movimientos manuales y Spreadsheet conviven en la misma tabla.", "Eliminar un pago de deuda restaura también el saldo de la deuda.", "Los filtros y la exportación trabajan sobre los movimientos visibles."] },
  { id: "spreadsheet", title: "Cómo conectar un Spreadsheet", summary: "Preparación, pestaña, mapeo, sincronización y errores.", items: ["Publica la hoja o habilita un enlace exportable sin autenticación.", "Usa columnas: ID_MOVIMIENTO | Fecha | Descripción | Categoría | Subcategoría | Monto | Medio_Pago | Cuenta | Nota.", "Pega el enlace y selecciona desde MIDAS la pestaña que contiene los movimientos.", "Valida la vista previa y confirma el mapeo de columnas.", "MIDAS agrega IDs nuevos e ignora IDs ya importados: nunca duplica.", "Las filas inválidas se informan sin detener las filas válidas.", "Cambiar la fuente conserva todo el histórico importado."] },
  { id: "debts", title: "Deudas", summary: "Saldo, interés, cuotas, pagos y proyección.", items: ["Registra entidad, saldo, interés y pago planificado.", "Cada pago se incorpora a Gastos Efectivos una sola vez.", "El saldo y la fecha proyectada se actualizan con cada pago.", "El simulador de pago adicional no modifica el plan real."] },
  { id: "dashboard", title: "Dashboard y MIDAS Score", summary: "Indicadores, alertas, forecast y recomendaciones.", items: ["El Dashboard resume ingreso, presupuesto, gasto, saldo y deuda.", "El forecast combina ritmo de gasto y deuda pendiente.", "MIDAS Score pondera presupuesto, ahorro, consumo discrecional y deuda.", "MIDAS Advisor separa observación, impacto y recomendación."] },
] as const;
const SHEET_FIELDS = [
  ["source_id", "ID movimiento", true], ["date", "Fecha", true], ["description", "Descripción", true],
  ["category", "Categoría", false], ["subcategory", "Subcategoría", false], ["amount", "Monto", true],
  ["payment_method", "Medio de pago", false], ["account", "Cuenta", false], ["notes", "Nota", false],
] as const;

function monthLabel(key: string) {
  const parts = key.split("-").map(Number);
  return monthNames[parts[1] - 1] + " " + parts[0];
}

function expenseStatus(percent: number) {
  if (!Number.isFinite(percent)) return { label: "Sin presupuesto", tone: "neutral" };
  if (percent > 100) return { label: "Desviación", tone: "danger" };
  if (percent >= 80) return { label: "Atención", tone: "warning" };
  return { label: "Óptimo", tone: "success" };
}

function redirectIfUnauthorized(response: Response) {
  if (response.status !== 401) return false;
  window.location.assign("/login");
  return true;
}

function projectDebt(debt: Debt, extra = 0) {
  const payment = Math.max(debt.plannedPayment || debt.minimumPayment, 0) + extra;
  const rate = debt.annualRate / 1200;
  if (debt.currentBalance <= 0) return { months: 0, interest: 0, date: "Cancelada" };
  if (payment <= debt.currentBalance * rate) return { months: Infinity, interest: Infinity, date: "Pago insuficiente" };
  const months = rate === 0
    ? Math.ceil(debt.currentBalance / Math.max(payment, 1))
    : Math.ceil(-Math.log(1 - rate * debt.currentBalance / payment) / Math.log(1 + rate));
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return {
    months,
    interest: Math.max(0, payment * months - debt.currentBalance),
    date: end.toLocaleDateString("es-PE", { month: "short", year: "numeric" }),
  };
}

export default function Home() {
  const [data, setData] = useState<FinanceState | null>(null);
  const [tab, setTab] = useState("dashboard");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [quickOpen, setQuickOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [debtOpen, setDebtOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [deleteTxn, setDeleteTxn] = useState<Transaction | null>(null);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [quick, setQuick] = useState({ amount: "", categoryId: "", description: "", account: "Efectivo", type: "expense", debtId: "", smart: "", date: today });
  const [newCategory, setNewCategory] = useState({ name: "", groupName: "Necesidades", budget: "", color: "#CBA65B", kind: "variable" });
  const [newDebt, setNewDebt] = useState({ name: "", entity: "", originalAmount: "", currentBalance: "", annualRate: "", minimumPayment: "", plannedPayment: "", dueDay: "1", acquiredAt: today });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetStep, setSheetStep] = useState<"status" | "url" | "mapping" | "result">("url");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [sheetPreview, setSheetPreview] = useState<SheetPreview | null>(null);
  const [sheetMapping, setSheetMapping] = useState<SheetMapping>({});
  const [sheetLoading, setSheetLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [changingSource, setChangingSource] = useState(false);
  const [helpSearch, setHelpSearch] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/state?month=" + monthKey);
      if (redirectIfUnauthorized(response)) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo cargar MIDAS.");
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar MIDAS.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (window.localStorage.getItem("midas-theme") === "light") setTheme("light");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const rawUrl = sheetUrl.trim();
    if (!sheetOpen || sheetStep !== "url" || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\//i.test(rawUrl)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSheetLoading(true);
      setError("");
      try {
        const response = await fetch("/api/spreadsheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_sheets", url: rawUrl }),
          signal: controller.signal,
        });
        if (redirectIfUnauthorized(response)) return;
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudieron detectar las pestañas.");
        const names = Array.isArray(result.sheets) ? result.sheets.map(String) : [];
        if (!names.length) throw new Error("El Spreadsheet no tiene pestañas visibles.");
        setSheetNames(names);
        setSheetName(names[0]);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "No se pudieron detectar las pestañas.");
      } finally {
        if (!controller.signal.aborted) setSheetLoading(false);
      }
    }, 650);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [sheetOpen, sheetStep, sheetUrl]);

  async function mutate(payload: Record<string, unknown>, success?: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, monthKey }),
      });
      if (redirectIfUnauthorized(response)) return false;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo guardar.");
      setData(result);
      if (success) {
        setNotice(success);
        window.setTimeout(() => setNotice(""), 3500);
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const metrics = useMemo<Metrics | null>(() => {
    if (!data) return null;
    const categories = data.categories.filter(c => !c.archived);
    const monthTx = data.transactions.filter(t => t.date.startsWith(monthKey));
    const expenseTx = monthTx.filter(t => t.type === "expense");
    const incomeTx = monthTx.filter(t => t.type === "income");
    const debtTx = monthTx.filter(t => t.type === "debt_payment");
    const actualIncome = data.month.income + incomeTx.reduce((sum, t) => sum + t.amount, 0);
    const spent = expenseTx.reduce((sum, t) => sum + t.amount, 0);
    const debtPaid = debtTx.reduce((sum, t) => sum + t.amount, 0);
    const budget = categories.reduce((sum, c) => sum + c.budget, 0);
    const totalDebt = data.debts.filter(d => d.status === "active").reduce((sum, d) => sum + d.currentBalance, 0);
    const actualByCategory = new Map<string, number>();
    expenseTx.forEach(t => actualByCategory.set(t.categoryId || "other", (actualByCategory.get(t.categoryId || "other") || 0) + t.amount));
    const day = Math.max(1, new Date().getDate());
    const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const pace = spent ? spent / day * days : 0;
    const pendingDebt = Math.max(0, data.debts.reduce((sum, d) => sum + d.plannedPayment, 0) - debtPaid);
    const forecast = pace + pendingDebt;
    const available = actualIncome - spent - debtPaid;
    const projectedSavings = Math.max(0, actualIncome - forecast);
    const categoryRows = categories.map(c => {
      const actual = actualByCategory.get(c.id) || 0;
      const percent = c.budget > 0 ? actual / c.budget * 100 : actual > 0 ? Infinity : 0;
      return { ...c, actual, available: c.budget - actual, percent, status: expenseStatus(percent) };
    });
    const setupComplete = actualIncome > 0 && budget > 0;
    const overrun = categoryRows.reduce((sum, c) => sum + Math.max(0, -c.available), 0);
    const budgetFactor = budget > 0 ? 40 * Math.max(0, 1 - overrun / Math.max(1, budget)) : 0;
    const savingsFactor = data.month.savingsTarget > 0 ? 25 * Math.min(1, projectedSavings / data.month.savingsTarget) : 0;
    const discretionary = categoryRows.filter(c => c.kind === "discretionary");
    const discretionBudget = discretionary.reduce((sum, c) => sum + c.budget, 0);
    const discretionSpent = discretionary.reduce((sum, c) => sum + c.actual, 0);
    const discretionFactor = discretionBudget > 0 ? 15 * Math.max(0, 1 - Math.max(0, discretionSpent - discretionBudget) / discretionBudget) : 15;
    const debtPlan = data.debts.reduce((sum, d) => sum + d.plannedPayment, 0);
    const debtFactor = data.debts.length ? 20 * Math.min(1, debtPaid / Math.max(1, debtPlan)) : 20;
    const score = setupComplete ? Math.round(Math.min(100, budgetFactor + savingsFactor + discretionFactor + debtFactor)) : null;
    return {
      monthTx, actualIncome, spent, debtPaid, budget, totalDebt, available,
      forecast, projectedSavings, score, setupComplete, categoryRows,
      factors: { budget: budgetFactor, savings: savingsFactor, discretion: discretionFactor, debt: debtFactor },
    };
  }, [data]);

  const trend = useMemo(() => {
    if (!metrics) return [];
    let cumulative = 0;
    const days = new Map<string, number>();
    metrics.monthTx.filter(t => t.type === "expense").forEach(t => days.set(t.date, (days.get(t.date) || 0) + t.amount));
    return Array.from(days.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(entry => {
      cumulative += entry[1];
      return { day: entry[0].slice(8), amount: cumulative };
    });
  }, [metrics]);

  if (!data || !metrics) {
    return <main className={"midas-app " + theme}><div className="loading-screen"><MidasCatIcon className="loading-cat" priority size={84} /><p>{error || "Preparando tu hub de control de gastos…"}</p>{error && <Button onClick={load}>Reintentar</Button>}</div></main>;
  }

  const finance = data;
  const pie = metrics.categoryRows.filter(c => c.actual > 0).map(c => ({ name: c.name, value: c.actual, color: c.color }));
  const filtered = metrics.monthTx.filter(t => {
    const categoryName = data.categories.find(category => category.id === t.categoryId)?.name || "";
    const match = (t.description + " " + categoryName).toLowerCase().includes(search.toLowerCase());
    return match && (typeFilter === "all" || t.type === typeFilter);
  });
  const visibleHelp = HELP_SECTIONS.filter(section => (section.title + " " + section.summary + " " + section.items.join(" ")).toLowerCase().includes(helpSearch.toLowerCase()));
  const scoreTone = metrics.score === null ? "neutral" : metrics.score >= 85 ? "success" : metrics.score >= 70 ? "good" : metrics.score >= 50 ? "warning" : "danger";
  const scoreLabel = metrics.score === null ? "Sin datos" : metrics.score >= 85 ? "Óptimo" : metrics.score >= 70 ? "Bueno" : metrics.score >= 50 ? "Atención" : "Crítico";

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("midas-theme", next);
  }

  async function signOut() {
    await fetch("/auth/signout", { method: "POST" });
    window.location.href = "/login";
  }

  function parseSmart() {
    const text = quick.smart.trim().toLowerCase();
    const amountMatch = text.match(/(\d+(?:[.,]\d{1,2})?)/);
    const category = finance.categories.find(c => text.includes(c.name.toLowerCase()) || text.includes(c.name.toLowerCase().split(" ")[0]));
    const debt = finance.debts.find(d => text.includes(d.name.toLowerCase()) || Boolean(d.entity && text.includes(d.entity.toLowerCase())));
    const account = text.includes("visa") ? "Visa" : text.includes("yape") ? "Yape" : text.includes("bcp") ? "BCP" : "Efectivo";
    const description = text.replace(amountMatch?.[0] || "", "").replace(/visa|yape|bcp/g, "").trim();
    setQuick({
      ...quick,
      amount: amountMatch?.[1]?.replace(",", ".") || quick.amount,
      categoryId: category?.id || quick.categoryId,
      debtId: debt?.id || "",
      type: text.includes("deuda") || debt ? "debt_payment" : "expense",
      account,
      description: description || quick.description,
    });
  }

  async function saveQuick() {
    const ok = await mutate({
      action: editingTxn ? "update_transaction" : "add_transaction",
      id: editingTxn?.id,
      amount: Number(quick.amount),
      categoryId: quick.type === "debt_payment" ? null : quick.categoryId,
      debtId: quick.type === "debt_payment" ? quick.debtId : null,
      type: quick.type,
      description: quick.description || (quick.type === "debt_payment" ? "Pago de deuda" : "Movimiento"),
      account: quick.account,
      date: quick.date,
    }, editingTxn ? "Movimiento actualizado" : "Movimiento registrado");
    if (ok) {
      setQuick({ amount: "", categoryId: "", description: "", account: "Efectivo", type: "expense", debtId: "", smart: "", date: today });
      setQuickOpen(false);
      setEditingTxn(null);
    }
  }

  function openQuick(transaction?: Transaction) {
    if (transaction) {
      setEditingTxn(transaction);
      setQuick({
        amount: String(transaction.amount),
        categoryId: transaction.categoryId || "",
        description: transaction.description,
        account: transaction.account,
        type: transaction.type,
        debtId: transaction.debtId || "",
        smart: "",
        date: transaction.date,
      });
    } else {
      setEditingTxn(null);
      setQuick({ amount: "", categoryId: "", description: "", account: "Efectivo", type: "expense", debtId: "", smart: "", date: today });
    }
    setQuickOpen(true);
  }

  function openCategory(category?: Category) {
    if (category) {
      setEditingCategory(category);
      setNewCategory({
        name: category.name,
        groupName: category.groupName,
        budget: String(category.budget),
        color: category.color,
        kind: category.kind,
      });
    } else {
      setEditingCategory(null);
      setNewCategory({ name: "", groupName: "Necesidades", budget: "", color: "#CBA65B", kind: "variable" });
    }
    setCategoryOpen(true);
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return setError("El CSV no contiene movimientos.");
    const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/^"|"$/g, ""));
    const modernFormat = ["fecha", "nombre", "ingreso", "gasto", "categoria"].every(h => header.includes(h));
    const legacyFormat = ["fecha", "descripcion", "monto", "categoria"].every(h => header.includes(h));
    if (!modernFormat && !legacyFormat) return setError("El CSV debe contener: fecha, nombre, ingreso, gasto, categoria.");
    let count = 0;
    for (const line of lines.slice(1)) {
      const cells = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      const row = Object.fromEntries(header.map((h, index) => [h, cells[index] || ""]));
      const category = finance.categories.find(c => c.name.toLowerCase() === row.categoria.toLowerCase());
      const income = modernFormat ? Number(row.ingreso) : 0;
      const expense = modernFormat ? Number(row.gasto) : Number(row.monto);
      const amount = income > 0 ? income : expense;
      const type = income > 0 ? "income" : "expense";
      if (!category || !(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(row.fecha)) continue;
      const ok = await mutate({ action: "add_transaction", date: row.fecha, description: modernFormat ? row.nombre : row.descripcion, amount, categoryId: category.id, type, account: "Importado" });
      if (ok) count++;
    }
    setNotice(count + " movimientos importados; las filas dudosas fueron omitidas.");
  }

  function exportCsv() {
    const rows: Array<Array<string | number>> = [
      ["fecha", "nombre", "ingreso", "gasto", "categoria"],
      ...filtered.map(t => [
        t.date,
        t.description,
        t.type === "income" ? t.amount : "",
        t.type === "income" ? "" : t.amount,
        finance.categories.find(c => c.id === t.categoryId)?.name || finance.debts.find(d => d.id === t.debtId)?.name || "",
      ]),
    ];
    const csv = rows.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "midas-" + monthKey + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function openSpreadsheet() {
    setSheetOpen(true);
    setSyncResult(null);
    setChangingSource(false);
    if (finance.spreadsheetSource) {
      setSheetUrl(finance.spreadsheetSource.sourceUrl);
      setSheetStep("status");
    } else {
      setSheetUrl("");
      setSheetNames([]);
      setSheetName("");
      setSheetPreview(null);
      setSheetMapping({});
      setSheetStep("url");
    }
  }

  async function previewSpreadsheet() {
    setSheetLoading(true);
    setError("");
    try {
      const response = await fetch("/api/spreadsheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", url: sheetUrl, sheetName }),
      });
      if (redirectIfUnauthorized(response)) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo validar la hoja.");
      setSheetPreview(result);
      setSheetMapping(result.suggestedMapping || {});
      setSheetStep("mapping");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo validar la hoja.");
    } finally {
      setSheetLoading(false);
    }
  }

  async function saveSpreadsheetSource() {
    if (!sheetPreview) return;
    setSheetLoading(true);
    setError("");
    try {
      const response = await fetch("/api/spreadsheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_source", url: sheetUrl, sheetName, sourceName: sheetPreview.sourceName, mapping: sheetMapping }),
      });
      if (redirectIfUnauthorized(response)) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo guardar la fuente.");
      await load();
      setNotice(changingSource ? "Fuente Spreadsheet actualizada" : "Spreadsheet conectado");
      setChangingSource(false);
      setSheetStep("status");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la fuente.");
    } finally {
      setSheetLoading(false);
    }
  }

  async function synchronizeSpreadsheet() {
    setSheetLoading(true);
    setError("");
    try {
      const response = await fetch("/api/spreadsheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (redirectIfUnauthorized(response)) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo sincronizar.");
      setSyncResult(result);
      await load();
      setSheetStep("result");
      setNotice("Sincronización completada");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo sincronizar.");
    } finally {
      setSheetLoading(false);
    }
  }

  return (
    <TooltipProvider>
    <main className={"midas-app " + theme}>
      <header className="topbar">
        <div className="brand-wrap">
          <MidasCatIcon className="brand-cat" priority size={48} />
          <div><div className="brand">M.I.D.A.S.</div><div className="tagline">Hub de control de gastos</div></div>
        </div>
        <div className="header-actions">
          <div className="month-chip"><span />{monthLabel(monthKey)}</div>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Cambiar tema">{theme === "dark" ? <Sun /> : <Moon />}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Menú de usuario"><UserCircle /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="user-menu">
              <DropdownMenuLabel><strong>{data.currentUser.displayName || "Usuario MIDAS"}</strong><span>{data.currentUser.email}</span></DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setTab("help")}><CircleHelp /> Centro HELP</DropdownMenuItem>
              {data.currentUser.role === "admin" && <DropdownMenuItem asChild><a href="/admin"><Settings /> ADMIN</a></DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> Cerrar sesión</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="gold-button desktop-add" onClick={() => openQuick()}><Plus /> Movimiento</Button>
        </div>
      </header>

      {error && <div className="global-message error-message"><AlertCircle />{error}<button onClick={() => setError("")} aria-label="Cerrar"><X /></button></div>}
      {notice && <div className="global-message success-message"><Check />{notice}</div>}

      <Tabs value={tab} onValueChange={setTab} className="workspace">
        <TabsList className="primary-nav" variant="line">
          <TabsTrigger value="dashboard"><LayoutDashboard /><span>Dashboard</span></TabsTrigger>
          <TabsTrigger value="plan"><Target /><span>Gastos programados</span></TabsTrigger>
          <TabsTrigger value="ledger"><ReceiptText /><span>Gastos efectivos</span></TabsTrigger>
          <TabsTrigger value="debts"><CreditCard /><span>Deudas</span></TabsTrigger>
          <TabsTrigger value="help"><CircleHelp /><span>HELP</span></TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="page-content">
          <PageHeading eyebrow="HUB DE CONTROL DE GASTOS" title="Control del mes" subtitle="Lo que planificaste, lo que ocurrió y lo que debes corregir." extra={<div className="data-badge"><ShieldCheck /> Datos persistentes y cálculos trazables</div>} />
          {!metrics.setupComplete && <section className="setup-banner"><div className="setup-icon"><Sparkles /></div><div><strong>Configura tu plan inicial</strong><p>Completa ingreso, ahorro y presupuestos para activar el MIDAS Score y el forecast.</p></div><Button className="gold-button" onClick={() => setTab("plan")}>Configurar <ChevronRight /></Button></section>}

          <section className="kpi-grid">
            <Kpi title="Ingresos del mes" value={currency.format(metrics.actualIncome)} note="Plan + ingresos registrados" icon={<ArrowUpRight />} tone="blue" />
            <Kpi title="Presupuesto total" value={currency.format(metrics.budget)} note="Distribuido por categorías" icon={<Target />} tone="gold" />
            <Kpi title="Gasto real" value={currency.format(metrics.spent)} note={(metrics.budget ? Math.round(metrics.spent / metrics.budget * 100) : 0) + "% del presupuesto"} icon={<ArrowDownRight />} tone="red" />
            <Kpi title="Saldo disponible" value={currency.format(metrics.available)} note="Después de gastos y deuda" icon={<WalletCards />} tone={metrics.available >= 0 ? "green" : "red"} />
            <Kpi title="Deuda total" value={currency.format(metrics.totalDebt)} note={currency.format(metrics.debtPaid) + " pagado este mes"} icon={<CreditCard />} tone="purple" />
            <Kpi title="Forecast de salida" value={currency.format(metrics.forecast)} note="Ritmo actual + deuda pendiente" icon={<TrendingUp />} tone="cyan" />
          </section>

          <section className="dashboard-grid">
            <article className="panel score-panel" role="button" tabIndex={0} onClick={() => setScoreOpen(true)} onKeyDown={e => e.key === "Enter" && setScoreOpen(true)}>
              <PanelTitle eyebrow="FINANCIAL HEALTH" title="MIDAS Score" extra={<Button variant="ghost" size="icon" aria-label="Ver cálculo"><Calculator /></Button>} />
              <div className="score-body">
                <div className={"score-ring " + scoreTone} style={{ "--score": metrics.score || 0 } as React.CSSProperties}><div><strong>{metrics.score ?? "—"}</strong><span>/100</span></div></div>
                <div className="score-copy"><span className={"status-pill " + scoreTone}><span />{scoreLabel}</span><p>{metrics.score === null ? "Ingresa tu plan para obtener una lectura financiera explicable." : "Combina presupuesto, ahorro, consumo discrecional y deuda."}</p><button>Ver cálculo y acciones <ChevronRight /></button></div>
              </div>
            </article>

            <article className="panel plan-actual-panel">
              <PanelTitle eyebrow="EJECUCIÓN" title="Plan vs. real" extra={<span className="small-meta">{metrics.categoryRows.length} categorías</span>} />
              <div className="category-bars">{metrics.categoryRows.slice(0, 6).map(row => <CategoryBar key={row.id} row={row} />)}</div>
              {!metrics.categoryRows.length && <EmptyState icon={<Target />} title="Sin categorías" text="Agrega categorías a tu plan mensual." />}
              <button className="panel-link" onClick={() => setTab("plan")}>Ver presupuesto completo <ChevronRight /></button>
            </article>

            <article className="panel chart-panel">
              <PanelTitle eyebrow="RITMO DEL MES" title="Gasto acumulado" extra={<span className="small-meta">{currency.format(metrics.spent)}</span>} />
              <div className="chart-area">
                {trend.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}><defs><linearGradient id="goldFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d2ad62" stopOpacity=".42" /><stop offset="1" stopColor="#d2ad62" stopOpacity="0" /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" /><XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-text)", fontSize: 11 }} /><YAxis tickFormatter={v => String(Math.round(v / 1000)) + "k"} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-text)", fontSize: 11 }} /><ChartTooltip formatter={v => currency.format(Number(v))} contentStyle={{ background: "var(--panel-solid)", border: "1px solid var(--line)", borderRadius: 10 }} /><Area type="monotone" dataKey="amount" stroke="#d2ad62" strokeWidth={2.5} fill="url(#goldFade)" /></AreaChart></ResponsiveContainer> : <EmptyState icon={<BarChart3 />} title="Aún sin movimientos" text="El gráfico aparecerá cuando registres el primer gasto." />}
              </div>
            </article>

            <article className="panel donut-panel">
              <PanelTitle eyebrow="COMPOSICIÓN" title="Gasto por categoría" />
              <div className="donut-content">
                <div className="donut-chart">{pie.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pie} dataKey="value" innerRadius={54} outerRadius={78} paddingAngle={3} stroke="none">{pie.map(item => <Cell key={item.name} fill={item.color} />)}</Pie><ChartTooltip formatter={v => currency.format(Number(v))} contentStyle={{ background: "var(--panel-solid)", border: "1px solid var(--line)", borderRadius: 10 }} /></PieChart></ResponsiveContainer> : <div className="empty-donut"><CircleDollarSign /></div>}</div>
                <div className="legend-list">{pie.slice(0, 5).map(item => <div key={item.name}><span style={{ background: item.color }} /><p>{item.name}</p><strong>{currency.format(item.value)}</strong></div>)}{!pie.length && <p className="muted-copy">Sin distribución disponible.</p>}</div>
              </div>
            </article>

            <Advisor metrics={metrics} debtCount={data.debts.length} />
          </section>
        </TabsContent>

        <TabsContent value="plan" className="page-content">
          <PageHeading eyebrow="EL PLAN DEL MES" title="Gastos programados" subtitle="Asigna cada sol antes de gastarlo y detecta compromisos excesivos." compact extra={<Button className="gold-button" onClick={() => openCategory()}><Plus /> Categoría</Button>} />
          <section className="plan-summary panel">
            <FieldMoney label="Ingreso esperado" id="income" value={data.month.income} onBlur={value => mutate({ action: "set_month", income: value, savingsTarget: data.month.savingsTarget }, "Ingreso actualizado")} />
            <div className="plan-operator">−</div><SummaryNumber label="Presupuesto" value={metrics.budget} />
            <div className="plan-operator">−</div><FieldMoney label="Ahorro objetivo" id="savings" value={data.month.savingsTarget} onBlur={value => mutate({ action: "set_month", income: data.month.income, savingsTarget: value }, "Objetivo actualizado")} />
            <div className="plan-operator">=</div><SummaryNumber label="Saldo planificado" value={data.month.income - metrics.budget - data.month.savingsTarget} result />
          </section>
          {data.month.income > 0 && data.month.income - metrics.budget - data.month.savingsTarget < 0 && <div className="inline-alert"><AlertCircle /><div><strong>Los compromisos superan tu ingreso</strong><p>Reduce el presupuesto o el ahorro objetivo en {currency.format(Math.abs(data.month.income - metrics.budget - data.month.savingsTarget))}.</p></div></div>}
          <section className="panel budget-table-panel">
            <PanelTitle eyebrow="CATEGORÍAS" title="Presupuesto por categoría" extra={<span className="small-meta">Se guarda al salir del campo</span>} />
            <Table className="midas-table"><TableHeader><TableRow><TableHead>Categoría</TableHead><TableHead>Grupo</TableHead><TableHead>Tipo</TableHead><TableHead className="align-right">Programado</TableHead><TableHead className="align-right">Real</TableHead><TableHead>Estado</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{metrics.categoryRows.map(row => <TableRow key={row.id}><TableCell><CategoryName category={row} /></TableCell><TableCell className="muted-cell">{row.groupName}</TableCell><TableCell><span className="type-chip">{row.kind === "fixed" ? "Fijo" : row.kind === "discretionary" ? "Discrecional" : "Variable"}</span></TableCell><TableCell><div className="inline-money"><span>S/</span><input type="number" min="0" defaultValue={row.budget} onBlur={e => mutate({ action: "update_category", id: row.id, budget: Number(e.target.value) })} /></div></TableCell><TableCell className="align-right strong-cell">{currency.format(row.actual)}</TableCell><TableCell><span className={"status-pill " + row.status.tone}><span />{row.status.label}</span></TableCell><TableCell><div className="row-actions"><Button variant="ghost" size="icon-sm" aria-label={"Editar " + row.name} onClick={() => openCategory(row)}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label={"Archivar " + row.name} onClick={() => mutate({ action: "archive_category", id: row.id }, "Categoría archivada")}><Trash2 /></Button></div></TableCell></TableRow>)}</TableBody>
            </Table>
          </section>
        </TabsContent>

        <TabsContent value="ledger" className="page-content">
          <PageHeading eyebrow="SINGLE SOURCE OF TRUTH" title="Gastos efectivos" subtitle="Fecha, nombre, ingreso, gasto y categoría en una sola vista." compact extra={<div className="heading-actions"><Tooltip><TooltipTrigger asChild><Button variant="outline" onClick={openSpreadsheet} disabled={sheetLoading}>{sheetLoading ? <RefreshCw className="spin" /> : <Database />}{data.spreadsheetSource ? "Sincronizar Spreadsheet" : "Obtener datos de Spreadsheet"}</Button></TooltipTrigger><TooltipContent>Importa únicamente movimientos nuevos desde una hoja publicada.</TooltipContent></Tooltip><Button className="gold-button" onClick={() => openQuick()}><Plus /> Registrar movimiento</Button></div>} />
          {data.spreadsheetSource && <section className="spreadsheet-connection"><div><span className={"connection-dot " + data.spreadsheetSource.lastSyncStatus} /><div><strong>Spreadsheet conectado</strong><p>{data.spreadsheetSource.sourceName} · Última sincronización: {data.spreadsheetSource.lastSyncAt ? formatDateTime(data.spreadsheetSource.lastSyncAt) : "pendiente"}</p></div></div><button onClick={openSpreadsheet}>Gestionar fuente <ChevronRight /></button></section>}
          <section className="ledger-toolbar panel">
            <div className="search-box"><Search /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nombre o categoría…" aria-label="Buscar movimientos" /></div>
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger className="filter-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los tipos</SelectItem><SelectItem value="expense">Gastos</SelectItem><SelectItem value="income">Ingresos</SelectItem><SelectItem value="debt_payment">Pagos de deuda</SelectItem></SelectContent></Select>
            <input ref={importRef} type="file" accept=".csv,text/csv" hidden onChange={e => e.target.files?.[0] && importCsv(e.target.files[0])} />
            <Button variant="outline" onClick={() => importRef.current?.click()}><FileUp /> Importar CSV</Button>
            <Button variant="outline" onClick={exportCsv}><Download /> Exportar</Button>
          </section>
          <section className="panel ledger-panel">
            <Table className="midas-table ledger-table"><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Nombre</TableHead><TableHead className="align-right">Ingreso</TableHead><TableHead className="align-right">Gasto</TableHead><TableHead>Categoría</TableHead><TableHead><span className="sr-only">Acciones</span></TableHead></TableRow></TableHeader>
              <TableBody>{filtered.map(t => {
                const category = data.categories.find(c => c.id === t.categoryId);
                const debt = data.debts.find(d => d.id === t.debtId);
                return <TableRow key={t.id}><TableCell className="date-cell">{new Date(t.date + "T12:00:00").toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" })}</TableCell><TableCell className="strong-cell"><span className="transaction-name">{t.description}</span><span className="transaction-origin">{t.sourceType === "spreadsheet" ? "Spreadsheet" : "Manual"}</span></TableCell><TableCell className="align-right amount-cell positive">{t.type === "income" ? currency2.format(t.amount) : "—"}</TableCell><TableCell className="align-right amount-cell">{t.type !== "income" ? currency2.format(t.amount) : "—"}</TableCell><TableCell>{category ? <CategoryName category={category} /> : debt ? <div className="category-name"><span className="debt-dot" />{debt.name}</div> : "—"}</TableCell><TableCell><div className="row-actions">{t.type !== "debt_payment" && <Button variant="ghost" size="icon-sm" onClick={() => openQuick(t)} aria-label="Editar movimiento"><Pencil /></Button>}<Button variant="ghost" size="icon-sm" onClick={() => setDeleteTxn(t)} aria-label="Eliminar movimiento"><Trash2 /></Button></div></TableCell></TableRow>;
              })}</TableBody>
            </Table>
            {!filtered.length && <EmptyState icon={<ReceiptText />} title="No hay movimientos" text={search || typeFilter !== "all" ? "No encontramos resultados con esos filtros." : "Registra tu primer ingreso o gasto."} action={<Button className="gold-button" onClick={() => openQuick()}><Plus /> Movimiento</Button>} />}
          </section>
        </TabsContent>

        <TabsContent value="debts" className="page-content">
          <PageHeading eyebrow="DEBT CONTROL CENTER" title="Deudas" subtitle="Saldo, costo, proyección y pagos vinculados a tus movimientos reales." compact extra={<Button className="gold-button" onClick={() => setDebtOpen(true)}><Plus /> Agregar deuda</Button>} />
          <section className="debt-overview"><div className="debt-total-card"><span>Deuda total activa</span><strong>{currency.format(metrics.totalDebt)}</strong><p>{data.debts.length} obligaciones registradas</p></div><div><span>Pago este mes</span><strong>{currency.format(metrics.debtPaid)}</strong><p>Vinculado al ledger</p></div><div><span>Pago mensual planificado</span><strong>{currency.format(data.debts.reduce((sum, d) => sum + d.plannedPayment, 0))}</strong><p>Según planes activos</p></div></section>
          <section className="debt-grid">
            {data.debts.map(debt => {
              const base = projectDebt(debt);
              const extra = extras[debt.id] || 0;
              const scenario = projectDebt(debt, extra);
              const paid = debt.originalAmount > 0 ? Math.min(100, (debt.originalAmount - debt.currentBalance) / debt.originalAmount * 100) : 0;
              return <article className="panel debt-card" key={debt.id}>
                <div className="debt-card-head"><div className="debt-icon"><Landmark /></div><div><span>{debt.entity || "Entidad no indicada"}</span><h2>{debt.name}</h2></div><span className="status-pill success"><span />Activa</span></div>
                <div className="debt-balance"><span>Saldo actual</span><strong>{currency.format(debt.currentBalance)}</strong><small>de {currency.format(debt.originalAmount)} original</small></div>
                <Progress value={paid} className="debt-progress" />
                <div className="debt-facts"><Fact label="TEA / APR" value={debt.annualRate.toFixed(2) + "%"} /><Fact label="Pago planificado" value={currency.format(debt.plannedPayment)} /><Fact label="Meses restantes" value={Number.isFinite(base.months) ? String(base.months) : "—"} /><Fact label="Cancelación" value={base.date} /></div>
                <div className="payment-row"><div className="money-input compact"><span>S/</span><input id={"pay-" + debt.id} type="number" min="1" placeholder={String(debt.plannedPayment || debt.minimumPayment)} /></div><Button className="gold-button" onClick={() => { const input = document.getElementById("pay-" + debt.id) as HTMLInputElement; const amount = Number(input.value); if (amount > 0) mutate({ action: "add_transaction", amount, type: "debt_payment", debtId: debt.id, description: "Pago " + debt.name, account: "Cuenta bancaria", date: today }, "Pago vinculado y saldo actualizado").then(ok => { if (ok) input.value = ""; }); }}>Registrar pago</Button></div>
                <div className="scenario-box"><div className="scenario-title"><Sparkles /><div><strong>Simulador: pago adicional</strong><p>No modifica tu plan real.</p></div></div><div className="scenario-controls"><div className="money-input compact"><span>S/</span><input type="number" min="0" value={extra || ""} placeholder="500" onChange={e => setExtras({ ...extras, [debt.id]: Number(e.target.value) })} /></div>{extra > 0 && Number.isFinite(base.months) && <div className="scenario-result"><strong>{Math.max(0, base.months - scenario.months)} meses menos</strong><span>{currency.format(Math.max(0, base.interest - scenario.interest))} de interés evitado</span></div>}</div></div>
              </article>;
            })}
            {!data.debts.length && <article className="panel full-empty"><EmptyState icon={<CreditCard />} title="No tienes deudas registradas" text="Agrega una deuda para proyectar pagos y vincular cada abono al ledger." action={<Button className="gold-button" onClick={() => setDebtOpen(true)}><Plus /> Agregar deuda</Button>} /></article>}
          </section>
        </TabsContent>

        <TabsContent value="help" className="page-content">
          <PageHeading eyebrow="CENTRO DE ASISTENCIA" title="HELP" subtitle="Respuestas rápidas para operar MIDAS con claridad y trazabilidad." compact extra={<div className="version-badge">MIDAS Beta · v0.3.0</div>} />
          <section className="help-hero panel">
            <div className="help-hero-icon"><CircleHelp /></div>
            <div><h2>¿Qué necesitas resolver?</h2><p>Busca una función o explora las guías por módulo.</p></div>
            <div className="search-box help-search"><Search /><input value={helpSearch} onChange={event => setHelpSearch(event.target.value)} placeholder="Buscar presupuesto, Spreadsheet, deuda…" aria-label="Buscar en HELP" /></div>
          </section>
          <section className="help-layout">
            <aside className="panel help-index">
              <p className="eyebrow">CONTENIDO</p>
              {HELP_SECTIONS.map(section => <button key={section.id} onClick={() => document.getElementById("help-" + section.id)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{section.title}<ChevronRight /></button>)}
              <button onClick={() => document.getElementById("about-midas")?.scrollIntoView({ behavior: "smooth", block: "center" })}>Acerca de MIDAS<ChevronRight /></button>
            </aside>
            <div className="help-content">
              <Accordion type="multiple" defaultValue={["start", "spreadsheet"]} className="panel help-accordion">
                {visibleHelp.map(section => <AccordionItem value={section.id} key={section.id} id={"help-" + section.id}><AccordionTrigger><div><span>{section.id === "spreadsheet" ? <Database /> : section.id === "debts" ? <CreditCard /> : section.id === "dashboard" ? <LayoutDashboard /> : section.id === "plan" ? <Target /> : section.id === "ledger" ? <ReceiptText /> : <Sparkles />}</span><div><strong>{section.title}</strong><p>{section.summary}</p></div></div></AccordionTrigger><AccordionContent><ol className="help-steps">{section.items.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}</ol>{section.id === "spreadsheet" && <div className="spreadsheet-example"><span>ESTRUCTURA RECOMENDADA</span><code>ID_MOVIMIENTO | Fecha | Descripción | Categoría | Subcategoría | Monto | Medio_Pago | Cuenta | Nota</code><p>Spreadsheet alimenta Gastos Efectivos. MIDAS realiza el control y análisis financiero.</p></div>}</AccordionContent></AccordionItem>)}
              </Accordion>
              {!visibleHelp.length && <div className="panel help-empty"><Search /><strong>Sin resultados</strong><p>Prueba con otra palabra o revisa el índice completo.</p></div>}
              <article className="panel about-midas" id="about-midas"><MidasCatIcon className="about-cat" size={72} /><div><p className="eyebrow">ACERCA DE MIDAS</p><h2>MIDAS Beta — v0.4.0</h2><p>Money Intelligence, Debt, Allocation & Spending</p><span>Hub de control de gastos · Datos aislados por usuario</span></div></article>
            </div>
          </section>
        </TabsContent>
      </Tabs>

      <Button className="floating-add gold-button" onClick={() => openQuick()}><Plus /><span>Movimiento</span></Button>

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="midas-dialog spreadsheet-dialog">
          <DialogHeader><p className="eyebrow">FUENTE EXTERNA · APPEND ONLY</p><DialogTitle>{sheetStep === "mapping" ? "Mapear columnas" : sheetStep === "result" ? "Sincronización completada" : data.spreadsheetSource && sheetStep === "status" ? "Spreadsheet conectado" : "Obtener datos de Spreadsheet"}</DialogTitle><DialogDescription>Sin Google API, OAuth ni credenciales. La hoja solo alimenta Gastos Efectivos.</DialogDescription></DialogHeader>

          {sheetStep === "status" && data.spreadsheetSource && <div className="sheet-status">
            <div className="sheet-source-card"><div className="integration-icon"><Database /></div><div><span>Fuente actual</span><strong>{data.spreadsheetSource.sourceName}</strong><p>Última sincronización: {data.spreadsheetSource.lastSyncAt ? formatDateTime(data.spreadsheetSource.lastSyncAt) : "pendiente"}</p></div><span className={"status-pill " + (data.spreadsheetSource.lastSyncStatus === "success" ? "success" : data.spreadsheetSource.lastSyncStatus === "partial" ? "warning" : "neutral")}><span />{data.spreadsheetSource.lastSyncStatus}</span></div>
            <div className="sync-summary"><MiniResult label="Encontrados" value={data.spreadsheetSource.lastRowsDetected} /><MiniResult label="Nuevos" value={data.spreadsheetSource.lastRowsInserted} /><MiniResult label="Ignorados" value={data.spreadsheetSource.lastRowsIgnored} /><MiniResult label="Errores" value={data.spreadsheetSource.lastRowsFailed} /></div>
            <div className="sheet-actions"><Button variant="outline" onClick={() => { setChangingSource(true); setSheetUrl(""); setSheetNames([]); setSheetName(""); setSheetPreview(null); setSheetMapping({}); setSheetStep("url"); }}><Link2 /> Cambiar fuente de datos</Button><Button className="gold-button" disabled={sheetLoading} onClick={synchronizeSpreadsheet}>{sheetLoading ? <RefreshCw className="spin" /> : <RefreshCw />} {sheetLoading ? "Sincronizando…" : "Sincronizar ahora"}</Button></div>
          </div>}

          {sheetStep === "url" && <div className="sheet-url-step">
            <div className="sheet-instruction"><Link2 /><div><strong>Pega un enlace de Google Sheets o Drive</strong><p>Admite enlaces /edit, drivesdk, publicados y exportables. El acceso general debe ser “Cualquier persona con el enlace · Lector”.</p></div></div>
            {changingSource && <div className="change-warning"><AlertCircle /><p><strong>Cambiar la fuente no eliminará los gastos importados.</strong> Las próximas sincronizaciones usarán el nuevo Spreadsheet.</p></div>}
            <DialogField label="Link del Google Spreadsheet" wide><input value={sheetUrl} onChange={event => { setSheetUrl(event.target.value); setSheetNames([]); setSheetName(""); setSheetLoading(false); setError(""); }} placeholder="https://docs.google.com/spreadsheets/d/…" /></DialogField>
            {sheetLoading && <div className="sheet-detection-status"><RefreshCw className="spin" /><span>Detectando pestañas automáticamente…</span></div>}
            {!sheetLoading && sheetNames.length > 0 && <div className="sheet-tab-picker">
              <div className="preview-chip"><Check /> {sheetNames.length} {sheetNames.length === 1 ? "pestaña detectada" : "pestañas detectadas"}</div>
              <DialogField label="Pestaña que MIDAS debe leer" wide><Select value={sheetName} onValueChange={setSheetName}><SelectTrigger className="sheet-tab-select"><SelectValue placeholder="Selecciona una pestaña" /></SelectTrigger><SelectContent>{sheetNames.map(name => <SelectItem value={name} key={name}>{name}</SelectItem>)}</SelectContent></Select></DialogField>
            </div>}
            <div className="privacy-note"><ShieldCheck /><span>MIDAS no solicita ni almacena usuario, contraseña, API Key, OAuth o tokens de Google.</span></div>
            <Button className="gold-button" disabled={!sheetName || sheetLoading} onClick={previewSpreadsheet}>{sheetLoading ? "Cargando vista previa…" : "Usar pestaña seleccionada"}</Button>
          </div>}

          {sheetStep === "mapping" && sheetPreview && <div className="mapping-step">
            <div className="preview-chip"><Check /> Pestaña “{sheetPreview.sheetName}” accesible · {sheetPreview.headers.length} columnas detectadas</div>
            <div className="mapping-grid">{SHEET_FIELDS.map(([key, label, required]) => <div className="mapping-row" key={key}><div><strong>{label}</strong>{required && <span>Obligatorio</span>}</div><ChevronRight /><Select value={sheetMapping[key] || "__none"} onValueChange={value => setSheetMapping({ ...sheetMapping, [key]: value === "__none" ? undefined : value })}><SelectTrigger className="mapping-select"><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><SelectItem value="__none">Sin asignar</SelectItem>{sheetPreview.headers.map(header => <SelectItem value={header} key={header}>{header}</SelectItem>)}</SelectContent></Select></div>)}</div>
            <div className="sheet-preview-table"><span>VISTA PREVIA</span><div><Table><TableHeader><TableRow>{sheetPreview.headers.slice(0, 5).map(header => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{sheetPreview.preview.slice(0, 3).map((row, index) => <TableRow key={index}>{sheetPreview.headers.slice(0, 5).map(header => <TableCell key={header}>{row[header] || "—"}</TableCell>)}</TableRow>)}</TableBody></Table></div></div>
            <div className="sheet-actions"><Button variant="outline" onClick={() => setSheetStep("url")}>Cambiar pestaña</Button><Button className="gold-button" disabled={sheetLoading || !sheetMapping.source_id || !sheetMapping.date || !sheetMapping.description || !sheetMapping.amount} onClick={saveSpreadsheetSource}>{sheetLoading ? "Guardando…" : "Guardar conexión"}</Button></div>
          </div>}

          {sheetStep === "result" && syncResult && <div className="sync-result">
            <div className={"result-icon " + syncResult.status}>{syncResult.status === "success" ? <Check /> : <AlertCircle />}</div>
            <div className="sync-summary large"><MiniResult label="Encontrados" value={syncResult.detected} /><MiniResult label="Nuevos agregados" value={syncResult.inserted} /><MiniResult label="Existentes ignorados" value={syncResult.ignored} /><MiniResult label="Errores" value={syncResult.failed} /></div>
            {syncResult.errors.length > 0 && <div className="sync-errors"><strong>{syncResult.failed} registros no pudieron importarse</strong>{syncResult.errors.map(error => <p key={error.row}>Fila {error.row} — {error.reason}</p>)}</div>}
            <div className="sheet-actions"><Button variant="outline" onClick={() => setSheetStep("status")}>Ver fuente</Button><Button className="gold-button" onClick={() => setSheetOpen(false)}>Cerrar</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={quickOpen} onOpenChange={open => { setQuickOpen(open); if (!open) setEditingTxn(null); }}>
        <DialogContent className="midas-dialog quick-dialog">
          <DialogHeader><p className="eyebrow">{editingTxn ? "EDICIÓN TRAZABLE" : "REGISTRO SIMPLE"}</p><DialogTitle>{editingTxn ? "Editar movimiento" : "Nuevo movimiento"}</DialogTitle><DialogDescription>Completa fecha, nombre, ingreso o gasto y categoría.</DialogDescription></DialogHeader>
          {!editingTxn && <div className="smart-entry"><div className="smart-label"><Sparkles /> Smart Entry</div><div className="smart-row"><input value={quick.smart} onChange={e => setQuick({ ...quick, smart: e.target.value })} onKeyDown={e => e.key === "Enter" && parseSmart()} placeholder='Ejemplo: “45 almuerzo visa”' /><Button variant="outline" onClick={parseSmart}>Interpretar</Button></div></div>}
          <div className="movement-switch"><button className={quick.type === "expense" ? "active" : ""} onClick={() => setQuick({ ...quick, type: "expense" })}>Gasto</button><button className={quick.type === "income" ? "active" : ""} onClick={() => setQuick({ ...quick, type: "income" })}>Ingreso</button><button className={quick.type === "debt_payment" ? "active" : ""} onClick={() => setQuick({ ...quick, type: "debt_payment" })}>Pago de deuda</button></div>
          <div className="quick-amount"><span>S/</span><input autoFocus type="number" min="0" step="0.01" value={quick.amount} onChange={e => setQuick({ ...quick, amount: e.target.value })} placeholder="0.00" /></div>
          {quick.type !== "debt_payment" && <div className="quick-categories"><label>Categoría</label><div>{data.categories.filter(c => !c.archived).map(c => <button type="button" key={c.id} className={quick.categoryId === c.id ? "selected" : ""} onClick={() => setQuick({ ...quick, categoryId: c.id })}><span style={{ background: c.color }} />{c.name}</button>)}</div></div>}
          {quick.type === "debt_payment" && <DialogField label="Deuda"><Select value={quick.debtId} onValueChange={value => setQuick({ ...quick, debtId: value })}><SelectTrigger className="full-select"><SelectValue placeholder="Selecciona una deuda" /></SelectTrigger><SelectContent>{data.debts.map(debt => <SelectItem key={debt.id} value={debt.id}>{debt.name} · {currency.format(debt.currentBalance)}</SelectItem>)}</SelectContent></Select></DialogField>}
          <div className="quick-extra-grid"><DialogField label="Fecha"><input type="date" value={quick.date} onChange={e => setQuick({ ...quick, date: e.target.value })} /></DialogField><DialogField label="Nombre"><input value={quick.description} onChange={e => setQuick({ ...quick, description: e.target.value })} placeholder={quick.type === "income" ? "Ej. Sueldo" : "Ej. Supermercado"} /></DialogField></div>
          <Button className="gold-button save-expense" disabled={saving || !Number(quick.amount) || (!quick.description.trim() && quick.type !== "debt_payment") || (quick.type !== "debt_payment" && !quick.categoryId) || (quick.type === "debt_payment" && !quick.debtId)} onClick={saveQuick}>{saving ? "Guardando…" : editingTxn ? "Actualizar movimiento" : "Guardar movimiento"}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryOpen} onOpenChange={open => { setCategoryOpen(open); if (!open) setEditingCategory(null); }}>
        <DialogContent className="midas-dialog"><DialogHeader><p className="eyebrow">PLAN DEL MES</p><DialogTitle>{editingCategory ? "Editar gasto programado" : "Nueva categoría"}</DialogTitle><DialogDescription>{editingCategory ? "Actualiza categoría, grupo, tipo, color y monto programado." : "Agrupa, asigna color y define su presupuesto."}</DialogDescription></DialogHeader>
          <div className="dialog-grid"><DialogField label="Nombre" wide><input value={newCategory.name} onChange={e => setNewCategory({ ...newCategory, name: e.target.value })} placeholder="Ej. Supermercado" /></DialogField><DialogField label="Grupo"><input value={newCategory.groupName} onChange={e => setNewCategory({ ...newCategory, groupName: e.target.value })} /></DialogField><DialogField label="Presupuesto"><div className="money-input"><span>S/</span><input type="number" min="0" value={newCategory.budget} onChange={e => setNewCategory({ ...newCategory, budget: e.target.value })} /></div></DialogField><DialogField label="Tipo"><Select value={newCategory.kind} onValueChange={value => setNewCategory({ ...newCategory, kind: value })}><SelectTrigger className="full-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fijo</SelectItem><SelectItem value="variable">Variable</SelectItem><SelectItem value="discretionary">Discrecional</SelectItem></SelectContent></Select></DialogField><DialogField label="Color"><input className="color-input" type="color" value={newCategory.color} onChange={e => setNewCategory({ ...newCategory, color: e.target.value })} /></DialogField></div>
          <Button className="gold-button" disabled={!newCategory.name || saving} onClick={async () => { const ok = await mutate({ action: editingCategory ? "update_category" : "add_category", id: editingCategory?.id, ...newCategory, budget: Number(newCategory.budget) }, editingCategory ? "Gasto programado actualizado" : "Categoría creada"); if (ok) { setCategoryOpen(false); setEditingCategory(null); setNewCategory({ name: "", groupName: "Necesidades", budget: "", color: "#CBA65B", kind: "variable" }); } }}>{saving ? "Guardando…" : editingCategory ? "Guardar cambios" : "Crear categoría"}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={debtOpen} onOpenChange={setDebtOpen}>
        <DialogContent className="midas-dialog debt-dialog"><DialogHeader><p className="eyebrow">DEBT CONTROL CENTER</p><DialogTitle>Agregar deuda</DialogTitle><DialogDescription>Usaremos estos datos para proyectar el pago.</DialogDescription></DialogHeader>
          <div className="dialog-grid"><DialogField label="Nombre" wide><input value={newDebt.name} onChange={e => setNewDebt({ ...newDebt, name: e.target.value })} placeholder="Ej. Préstamo personal" /></DialogField><DialogField label="Entidad"><input value={newDebt.entity} onChange={e => setNewDebt({ ...newDebt, entity: e.target.value })} /></DialogField><DialogField label="Fecha de adquisición"><input type="date" value={newDebt.acquiredAt} onChange={e => setNewDebt({ ...newDebt, acquiredAt: e.target.value })} /></DialogField>{[["Monto original", "originalAmount"], ["Saldo actual", "currentBalance"], ["TEA / APR (%)", "annualRate"], ["Cuota mínima", "minimumPayment"], ["Pago planificado", "plannedPayment"], ["Día de pago", "dueDay"]].map(pair => <DialogField label={pair[0]} key={pair[1]}><input type="number" min="0" value={newDebt[pair[1] as keyof typeof newDebt]} onChange={e => setNewDebt({ ...newDebt, [pair[1]]: e.target.value })} /></DialogField>)}</div>
          <Button className="gold-button" disabled={!newDebt.name || !Number(newDebt.currentBalance) || saving} onClick={async () => { const ok = await mutate({ action: "add_debt", ...newDebt }, "Deuda agregada"); if (ok) { setDebtOpen(false); setNewDebt({ name: "", entity: "", originalAmount: "", currentBalance: "", annualRate: "", minimumPayment: "", plannedPayment: "", dueDay: "1", acquiredAt: today }); } }}>Agregar deuda</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={scoreOpen} onOpenChange={setScoreOpen}>
        <DialogContent className="midas-dialog score-dialog"><DialogHeader><p className="eyebrow">CÁLCULO EXPLICABLE</p><DialogTitle>Cómo se calcula tu MIDAS Score</DialogTitle><DialogDescription>Periodo: {monthLabel(monthKey)}. Fuentes: plan, ledger y deudas del mismo mes.</DialogDescription></DialogHeader>
          <div className="score-detail"><div className={"score-number " + scoreTone}>{metrics.score ?? "—"}<span>/100</span></div><div className="factor-list"><ScoreFactor label="Cumplimiento del presupuesto" value={metrics.factors.budget} max={40} /><ScoreFactor label="Ahorro proyectado" value={metrics.factors.savings} max={25} /><ScoreFactor label="Consumo discrecional" value={metrics.factors.discretion} max={15} /><ScoreFactor label="Cumplimiento de deuda" value={metrics.factors.debt} max={20} /></div></div>
          <div className="formula-note"><Calculator /><div><strong>Fórmula</strong><p>Suma ponderada de cuatro factores. Cada factor se limita a su máximo.</p></div></div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTxn)} onOpenChange={open => !open && setDeleteTxn(null)}>
        <AlertDialogContent className="midas-dialog"><AlertDialogHeader><AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle><AlertDialogDescription>{deleteTxn?.type === "debt_payment" ? "El pago saldrá del ledger y el saldo de la deuda se restaurará." : "El movimiento dejará de contabilizarse en el dashboard."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => deleteTxn && mutate({ action: "delete_transaction", id: deleteTxn.id }, "Movimiento eliminado").then(() => setDeleteTxn(null))}>Eliminar</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </main>
    </TooltipProvider>
  );
}

function PageHeading({ eyebrow, title, subtitle, extra, compact }: { eyebrow: string; title: string; subtitle: string; extra?: React.ReactNode; compact?: boolean }) {
  return <section className={"page-heading " + (compact ? "compact-heading" : "")}><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div>{extra}</section>;
}

function PanelTitle({ eyebrow, title, extra }: { eyebrow: string; title: string; extra?: React.ReactNode }) {
  return <div className="panel-title"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{extra}</div>;
}

function Kpi({ title, value, note, icon, tone }: { title: string; value: string; note: string; icon: React.ReactNode; tone: string }) {
  return <article className={"kpi-card " + tone}><div className="kpi-icon">{icon}</div><div><span>{title}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

function CategoryName({ category }: { category: Pick<Category, "name" | "color"> }) {
  return <div className="category-name"><span style={{ background: category.color }} />{category.name}</div>;
}

function CategoryBar({ row }: { row: CategoryMetric }) {
  const width = row.budget > 0 ? Math.min(100, row.percent) : 0;
  return <div className="category-bar"><div className="bar-top"><CategoryName category={row} /><div><strong>{currency.format(row.actual)}</strong><span>/ {currency.format(row.budget)}</span></div></div><div className="bar-track"><div style={{ width: width + "%", background: row.percent > 100 ? "#ef6a6a" : row.color }} /></div><div className="bar-bottom"><span>{Number.isFinite(row.percent) ? Math.round(row.percent) + "% ejecutado" : "Sin presupuesto"}</span><span className={row.status.tone}>{row.status.label}</span></div></div>;
}

function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><p>{text}</p>{action}</div>;
}

function FieldMoney({ label, id, value, onBlur }: { label: string; id: string; value: number; onBlur: (value: number) => void }) {
  return <div className="form-field"><label htmlFor={id}>{label}</label><div className="money-input"><span>S/</span><input id={id} type="number" min="0" defaultValue={value} onBlur={e => onBlur(Number(e.target.value))} /></div></div>;
}

function SummaryNumber({ label, value, result }: { label: string; value: number; result?: boolean }) {
  return <div className={"summary-number " + (result ? "result " : "") + (value < 0 ? "negative" : "")}><span>{label}</span><strong>{currency.format(value)}</strong></div>;
}

function DialogField({ label, children, optional, wide }: { label: string; children: React.ReactNode; optional?: boolean; wide?: boolean }) {
  return <div className={"dialog-field " + (wide ? "wide" : "")}><label>{label}{optional && <span> opcional</span>}</label>{children}</div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function MiniResult({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ScoreFactor({ label, value, max }: { label: string; value: number; max: number }) {
  return <div><div><span>{label}</span><strong>{value.toFixed(1)} / {max}</strong></div><Progress value={value / max * 100} /></div>;
}

function Advisor({ metrics, debtCount }: { metrics: Metrics; debtCount: number }) {
  let tone = "info";
  let title = "Completa tu plan mensual";
  let observation = "Aún no hay base suficiente para proyectar tu cierre.";
  let impact = "El forecast y el MIDAS Score permanecerán sin calificación.";
  let recommendation = "Ingresa tu ingreso y asigna presupuestos por categoría.";
  const over = [...metrics.categoryRows].sort((a, b) => b.percent - a.percent).find(c => c.percent > 100);
  if (over) {
    tone = "danger"; title = over.name + " está sobre el presupuesto";
    observation = "Se ejecutó " + Math.round(over.percent) + "% del monto programado.";
    impact = "La desviación actual es " + currency.format(Math.abs(over.available)) + ".";
    recommendation = "Revisa los próximos consumos o reasigna presupuesto conscientemente.";
  } else if (metrics.setupComplete && metrics.forecast > metrics.budget) {
    tone = "warning"; title = "El ritmo actual proyecta una desviación";
    observation = "El forecast de salida alcanza " + currency.format(metrics.forecast) + ".";
    impact = "Superaría el presupuesto por " + currency.format(metrics.forecast - metrics.budget) + ".";
    recommendation = "Revisa las categorías con mayor ritmo antes del siguiente gasto discrecional.";
  } else if (metrics.setupComplete) {
    tone = "success"; title = "El mes se mantiene bajo control";
    observation = "El gasto representa " + (metrics.budget ? Math.round(metrics.spent / metrics.budget * 100) : 0) + "% del presupuesto.";
    impact = "El ahorro proyectado es " + currency.format(metrics.projectedSavings) + ".";
    recommendation = debtCount ? "Mantén los pagos planificados y revisa el forecast cada semana." : "Conserva el margen como ahorro o reserva.";
  }
  return <article className={"panel advisor-panel " + tone}><div className="advisor-icon"><Lightbulb /></div><div className="advisor-main"><p className="eyebrow">MIDAS ADVISOR</p><h2>{title}</h2><p>{observation}</p></div><div className="advisor-details"><div><span>Impacto</span><p>{impact}</p></div><div><span>Recomendación</span><p>{recommendation}</p></div></div></article>;
}
