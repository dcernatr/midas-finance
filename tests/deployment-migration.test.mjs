import assert from "node:assert/strict";
import test from "node:test";
import { deploymentConfig, prepareDeployment } from "../scripts/prepare-appwrite-deployment.mjs";

const env = {
  APPWRITE_SITE_ID: "6a94fe3e001e18fb98ba",
  APPWRITE_SITE_PROJECT_ID: "6a94f1000028038e283d",
  NEXT_PUBLIC_APPWRITE_PROJECT_ID: "6a94f1000028038e283d",
  NEXT_PUBLIC_APPWRITE_ENDPOINT: "https://nyc.cloud.appwrite.io/v1",
  APPWRITE_DATABASE_ID: "midas",
  APPWRITE_API_KEY: "synthetic-test-value",
};

test("local builds never run a live migration", async () => {
  assert.equal(await prepareDeployment({}, () => { throw new Error("Must not run"); }), false);
});

test("deployment guard only accepts the linked MIDAS project, site and database", () => {
  assert.equal(deploymentConfig(env).project, env.NEXT_PUBLIC_APPWRITE_PROJECT_ID);
  for (const key of ["APPWRITE_SITE_ID", "APPWRITE_SITE_PROJECT_ID", "NEXT_PUBLIC_APPWRITE_PROJECT_ID", "NEXT_PUBLIC_APPWRITE_ENDPOINT", "APPWRITE_DATABASE_ID"]) {
    assert.throws(() => deploymentConfig({ ...env, [key]: "other-project" }), /no coincide/);
  }
  assert.throws(() => deploymentConfig({ ...env, APPWRITE_API_KEY: "" }), /credencial/);
});

test("a migration failure prevents publication and is never treated as success", async () => {
  let called = false;
  assert.equal(await prepareDeployment(env, async config => { called = true; assert.equal(config.key, env.APPWRITE_API_KEY); }), true);
  assert.equal(called, true);
  await assert.rejects(prepareDeployment(env, async () => { throw Object.assign(new Error("Forbidden"), { code: 403 }); }), error => error.code === 403);
});
