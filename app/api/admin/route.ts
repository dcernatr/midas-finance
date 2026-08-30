import type { SupabaseClient } from "@supabase/supabase-js";
import { authErrorResponse, newLogId, requireAdmin } from "../../../lib/auth";
import { dataOrThrow, mapActivity, mapSetting, mapSource, mapSyncLog, mapUser } from "../../../lib/midas-data";

const DEFAULT_SETTINGS = [
  { key: "maintenance_mode", value: "false" },
  { key: "spreadsheet_enabled", value: "true" },
] as const;

async function ensureSettings(supabase: SupabaseClient, adminId: string) {
  for (const setting of DEFAULT_SETTINGS) {
    const existing = await supabase.from("midas_system_settings").select("key").eq("key", setting.key).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) dataOrThrow(await supabase.from("midas_system_settings").insert({ ...setting, updated_by: adminId }));
  }
}

async function readAdminState(supabase: SupabaseClient, adminId: string) {
  await ensureSettings(supabase, adminId);
  const [usersResult, sourcesResult, syncsResult, logsResult, settingsResult] = await Promise.all([
    supabase.from("midas_users").select("*").order("created_at", { ascending: false }),
    supabase.from("midas_spreadsheet_sources").select("*").order("updated_at", { ascending: false }),
    supabase.from("midas_spreadsheet_sync_logs").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("midas_activity_logs").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("midas_system_settings").select("*"),
  ]);
  const userRows = dataOrThrow(usersResult).map(mapUser);
  const sourceRows = dataOrThrow(sourcesResult).map(mapSource);
  const syncRows = dataOrThrow(syncsResult).map(mapSyncLog);
  const logRows = dataOrThrow(logsResult).map(mapActivity);
  const settingRows = dataOrThrow(settingsResult).map(mapSetting);
  const activeUsers = userRows.filter(user => user.status === "active").length;
  const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newUsers = userRows.filter(user => Date.parse(user.createdAt) >= recentThreshold).length;
  const failedSyncs = syncRows.filter(log => log.status === "failed" || log.status === "partial").length;
  const userById = new Map(userRows.map(user => [user.id, user.email]));
  return {
    overview: {
      totalUsers: userRows.length, activeUsers, newUsers, integrations: sourceRows.length,
      synchronizations: syncRows.length, recentErrors: failedSyncs,
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
    const { user, supabase } = await requireAdmin();
    return Response.json(await readAdminState(supabase, user.id));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user: admin, supabase } = await requireAdmin();
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action ?? "");

    if (action === "set_role" || action === "set_status") {
      const targetEmail = String(payload.email ?? "").toLowerCase();
      const targetResult = await supabase.from("midas_users").select("*").eq("email", targetEmail).maybeSingle();
      if (targetResult.error) throw new Error(targetResult.error.message);
      if (!targetResult.data) return Response.json({ error: "El usuario no existe." }, { status: 404 });
      const target = mapUser(targetResult.data);
      const nextRole = action === "set_role" ? String(payload.role ?? "") : target.role;
      const nextStatus = action === "set_status" ? String(payload.status ?? "") : target.status;
      if (!["admin", "user"].includes(nextRole) || !["active", "disabled"].includes(nextStatus)) {
        return Response.json({ error: "Valor administrativo inválido." }, { status: 400 });
      }
      if (target.email === admin.email && (nextRole !== "admin" || nextStatus !== "active")) {
        return Response.json({ error: "No puedes retirar o desactivar tu propio acceso ADMIN." }, { status: 400 });
      }
      if (target.role === "admin" && (nextRole !== "admin" || nextStatus !== "active")) {
        const adminsResult = dataOrThrow(await supabase.from("midas_users").select("role,status"));
        const activeAdmins = adminsResult.filter(row => row.role === "admin" && row.status === "active").length;
        if (activeAdmins <= 1) return Response.json({ error: "MIDAS debe conservar al menos un administrador activo." }, { status: 400 });
      }
      dataOrThrow(await supabase.from("midas_users").update({ role: nextRole, status: nextStatus }).eq("email", targetEmail));
      dataOrThrow(await supabase.from("midas_activity_logs").insert({
        id: newLogId(), user_id: admin.id, target_user_id: target.id,
        action: action === "set_role" ? "user_role_changed" : nextStatus === "active" ? "user_activated" : "user_disabled",
        status: "success",
        metadata: JSON.stringify({ previousRole: target.role, role: nextRole, previousStatus: target.status, userStatus: nextStatus, at: new Date().toISOString() }),
      }));
    } else if (action === "set_setting") {
      const key = String(payload.key ?? "");
      const value = String(payload.value ?? "");
      if (!["maintenance_mode", "spreadsheet_enabled"].includes(key) || !["true", "false"].includes(value)) {
        return Response.json({ error: "Configuración no permitida." }, { status: 400 });
      }
      dataOrThrow(await supabase.from("midas_system_settings").upsert({ key, value, updated_by: admin.id, updated_at: new Date().toISOString() }));
      dataOrThrow(await supabase.from("midas_activity_logs").insert({
        id: newLogId(), user_id: admin.id, target_user_id: null,
        action: "system_setting_changed", status: "success", metadata: JSON.stringify({ key, value }),
      }));
    } else {
      return Response.json({ error: "Acción no reconocida." }, { status: 400 });
    }
    return Response.json(await readAdminState(supabase, admin.id));
  } catch (error) {
    return authErrorResponse(error);
  }
}
