# DITHER Baseline Inventory

## Repository baseline

- Repository: `globalanomalyindex/dither`
- Default branch: `main`
- Visibility: public
- Baseline commit: `faf52b24391cadd7b39a657918c80558df9979eb`
- Baseline commit date: 2026-06-15
- Live site: `https://globalanomalyindex.github.io/dither/`
- Open issues observed at baseline: 0
- Open pull requests observed at baseline: 0
- Status checks observed at baseline: none
- Workflow runs observed at baseline: none

## Product claim

The baseline README describes a browser-based image dithering studio that is static, client-side, zero-build, and dependency-free. Its primary capabilities are dithering, grain, paint tools, palette and tone controls, and image export.

## Core source inventory

| File | Approximate lines | Primary responsibility |
|---|---:|---|
| `index.html` | 1,675 | shell, UI markup, and substantial inline interaction and motion code |
| `style.css` | 3,035 | tokens, layout, controls, responsive behavior, and motion |
| `app.js` | 5,145 | state, UI wiring, history, rendering orchestration, and tools |
| `dither.js` | 8,768 | algorithm definitions and advanced painter logic |
| `engine.js` | 1,091 | source image handling and processing pipeline |
| `grain.js` | 668 | grain and procedural noise engine |
| `paintstroke.js` | 2,121 | paint engine, brushes, pointer input, and stylus behavior |
| `serve.py` | 8 | baseline local static server |
| `README.md` | 43 | overview and local run instructions |

The source surface exceeds 22,000 lines and is concentrated in a small number of global scripts. This raises the cost of state reasoning, regression isolation, and safe review.

## Runtime structure

The baseline page loads five classic scripts in this order:

1. `dither.js`
2. `engine.js`
3. `grain.js`
4. `paintstroke.js`
5. `app.js`

The load order is an implicit dependency contract. Plan 0 records and verifies it before introducing modules.

## Current visual direction

- dark workshop foundation
- Archivo for primary typography when the remote font request succeeds
- JetBrains Mono for readouts when the remote font request succeeds
- one local custom pixel face for selected expressive moments
- orange, pink, and cyan signals for Dither, Grain, and Paint
- animated intro, reactive waiting field, and dither ripple effects
- dense collapsible sidebar with a large control and algorithm surface

## Current delivery risks

- the baseline server contains a private absolute path
- the baseline dependency claim conflicts with remote Google Fonts requests
- no committed package manifest, lockfile, CI workflow, or browser smoke suite exists
- manual query-string cache versions are repeated in `index.html`
- algorithm fidelity has no visible golden-image or invariant coverage
- no root license is present

## Plan 0 branch

Plan 0 is developed on `agent/dither-00-verification-foundation` through draft pull request 3. It must not include product-model or visual redesign work.
