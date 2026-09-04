import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readAuthConfiguration, authFailureResponse, AuthConfigurationError } from "../lib/auth-diagnostics.ts";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith("/lib/neon-auth") && context.parentURL?.includes("/app/api/auth/"))
    return { url: "midas-diagnostics:auth", shortCircuit: true };
  if (specifier.startsWith("@/")) return next(new URL("../" + specifier.slice(2) + ".ts", import.meta.url).href, context);
  if (context.parentURL?.endsWith(".ts") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier))
    return next(specifier + ".ts", context);
  return next(specifier, context);
}, load(url, context, next) {
  if (url === "midas-diagnostics:auth") return { format: "module", shortCircuit: true,
    source: "export function getAuth() { return globalThis.__authRouteMock(); }" };
  return next(url, context);
} });

test("auth configuration distinguishes missing URL, invalid URL and missing/short secret", () => {
  const valid = { NEON_AUTH_BASE_URL: "https://auth.example.test/auth", NEON_AUTH_COOKIE_SECRET: "x".repeat(40) };
  for (const [env, code] of [
    [{}, "AUTH_URL_MISSING"],
    [{ ...valid, NEON_AUTH_BASE_URL: "not a URL" }, "AUTH_URL_INVALID"],
    [{ ...valid, NEON_AUTH_BASE_URL: "https://user:secret@example.test" }, "AUTH_URL_INVALID"],
    [{ ...valid, NEON_AUTH_COOKIE_SECRET: "" }, "AUTH_SECRET_MISSING"],
    [{ ...valid, NEON_AUTH_COOKIE_SECRET: "short" }, "AUTH_SECRET_TOO_SHORT"],
  ]) assert.throws(() => readAuthConfiguration(env), error => error.code === code);
  assert.deepEqual(readAuthConfiguration(valid), { baseUrl: valid.NEON_AUTH_BASE_URL, secret: valid.NEON_AUTH_COOKIE_SECRET });
});

test("auth diagnostics never expose provider credentials, email or raw errors", async t => {
  const logs = [];
  const oldLog = console.error;
  console.error = value => logs.push(value);
  t.after(() => { console.error = oldLog; });
  const sensitive = "private-password email@example.test postgres://user:secret@host/db";
  for (const [failure, phase, expected] of [
    [{ status: 500, message: sensitive }, "signup", "AUTH_PROVIDER_UNAVAILABLE"],
    [{ status: 400, code: "INVALID_ORIGIN", message: sensitive }, "signup", "AUTH_DOMAIN_REJECTED"],
    [{ status: 429, message: sensitive }, "signin", "AUTH_RATE_LIMITED"],
    [{ status: 400, message: sensitive }, "signup", "AUTH_SIGNUP_REJECTED"],
    [new Error(sensitive), "signin", "AUTH_INTERNAL_ERROR"],
  ]) {
    const response = authFailureResponse(failure, phase);
    const body = await response.json();
    assert.equal(body.code, expected);
    assert.match(body.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!JSON.stringify(body).includes(sensitive));
  }
  assert.ok(!logs.join("").includes(sensitive));
});

test("registration reports configuration failures and preserves success when verification fails", async t => {
  const oldLog = console.error;
  console.error = () => {};
  t.after(() => { console.error = oldLog; delete globalThis.__authRouteMock; });
  const { POST } = await import("../app/api/auth/session/route.ts");
  const request = mode => new Request("https://midas.example.test/api/auth/session", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://midas.example.test" },
    body: JSON.stringify({ email: "user@example.test", password: "test-only-password", mode }),
  });
  globalThis.__authRouteMock = () => { throw new AuthConfigurationError("AUTH_SECRET_MISSING", "Missing cookie secret"); };
  const missing = await POST(request("signup"));
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, "AUTH_SECRET_MISSING");
  globalThis.__authRouteMock = () => ({
    signUp: { email: async () => ({ data: {}, error: null }) },
    sendVerificationEmail: async () => { throw new Error("upstream error"); },
  });
  const created = await POST(request("signup"));
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.equal(body.success, true);
  assert.equal(body.needsVerification, true);
  assert.match(body.message, /^Cuenta creada/);
});

test("resend verification does not falsely report success on provider failure", async t => {
  const oldLog = console.error;
  console.error = () => {};
  t.after(() => { console.error = oldLog; delete globalThis.__authRouteMock; });
  globalThis.__authRouteMock = () => ({ sendVerificationEmail: async () => ({ error: { status: 502 } }) });
  const { POST } = await import("../app/api/auth/verify/route.ts");
  const result = await POST(new Request("https://midas.example.test/api/auth/verify", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "user@example.test" }),
  }));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).code, "AUTH_PROVIDER_UNAVAILABLE");
});
