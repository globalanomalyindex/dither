---
title: "DITHER Master Product, Design, Engineering, and Case Study Specification"
version: "1.0-approved-design"
status: "Approved direction, pending implementation planning and execution"
owner: "Christopher Robin Fiore"
prepared: "2026-07-12"
repository: "globalanomalyindex/dither"
live_product: "https://globalanomalyindex.github.io/dither/"
baseline_commit: "faf52b24391cadd7b39a657918c80558df9979eb"
primary_design_constitution: "Exposed Logic, Foundation v0.1"
supporting_design_constitution: "SIGNAL//BODY v2"
accessibility_baseline: "WCAG 2.2 AA"
runtime_model: "Static, client-side, local-first"
architecture_direction: "Zero-dependency runtime with a professional development toolchain and selective TypeScript modernization"
---

# DITHER

## Master product, design, engineering, audit, release, and case study specification

> **Binding instruction for an implementing AI or human team**
>
> Treat this document as the authoritative source for the DITHER audit, redesign, selective modernization, verification, release, and case study. Inspect the current repository and deployed application before changing code. Preserve strong existing behavior. Do not invent research, metrics, validation, collaborators, product capability, performance gains, or accessibility conformance. Every public claim must be supported by working code, a test, a measurement, a recorded inspection, or clearly labeled expert judgment.

# 0. Operating rules

## 0.1 Authority

When sources disagree, use this order:

1. Current runnable behavior and passing tests
2. Verified repository source
3. This approved specification
4. Current deployed product copy
5. Historical commits and earlier documentation
6. Assumptions

A lower source may not override a higher source to preserve a preferred narrative.

## 0.2 Normative language

- **MUST** and **MUST NOT** are release blocking.
- **SHOULD** and **SHOULD NOT** are the expected default. Deviations require a written rationale.
- **MAY** is optional and still subject to every release gate.

## 0.3 Missing information

The implementation must not invent facts. Remove unsupported claims, label expert judgment precisely, measure performance before describing improvement, use owned or properly licensed sample assets, and provide fallbacks for unsupported browser features. When a conflict remains, choose the more truthful, legible, accessible, reversible, performant, and lower-risk option, then record it.

## 0.4 Writing standard

All product, repository, and case study writing must be direct, specific, active, and grounded in visible decisions. Prohibited writing includes em-dash characters, generic AI introductions, fake quotations, invented user reactions, vague claims such as “seamless experience,” inflated adjectives, unsupported accessibility or performance claims, and template-style design-process prose.

# 1. Product thesis and audience

> **DITHER is a serious local-first image transformation workshop that lets visual designers reach intentional results quickly, then exposes the real processing structure when they need deeper control.**

DITHER uses a progressive expert model.

The first-use audience is a visual designer who wants to import an image, reach a deliberate result quickly, understand the highest-impact controls, compare source and output, and export with confidence.

The expert audience is an experimental artist, creative coder, or advanced designer who wants to chain supported operations, inspect algorithms and parameters, route tone and edge behavior, layer grain, paint with sampled pixels, and understand the relationship between source, live stages, checkpoints, and export.

The application must work as a real creative tool. Portfolio value must come from the quality of the workflow, architecture, verification, and documentation rather than a staged demo.

# 2. Approved product decisions

The following decisions are locked unless a new decision record is approved:

- Static, client-side, local-first runtime
- Professional development toolchain
- Selective TypeScript and module modernization
- No framework migration without evidence
- Recognizable Dither, Grain, and Paint workspaces
- One shared document, viewport, history, checkpoint, and export model
- Progressive expert disclosure
- Standard shell, Quiet controls, Exhibition canvas
- Dual entry through import and one curated editable sample
- Expandable stage stack
- Checkpointed Bake
- Selection-driven inspector
- Source, checkpoint, and current comparison
- Production-check export workflow
- Intentionally scoped mobile support rather than false parity
- Evidence-led reviewer case study

# 3. Design-language authority

Use this order:

1. Exposed Logic, Foundation v0.1
2. DITHER’s real mechanics and user needs
3. SIGNAL//BODY v2
4. Current DITHER identity
5. Novelty

Treat DITHER as a workshop. Its authentic exposed logic is the source image, working source, live processing stages, render state, history, checkpoints, Bake boundary, brush pickup, comparison references, and export state.

The interface must not pretend to be a technical instrument through decorative telemetry. Remove or reject fake HUD framing, ornamental microtype, decorative scanlines, fake coordinates, meaningless glitch, random glyphs, barcodes, tactical marks, and pseudo-terminal copy.

