import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SOURCE_FIXTURES,
  createCheckerEdge16,
  createDetailField24,
  createGradient16,
} from "../fixtures/rendering/sources.mjs";

function canonicalDigest(pixels) {
  const bytes = Uint8Array.from(pixels);
  return createHash("sha256").update(bytes).digest("hex");
}

const EXPECTED_FIXTURES = {
  "gradient-16": {
    width: 16,
    height: 16,
    min: 0,
    max: 255,
    uniqueCount: 204,
    sum: 32638,
    sha256: "7dc47ab8d436487922c1995eeb4484fcb194eabd5b757c426f9cc6ad435ba15c",
  },
  "checker-edge-16": {
    width: 16,
    height: 16,
    min: 32,
    max: 224,
    uniqueCount: 5,
    sum: 32768,
    sha256: "6b8cf97739bf0d74741893612fe389af3c19d90ac75a92e3f2cf12cae93bd48e",
  },
  "detail-field-24": {
    width: 24,
    height: 24,
    min: 0,
    max: 255,
    uniqueCount: 199,
    sum: 62163,
    sha256: "a2abada7eea935166ff7b8b23994ee631f6df43814a9ef1ce8ab213af1b5ff14",
  },
};

describe("rendering source fixtures", () => {
  it("exposes the required fixture catalog", () => {
    expect(Object.keys(SOURCE_FIXTURES)).toEqual([
      "gradient-16",
      "checker-edge-16",
      "detail-field-24",
    ]);
  });

  it.each([
    ["gradient-16", createGradient16],
    ["checker-edge-16", createCheckerEdge16],
    ["detail-field-24", createDetailField24],
  ])("creates deterministic fresh %s pixels", (fixtureId, factory) => {
    const first = factory();
    const second = factory();
    const expected = EXPECTED_FIXTURES[fixtureId];

    expect(first.id).toBe(fixtureId);
    expect(first.width).toBe(expected.width);
    expect(first.height).toBe(expected.height);
    expect(first.pixels).toBeInstanceOf(Float32Array);
    expect(first.pixels).not.toBe(second.pixels);
    expect(Array.from(first.pixels)).toEqual(Array.from(second.pixels));
    expect(first.pixels).toHaveLength(first.width * first.height);

    const values = Array.from(first.pixels);
    expect(values.every((value) => Number.isFinite(value))).toBe(true);
    expect(values.every((value) => value >= 0 && value <= 255)).toBe(true);
    expect(Math.min(...values)).toBe(expected.min);
    expect(Math.max(...values)).toBe(expected.max);
    expect(new Set(values).size).toBe(expected.uniqueCount);
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(expected.sum);
    expect(canonicalDigest(first.pixels)).toBe(expected.sha256);
  });
});
