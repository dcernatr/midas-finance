"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertCircle, ArrowLeft, Check, Database, Gauge, Search,
  Settings, ShieldCheck, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AdminUser = { id: string; email: string; displayName: string | null; role: string; status: string; createdAt: string; lastLoginAt: string };
type Sync = { id: string; rowsDetected: number; rowsInserted: number; rowsIgnored: number; rowsFailed: number; status: string; createdAt: string };
type Integration = { id: string; userKey: string; sourceName: string; lastSyncAt: string | null; lastSyncStatus: string; lastRowsDetected: number; lastRowsInserted: number; lastRowsIgnored: number; lastRowsFailed: number; syncs: Sync[] };
type Log = { id: string; userKey: string; targetUserKey: string | null; action: string; status: string; metadata: string; createdAt: string };
type AdminState = {
  overview: { totalUsers: number; activeUsers: number; newUsers: number; integrations: number; synchronizations: number; recentErrors: number; systemStatus: string };
  users: AdminUser[];
  integrations: Integration[];
  logs: Log[];
  settings: Record<string, string>;
};

const actions: Record<string, string> = {
  login: "Inicio de sesión",
  user_created: "Usuario creado",
  user_role_changed: "Rol modificado",
  user_activated: "Usuario activado",
  user_disabled: "Usuario desactivado",
  spreadsheet_configured: "Spreadsheet configurado",
  spreadsheet_source_changed: "Fuente modificada",
  spreadsheet_sync: "Sincronización Spreadsheet",
  system_setting_changed: "Configuración modificada",
};

function redirectIfUnauthorized(response: Response) {
  if (response.status !== 401) return false;
  window.location.assign("/login");
  return true;
}

