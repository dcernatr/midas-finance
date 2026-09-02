"use client";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BudgetCategoryPicker } from "@/components/budget-category-picker";
import { type BudgetProfile, type BudgetCategory } from "@/lib/budgeting";
import { movementTotals } from "@/lib/finance-metrics";

export type LedgerEntry = { id: string; date: string; description: string; type: string; amount: number;
  code: string | null; sourceType: string; sourceName: string | null; sourceId: string | null;
  sourceCategory: string; categoryId: string | null; debtId: string | null; categoryPending: boolean; periodKey: string };
const money = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 });
const formatDate = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

export function ExpenseLedger<T extends LedgerEntry>({ rows, categories, debts, profile, disabled, theme, error, onSave, onEdit, onDelete }: {
  rows: T[]; categories: BudgetCategory[]; debts: Array<{ id: string; name: string }>; profile: BudgetProfile;
  disabled: boolean; theme: string; error?: string; onSave: (payload: Record<string, unknown>) => Promise<boolean>;
  onEdit: (row: T) => void; onDelete: (row: T) => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 25, pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * pageSize, (current + 1) * pageSize);
  const totals = movementTotals(rows);
  return <>
    <div className="ledger-totals" aria-label="Totales de todos los movimientos filtrados">
      <div><span>Ingresos</span><strong className="positive">{money.format(totals.income)}</strong></div>
      <div><span>Gastos + pagos de deuda</span><strong>{money.format(totals.outflow)}</strong></div>
      <div><span>Saldo de esta vista</span><strong>{money.format(totals.balance)}</strong></div>
    </div>
    <div className="expense-table-scroll" tabIndex={0} role="region" aria-label="Tabla de gastos efectivos">
      <table className="expense-table">
        <colgroup><col className="col-date" /><col className="col-name" /><col className="col-amount" /><col className="col-amount" /><col className="col-category" /><col className="col-actions" /></colgroup>
        <thead><tr><th>Fecha</th><th>Nombre</th><th className="align-right">Ingreso</th><th className="align-right">Gasto</th><th>Categoría</th><th><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>{visible.map(t => {
          const category = categories.find(c => c.id === t.categoryId);
          const debt = debts.find(d => d.id === t.debtId);
          return <tr key={t.id}>
            <td className="entry-date" data-label="Fecha">{formatDate(t.date)}</td>
            <td className="entry-name" data-label="Nombre"><strong>{t.description}</strong>
              <details className="entry-details"><summary>Detalles · {t.sourceType === "spreadsheet" ? "Hoja" : "Manual"}</summary>
                <dl><dt>Código MIDAS</dt><dd>{t.code || "Pendiente"}</dd><dt>Periodo</dt><dd>{t.periodKey}</dd>
                  <dt>Fuente</dt><dd>{t.sourceName || "Registro manual"}</dd><dt>Categoría original</dt><dd>{t.sourceCategory || category?.name || "Sin categoría"}</dd></dl>
              </details>
            </td>
            <td className="entry-income amount-cell positive" data-label="Ingreso">{t.type === "income" ? money.format(t.amount) : "—"}</td>
            <td className="entry-expense amount-cell" data-label="Gasto">{t.type !== "income" ? money.format(t.amount) : "—"}</td>
            <td className="entry-category" data-label="Categoría">{t.type === "expense" ? <BudgetCategoryPicker compact categories={categories} profile={profile} date={t.date} original={t.sourceCategory || category?.name || "Sin categoría"} categoryId={t.categoryId} transactionId={t.id} sourceId={t.sourceId} pending={t.categoryPending} error={error} observedAmount={t.amount} theme={theme} disabled={disabled} onSave={onSave} /> : <span className="entry-category-label"><i style={{ background: category?.color || "#9BA8BC" }} />{category?.name || debt?.name || (t.type === "income" ? "Ingreso" : "Pago de deuda")}</span>}</td>
            <td className="entry-actions"><div className="row-actions">
              {t.type !== "debt_payment" && <Button disabled={disabled} variant="ghost" size="icon-sm" onClick={() => onEdit(t)} aria-label={"Editar " + t.description}><Pencil /></Button>}
              <Button disabled={disabled} variant="ghost" size="icon-sm" onClick={() => onDelete(t)} aria-label={"Eliminar " + t.description}><Trash2 /></Button>
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {rows.length > 0 && <nav className="ledger-pagination" aria-label="Paginación de movimientos"><span>{current * pageSize + 1}–{Math.min(rows.length, (current + 1) * pageSize)} de {rows.length} · Totales de toda la vista</span><div><Button variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</Button><span>{current + 1} / {pages}</span><Button variant="outline" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>Siguiente</Button></div></nav>}
  </>;
}
