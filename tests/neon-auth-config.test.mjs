import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// Node's test runner needs extensions for Next's subpaths. Keep the real Neon
// SDK so its runtime configuration validation is exercised (without requests).
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "next/headers" || specifier === "next/server")
    return next(specifier + ".js", context);
  if (context.parentURL?.endsWith(".ts") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier))
    return next(specifier + ".ts", context);
  return next(specifier, context);
} });

test("MIDAS initializes the real Neon SDK with valid cookie settings", async t => {
  const previousUrl = process.env.NEON_AUTH_BASE_URL;
  const previousSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.NEON_AUTH_COOKIE_SECRET;
    else process.env.NEON_AUTH_COOKIE_SECRET = previousSecret;
  });
  process.env.NEON_AUTH_BASE_URL = "https://auth.example.test/auth";
  process.env.NEON_AUTH_COOKIE_SECRET = "test-only-cookie-secret-not-for-production-123456";
  const { getAuth } = await import("../lib/neon-auth.ts");
  const auth = getAuth();
  assert.equal(typeof auth.signUp.email, "function");
  assert.equal(typeof auth.signIn.email, "function");
  assert.equal(typeof auth.getSession, "function");
  assert.equal(getAuth(), auth);
});