Use the workshop split:

- **Standard shell:** navigation, document identity, commands, history, comparison, Bake, export
- **Quiet controls:** repeated parameters, inspector content, advanced disclosure
- **Exhibition canvas:** source imagery, transformed material, grain, brush behavior, comparison, and major transitions

Use one earned rupture at most. The preferred candidates are source-to-current transformation or checkpointed Bake because both represent real product boundaries.

# 4. Document and state model

Each project contains:

```text
Document
  identity
  originalSource
  workingSource
  stageStack
    ditherStage
    grainStage
    paintStage
  liveResult
  history
  checkpoints
  viewport
  exportSettings
  sessionMetadata
  storageState
```

The original source is immutable. The working source feeds live stages and may change through Bake. The live result is the most recent valid output. Checkpoints preserve durable milestones. History stores recent reversible actions. Viewport stores zoom, pan, fit, and comparison state.

Separate state into explicit domains:

- document and source
- processing stages and operations
- render scheduling and cancellation
- history
- checkpoints
- viewport and comparison
- Paint session
- export
- persistence
- transient interface state

Transient interface state must not become a second source of truth for document behavior.

Explicit transitions are required for import, sample open, source replacement, stage bypass, operation changes, reordering, processing, cancellation, failure, Paint strokes, pickup selection, undo, redo, Bake, checkpoint restore, comparison, export, and session migration.

# 5. Primary workflow and workspace

A first-time user must be able to:

1. Import an image or open the sample.
2. Choose an outcome-oriented preset or starting result.
3. Adjust a small set of high-value controls.
4. Inspect or expand a stage when deeper control is needed.
5. Add Grain or Paint without losing earlier work.
6. Compare source, checkpoint, and current result.
7. Bake when a new material base is useful.
8. Export with clear output information.

The desktop workspace uses four stable regions:

- **Command bar:** document identity, import, undo, redo, compare, Bake, export, essential status
- **Mode switcher:** Dither, Grain, Paint, each with real state indicators
- **Canvas field:** current result, source comparison, zoom, pan, transparency, contextual guidance, processing feedback
- **Inspector and stage stack:** selection-driven controls plus document structure

Switching modes must not unexpectedly reposition or rescale the canvas.

# 6. Progressive disclosure and inspector

Organize controls by creative intent first and implementation second.

Use three levels:

1. **Outcome controls:** style, intensity, scale, color behavior, texture character, variation
2. **Stage operations:** algorithms, grain layers, Paint tools, bypass, supported ordering
3. **Technical parameters:** threshold, seed, routing, edge response, blend behavior, brush dynamics, wet material behavior

A first-time user must not need technical parameters to create a deliberate result.

Use consequence-based groups such as Pattern and scale, Tone and color, Edge response, Surface variation, Composition rules, Brush dynamics, Wet material behavior, Input and pressure, and Output and resolution.

The inspector follows selection. Selecting a stage shows stage controls. Selecting an operation shows operation controls. Selecting a checkpoint shows compare and restore actions. Selecting a Paint tool shows only relevant tool settings.

# 7. Presets and first use

The entry screen must offer:

- a primary import or drop action
- one curated sample project labeled clearly as an example

The sample must use the real document model, real processing stack, real history, and real export path. It must remain fully editable. Importing a file must replace the sample cleanly.

Presets must be outcome-oriented and show a name, preview, affected stages, and whether application merges or replaces settings. Applying a preset must create a history entry and must not silently destroy custom work.

# 8. Expandable stage stack

The default stack shows Dither, Grain, and Paint summaries.

Each summary communicates:

- enabled or bypassed state
- operation or layer count
- changed-from-checkpoint state
- processing state
- warning or failure state

Expansion reveals real operations, order, local bypasses, parameters, and supported reordering. The interface must not imply arbitrary composability when the engine cannot preserve the expected result.

# 9. Unified history

Use one document-level history for parameter changes, presets, operation changes, grain layers, Paint strokes, stage visibility, source replacement, and checkpoint actions.

Group continuous interactions into meaningful actions. Slider scrubbing becomes one history item. One Paint stroke becomes one history item. One reorder gesture becomes one history item.

Use readable entries such as:

- Increased pattern scale
- Added Floyd-Steinberg
- Reordered grain layer
- Painted with sampled pixels
- Applied Newsprint preset
- Baked checkpoint
- Restored checkpoint

