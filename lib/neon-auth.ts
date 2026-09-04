import { createNeonAuth } from "@neondatabase/auth/next/server";
import { readAuthConfiguration } from "./auth-diagnostics";

let instance: ReturnType<typeof createNeonAuth> | undefined;
export function getAuth() {
  if (!instance) {
    const { baseUrl, secret } = readAuthConfiguration(process.env);
    // The SDK rejects zero TTL during initialization. Protected requests bypass
    // this short-lived cache explicitly in ensureContext instead.
    instance = createNeonAuth({ baseUrl, cookies: { secret, sessionDataTtl: 60 }, logLevel: "silent" });
  }
  return instance;
}
