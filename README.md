# DITHER

DITHER is a local-first browser workshop for transforming images through dithering, grain, and direct pixel painting.

**Live product:** https://globalanomalyindex.github.io/dither/

## Product

DITHER combines three creative capabilities inside one browser application:

- **Dither:** ordered, error-diffusion, halftone, image-aware, sketch, and painterly transformations
- **Grain:** film, digital, procedural, texture, and compositing controls
- **Paint:** brush-based displacement and sampling tools, including pressure, tilt, twist, velocity, wet-paint behavior, and pixel pickup

Additional controls cover color modes, palette extraction, tone protection, undo and redo, checkpoints through Bake, canvas navigation, and PNG export.

## Runtime and privacy

The shipped product is static HTML, CSS, and JavaScript. Image processing happens in the browser. No server receives the selected image.

The entry experience is protected by a browser request-capture test and makes no third-party runtime requests. Broader workflow privacy remains part of the ongoing production audit, so the repository does not make a blanket privacy claim beyond the evidence currently recorded.

Node is used only for development, verification, and build tooling. The generated `dist` directory remains a static site.

## Run locally

### Verified development path

Requirements:

- Node.js 22.12 or newer
- npm 10.9 or newer

```bash
npm ci
npm run dev
```

Open the URL printed by Vite. The default route is:

```text
http://127.0.0.1:5173/dither/
```

### Minimal static path

Python is optional. The repository also includes a portable static server with no package installation:

```bash
python3 serve.py
```

The server resolves the repository from its own file location and binds to `127.0.0.1:8080` by default.

Useful options:

```bash
python3 serve.py 9000
python3 serve.py --host 0.0.0.0 --root /path/to/dither
```

## Build

```bash
npm run build
```

The build copies the current static runtime into `dist` and creates `dist/build-manifest.json`. The manifest records each output file, byte count, and SHA-256 digest. CI rebuilds the product twice and compares the manifests to detect nondeterministic output.

## Verification

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run build
npm run test:e2e
```

The pull-request workflow verifies:

- portable local setup
- package-lock drift
- strict TypeScript boundaries
- lint and formatting for the modernized surface
- unit and foundation contracts
- complete static output
- deterministic build integrity
- Chromium entry behavior
- third-party runtime requests

## Current architecture

| Path | Responsibility |
|---|---|
| `index.html` | application shell, interface markup, and current inline interaction systems |
| `style.css` | tokens, layout, controls, responsive rules, and motion |
| `app.js` | application state, UI wiring, history, and render orchestration |
| `dither.js` | dithering and painterly algorithm library |
| `engine.js` | source-image handling and processing pipeline |
| `grain.js` | grain and procedural-noise engine |
| `paintstroke.js` | paint engine, brushes, and pointer or stylus behavior |
| `scripts/` | deterministic build and runtime-manifest tooling |
| `src/` | selective TypeScript boundaries introduced during modernization |
| `tests/` | foundation, unit, and browser verification |
| `docs/` | audit evidence, decisions, risks, claims, provenance, and release gates |

The current creative engines remain classic browser scripts. They will not be rewritten until representative outputs are protected by deterministic fixtures and invariants.

## Production audit

DITHER is being audited and polished through eight isolated plans. Product-model and interface changes start only after the verification foundation is reviewed.

Start here:

- [`docs/audits/AUDIT_CHARTER.md`](docs/audits/AUDIT_CHARTER.md)
- [`docs/audits/BASELINE_INVENTORY.md`](docs/audits/BASELINE_INVENTORY.md)
- [`docs/audits/FINDINGS_LEDGER.md`](docs/audits/FINDINGS_LEDGER.md)
- [`docs/audits/VERIFICATION_MATRIX.md`](docs/audits/VERIFICATION_MATRIX.md)
- [`docs/decisions/DECISION_LOG.md`](docs/decisions/DECISION_LOG.md)
- [`docs/evidence/CLAIMS_LEDGER.md`](docs/evidence/CLAIMS_LEDGER.md)
- [`docs/evidence/ASSET_PROVENANCE.md`](docs/evidence/ASSET_PROVENANCE.md)
- [`docs/releases/RELEASE_READINESS.md`](docs/releases/RELEASE_READINESS.md)
- [`docs/superpowers/plans/2026-07-12-dither-program-roadmap.md`](docs/superpowers/plans/2026-07-12-dither-program-roadmap.md)

## Current limitations

- The workshop is desktop-first. Supported narrow and high-zoom behavior has not yet completed its formal audit.
- Representative algorithm output fixtures are planned for the next architecture phase.
- Keyboard, screen-reader, reduced-motion, contrast, browser, performance, and large-image coverage are not yet complete.
- The repository is not yet described as production-ready.
- No license has been selected. Until a license file is added, do not assume permission to copy, modify, or redistribute the source or bundled assets.