Undo, checkpoint restore, and source reset must remain visibly distinct.

# 10. Checkpoints and Bake

A checkpoint stores:

- rendered image state
- active stage configuration
- source relationship
- dimensions and transparency
- creation reason
- optional user name
- schema version

Bake must open a compact commitment surface before execution. It must explain which stages will be flattened, which controls will become part of the new working source, which operations remain live, whether Paint is included, the resulting dimensions and transparency, and that an automatic checkpoint will be created.

Restoring a checkpoint must create a safety checkpoint of the current state first.

Bake is a deliberate material commitment, not a routine save command.

# 11. Comparison

Support three references:

1. Original source
2. Latest or selected checkpoint
3. Current result

The default comparison may use press and hold, but a persistent accessible toggle or split view is required. Comparison must preserve zoom, pan, canvas placement, transparency display, and selected reference. It must not trigger Paint or selection accidentally.

# 12. Export

Export is a final production check, not a generic download modal.

Show:

- final dimensions
- file format
- transparency support
- scaling method
- quality when relevant
- current color behavior
- processing or unapplied state
- source of output, including live stack or checkpoint
- preview against light, dark, and transparent backgrounds

Initial formats should remain focused: PNG, JPEG, and WebP only when reliably supported. Export settings may persist in the document session but must not alter the working canvas.

# 13. Large images, processing, and recovery

DITHER must not silently downsample an image.

For unusually large images, estimate cost and offer explicit choices such as original-size processing, a working proxy with full-resolution export where supported, resize document, or cancel.

Long operations must show the active stage, cancellation, and whether the previous valid result remains visible. New parameter changes must supersede obsolete renders rather than queue behind them.

If one operation fails, preserve the last valid render, identify the failed operation, and offer specific recovery actions such as Retry, Bypass, Restore checkpoint, Reduce size, or Export last valid result.

# 14. Visual system

The shell should use a restrained dark material system with clear spatial hierarchy, fine structural rules, controlled radii, limited elevation, and strong docking relationships.

Color must communicate state and meaning. Warm signal color may indicate active transformation and commitment. Cool signal color may indicate inspection, comparison, sampling, and measurement. Warning, error, success, focus, and selection must remain distinct. Every state must remain legible without color.

Typography has three roles:

- display for rare high-impact moments
- interface for navigation, labels, guidance, and controls
- technical for dimensions, percentages, seeds, render state, and export specifications

Monospace is restricted to genuinely technical values. The custom pixel typeface may appear only in one or two earned moments.

Controls should appear assembled into a working surface rather than floating as unrelated cards.

# 15. Motion

Motion must represent causality.

Approved motion verbs include assemble, dock, resolve, open, settle, transfer, commit, reveal, and restore.

Examples:

- Stage expansion unfolds from its summary.
- Reordered operations settle into position.
- Bake transfers the current result into a checkpoint and new source state.
- Comparison reveals a reference without flashing.
- Processing resolves through the canvas.

Remove ambient loops, exaggerated springs, decorative glitch, and unnecessary entrance animation. Reduced motion must preserve the same information through static state, instant replacement, and clear labels.

# 16. Icon system

Use icons only when they improve recognition or reduce repeated text.

Icons must have simple geometric construction, consistent optical weight, distinct silhouettes at production sizes, accessible names, and labeled variants for unfamiliar actions.

Prioritize source, current result, checkpoint, Bake, bypass, compare, sample, reorder, and export. Do not use a generic sparkle as the default symbol for randomness or automation.

Custom icons should be direct SVG assets that remain editable and inspectable.

# 17. Responsive behavior

Desktop prioritizes the canvas, a compact command bar, a stable mode switcher, and a right-side inspector with stage structure.

At intermediate widths, the stage stack may collapse, the inspector may overlay or resize, and secondary commands may move into grouped overflow menus. Undo, compare, Bake, and export must remain directly accessible. The canvas must remain stable during panel transitions.

Mobile supports import, sample, presets, basic adjustments, compare, checkpoints, and export. Advanced algorithm construction, precision painting, and dense technical editing may be intentionally limited with clear messaging. Do not compress full desktop complexity into an unusable phone interface.

# 18. Accessibility

Target WCAG 2.2 AA for supported workflows.

Required support includes:

