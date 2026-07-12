# DITHER Claims Ledger

This ledger separates verified claims from goals and hypotheses. A reviewer-facing statement must point to evidence here or be labeled as an intention.

| ID | Claim | Classification | Evidence | Allowed wording | Status |
|---|---|---|---|---|---|
| CLM-001 | DITHER processes images in the browser. | Verified baseline | Source architecture and browser runtime | "DITHER processes images in the browser." | Verified |
| CLM-002 | Normal product use is private and local-only. | Not yet verified | Browser request test is currently expected to expose remote font traffic | Do not use until third-party runtime requests are removed and full flows are checked. | Blocked |
| CLM-003 | The product has no runtime dependencies. | Contradicted baseline | Google Fonts links in baseline `index.html` | Replace with a narrower accurate claim until resolved. | Blocked |
| CLM-004 | The repository has a reproducible development environment. | In verification | Exact package versions, generated lockfile, CI | "The development toolchain is pinned and checked in CI" only after green run. | In progress |
| CLM-005 | The static build is deterministic. | In verification | Runtime manifest and SHA-256 build manifest | "The build records deterministic file integrity" after repeated build comparison. | In progress |
| CLM-006 | Algorithm output is protected against regression. | Goal | No baseline fixture suite | Describe as planned work, not current capability. | Open |
| CLM-007 | DITHER is accessible. | Unverified | Accessibility audit and automated checks are incomplete | Do not make a broad accessibility claim. Cite specific passing behaviors only. | Open |
| CLM-008 | DITHER is production-ready. | Goal | Release readiness matrix remains incomplete | Do not use until all required release gates pass and limitations are disclosed. | Open |
| CLM-009 | DITHER contains a large creative algorithm library. | Verified baseline | `dither.js`, algorithm UI, README | "DITHER includes an extensive library of dithering and painterly transformations." | Verified |
| CLM-010 | DITHER supports mouse and stylus-aware painting behavior. | Verified in source, not fully interaction-tested | `paintstroke.js` pressure, tilt, twist, and velocity mappings | Describe source capability and note test coverage status. | Partially verified |
