import { RENDER_FIXTURE_SELECTIONS } from "../fixtures/rendering/selections.mjs";
import { SOURCE_FIXTURES } from "../fixtures/rendering/sources.mjs";
import { loadLegacyDitherRegistry } from "./load-legacy-dither.mjs";
import {
  createRenderFixtureRecord,
  resolveAlgorithmParameters,
} from "./render-fixture-utils.mjs";

export function renderFixtureSelection(selection, registry) {
  const algorithm = registry.findAlgorithm(selection.algorithmId);
  if (!algorithm) {
    throw new Error(`Unknown fixture algorithm: ${selection.algorithmId}`);
  }

  const sourceFactory = SOURCE_FIXTURES[selection.sourceId];
  if (!sourceFactory) {
    throw new Error(`Unknown source fixture: ${selection.sourceId}`);
  }

  const source = sourceFactory();
  const parameters = resolveAlgorithmParameters(
    algorithm,
    selection.parameterOverrides,
  );
  const output = algorithm.apply(
    new Float32Array(source.pixels),
    source.width,
    source.height,
    parameters,
  );

  return {
    fixtureId: selection.fixtureId,
    family: selection.family,
    rationale: selection.rationale,
    ...createRenderFixtureRecord({
      algorithmId: selection.algorithmId,
      source,
      parameters,
      output,
    }),
  };
}

export async function generateRenderFixtureCandidate() {
  const registry = await loadLegacyDitherRegistry();

  return {
    schemaVersion: 1,
    engineSourceSha256: registry.sourceSha256,
    fixtures: RENDER_FIXTURE_SELECTIONS.map((selection) =>
      renderFixtureSelection(selection, registry),
    ),
  };
}
