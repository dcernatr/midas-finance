import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("password visibility is opt-in, controlled, and linked to the password field", async () => {
  const page = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\[showPassword, setShowPassword\] = useState\(false\)/);
  assert.match(page, /id="midas-password" type=\{showPassword \? "text" : "password"\}/);
  assert.match(page, /type="checkbox" checked=\{showPassword\} onChange=\{event => setShowPassword\(event\.target\.checked\)\} aria-controls="midas-password"/);
  assert.match(page, /Mostrar contraseña/);
  assert.match(page, /htmlFor="midas-email"/);
  assert.match(page, /htmlFor="midas-password"/);
});

test("login field spacing and autofill styling do not apply full-width styles to the checkbox", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.login-card \.login-field > div \{[^}]*gap: 12px/);
  assert.match(css, /\.login-card \.login-field input \{[^}]*min-width: 0;[^}]*padding: 10px 8px/);
  assert.match(css, /input:-webkit-autofill \{[^}]*-webkit-text-fill-color: var\(--text\)/);
  assert.match(css, /input:-webkit-autofill \{[^}]*-webkit-box-shadow: 0 0 0 1000px var\(--panel-solid\) inset/);
  assert.match(css, /\.login-password-toggle input \{[^}]*width: 16px; height: 16px/);
  assert.doesNotMatch(css, /\.login-card input \{/);
});
