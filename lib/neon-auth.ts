import { createNeonAuth } from "@neondatabase/auth/next/server";

let instance: ReturnType<typeof createNeonAuth> | undefined;
export function getAuth() {
  if (!instance) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret || secret.length < 32) throw new Error("Falta configurar el inicio de sesión de MIDAS con Neon.");
    instance = createNeonAuth({ baseUrl, cookies: { secret, sessionDataTtl: 0 }, logLevel: "silent" });
  }
  return instance;
}
