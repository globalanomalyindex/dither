export const RENDER_FIXTURE_SELECTIONS = Object.freeze([
  Object.freeze({
    fixtureId: "classic-floyd-gradient",
    algorithmId: "floyd-steinberg",
    family: "classic-error-diffusion",
    sourceId: "gradient-16",
    parameterOverrides: Object.freeze({ seed: 101 }),
    rationale:
      "Protects serpentine error propagation and binary threshold behavior on a smooth tonal field.",
  }),
  Object.freeze({
    fixtureId: "ordered-bayer-edges",
    algorithmId: "bayer-4",
    family: "ordered-threshold",
    sourceId: "checker-edge-16",
    parameterOverrides: Object.freeze({}),
    rationale:
      "Protects repeating threshold structure across flat fields, diagonals, and hard edges.",
  }),
  Object.freeze({
    fixtureId: "halftone-dot-gradient",
    algorithmId: "halftone-dot",
    family: "halftone-screen",
    sourceId: "gradient-16",
    parameterOverrides: Object.freeze({}),
    rationale:
      "Protects cell-based dot screening and tonal coverage across a controlled gradient.",
  }),
  Object.freeze({
    fixtureId: "blue-noise-detail",
    algorithmId: "blue-noise",
    family: "seeded-noise",
    sourceId: "detail-field-24",
    parameterOverrides: Object.freeze({ seed: 202 }),
    rationale:
      "Protects seeded stochastic placement over mixed-frequency detail without browser source dependencies.",
  }),
]);
