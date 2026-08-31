import type { TablesDB } from "node-appwrite";
import { authErrorResponse, newLogId, requireAdmin } from "../../../lib/auth";
import {
  APPWRITE_TABLES, Query, createRow, findRow, listRows, updateRow, upsertRow,
} from "../../../lib/appwrite/server";
import { mapActivity, mapSetting, mapSource, mapSyncLog, mapUser } from "../../../lib/midas-data";

const DEFAULT_SETTINGS = [
  { key: "maintenance_mode", value: "false" },
  { key: "spreadsheet_enabled", value: "true" },
] as const;

async function ensureSettings(tables: TablesDB, adminId: string) {
  for (const setting of DEFAULT_SETTINGS) {
    const existing = await findRow(tables, APPWRITE_TABLES.settings, [Query.equal("setting_key", setting.key)]);
    if (!existing) {
      await createRow(tables, APPWRITE_TABLES.settings, setting.key, {
        setting_key: setting.key, value: setting.value, updated_by: adminId, updated_at: new Date().toISOString(),
      });
    }
  }
}

async function readAdminState(tables: TablesDB, adminId: string) {
  await ensureSettings(tables, adminId);
  const [users, sources, syncs, logs, settings] = await Promise.all([
    listRows(tables, APPWRITE_TABLES.users, [Query.orderDesc("$createdAt")]),
    listRows(tables, APPWRITE_TABLES.sources, [Query.orderDesc("$updatedAt")]),
    listRows(tables, APPWRITE_TABLES.syncLogs, [Query.orderDesc("$createdAt")], 50),
    listRows(tables, APPWRITE_TABLES.activity, [Query.orderDesc("$createdAt")], 100),
    listRows(tables, APPWRITE_TABLES.settings),
  ]);
  const userRows = users.map(mapUser);
  const sourceRows = sources.map(mapSource);
  const syncRows = syncs.map(mapSyncLog);
  const logRows = logs.map(mapActivity);
  const settingRows = settings.map(mapSetting);
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const userById = new Map(userRows.map(user => [user.id, user.email]));
  return {
    overview: {
      totalUsers: userRows.length,
      activeUsers: userRows.filter(user => user.status === "active").length,
      newUsers: userRows.filter(user => Date.parse(user.createdAt) >= recentThreshold).length,
      integrations: sourceRows.length,
      synchronizations: syncRows.length,
      recentErrors: syncRows.filter(log => log.status === "failed" || log.status === "partial").length,
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
    const { user, tables } = await requireAdmin();
    return Response.json(await readAdminState(tables, user.id));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user: admin, tables } = await requireAdmin();
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");

    if (action === "set_role" || action === "set_status") {
      const targetEmail = String(payload.email ?? "").trim().toLowerCase();
      const targetRow = await findRow(tables, APPWRITE_TABLES.users, [Query.equal("email", targetEmail)]);
      if (!targetRow) return Response.json({ error: "El usuario no existe." }, { status: 404 });
      const target = mapUser(targetRow);
      const nextRole = action === "set_role" ? String(payload.role ?? "") : target.role;
      const nextStatus = action === "set_status" ? String(payload.status ?? "") : target.status;
      if (!["admin", "user"].includes(nextRole) || !["active", "disabled"].includes(nextStatus)) {
        return Response.json({ error: "Valor administrativo inválido." }, { status: 400 });
      }
      if (target.email === admin.email && (nextRole !== "admin" || nextStatus !== "active")) {
        return Response.json({ error: "No puedes retirar o desactivar tu propio acceso ADMIN." }, { status: 400 });
      }
      if (target.role === "admin" && (nextRole !== "admin" || nextStatus !== "active")) {
        const users = (await listRows(tables, APPWRITE_TABLES.users)).map(mapUser);
        if (users.filter(user => user.role === "admin" && user.status === "active").length <= 1) {
          return Response.json({ error: "MIDAS debe conservar al menos un administrador activo." }, { status: 400 });
        }
      }
      await updateRow(tables, APPWRITE_TABLES.users, target.id, { role: nextRole, status: nextStatus });
      await createRow(tables, APPWRITE_TABLES.activity, newLogId(), {
        user_id: admin.id, target_user_id: target.id,
        action: action === "set_role" ? "user_role_changed" : nextStatus === "active" ? "user_activated" : "user_disabled",
        status: "success",
        metadata: JSON.stringify({ previousRole: target.role, role: nextRole, previousStatus: target.status, userStatus: nextStatus }),
      });
    } else if (action === "set_setting") {
      const key = String(payload.key ?? "");
      const value = String(payload.value ?? "");
      if (!["maintenance_mode", "spreadsheet_enabled"].includes(key) || !["true", "false"].includes(value)) {
        return Response.json({ error: "Configuración no permitida." }, { status: 400 });
      }
      await upsertRow(tables, APPWRITE_TABLES.settings, key, {
        setting_key: key, value, updated_by: admin.id, updated_at: new Date().toISOString(),
      });
      await createRow(tables, APPWRITE_TABLES.activity, newLogId(), {
        user_id: admin.id, action: "system_setting_changed", status: "success", metadata: JSON.stringify({ key, value }),
      });
    } else {
      return Response.json({ error: "Acción no reconocida." }, { status: 400 });
    }
    return Response.json(await readAdminState(tables, admin.id));
  } catch (error) {
    return authErrorResponse(error);
  }
}
