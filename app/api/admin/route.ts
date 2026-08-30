import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  activityLogs, spreadsheetSources, spreadsheetSyncLogs, systemSettings, users,
} from "../../../db/schema";
import { authErrorResponse, newLogId, requireAdmin } from "../../../lib/auth";

const DEFAULT_SETTINGS = [
  { key: "maintenance_mode", value: "false" },
  { key: "spreadsheet_enabled", value: "true" },
] as const;

async function ensureSettings(adminId: string) {
  const db = getDb();
  for (const setting of DEFAULT_SETTINGS) {
    const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.key, setting.key)).limit(1);
    if (!existing) await db.insert(systemSettings).values({ ...setting, updatedBy: adminId });
  }
}

async function readAdminState(adminId: string) {
  await ensureSettings(adminId);
  const db = getDb();
  const [userRows, sourceRows, syncRows, logRows, settingRows] = await Promise.all([
    db.select().from(users).orderBy(desc(users.createdAt)),
    db.select().from(spreadsheetSources).orderBy(desc(spreadsheetSources.updatedAt)),
    db.select().from(spreadsheetSyncLogs).orderBy(desc(spreadsheetSyncLogs.createdAt)).limit(50),
    db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(100),
    db.select().from(systemSettings),
  ]);
  const activeUsers = userRows.filter(user => user.status === "active").length;
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newUsers = userRows.filter(user => Date.parse(user.createdAt) >= recentThreshold).length;
  const failedSyncs = syncRows.filter(log => log.status === "failed" || log.status === "partial").length;
  const userById = new Map(userRows.map(user => [user.id, user.email]));
  return {
    overview: {
      totalUsers: userRows.length,
      activeUsers,
      newUsers,
      integrations: sourceRows.length,
      synchronizations: syncRows.length,
      recentErrors: failedSyncs,
      systemStatus: settingRows.find(setting => setting.key === "maintenance_mode")?.value === "true" ? "maintenance" : "operational",
    },
    users: userRows,
    integrations: sourceRows.map(source => ({
      ...source,
      userKey: userById.get(source.userKey) ?? source.userKey,
      syncs: syncRows.filter(log => log.sourceId === source.id).slice(0, 5),
    })),
    logs: logRows.map(log => ({
      ...log,
      userKey: userById.get(log.userKey) ?? log.userKey,
      targetUserKey: log.targetUserKey ? userById.get(log.targetUserKey) ?? log.targetUserKey : null,
    })),
    settings: Object.fromEntries(settingRows.map(setting => [setting.key, setting.value])),
  };
}

export async function GET() {
  try {
    const admin = await requireAdmin();
    return Response.json(await readAdminState(admin.id));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const db = getDb();

    if (action === "set_role" || action === "set_status") {
      const targetEmail = String(payload.email ?? "").toLowerCase();
      const [target] = await db.select().from(users).where(eq(users.email, targetEmail)).limit(1);
      if (!target) return Response.json({ error: "El usuario no existe." }, { status: 404 });
      const nextRole = action === "set_role" ? String(payload.role ?? "") : target.role;
      const nextStatus = action === "set_status" ? String(payload.status ?? "") : target.status;
      if (!["admin", "user"].includes(nextRole) || !["active", "disabled"].includes(nextStatus)) {
        return Response.json({ error: "Valor administrativo inválido." }, { status: 400 });
      }
      if (target.email === admin.email && (nextRole !== "admin" || nextStatus !== "active")) {
        return Response.json({ error: "No puedes retirar o desactivar tu propio acceso ADMIN." }, { status: 400 });
      }
      if (target.role === "admin" && (nextRole !== "admin" || nextStatus !== "active")) {
        const admins = await db.select().from(users);
        const activeAdmins = admins.filter(user => user.role === "admin" && user.status === "active").length;
        if (activeAdmins <= 1) return Response.json({ error: "MIDAS debe conservar al menos un administrador activo." }, { status: 400 });
      }
      const now = new Date().toISOString();
      await db.transaction(async tx => {
        await tx.update(users).set({ role: nextRole, status: nextStatus }).where(eq(users.email, targetEmail));
        await tx.insert(activityLogs).values({
          id: newLogId(),
          userKey: admin.id,
          targetUserKey: target.id,
          action: action === "set_role" ? "user_role_changed" : nextStatus === "active" ? "user_activated" : "user_disabled",
          status: "success",
          metadata: JSON.stringify({ previousRole: target.role, role: nextRole, previousStatus: target.status, userStatus: nextStatus, at: now }),
        });
      });
    } else if (action === "set_setting") {
      const key = String(payload.key ?? "");
      const value = String(payload.value ?? "");
      if (!["maintenance_mode", "spreadsheet_enabled"].includes(key) || !["true", "false"].includes(value)) {
        return Response.json({ error: "Configuración no permitida." }, { status: 400 });
      }
      const [existing] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
      const now = new Date().toISOString();
      if (existing) {
        await db.update(systemSettings).set({ value, updatedBy: admin.id, updatedAt: now }).where(eq(systemSettings.key, key));
      } else {
        await db.insert(systemSettings).values({ key, value, updatedBy: admin.id, updatedAt: now });
      }
      await db.insert(activityLogs).values({
        id: newLogId(),
        userKey: admin.id,
        targetUserKey: null,
        action: "system_setting_changed",
        status: "success",
        metadata: JSON.stringify({ key, value }),
      });
    } else {
      return Response.json({ error: "Acción no reconocida." }, { status: 400 });
    }
    return Response.json(await readAdminState(admin.id));
  } catch (error) {
    return authErrorResponse(error);
  }
}
