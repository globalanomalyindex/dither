# DITHER Release Readiness

## Status

Current program state: not release-ready.

Plan 0 establishes the evidence system. Passing Plan 0 does not imply product completion.

## Required gates

| Gate | Requirement | Evidence location | Current status |
|---|---|---|---|
| Portable setup | Clean checkout can start through documented commands | CI and README | Passing on Plan 0 branch |
| Reproducible install | `npm ci` succeeds from committed lockfile | GitHub Actions | Passing on Plan 0 branch |
| Deterministic build | `npm run build` creates complete static output and integrity manifest | `dist/build-manifest.json` in CI | Passing on Plan 0 branch |
| Runtime smoke | Built entry loads with no uncaught errors | Playwright | Passing on Plan 0 branch |
| Privacy | Normal entry and primary workflows make no undisclosed third-party requests | Playwright request capture | Entry passing; primary workflow coverage remains open |
| Entry accessibility | Entry has no critical or serious automated violations and creative-mode tabs expose correct state and keyboard behavior | Axe evidence and Playwright tab regression | Passing on Plan 0 branch |
| Core workflow | Upload through export completes across supported modes | Playwright and manual matrix | Open |
| Rendering fidelity | Representative seeded output fixtures pass | Golden-image suite | Open |
| Full accessibility | Keyboard, screen reader semantics, contrast, zoom, and reduced motion meet defined criteria throughout the loaded product | Automated and manual evidence | Open |
| Performance | Representative images meet documented latency and memory budgets | Performance artifacts | Open |
| Responsive scope | Supported viewport tiers pass and limitations are documented | Viewport suite | Open |
| Governance | License, contribution rules, asset provenance, and security posture are explicit | Root docs | Open |
| Documentation | Reviewer can run, inspect, test, and understand tradeoffs | README and docs | Plan 0 passing; program documentation continues |
| Case study | Claims are supported by real product and test evidence | Claims ledger and case study | Open |

## Release rule

No release or portfolio claim may use "production-ready" while any required gate is open, blocked, or not run. Limitations can remain only when they are intentional, documented, and outside the supported scope.
