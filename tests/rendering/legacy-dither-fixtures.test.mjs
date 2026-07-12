import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { generateRenderFixtureCandidate } from "../helpers/run-legacy-render-fixtures.mjs";

const approvedFixtureUrl = new URL(
  "../fixtures/rendering/approved-fixtures.json",
  import.meta.url,
);

async function readApprovedFixtures() {
  return JSON.parse(await readFile(approvedFixtureUrl, "utf-8"));
}

describe("protected legacy dither fixtures", () => {
  it("is deterministic across fresh registry contexts", async () => {
    const first = await generateRenderFixtureCandidate();
    const second = await generateRenderFixtureCandidate();
    const third = await generateRenderFixtureCandidate();

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.fixtures).toHaveLength(4);

    for (const fixture of first.fixtures) {
      expect(fixture.output.length).toBe(
        fixture.source.width * fixture.source.height,
      );
      expect(fixture.output.uniqueCount).toBeGreaterThan(1);
      expect(fixture.output.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("matches the explicitly approved fixture ledger", async () => {
    const candidate = await generateRenderFixtureCandidate();
    const approved = await readApprovedFixtures();

    expect(candidate).toEqual(approved);
  });
});
