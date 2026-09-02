export function isProtocolError(message: string) {
  return /unexpected token.*(?:<|json)|not valid json|unexpected end of json|json\.parse|<\?xml|<!doctype/i.test(message);
}

export function safeApiError(message: string) {
  return isProtocolError(message)
    ? "El servidor devolvió una respuesta inválida. Vuelve a intentar; los movimientos ya guardados se conservan."
    : message;
}

export class ApiResponseError extends Error {
  status: number;
  retryable: boolean;
  remapRequired: boolean;
  restartRequired: boolean;
  constructor(message: string, status = 502, options: { retryable?: boolean; remapRequired?: boolean; restartRequired?: boolean } = {}) {
    super(safeApiError(message));
    this.status = status;
    this.retryable = options.retryable ?? [408, 429, 502, 503, 504].includes(status);
    this.remapRequired = options.remapRequired === true;
    this.restartRequired = options.restartRequired === true;
  }
}

export type ApiMeta = { error?: string; retryable?: boolean; remapRequired?: boolean; restartRequired?: boolean };

export async function readApiResponse<T>(response: Response): Promise<T & ApiMeta> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const status = response.ok ? 502 : response.status;
  const invalid = () => new ApiResponseError(
    `No se pudo confirmar la respuesta de MIDAS (HTTP ${status}). Vuelve a intentar; los movimientos ya guardados se conservan.`, status,
  );
  if (!/(?:application\/json|\+json)/i.test(contentType) || /^\s*</.test(text)) throw invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw invalid(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
  const value = parsed as T & ApiMeta;
  if (typeof value.error === "string") value.error = safeApiError(value.error);
  return value;
}

// Retry reads and checkpointed imports only. Source configuration and manual
// financial mutations must not be automatically replayed.
export async function spreadsheetRequest<T>(payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const canReplay = ["preview", "list_sheets"].includes(String(payload.action)) || (payload.action === "sync" && typeof payload.requestId === "string" && !!payload.requestId);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("/api/spreadsheet", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
      });
      if (response.status === 401 || (response.redirected && new URL(response.url).pathname === "/login")) {
        throw new ApiResponseError("Tu sesión venció. Ingresa nuevamente.", 401);
      }
      const result = await readApiResponse<T>(response);
      if (!response.ok) throw new ApiResponseError(result.error || "No se pudo completar la importación.", response.status, result);
      return result;
    } catch (error) {
      if (signal?.aborted) throw error;
      const retryable = error instanceof ApiResponseError ? error.retryable : error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError");
      if (!canReplay || !retryable || attempt === 2) {
        if (error instanceof ApiResponseError) throw error;
        throw new ApiResponseError("La conexión se interrumpió. Vuelve a sincronizar para continuar sin duplicar movimientos.", 503);
      }
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw new ApiResponseError("No se pudo conectar con MIDAS.", 503);
}
