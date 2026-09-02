import { ID, Query } from "node-appwrite";
import {
  APPWRITE_TABLES, createAdminServices, createRow, createSessionAccount, findRow,
  listRows, updateRow,
} from "./appwrite/server";
import { mapUser } from "./midas-data";
import type { MidasUser } from "./midas-data";
import { isProtocolError, safeApiError } from "./api-response";

export type { MidasUser } from "./midas-data";

export class AuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 35 - prefix.length)}`;
}

export async function ensureContext(options: { logAccess?: boolean } = {}) {
  const sessionAccount = await createSessionAccount();
  if (!sessionAccount) throw new AuthError("Debes iniciar sesión para usar MIDAS.", 401);

  let identity;
  try {
    identity = await sessionAccount.get();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && [401, 403].includes(Number(error.code))) throw new AuthError("Tu sesión venció. Ingresa nuevamente.", 401);
    throw error;
  }

  const { tables } = createAdminServices();
  let row = await findRow(tables, APPWRITE_TABLES.users, [Query.equal("auth_user_id", identity.$id)]);
  const now = new Date().toISOString();

  if (!row) {
    const firstUser = (await listRows(tables, APPWRITE_TABLES.users, [], 1)).length === 0;
    row = await createRow(tables, APPWRITE_TABLES.users, identity.$id, {
      auth_user_id: identity.$id,
      email: identity.email.toLowerCase(),
      display_name: identity.name || identity.email.split("@")[0],
      role: firstUser ? "admin" : "user",
      status: "active",
      last_login_at: now,
    });
    await createRow(tables, APPWRITE_TABLES.activity, makeId("act"), {
      user_id: identity.$id,
      target_user_id: identity.$id,
      action: "user_created",
      status: "success",
      metadata: JSON.stringify({ role: firstUser ? "admin" : "user" }),
    });
  }

  let user = mapUser(row);
  const lastAccess = Date.parse(user.lastLoginAt);
  if (options.logAccess && (!Number.isFinite(lastAccess) || Date.now() - lastAccess > 30 * 60 * 1000)) {
    await updateRow(tables, APPWRITE_TABLES.users, row.$id, {
      last_login_at: now,
      display_name: identity.name || user.displayName || identity.email.split("@")[0],
    });
    await createRow(tables, APPWRITE_TABLES.activity, ID.unique(), {
      user_id: identity.$id,
      target_user_id: identity.$id,
      action: "login",
      status: "success",
      metadata: "{}",
    });
    user = { ...user, lastLoginAt: now };
  }

  if (user.status === "disabled") throw new AuthError("Tu acceso a MIDAS está desactivado. Contacta al administrador.", 403);
  if (user.role !== "admin") {
    const maintenance = await findRow(tables, APPWRITE_TABLES.settings, [Query.equal("setting_key", "maintenance_mode")]);
    if (maintenance?.value === "true") throw new AuthError("MIDAS se encuentra temporalmente en mantenimiento.", 503);
  }

  return { user: user as MidasUser, tables, identity };
}

export async function ensureUser(options: { logAccess?: boolean } = {}) {
  return (await ensureContext(options)).user;
}

export async function requireAdmin() {
  const context = await ensureContext();
  if (context.user.role !== "admin") throw new AuthError("No tienes autorización para acceder a ADMIN.", 403);
  return context;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && isProtocolError(error.message)) return Response.json({ error: safeApiError(error.message), retryable: true }, { status: 503 });
  const code = error && typeof error === "object" && "code" in error ? Number(error.code) : 0;
  if ([408, 429, 502, 503, 504].includes(code)) return Response.json({ error: "El servicio está temporalmente ocupado. Vuelve a intentar; los movimientos guardados se conservan.", retryable: true }, { status: code });
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo completar la operación." }, { status: 500 });
}

export function newLogId() {
  return makeId("act");
}
