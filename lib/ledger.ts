import { createHash } from "node:crypto";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
export const normalizedText = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

export function codePrefix(date: string, type: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["income", "expense", "debt_payment"].includes(type)) throw new Error("Fecha o tipo de movimiento inválido.");
  const parsed = new Date(date + "T12:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("Fecha inválida.");
  return `${date.slice(2, 7)}-${type === "income" ? "I" : "G"}`;
}

export function formatCode(date: string, type: string, sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Secuencia inválida.");
  return `${codePrefix(date, type)}-${String(sequence).padStart(3, "0")}`;
}

export function sourceScope(url: string) {
  const parsed = new URL(url);
  const workbook = parsed.pathname.match(/\/spreadsheets\/d\/((?:e\/)?[^/]+)/)?.[1];
  const tab = parsed.searchParams.get("sheet");
  if (parsed.protocol !== "https:" || parsed.hostname !== "docs.google.com" || !workbook || !tab?.trim()) throw new Error("Selecciona nuevamente el archivo y la pestaña de origen.");
  return digest(JSON.stringify([workbook, tab.normalize("NFC").trim()]));
}

export function movementFingerprint(row: { date: string; description: string; amount: number; type: string; category: string }) {
  return digest(JSON.stringify([row.date, normalizedText(row.description), Math.round(row.amount * 100), row.type, normalizedText(row.category)]));
}

export function importIdentity(userId: string, scope: string, fingerprint: string, occurrence: number) {
  const sourceId = `v2:${scope}:${fingerprint}:${occurrence}`;
  return { sourceId, rowId: `imp_${digest(userId + ":" + sourceId)}` };
}

export function nextOccurrence(counts: Map<string, number>, fingerprint: string) {
  const next = (counts.get(fingerprint) ?? 0) + 1;
  counts.set(fingerprint, next);
  return next;
}
