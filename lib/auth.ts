import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { activityLogs, systemSettings, users } from "../db/schema";
import { createClient } from "./supabase/server";

export type MidasUser = typeof users.$inferSelect;

export class AuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function getIdentity() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) throw new AuthError("Debes iniciar sesión para usar MIDAS.", 401);
  return {
    id: data.user.id,
    email: data.user.email.trim().toLowerCase(),
    displayName: typeof data.user.user_metadata?.display_name === "string" ? data.user.user_metadata.display_name : null,
  };
}

export async function ensureUser(options: { logAccess?: boolean } = {}) {
  const identity = await getIdentity();
  const db = getDb();
  let [user] = await db.select().from(users).where(eq(users.id, identity.id)).limit(1);
  const now = new Date().toISOString();

  if (!user) {
    const anyUsers = await db.select({ id: users.id }).from(users).limit(1);
    const role = anyUsers.length ? "user" : "admin";
    const newUser = { id: identity.id, email: identity.email, displayName: identity.displayName, role, status: "active", lastLoginAt: now };
    await db.transaction(async tx => {
      await tx.insert(users).values(newUser);
      await tx.insert(activityLogs).values({ id: makeId("act"), userKey: identity.id, targetUserKey: identity.id, action: "user_created", status: "success", metadata: JSON.stringify({ role }) });
    });
    [user] = await db.select().from(users).where(eq(users.id, identity.id)).limit(1);
  } else {
    const lastAccess = Date.parse(user.lastLoginAt);
    const shouldLog = options.logAccess && (!Number.isFinite(lastAccess) || Date.now() - lastAccess > 30 * 60 * 1000);
    if (shouldLog) {
      await db.transaction(async tx => {
        await tx.update(users).set({ lastLoginAt: now, displayName: identity.displayName ?? user.displayName }).where(eq(users.id, identity.id));
        await tx.insert(activityLogs).values({ id: makeId("act"), userKey: identity.id, targetUserKey: identity.id, action: "login", status: "success", metadata: "{}" });
      });
      user = { ...user, lastLoginAt: now, displayName: identity.displayName ?? user.displayName };
    }
  }

  if (!user) throw new AuthError("No se pudo preparar el usuario.", 500);
  if (user.status === "disabled") throw new AuthError("Tu acceso a MIDAS está desactivado. Contacta al administrador.", 403);
  if (user.role !== "admin") {
    const [maintenance] = await db.select().from(systemSettings).where(eq(systemSettings.key, "maintenance_mode")).limit(1);
    if (maintenance?.value === "true") throw new AuthError("MIDAS se encuentra temporalmente en mantenimiento.", 503);
  }
  return user;
}

export async function requireAdmin() {
  const user = await ensureUser();
  if (user.role !== "admin") throw new AuthError("No tienes autorización para acceder a ADMIN.", 403);
  return user;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo completar la operación." }, { status: 500 });
}

export function newLogId() {
  return makeId("act");
}
