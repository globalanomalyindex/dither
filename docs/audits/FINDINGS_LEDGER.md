# DITHER Findings Ledger

## Severity scale

- P0: data loss, security failure, unusable core path, or broken release
- P1: major task failure, severe accessibility issue, or material production blocker
- P2: meaningful friction, inconsistency, performance risk, or maintainability issue
- P3: polish, clarity, or low-risk improvement

| ID | Domain | Severity | Confidence | Finding | Evidence | Acceptance criterion | Status |
|---|---|---:|---:|---|---|---|---|
| DTH-001 | Developer experience | P1 | Confirmed | `serve.py` hard-codes a private absolute path, so the documented local command cannot work from another checkout. | Baseline `serve.py`; failing portability contract | Server root resolves from the repository file, exposes a testable factory, and passes CI. | Resolved on Plan 0 branch |
| DTH-002 | Privacy and product claim | P1 | Confirmed | The README claims no dependencies, while `index.html` requests Archivo and JetBrains Mono from Google Fonts at runtime. | Baseline README; failing browser request-capture test; corrected `index.html` | Entry screen makes no third-party runtime requests and documentation states the actual dependency model. | Resolved on Plan 0 branch |
| DTH-003 | Release confidence | P1 | Confirmed | The baseline has no automated status checks. | GitHub baseline status and workflow queries | Required CI jobs run on every pull request and block release when failing. | Required jobs established; branch-protection policy remains open for Plan 7 |
| DTH-004 | Architecture | P1 | Confirmed | Core responsibilities are concentrated in large global scripts, especially `app.js` and `dither.js`. | Baseline source inventory | Stable contracts exist before extraction; later plans isolate responsibilities without unverified output changes. | Open for Plans 1 and 2 |
| DTH-005 | Accessibility and motion | P1 | Confirmed | Reduced-motion handling exists in selected inline scripts, but there is no unified motion policy across CSS and all animated systems. | `index.html` hero and intro scripts; `style.css` motion sections | One documented reduced-motion contract suppresses nonessential animation without hiding state. | Open for Plan 6 |
| DTH-006 | Accessibility and focus | P1 | High | No coherent focus-visible system is evident for the control-dense interface. | Stylesheet review and pending keyboard audit | Every interactive control has visible focus, logical order, and reliable restoration after dialogs and modes. | Open for Plan 6 |
| DTH-007 | Governance | P2 | Confirmed | The public repository has no root license. | Root content lookup | An intentional license decision is documented and a matching file is committed, or the repository clearly states all rights reserved. | Open for Plan 7 |
| DTH-008 | Interaction architecture | P1 | Confirmed | Recent fixes show pointer capture and mode teardown were distributed enough for prompt buttons and Pickup mode to become stuck. | Recent commits and baseline app structure | Mode transitions use explicit state and automated regression coverage for cancel, Escape, tool switch, and tab switch. | Open for Plans 1 through 5 |
| DTH-009 | Information architecture | P2 | High | A very large control and algorithm surface is exposed through one persistent sidebar. Search and collapsing reduce symptoms but do not define a progressive workflow. | Baseline markup and recent commits | A stage model, selection-driven inspector, and progressive expert disclosure reduce scanning cost without hiding capability. | Open for Plans 3 and 4 |
| DTH-010 | Documentation | P2 | Confirmed | The baseline README omits browser support, privacy, limits, architecture, testing, contribution path, provenance, and deployment. | Baseline README; replacement project guide and audit records | A reviewer can run, inspect, test, and evaluate the project without private context. | Plan 0 documentation resolved; deeper product documentation continues by plan |
| DTH-011 | Cache and release mechanics | P2 | Confirmed | Manual `?v=70` cache parameters are repeated across CSS and scripts. | Baseline `index.html` | Release output uses one reproducible versioning strategy with no manual multi-file bump requirement. | Open for Plan 7 |
| DTH-012 | Rendering fidelity | P1 | Confirmed | No visible deterministic output fixture suite protects the algorithm library. | Baseline repository and CI review | Seeded fixtures and invariants protect representative algorithms before deep refactors. | Open for Plans 1 and 2 |
| DTH-013 | Responsive scope | P2 | High | The desktop-first workshop exposes a broad control surface, but supported narrow-view behavior is not explicitly defined. | Baseline layout and pending viewport audit | Supported and unsupported viewport behavior is intentional, documented, and tested. | Open for Plan 6 |
| DTH-014 | Asset provenance | P2 | Confirmed | The repository does not provide one ledger for fonts, icons, samples, screenshots, and generated assets. | Baseline documentation review; committed provenance ledger | Every non-original asset has source, license, purpose, and modification status. | Ledger established; individual asset provenance remains open |
| DTH-015 | Typography | P2 | Confirmed | Removing remote fonts restores local-first behavior but makes primary and mono typography dependent on platform font availability. | Corrected `index.html`; existing CSS fallback stacks | Supported platforms maintain stable hierarchy and control fit, or properly licensed local fonts are introduced with provenance. | Open for Plan 6 |

## Finding quality gate

A finding can move to implementation only when it includes:

- reproducible behavior or static evidence
- affected user or maintainer consequence
- explicit acceptance criteria
- planned regression evidence
