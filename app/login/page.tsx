"use client";

import { useState } from "react";
import { LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const supabase = createClient();
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: email.split("@")[0] } } });
    setLoading(false);
    if (result.error) return setMessage(result.error.message);
    if (mode === "signup" && !result.data.session) return setMessage("Revisa tu correo para confirmar la cuenta antes de ingresar.");
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    window.location.href = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  }

  return (
    <main className="login-page dark">
      <section className="login-card">
        <div className="midas-mark">M</div>
        <p className="eyebrow">FINANCIAL COMMAND CENTER</p>
        <h1>Accede a MIDAS</h1>
        <p className="login-copy">Tus presupuestos, movimientos y deudas permanecen aislados en tu cuenta.</p>
        <div className="login-tabs">
          <button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Ingresar</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Crear cuenta</button>
        </div>
        <form onSubmit={submit}>
          <label><span>Correo</span><div><Mail /><input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></div></label>
          <label><span>Contraseña</span><div><LockKeyhole /><input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={event => setPassword(event.target.value)} /></div></label>
          {message && <p className="login-message">{message}</p>}
          <button className="gold-button login-submit" disabled={loading}>{loading ? "Procesando…" : mode === "signin" ? "Ingresar" : "Crear cuenta"}</button>
        </form>
        <div className="login-security"><ShieldCheck /><span>Autenticación segura con Supabase. MIDAS nunca almacena tu contraseña.</span></div>
      </section>
    </main>
  );
}
