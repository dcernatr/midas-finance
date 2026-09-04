"use client";

import { useState } from "react";
import { LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { MidasCatIcon } from "@/components/midas-cat-icon";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, mode }),
    });
    const result = await response.json() as { error?: string; needsVerification?: boolean; message?: string };
    if (!response.ok) return setMessage(result.error ?? "No se pudo completar el acceso.");
    if (result.needsVerification) { setMode("signin"); return setMessage(result.message || "Revisa tu correo para verificar la cuenta."); }
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    const destination = new URL(returnTo || "/", window.location.origin);
    window.location.href = destination.origin === window.location.origin ? destination.href : "/";
    } catch { setMessage("No se pudo conectar con MIDAS. Vuelve a intentar."); }
    finally { setLoading(false); }
  }

  async function resendVerification() {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json();
      setMessage(result.message || result.error || "Vuelve a intentar.");
    } catch { setMessage("No se pudo enviar la solicitud."); }
    finally { setLoading(false); }
  }

  return (
    <main className="login-page dark">
      <section className="login-card">
        <MidasCatIcon className="login-cat" priority size={88} />
        <p className="eyebrow">HUB DE CONTROL DE GASTOS</p>
        <h1>Accede a MIDAS</h1>
        <p className="login-copy">Tus presupuestos, movimientos y deudas permanecen aislados en tu cuenta.</p>
        <div className="login-tabs">
          <button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Ingresar</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Crear cuenta</button>
        </div>
        <form onSubmit={submit}>
          <label className="login-field" htmlFor="midas-email"><span>Correo</span><div><Mail aria-hidden="true" /><input id="midas-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></div></label>
          <label className="login-field" htmlFor="midas-password"><span>Contraseña</span><div><LockKeyhole aria-hidden="true" /><input id="midas-password" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={event => setPassword(event.target.value)} /></div></label>
          <label className="login-password-toggle"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} aria-controls="midas-password" />Mostrar contraseña</label>
          {message && <p className="login-message">{message}</p>}
          <button className="gold-button login-submit" disabled={loading}>{loading ? "Procesando…" : mode === "signin" ? "Ingresar" : "Crear cuenta"}</button>
        </form>
        <button className="text-button" type="button" disabled={loading || !email} onClick={resendVerification}>Reenviar verificación</button>
        <div className="login-security"><ShieldCheck /><span>Autenticación con Neon Auth. MIDAS no guarda contraseñas en sus tablas financieras.</span></div>
      </section>
    </main>
  );
}
