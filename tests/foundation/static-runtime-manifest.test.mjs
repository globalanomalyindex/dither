import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

import {
  STATIC_RUNTIME_FILES,
  validateStaticRuntimeManifest,
} from "../../scripts/static-runtime-manifest.mjs";

const REQUIRED_RUNTIME_ENTRIES = [
  "index.html",
  "style.css",
  "dither.js",
  "engine.js",
  "grain.js",
  "paintstroke.js",
  "app.js",
  "fonts",
];

test("the static runtime manifest preserves every current product entry", () => {
  assert.deepEqual(STATIC_RUNTIME_FILES, REQUIRED_RUNTIME_ENTRIES);
});

test("the static runtime manifest resolves to repository-owned files", async () => {
  const resolvedEntries = await validateStaticRuntimeManifest(process.cwd());

  assert.equal(resolvedEntries.length, REQUIRED_RUNTIME_ENTRIES.length);
  assert.equal(resolvedEntries.some((entry) => entry.includes("/Users/")), false);

  for (const entry of resolvedEntries) {
    const entryStat = await stat(entry);
    assert.equal(entryStat.isFile() || entryStat.isDirectory(), true);
  }
});
