import { TABLES, MidasTables, Query, createRow, findRow, updateRow } from "./postgres/server";
import { getAuth } from "./neon-auth";
import { mapUser } from "./midas-data";
import type { MidasUser } from "./midas-data";
export type { MidasUser } from "./midas-data";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export function newLogId() { return "act_" + crypto.randomUUID().replaceAll("-", ""); }

export async function ensureContext(options: { logAccess?: boolean } = {}) {
  const { data: session, error } = await getAuth().getSession();
  if (error) throw new AuthError("No se pudo verificar tu sesión. Vuelve a intentar.", 503);
  const identity = session?.user;
  if (!identity) throw new AuthError("Debes iniciar sesión para usar MIDAS.", 401);
  if (!identity.emailVerified) throw new AuthError("Verifica tu correo antes de ingresar a MIDAS.", 403);
  const tables = new MidasTables(identity.id);
  let row = await findRow(tables, TABLES.users, [Query.equal("auth_user_id", identity.id)]);
  const now = new Date().toISOString();
  const ownerEmail = process.env.MIDAS_ADMIN_EMAIL?.trim().toLowerCase();
  if (!row) {
    try {
      row = await createRow(tables, TABLES.users, identity.id, {
        auth_user_id: identity.id, email: identity.email.toLowerCase(),
        display_name: identity.name || identity.email.split("@")[0],
        role: ownerEmail && ownerEmail === identity.email.toLowerCase() ? "admin" : "user",
        status: "active", last_login_at: now,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 409) throw error;
      row = await findRow(tables, TABLES.users, [Query.equal("auth_user_id", identity.id)]);
      if (!row) throw error;
    }
  }
  let user = mapUser(row);
  if (user.status === "disabled") throw new AuthError("Tu acceso a MIDAS está desactivado.", 403);
  const lastAccess = Date.parse(user.lastLoginAt);
  if (options.logAccess && (!Number.isFinite(lastAccess) || Date.now() - lastAccess > 30 * 60 * 1000)) {
    await updateRow(tables, TABLES.users, row.$id, { last_login_at: now });
    await createRow(tables, TABLES.activity, newLogId(), {
      user_id: identity.id, target_user_id: identity.id, action: "login", status: "success", metadata: "{}",
    });
    user = { ...user, lastLoginAt: now };
  }
  if (user.role !== "admin") {
    const maintenance = await findRow(tables, TABLES.settings, [Query.equal("setting_key", "maintenance_mode")]);
    if (maintenance?.value === "true") throw new AuthError("MIDAS se encuentra temporalmente en mantenimiento.", 503);
  }
  return { user: user as MidasUser, tables, identity };
}
export async function ensureUser(options: { logAccess?: boolean } = {}) { return (await ensureContext(options)).user; }
export async function requireAdmin() {
  const context = await ensureContext();
  if (context.user.role !== "admin") throw new AuthError("No tienes autorización para acceder a ADMIN.", 403);
  return { ...context, tables: new MidasTables(context.user.id, true) };
}
export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const code = Number((error as { code?: number })?.code);
  if ([408,429,502,503,504].includes(code)) return Response.json({ error: "El servicio está temporalmente ocupado. Los movimientos guardados se conservan.", retryable: true }, { status: code });
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo completar la operación." }, { status: [400,403,404,409].includes(code) ? code : 500 });
}
