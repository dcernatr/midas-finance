"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { type BudgetCategory, type BudgetProfile, isPlanned, periodForDate, originalScope } from "@/lib/budgeting";

export function BudgetCategoryPicker({ categories, profile, date, original, categoryId, transactionId, sourceId, sourceUrl, pending, onSave, disabled, theme = "dark", error, observedAmount }: {
  categories: BudgetCategory[]; profile: BudgetProfile; date: string; original: string; categoryId?: string | null;
  transactionId?: string; sourceId?: string | null; sourceUrl?: string; pending?: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>; disabled?: boolean; theme?: string; error?: string;
  observedAmount?: number;
}) {
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [color, setColor] = useState("#CBA65B");
  const [group, setGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const period = periodForDate(date, profile.starts);
  const options = categories.filter(c => !c.archived && isPlanned(profile, period, c.id));
  const canGroup = !!originalScope(sourceId) || !!sourceUrl;
  const creating = choice === "current" || choice === "new";
  async function save() {
    setBusy(true); setFailed(false);
    try {
      const ok = await onSave({ action: "budget_link", targetPeriod: period, transactionId, sourceUrl, original, date,
        mode: creating ? choice : "existing", categoryId: creating ? undefined : choice,
        name: choice === "current" ? original : name, budget: creating ? budget : undefined, color,
        applyGroup: canGroup && (group || !transactionId),
      });
      if (ok) setChoice(""); else setFailed(true);
    } finally { setBusy(false); }
  }
  return <div className="budget-category-cell">
    <select aria-label={`Categoría de ${original || "gasto"}`} className="ledger-period" disabled={disabled || busy} value={options.some(c => c.id === categoryId) ? categoryId! : ""} onChange={e => {
      setChoice(e.target.value); setName(""); setBudget(""); setFailed(false); setGroup(canGroup); setColor("#CBA65B");
    }}>
      <option value="" disabled>{original || "Seleccionar categoría"}</option>
      <optgroup label={`Programadas · ${period}`}>{options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
      <option value="current">Agregar actual: {original || "sin nombre"}</option>
      <option value="new">Agregar nueva…</option>
    </select>
    {pending && <small className="category-pending">Pendiente de vincular · Actualiza programados</small>}
    {original && <small>Hoja / original: {original}</small>}
    <Dialog open={!!choice} onOpenChange={open => { if (!open && !busy) setChoice(""); }}>
      <DialogContent className="midas-dialog budget-dialog" data-theme={theme}>
        <DialogHeader><DialogTitle>{creating ? "Agregar a gastos programados" : "Vincular categoría"}</DialogTitle><DialogDescription>Periodo {period}. Se conserva la categoría original y no se modifican los importes del gasto.</DialogDescription></DialogHeader>
        <p>{original} → {creating ? (choice === "current" ? original : name || "Nueva categoría") : options.find(c => c.id === choice)?.name}</p>
        {creating && <div className="budget-form">
          <label>Nombre<input value={choice === "current" ? original : name} disabled={choice === "current"} maxLength={128} onChange={e => setName(e.target.value)} /></label>
          <label>Presupuesto del periodo (S/)<input type="number" min="0" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} placeholder="Indica el monto planificado" /></label>
          {observedAmount !== undefined && <div><p>Importe observado: S/ {observedAmount.toFixed(2)}. Es una referencia, no un aumento automático del presupuesto.</p><Button variant="outline" onClick={() => setBudget(observedAmount.toFixed(2))}>Usar como propuesta</Button></div>}
          <label>Color<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
        </div>}
        {transactionId && canGroup ? <label className="budget-group"><input type="checkbox" checked={group} onChange={e => setGroup(e.target.checked)} />Aplicar a pendientes con la misma categoría, archivo y pestaña; recordar para futuras importaciones.</label> : sourceUrl && <p className="muted-copy">La elección se aplicará a pendientes de esta categoría en el mismo archivo y pestaña, incluidas próximas importaciones.</p>}
        {failed && <p role="alert" className="category-pending">{error || "No se pudo guardar. Intenta nuevamente; no vuelvas a importar."}</p>}
        <Button className="gold-button" onClick={save} disabled={busy || (creating && (budget === "" || Number(budget) < 0 || !Number.isFinite(Number(budget)) || (choice === "new" && !name.trim())))}>{busy ? "Guardando…" : "Confirmar vinculación"}</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
