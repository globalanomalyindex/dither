# DITHER Claims Ledger

This ledger separates verified claims from goals and hypotheses. A reviewer-facing statement must point to evidence here or be labeled as an intention.

| ID | Claim | Classification | Evidence | Allowed wording | Status |
|---|---|---|---|---|---|
| CLM-001 | DITHER processes images in the browser. | Verified baseline | Source architecture and browser runtime | "DITHER processes images in the browser." | Verified |
| CLM-002 | Normal product use is private and local-only. | Not yet fully verified | Entry request capture passes after remote fonts were removed; upload through export has not completed full network characterization | Do not make the broad claim until primary workflows are checked. | Blocked |
| CLM-003 | The product has no runtime dependencies. | Retired wording | The baseline wording concealed remote font requests and did not distinguish bundled assets from network dependencies | Use the static-runtime and verified-request wording instead. | Retired |
| CLM-004 | The repository has a reproducible development environment. | Verified on Plan 0 branch | Exact package versions, committed lockfile, clean `npm ci`, and lock drift CI | "The development toolchain is pinned and checked in CI." | Verified |
| CLM-005 | The static build records deterministic integrity. | Verified on Plan 0 branch | Runtime manifest, per-file SHA-256 build manifest, and repeated manifest comparison | "The static build records deterministic file integrity." | Verified |
| CLM-006 | Algorithm output is protected against regression. | Goal | No baseline fixture suite | Describe as planned work, not current capability. | Open |
| CLM-007 | DITHER is accessible. | Unverified | Accessibility audit and automated checks are incomplete | Do not make a broad accessibility claim. Cite specific passing behaviors only. | Open |
| CLM-008 | DITHER is production-ready. | Goal | Release readiness matrix remains incomplete | Do not use until all required release gates pass and limitations are disclosed. | Open |
| CLM-009 | DITHER contains a large creative algorithm library. | Verified baseline | `dither.js`, algorithm UI, and README | "DITHER includes an extensive library of dithering and painterly transformations." | Verified |
| CLM-010 | DITHER supports mouse and stylus-aware painting behavior. | Verified in source, not fully interaction-tested | `paintstroke.js` pressure, tilt, twist, and velocity mappings | Describe source capability and note test coverage status. | Partially verified |
| CLM-011 | The built entry experience makes no third-party runtime requests. | Verified on Plan 0 branch | Playwright request capture against the built `dist` output | "The built entry experience makes no third-party runtime requests." | Verified |
