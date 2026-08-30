import { dataOrThrow, mapUser } from "./midas-data";
import type { MidasUser } from "./midas-data";
import { createClient } from "./supabase/server";

export type { MidasUser } from "./midas-data";

export class AuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function ensureContext(options: { logAccess?: boolean } = {}) {
  const supabase = await createClient();
  const identityResult = await supabase.auth.getUser();
  const identity = identityResult.data.user;
  if (identityResult.error || !identity?.email) throw new AuthError("Debes iniciar sesión para usar MIDAS.", 401);

  const userResult = await supabase.from("midas_users").select("*").eq("id", identity.id).maybeSingle();
  if (userResult.error) throw new Error(userResult.error.message);
  let user = userResult.data ? mapUser(userResult.data) : null;
  const now = new Date().toISOString();

  if (!user) {
    const registered = dataOrThrow(await supabase.rpc("midas_register_current_user", {
      p_display_name: typeof identity.user_metadata?.display_name === "string" ? identity.user_metadata.display_name : null,
    }));
    const row = Array.isArray(registered) ? registered[0] : registered;
    if (!row) throw new AuthError("No se pudo preparar el usuario.", 500);
    user = mapUser(row as Record<string, unknown>);
  } else {
    const lastAccess = Date.parse(user.lastLoginAt);
    const shouldLog = options.logAccess && (!Number.isFinite(lastAccess) || Date.now() - lastAccess > 30 * 60 * 1000);
    if (shouldLog) {
      dataOrThrow(await supabase.from("midas_users").update({
        last_login_at: now,
        display_name: typeof identity.user_metadata?.display_name === "string" ? identity.user_metadata.display_name : user.displayName,
      }).eq("id", identity.id));
      dataOrThrow(await supabase.from("midas_activity_logs").insert({
        id: makeId("act"), user_id: identity.id, target_user_id: identity.id,
        action: "login", status: "success", metadata: "{}",
      }));
      user = { ...user, lastLoginAt: now };
    }
  }

  if (user.status === "disabled") throw new AuthError("Tu acceso a MIDAS está desactivado. Contacta al administrador.", 403);
  if (user.role !== "admin") {
    const settingResult = await supabase.from("midas_system_settings").select("value").eq("key", "maintenance_mode").maybeSingle();
    if (settingResult.error) throw new Error(settingResult.error.message);
    if (settingResult.data?.value === "true") throw new AuthError("MIDAS se encuentra temporalmente en mantenimiento.", 503);
  }

  return { user: user as MidasUser, supabase };
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
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo completar la operación." }, { status: 500 });
}

export function newLogId() {
  return makeId("act");
}
