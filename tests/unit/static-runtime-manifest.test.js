import { describe, expect, it } from "vitest";

import {
  STATIC_RUNTIME_FILES,
  createStaticRuntimeCopyPlan,
} from "../../scripts/static-runtime-manifest.mjs";

describe("static runtime manifest", () => {
  it("keeps source and destination paths aligned by relative entry", () => {
    const plan = createStaticRuntimeCopyPlan("/workspace/dither", "/workspace/dist");

    expect(plan).toHaveLength(STATIC_RUNTIME_FILES.length);
    expect(plan.map((entry) => entry.relativePath)).toEqual(STATIC_RUNTIME_FILES);
    expect(plan[2]).toEqual({
      destinationPath: "/workspace/dist/dither.js",
      relativePath: "dither.js",
      sourcePath: "/workspace/dither/dither.js",
    });
  });
});
