import { describe, expect, it } from "vitest";

import {
  createRenderFixtureRecord,
  resolveAlgorithmParameters,
  summarizeByteOutput,
} from "../helpers/render-fixture-utils.mjs";

const SEEDED_ALGORITHM = {
  id: "seeded-test",
  params: [
    { id: "strength", default: 1 },
    { id: "nested", default: { mode: "soft", values: [1, 2] } },
    { id: "seed", default: 42 },
  ],
};

describe("render fixture parameter resolution", () => {
  it("deep-clones defaults and applies explicit overrides", () => {
    const resolved = resolveAlgorithmParameters(SEEDED_ALGORITHM, {
      strength: 0.75,
      seed: 7,
    });

    expect(resolved).toEqual({
      strength: 0.75,
      nested: { mode: "soft", values: [1, 2] },
      seed: 7,
    });

    resolved.nested.values.push(3);
    expect(SEEDED_ALGORITHM.params[1].default.values).toEqual([1, 2]);
  });

  it("requires an explicit seed for seeded fixture algorithms", () => {
    expect(() =>
      resolveAlgorithmParameters(SEEDED_ALGORITHM, { strength: 0.5 }),
    ).toThrow(/explicit seed/i);
  });

  it("rejects override keys not declared by the catalog", () => {
    expect(() =>
      resolveAlgorithmParameters(SEEDED_ALGORITHM, {
        seed: 7,
        unknown: true,
      }),
    ).toThrow(/unknown parameter/i);
  });
});

describe("render fixture output summaries", () => {
  it("records byte invariants and a stable digest", () => {
    expect(
      summarizeByteOutput(new Uint8ClampedArray([0, 255, 128, 128]), 2, 2),
    ).toEqual({
      constructor: "Uint8ClampedArray",
      length: 4,
      min: 0,
      max: 255,
      uniqueCount: 3,
      sum: 511,
      weightedChecksum: 1406,
      sha256: "ffdf46afc76d0ca1b8aa50756f9f444cf62c8e605f3ebcc7c2a36b3d60a7f3ef",
    });
  });

  it("rejects output whose length does not match the declared dimensions", () => {
    expect(() =>
      summarizeByteOutput(new Uint8ClampedArray([0, 255]), 2, 2),
    ).toThrow(/output length/i);
  });

  it("builds a reviewable fixture record", () => {
    const record = createRenderFixtureRecord({
      algorithmId: "classic-test",
      source: {
        id: "tiny",
        width: 2,
        height: 2,
        pixels: new Float32Array([0, 64, 128, 255]),
      },
      parameters: { threshold: 128 },
      output: new Uint8ClampedArray([0, 0, 255, 255]),
    });

    expect(record.algorithmId).toBe("classic-test");
    expect(record.source).toEqual({ id: "tiny", width: 2, height: 2 });
    expect(record.parameters).toEqual({ threshold: 128 });
    expect(record.output.length).toBe(4);
    expect(record.output.uniqueCount).toBe(2);
  });
});
