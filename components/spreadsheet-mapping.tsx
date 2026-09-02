"use client";

import type { ColumnMapping } from "@/lib/spreadsheet";
import { parseMappedRow, validateMapping } from "@/lib/spreadsheet";

const fields = [
  ["date", "Fecha", true], ["description", "Nombre", true],
  ["income", "Ingreso", false], ["expense", "Gasto", false], ["category", "Categoría", true],
] as const;

export function SpreadsheetMapping({ headers, preview, mapping, onChange, disabled = false }: {
  headers: string[]; preview: Array<Record<string, string>>; mapping: Partial<ColumnMapping>;
  onChange: (mapping: Partial<ColumnMapping>) => void; disabled?: boolean;
}) {
  let valid: ColumnMapping | undefined;
  let message = "";
  try { valid = validateMapping(mapping, headers); }
  catch (error) { message = error instanceof Error ? error.message : "Revisa las columnas."; }
  const singleAmount = Boolean(mapping.income) !== Boolean(mapping.expense);
  return <>
    <p className="mapping-explainer">Asigna únicamente las columnas de tus movimientos. El código lo genera MIDAS automáticamente: <strong>26-09-G-001</strong> / <strong>26-09-I-001</strong>.</p>
    <div className="mapping-grid">
      {fields.map(([key, label, required]) => <label className="mapping-row" key={key}>
        <span><strong>{label}</strong><small>{required ? "Obligatorio" : "Al menos Ingreso o Gasto"}</small></span>
        <select aria-label={`Columna de ${label}`} value={mapping[key] || ""} disabled={disabled} onChange={event => {
          const next = { ...mapping, [key]: event.target.value || undefined };
          if (next.income && next.expense) next.signed = false;
          onChange(next);
        }}>
          <option value="">{required ? "Selecciona una columna" : "Sin columna"}</option>
          {headers.map(header => <option key={header} value={header} disabled={fields.some(([other]) => other !== key && mapping[other] === header)}>{header}</option>)}
        </select>
      </label>)}
    </div>
    {singleAmount && <label className="mapping-sign-option"><input type="checkbox" checked={mapping.signed === true} disabled={disabled} onChange={event => onChange({ ...mapping, signed: event.target.checked })} /><span>Mi columna mezcla importes con signo: <strong>positivo = ingreso</strong>, <strong>negativo = gasto</strong>.</span></label>}
    {message && <p className="mapping-validation" role="status">{message}</p>}
    <div className="sheet-preview-table"><span>ASÍ SE IMPORTARÁN TUS MOVIMIENTOS</span><div>
      <table><thead><tr>{["Fecha", "Nombre", "Ingreso", "Gasto", "Categoría"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {preview.slice(0, 5).map((row, index) => {
          if (!valid) return <tr key={index}><td colSpan={5}>Completa el mapeo para ver esta fila.</td></tr>;
          try {
            const movement = parseMappedRow(row, valid);
            return <tr key={index}><td>{movement.date}</td><td>{movement.description}</td><td>{movement.type === "income" ? movement.amount.toFixed(2) : "—"}</td><td>{movement.type === "expense" ? movement.amount.toFixed(2) : "—"}</td><td>{movement.category}</td></tr>;
          } catch (error) { return <tr className="preview-invalid" key={index}><td colSpan={5}>Fila {index + 2}: {error instanceof Error ? error.message : "revisa los datos"}</td></tr>; }
        })}
      </tbody></table>
    </div></div>
    <p className="mapping-explainer">Se conservan tus registros manuales y de otras hojas. La comparación utiliza archivo, pestaña y contenido. Reordenar filas no vuelve a importarlas. Si editas su contenido en la hoja, se considera un movimiento nuevo.</p>
  </>;
}
