import assert from "node:assert/strict";
import test from "node:test";

import { loadLegacyDitherRegistry } from "../helpers/load-legacy-dither.mjs";


test("the legacy dither registry loads from the unmodified classic script", async () => {
  const registry = await loadLegacyDitherRegistry();

  assert.equal(Array.isArray(registry.algorithms), true);
  assert.ok(
    registry.algorithms.length >= 100,
    `expected a substantial algorithm catalog, received ${registry.algorithms.length}`,
  );
  assert.match(registry.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(registry.findAlgorithm("not-a-real-algorithm"), undefined);
});

test("legacy algorithm identity and parameter metadata are internally consistent", async () => {
  const first = await loadLegacyDitherRegistry();
  const second = await loadLegacyDitherRegistry();

  const firstIds = first.algorithms.map((algorithm) => algorithm.id);
  const secondIds = second.algorithms.map((algorithm) => algorithm.id);

  assert.deepEqual(firstIds, secondIds);
  assert.equal(first.sourceSha256, second.sourceSha256);
  assert.equal(new Set(firstIds).size, firstIds.length, "algorithm IDs must be unique");

  for (const algorithm of first.algorithms) {
    assert.equal(typeof algorithm.id, "string");
    assert.notEqual(algorithm.id.trim(), "");
    assert.equal(typeof algorithm.name, "string", `missing name for ${algorithm.id}`);
    assert.notEqual(algorithm.name.trim(), "");
    assert.equal(typeof algorithm.category, "string", `missing category for ${algorithm.id}`);
    assert.notEqual(algorithm.category.trim(), "");
    assert.equal(typeof algorithm.apply, "function", `missing apply for ${algorithm.id}`);
    assert.equal(Array.isArray(algorithm.params), true, `missing params for ${algorithm.id}`);

    const parameterIds = algorithm.params.map((parameter) => parameter.id);
    assert.equal(
      new Set(parameterIds).size,
      parameterIds.length,
      `duplicate parameter ID in ${algorithm.id}`,
    );

    for (const parameter of algorithm.params) {
      assert.equal(typeof parameter.id, "string", `invalid parameter ID in ${algorithm.id}`);
      assert.notEqual(parameter.id.trim(), "");
      structuredClone(parameter.default);
    }
  }
});