- complete keyboard navigation for document actions
- logical focus order
- visible `:focus-visible` treatment
- semantic buttons, tabs, lists, dialogs, and labels
- accessible names for icon controls
- announced processing, error, checkpoint, and export states
- minimum target sizes appropriate to mouse, pen, and touch
- alternatives to drag-only interactions
- an alternative to press-and-hold comparison
- no state conveyed only by color
- reduced motion
- 200 percent zoom
- high-contrast and forced-colors inspection where practical

Precision painting may remain pointer-oriented, but the surrounding document workflow must remain keyboard operable.

# 19. Technical modernization

Use TypeScript first at high-value boundaries:

- document schema
- stage and operation schema
- history actions and grouping
- checkpoints
- export model
- render request and result contracts
- persistence migrations
- worker messages
- error types and recovery actions

Wrap existing algorithms behind typed adapters before rewriting them.

An algorithm may be moved or rewritten only after deterministic fixtures exist, current output is characterized, profiling identifies a reason, visual equivalence is defined, and rollback is available.

A likely structure is:

```text
src/
  app/
  document/
  processing/
  history/
  checkpoints/
  viewport/
  paint/
  export/
  persistence/
  ui/
  legacy/
tests/
  unit/
  integration/
  e2e/
  visual/
  fixtures/
public/
docs/
scripts/
```

The current machine-specific path in `serve.py` must be removed. A fresh clone must run with documented commands.

The current runtime claim must be made honest. Either self-host required fonts or describe the network dependency accurately.

# 20. Performance

Measure before optimizing.

Track:

- startup and sample-open time
- first image render
- parameter-scrub response
- cancellation latency
- memory use at representative image sizes
- checkpoint storage cost
- Paint stroke latency
- export duration
- layout stability
- shipped JavaScript size

Use Web Workers or OffscreenCanvas only where profiling demonstrates a real benefit and a reliable fallback exists.

The UI must remain responsive during heavy work, obsolete renders must cancel or be ignored, and memory pressure must be communicated before failure.

# 21. Testing

## Unit tests

Cover deterministic algorithms, palettes, parameter normalization, document serialization, history grouping, checkpoint creation and restoration, export calculations, memory estimation, and persistence migrations.

## Integration tests

Cover document-to-render flow, stage selection, Bake and checkpoints, bypass behavior, source replacement, Paint plus undo, comparison plus viewport, and export settings.

## End-to-end tests

Cover sample open, preset application, operation editing, Grain addition, sampled-pixel Paint, comparison, Bake, restore, and export.

Explicitly test fragile interaction areas: pointer capture, marquee tools, Escape, modal focus, tab changes, cancellation, undo boundaries, and panel collapse.

## Visual regression

Capture deterministic states at representative widths, including entry, sample workspace, expanded Dither, dense inspector, Paint pickup, checkpoint comparison, Bake, export, loading, failure, narrow laptop, and tablet.

## Accessibility verification

Run automated checks in CI and maintain a manual matrix for keyboard, focus, screen reader, reduced motion, zoom, contrast, drag alternatives, and canvas-adjacent controls.

# 22. Audit and implementation sequence

Work through these phases in order:

1. Baseline and forensic audit
2. Product and interaction audit
3. Visual-system and accessibility audit
4. Architecture, state, and correctness audit
5. Performance and pipeline profiling
6. Target architecture and migration plan
7. Foundation implementation
8. Shared document and workspace implementation
9. Visual refinement and responsive behavior
10. Testing, hardening, and regression repair
11. Repository and portfolio presentation
12. Final release audit and deployment

Each phase must update durable anchors and end with verification evidence.

# 23. Durable project anchors

Maintain:

```text
docs/audit/AUDIT_CHARTER.md
docs/audit/BASELINE_INVENTORY.md
docs/audit/FINDINGS_LEDGER.md
docs/audit/RISK_REGISTER.md
docs/decisions/DECISION_LOG.md
docs/decisions/ADR-*.md
docs/testing/VERIFICATION_MATRIX.md
docs/testing/PERFORMANCE_BASELINE.md
docs/testing/ACCESSIBILITY_MATRIX.md
docs/release/RELEASE_READINESS.md
docs/case-study/CLAIMS_LEDGER.md
```

Each finding must include severity, evidence, product impact, recommendation, implementation status, and verification.

# 24. Repository and CI

The README must include a concise product statement, live product, screenshots or restrained demonstration, primary workflows, privacy model, architecture summary, setup, test commands, accessibility and performance commitments, known limits, roadmap boundaries, license, and documentation links.

