import { createNeonAuth } from "@neondatabase/auth/next/server";

let instance: ReturnType<typeof createNeonAuth> | undefined;
export function getAuth() {
  if (!instance) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret || secret.length < 32) throw new Error("Falta configurar el inicio de sesión de MIDAS con Neon.");
    // The SDK rejects zero TTL during initialization. Protected requests bypass
    // this short-lived cache explicitly in ensureContext instead.
    instance = createNeonAuth({ baseUrl, cookies: { secret, sessionDataTtl: 60 }, logLevel: "silent" });
  }
  return instance;
}
