import { strFromU8, unzipSync } from "fflate";

export type ColumnMapping = {
  source_id: string;
  date: string;
  description: string;
  category?: string;
  subcategory?: string;
  amount: string;
  payment_method?: string;
  account?: string;
  notes?: string;
};

export function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function toPublishedCsvUrl(raw: string) {
  return toPublishedCsvUrls(raw)[0];
}

export function toPublishedCsvUrls(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("El link no tiene un formato válido.");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !url.pathname.includes("/spreadsheets/d/")) {
    throw new Error("Utiliza un enlace HTTPS de Google Spreadsheet publicado o compartido como CSV.");
  }
  const sheet = url.searchParams.get("sheet");
  if (!sheet && (url.pathname.endsWith("/export") || url.searchParams.get("output") === "csv" || url.searchParams.get("format") === "csv")) {
    return [url.toString()];
  }
  const gidFromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("gid");
  const gid = url.searchParams.get("gid") ?? gidFromHash;
  if (url.pathname.includes("/spreadsheets/d/e/")) {
    const base = url.pathname.replace(/\/pubhtml\/?$/, "/pub").replace(/\/edit\/?$/, "/pub");
    return ["https://docs.google.com" + base + "?output=csv" + (gid ? "&gid=" + encodeURIComponent(gid) : "")];
  }
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new Error("No se pudo identificar el Spreadsheet.");
  const base = "https://docs.google.com/spreadsheets/d/" + match[1];
  if (sheet) return [base + "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(sheet)];
  if (gid) return [base + "/export?format=csv&gid=" + encodeURIComponent(gid)];
  return [
    base + "/gviz/tq?tqx=out:csv",
    base + "/export?format=csv&gid=0",
  ];
}

function spreadsheetId(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("El link no tiene un formato válido.");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new Error("Utiliza un enlace HTTPS de Google Spreadsheet.");
  }
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match || match[1] === "e") throw new Error("No se pudo identificar el Spreadsheet.");
  return match[1];
}

function decodeXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseWorkbookSheetNames(xml: string) {
  const names: string[] = [];
  for (const match of xml.matchAll(/<sheet\b([^>]*)\/?\s*>/gi)) {
    const attributes = match[1];
    const name = attributes.match(/\bname=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(value => value !== undefined);
    const state = attributes.match(/\bstate=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(value => value !== undefined);
    if (!name || (state && state.toLowerCase() !== "visible")) continue;
    const decoded = decodeXml(name).trim();
    if (decoded && !names.includes(decoded)) names.push(decoded);
  }
  return names;
}

export function withSpreadsheetSheet(raw: string, sheetName: string) {
  const id = spreadsheetId(raw);
  const selected = sheetName.trim();
  if (!selected) throw new Error("Selecciona una pestaña del Spreadsheet.");
  return `https://docs.google.com/spreadsheets/d/${id}/edit?sheet=${encodeURIComponent(selected)}`;
}

export async function fetchSpreadsheetSheets(rawUrl: string) {
  const id = spreadsheetId(rawUrl);
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, {
    headers: { "User-Agent": "MIDAS/0.5 Spreadsheet Tabs" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error("MIDAS no pudo leer las pestañas. Verifica que el acceso sea “Cualquier persona con el enlace · Lector”.");
  }
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > 20_000_000) throw new Error("El archivo supera el tamaño permitido para detectar pestañas.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 20_000_000) throw new Error("El archivo supera el tamaño permitido para detectar pestañas.");
  try {
    const archive = unzipSync(bytes, { filter: file => file.name === "xl/workbook.xml" });
    const workbook = archive["xl/workbook.xml"];
    if (!workbook) throw new Error("workbook missing");
    const sheets = parseWorkbookSheetNames(strFromU8(workbook));
    if (!sheets.length) throw new Error("sheets missing");
    return sheets;
  } catch {
    throw new Error("MIDAS no pudo identificar las pestañas visibles de este Spreadsheet.");
  }
}

export async function fetchSpreadsheet(rawUrl: string) {
  const candidates = toPublishedCsvUrls(rawUrl);
  for (const csvUrl of candidates) {
    try {
      const response = await fetch(csvUrl, {
        headers: { "User-Agent": "MIDAS/0.2 Spreadsheet Import" },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();
      if (text.length > 3_000_000) throw new Error("La hoja supera el tamaño permitido para una sincronización.");
      if (!text.trim() || contentType.includes("text/html") || /^\s*<!doctype html/i.test(text)) continue;
      const rows = parseCsv(text);
      if (!rows.length || !rows[0].some(Boolean)) continue;
      return { csvUrl, rows };
    } catch (error) {
      if (error instanceof Error && error.message.includes("tamaño permitido")) throw error;
    }
  }
  throw new Error("MIDAS no puede acceder a esta hoja. En Google Drive selecciona Compartir → Acceso general → Cualquier persona con el enlace → Lector.");
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      row.push(field.trim());
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

export function suggestMapping(headers: string[]): Partial<ColumnMapping> {
  const normalized = new Map(headers.map(header => [normalizeHeader(header), header]));
  const find = (...candidates: string[]) => candidates.map(normalizeHeader).map(key => normalized.get(key)).find(Boolean);
  return {
    source_id: find("ID_MOVIMIENTO", "id movimiento", "id", "transaction id"),
    date: find("Fecha", "date", "fecha movimiento"),
    description: find("Descripción", "Descripcion", "concepto", "detalle"),
    category: find("Categoría", "Categoria", "category"),
    subcategory: find("Subcategoría", "Subcategoria", "subcategory"),
    amount: find("Monto", "Importe", "amount", "valor"),
    payment_method: find("Medio_Pago", "Medio de pago", "payment method"),
    account: find("Cuenta", "account"),
    notes: find("Nota", "Notas", "notes", "observacion"),
  };
}

export function normalizeDate(value: string) {
  const text = value.trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) return validDate(Number(match[3]), Number(match[2]), Number(match[1]));
  throw new Error("fecha no reconocida");
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("fecha no reconocida");
  }
  return [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
}

export function normalizeAmount(value: string) {
  let text = value.trim().replace(/^S\/?\s*/i, "").replace(/\s/g, "");
  if (!text) throw new Error("monto vacío");
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma >= 0) {
    const decimals = text.length - comma - 1;
    text = decimals === 1 || decimals === 2 ? text.replace(",", ".") : text.replace(/,/g, "");
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("monto inválido");
  return amount;
}

export function rowObject(headers: string[], row: string[]) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""]));
}