CI must run formatting, linting, type checks, unit tests, integration tests, browser tests, automated accessibility checks, production build, bundle budgets, and selected visual regression tests.

GitHub Pages must deploy the verified production artifact rather than untested source files.

The repository must include an explicit license before being presented as complete open source work.

# 25. Reviewer-facing case study

The case study is a real product record, not a decorative recap.

Primary audience:

- product design lead
- senior product designer
- design engineer
- hiring manager

Recommended narrative:

1. What DITHER is
2. The original product strength
3. Why the system reached a limit
4. Audit method
5. Consequential findings
6. Product thesis
7. Progressive expert strategy
8. Shared document model
9. Expandable processing stack
10. Checkpointed Bake
11. Exposed Logic application
12. Accessibility and engineering modernization
13. Performance and correctness evidence
14. Before and after
15. Rejected directions and tradeoffs
16. Remaining limits
17. What Chris learned and would change next

Required evidence may include annotated before-and-after screens, workflow diagrams, state models, Bake sequence, comparison sequence, responsive layouts, accessibility matrix, architecture diagram, test evidence, performance measurements, and a short final interaction recording.

Use direct first person where authorship matters. Do not fabricate user research, collaborators, business outcomes, or metrics. Label expert review, automated checks, synthetic tests, and informal testing accurately.

The case study cannot be marked final until the product is deployed, primary workflows pass, performance claims are measured, accessibility claims are verified, before-and-after captures are comparable, unresolved issues are stated, prose passes review, and asset provenance is complete.

# 26. Claims and evidence

Every public claim must have:

- claim
- evidence type
- source
- date or revision
- scope
- limitations
- approved public wording

Claims such as local processing, recoverable Bake, keyboard accessibility, faster response, or production readiness may be stated only within the verified scope.

# 27. Risk register

High-risk areas include unified history memory, checkpoint storage, Paint determinism, worker migration, large-image memory, stage-order semantics, preserving algorithm output, source replacement recovery, browser export differences, pointer capture, modal interaction, visual scope expansion, rewriting before tests, and mobile overreach.

Each high risk requires an owner, early proof, fallback, test, release criterion, and public disclosure if unresolved.

The initial release does not require cloud accounts, collaboration, plugin marketplace, unrestricted node graph, full mobile parity, AI-generated effects, social sharing, synchronization, or format proliferation.

# 28. Release gates

A production release requires:

1. No open Critical or High correctness finding.
2. No known data-loss path.
3. Import-to-export and sample workflows pass.
4. Dither, Grain, and Paint share one verified document state.
5. Unified undo behaves consistently.
6. Checkpointed Bake passes all supported paths.
7. Comparison preserves viewport and avoids accidental Paint.
8. Keyboard, focus, reduced-motion, zoom, and drag-alternative checks pass.
9. Performance remains within measured budgets.
10. Large-image behavior is explicit and no silent downsampling occurs.
11. Setup works from a fresh clone.
12. CI passes and GitHub Pages publishes the tested artifact.
13. README and product copy match behavior.
14. License and provenance are explicit.
15. Decorative technical theater is absent.
16. Case study claims are evidence-backed.
17. Final Exposed Logic review passes Truth and Legibility.
18. Charge is appropriate to the product rather than merely impressive.

# 29. Definition of done

DITHER is complete when the audit is finished, findings are resolved or accepted, the shared document model is implemented, first use supports import and sample, progressive disclosure works, history is unified, Bake creates checkpoints, comparison is stable, export is trustworthy, accessibility is verified, performance is measured, setup is portable, CI and deployment are verified, public claims have evidence, and the reviewer case study is complete.

# 30. Execution behavior

An implementing AI or team must:

1. Read this entire file before changing code.
2. Inspect the repository and deployed product.
3. Create durable audit and decision records.
4. Work in the approved phase order.
5. Protect current behavior with tests before high-risk changes.
6. Use focused branches and reviewable commits.
7. Record deviations and update evidence.
8. Avoid silent scope reduction and speculative rewrites.
9. Verify completion with commands, tests, screenshots, and measurements.
10. Preserve Chris’s authorship and public voice.
11. Use Figma only when editable spatial comparison adds value.
12. Use generated imagery only for project-owned assets with provenance.
13. Stop at review gates when a decision changes the approved product model.

# 31. Final shorthand

> **Treat DITHER as a workshop. Keep the shell calm, let the image carry the charge, expose the real pipeline, make commitment recoverable, protect the algorithms before rewriting them, and prove every public claim.**
