import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const esm = await import("./dist/index.js");
const cjs = require("./dist/index.cjs");

for (const exportedModule of [esm, cjs]) {
  assert.equal(typeof exportedModule.createShoptetClient, "function");
  assert.equal(typeof exportedModule.Result.ok, "function");
  assert.equal(typeof exportedModule.Result.isOk, "function");
}

assert.equal(esm.Result.ok(1).status, "ok");
assert.equal(cjs.Result.error(new Error("x")).status, "error");