export default function AdminClient() {
  const [data, setData] = useState<AdminState | null>(null);
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/admin");
      if (redirectIfUnauthorized(response)) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo cargar ADMIN.");
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar ADMIN.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function mutate(payload: Record<string, unknown>, label: string) {
    setSaving(label);
    setError("");
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (redirectIfUnauthorized(response)) return;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo guardar.");
      setData(result);
      setNotice("Cambio guardado");
      window.setTimeout(() => setNotice(""), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setSaving("");
    }
  }

  const users = useMemo(() => (data?.users ?? []).filter(user =>
    (user.displayName + " " + user.email).toLowerCase().includes(search.toLowerCase())
  ), [data, search]);

  if (!data) {
    return <main className="midas-app dark"><div className="loading-screen"><div className="midas-mark">M</div><p>{error || "Preparando ADMIN…"}</p>{error && <Button onClick={load}>Reintentar</Button>}</div></main>;
  }

  return (
    <main className="midas-app dark admin-app">
      <header className="topbar admin-topbar">
        <div className="brand-wrap"><div className="midas-mark">M</div><div><div className="brand">M.I.D.A.S. ADMIN</div><div className="tagline">Seguridad · Usuarios · Integraciones · Sistema</div></div></div>
        <Button variant="outline" asChild><Link href="/"><ArrowLeft /> Volver a MIDAS</Link></Button>
      </header>
      {error && <div className="global-message error-message"><AlertCircle />{error}</div>}
      {notice && <div className="global-message success-message"><Check />{notice}</div>}
      <Tabs value={tab} onValueChange={setTab} className="admin-workspace">
        <TabsList className="admin-nav" variant="line">
          <TabsTrigger value="overview"><Gauge /> Overview</TabsTrigger>
          <TabsTrigger value="users"><Users /> Usuarios</TabsTrigger>
          <TabsTrigger value="integrations"><Database /> Integraciones</TabsTrigger>
          <TabsTrigger value="logs"><Activity /> Activity Logs</TabsTrigger>
          <TabsTrigger value="settings"><Settings /> System Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="page-content admin-content">
          <AdminHeading title="Overview" subtitle="Estado operativo de MIDAS sin exponer información financiera personal." />
          <section className="admin-kpis">
            <AdminKpi label="Usuarios totales" value={data.overview.totalUsers} icon={<Users />} />
            <AdminKpi label="Usuarios activos" value={data.overview.activeUsers} icon={<ShieldCheck />} tone="success" />
            <AdminKpi label="Nuevos · 7 días" value={data.overview.newUsers} icon={<Users />} />
            <AdminKpi label="Integraciones" value={data.overview.integrations} icon={<Database />} />
            <AdminKpi label="Sincronizaciones" value={data.overview.synchronizations} icon={<Activity />} />
            <AdminKpi label="Errores recientes" value={data.overview.recentErrors} icon={<AlertCircle />} tone={data.overview.recentErrors ? "danger" : "success"} />
          </section>
          <section className="panel system-status-card">
            <div className={"system-orb " + data.overview.systemStatus}><span /></div>
            <div><p className="eyebrow">SYSTEM STATUS</p><h2>{data.overview.systemStatus === "operational" ? "MIDAS opera con normalidad" : "Modo mantenimiento activo"}</h2><p>Versión Beta v0.4.0 · Appwrite, Spreadsheet y autorización verificables.</p></div>
          </section>
        </TabsContent>

        <TabsContent value="users" className="page-content admin-content">
          <AdminHeading title="Usuarios" subtitle="Roles y estados. Desactivar conserva íntegramente los datos del usuario." />
          <div className="panel admin-toolbar"><div className="search-box"><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar usuario o email…" /></div><span>{users.length} usuarios</span></div>
          <section className="panel admin-table-panel">
            <Table className="midas-table admin-table"><TableHeader><TableRow><TableHead>Usuario</TableHead><TableHead>Rol</TableHead><TableHead>Estado</TableHead><TableHead>Creado</TableHead><TableHead>Último acceso</TableHead></TableRow></TableHeader>
              <TableBody>{users.map(user => <TableRow key={user.id}><TableCell><div className="admin-user"><div>{(user.displayName || user.email).slice(0, 1).toUpperCase()}</div><div><strong>{user.displayName || "Usuario MIDAS"}</strong><span>{user.email}</span></div></div></TableCell><TableCell><Select value={user.role} disabled={saving === user.email + "-role"} onValueChange={role => mutate({ action: "set_role", email: user.email, role }, user.email + "-role")}><SelectTrigger className="admin-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="user">Usuario</SelectItem></SelectContent></Select></TableCell><TableCell><div className="status-control"><Switch checked={user.status === "active"} disabled={saving === user.email + "-status"} onCheckedChange={checked => mutate({ action: "set_status", email: user.email, status: checked ? "active" : "disabled" }, user.email + "-status")} /><span className={"status-pill " + (user.status === "active" ? "success" : "danger")}><span />{user.status === "active" ? "Activo" : "Desactivado"}</span></div></TableCell><TableCell>{formatDate(user.createdAt)}</TableCell><TableCell>{formatDateTime(user.lastLoginAt)}</TableCell></TableRow>)}</TableBody>
            </Table>
          </section>
        </TabsContent>

        <TabsContent value="integrations" className="page-content admin-content">
          <AdminHeading title="Integraciones" subtitle="Diagnóstico técnico de Spreadsheet. No se muestran movimientos ni montos personales." />
          <section className="integration-admin-grid">
            {data.integrations.map(integration => <article className="panel integration-admin-card" key={integration.id}><div className="integration-head"><div className="integration-icon"><Database /></div><div><span>{integration.userKey}</span><h2>{integration.sourceName}</h2></div><span className={"status-pill " + (integration.lastSyncStatus === "success" ? "success" : integration.lastSyncStatus === "partial" ? "warning" : integration.lastSyncStatus === "failed" ? "danger" : "neutral")}><span />{integration.lastSyncStatus}</span></div><div className="integration-stats"><MiniStat label="Procesados" value={integration.lastRowsDetected} /><MiniStat label="Insertados" value={integration.lastRowsInserted} /><MiniStat label="Ignorados" value={integration.lastRowsIgnored} /><MiniStat label="Errores" value={integration.lastRowsFailed} /></div><p>Última sincronización: {integration.lastSyncAt ? formatDateTime(integration.lastSyncAt) : "Pendiente"}</p></article>)}
            {!data.integrations.length && <div className="panel admin-empty"><Database /><strong>Sin integraciones configuradas</strong><p>Las fuentes aparecerán cuando un usuario conecte un Spreadsheet.</p></div>}
          </section>
        </TabsContent>

        <TabsContent value="logs" className="page-content admin-content">
          <AdminHeading title="Activity Logs" subtitle="Eventos de seguridad, usuarios, configuración e integraciones." />
          <section className="panel admin-table-panel"><Table className="midas-table admin-table"><TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Actor</TableHead><TableHead>Acción</TableHead><TableHead>Objetivo</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader><TableBody>{data.logs.map(log => <TableRow key={log.id}><TableCell>{formatDateTime(log.createdAt)}</TableCell><TableCell>{log.userKey}</TableCell><TableCell className="strong-cell">{actions[log.action] || log.action}</TableCell><TableCell>{log.targetUserKey || "Sistema"}</TableCell><TableCell><span className={"status-pill " + (log.status === "success" ? "success" : log.status === "partial" ? "warning" : "danger")}><span />{log.status}</span></TableCell></TableRow>)}</TableBody></Table></section>
        </TabsContent>

        <TabsContent value="settings" className="page-content admin-content">
          <AdminHeading title="System Settings" subtitle="Solo se muestran parámetros que tienen efecto real en MIDAS." />
          <section className="settings-grid">
            <SettingCard title="Integración Spreadsheet" description="Permite que los usuarios configuren y sincronicen hojas publicadas." checked={data.settings.spreadsheet_enabled !== "false"} disabled={saving === "spreadsheet_enabled"} onChange={checked => mutate({ action: "set_setting", key: "spreadsheet_enabled", value: String(checked) }, "spreadsheet_enabled")} />
            <SettingCard title="Modo mantenimiento" description="Bloquea temporalmente las operaciones de usuarios normales; ADMIN permanece disponible." checked={data.settings.maintenance_mode === "true"} disabled={saving === "maintenance_mode"} warning onChange={checked => mutate({ action: "set_setting", key: "maintenance_mode", value: String(checked) }, "maintenance_mode")} />
          </section>
          <section className="panel about-admin"><p className="eyebrow">APPLICATION</p><h2>MIDAS Beta — v0.4.0</h2><p>Money Intelligence, Debt, Allocation & Spending</p></section>
        </TabsContent>
      </Tabs>
    </main>
  );
}

function AdminHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <section className="page-heading compact-heading"><div><p className="eyebrow">MIDAS ADMIN</p><h1>{title}</h1><p>{subtitle}</p></div></section>;
}

function AdminKpi({ label, value, icon, tone = "gold" }: { label: string; value: number; icon: React.ReactNode; tone?: string }) {
  return <article className={"admin-kpi " + tone}><div>{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function SettingCard({ title, description, checked, disabled, warning, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; warning?: boolean; onChange: (checked: boolean) => void }) {
  return <article className={"panel setting-card " + (warning ? "warning-setting" : "")}><div><h2>{title}</h2><p>{description}</p></div><Switch checked={checked} disabled={disabled} onCheckedChange={onChange} /></article>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
