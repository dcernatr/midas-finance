"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { type BudgetProfile, type BudgetPeriod, payrollCandidates } from "@/lib/budgeting";

export function BudgetPeriodSettings({ period, profile, transactions, onSave, disabled, theme, error }: {
  period: BudgetPeriod; profile: BudgetProfile; transactions: Array<{ id: string; date: string; description: string; type: string }>;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>; disabled: boolean; theme: string; error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(period.start), [names, setNames] = useState(profile.payrollNames.join(", "));
  const candidates = payrollCandidates(transactions, profile, period.key);
  const last = new Date(Date.parse(period.end) - 86400000).toISOString().slice(0, 10);
  return <section className="period-settings panel">
    <div><strong>Periodo {period.key} · {period.start} — {last}</strong><p>{period.confirmed ? "Inicio confirmado por sueldo" : "Inicio estimado: último viernes del mes anterior"} · {period.endConfirmed ? "Fin según siguiente sueldo confirmado" : "Fin estimado; confirma el siguiente sueldo"}.</p><small>La estimación no incluye feriados. Confirma la fecha real antes de evaluar el presupuesto.</small></div>
    <div className="period-actions"><Button variant="outline" disabled={disabled} onClick={() => { setStart(period.start); setNames(profile.payrollNames.join(", ")); setOpen(true); }}>Configurar sueldo</Button>
      <Button variant="outline" disabled={disabled} onClick={() => onSave({ action: "budget_copy" })}>Copiar plan anterior</Button>
    </div>
    <Dialog open={open} onOpenChange={v => { if (!disabled) setOpen(v); }}><DialogContent className="midas-dialog budget-dialog" data-theme={theme}>
      <DialogHeader><DialogTitle>Inicio por ingreso de sueldo · {period.key}</DialogTitle><DialogDescription>Esta fecha cambia el periodo de los indicadores y filtros; no cambia fechas ni códigos de movimientos. Otros ingresos no abren periodos.</DialogDescription></DialogHeader>
      <div className="budget-form"><label>Fecha real de recepción<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label><label>Nombres para sugerir sueldo (separados por comas)<input value={names} onChange={e => setNames(e.target.value)} placeholder="sueldo, salario" /></label></div>
      <p className="muted-copy">{candidates.length ? "Ingresos candidatos: revisa y confirma uno; ninguno se aplica automáticamente." : "No se detectó un sueldo inequívoco. Puedes confirmar la fecha manualmente."}</p>
      <div className="payroll-candidates">{candidates.map(c => <Button key={c.id} variant="outline" onClick={() => setStart(c.date)}>{c.date} · {c.description}</Button>)}</div>
      {error && <p role="alert" className="category-pending">{error}</p>}
      <Button className="gold-button" disabled={disabled || !start || !names.trim()} onClick={async () => { if (await onSave({ action: "budget_period", start, payrollNames: names })) setOpen(false); }}>Confirmar fecha y regla</Button>
    </DialogContent></Dialog>
  </section>;
}
