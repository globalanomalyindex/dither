import { describe, expect, it } from "vitest";

import { createRegistryInventory } from "../../scripts/inspect-dither-registry.mjs";


describe("registry inventory", () => {
  it("normalizes ordered metadata and category totals", () => {
    const inventory = createRegistryInventory({
      sourceSha256: "a".repeat(64),
      algorithms: [
        {
          id: "ordered-alpha",
          name: "Ordered Alpha",
          category: "ordered",
          params: [
            { id: "scale", default: 2 },
            { id: "seed", default: 42 },
          ],
          apply() {},
        },
        {
          id: "classic-beta",
          name: "Classic Beta",
          category: "classic",
          params: [],
          apply() {},
        },
      ],
    });

    expect(inventory).toEqual({
      sourceSha256: "a".repeat(64),
      algorithmCount: 2,
      categoryCounts: {
        classic: 1,
        ordered: 1,
      },
      duplicates: {
        algorithmIds: [],
      },
      algorithms: [
        {
          id: "ordered-alpha",
          name: "Ordered Alpha",
          category: "ordered",
          parameterIds: ["scale", "seed"],
          hasSeed: true,
        },
        {
          id: "classic-beta",
          name: "Classic Beta",
          category: "classic",
          parameterIds: [],
          hasSeed: false,
        },
      ],
    });
  });

  it("reports duplicate algorithm identities without reordering the catalog", () => {
    const inventory = createRegistryInventory({
      sourceSha256: "b".repeat(64),
      algorithms: [
        { id: "same", name: "First", category: "classic", params: [] },
        { id: "same", name: "Second", category: "ordered", params: [] },
      ],
    });

    expect(inventory.duplicates.algorithmIds).toEqual(["same"]);
    expect(inventory.algorithms.map((algorithm) => algorithm.name)).toEqual([
      "First",
      "Second",
    ]);
  });
});
