# DITHER Plan 1 Document and Render Boundary Design

## Status

- Parent design: `2026-07-12-dither-production-audit-design.md`
- Starting commit: `50f722a87bf2995dc39f62dbb1056b16a98c8cb8`
- Parent verification run: `29207561281`
- Branch: `agent/dither-01-document-render-boundaries`
- Scope owner: Plan 1

## 1. Purpose

Plan 1 establishes the first protected architectural seams around DITHER without changing the creative output or replacing the existing browser runtime.

The plan has two responsibilities:

1. Protect representative algorithm behavior with deterministic fixtures and invariants.
2. Define typed document and render contracts that can later replace the current implicit global-state and render-cancellation conventions.

The fixture layer is the hard gate. No extraction, module conversion, or runtime integration may begin until representative legacy outputs are reproducible and recorded.

## 2. Current system boundary

The current runtime has five classic scripts loaded in order:

1. `dither.js`
2. `engine.js`
3. `grain.js`
4. `paintstroke.js`
5. `app.js`

`dither.js` defines `DitherAlgorithms` as a lexical global array. Each catalog entry exposes identity, presentation metadata, parameter definitions, and an `apply(Float32Array, width, height, params)` function. `app.js` searches this array by algorithm ID, builds parameter objects from catalog defaults, randomizes seed fields, and passes selected algorithms into the processing pipeline.

This is an implicit contract. Plan 1 makes it testable before changing it.

## 3. Design principles

### 3.1 Preserve output before improving structure

A successful refactor that silently changes pixels is a product regression. Output protection is therefore stronger than code-style preference.

### 3.2 Test through a narrow legacy adapter

Tests may load the classic script through a Node VM adapter. The adapter is test-only and must not become a second production implementation.

The adapter may:

- evaluate the current unmodified script
- expose the lexical algorithm array to tests
- normalize metadata for inspection
- execute a selected algorithm with explicit inputs and parameters

The adapter may not:

- patch algorithm logic
- replace browser APIs with behaviorally different implementations
- rewrite source text beyond appending one test-only export statement
- hide exceptions or coerce invalid outputs into passing results

### 3.3 Protect representative behavior, not every pixel path at once

The first fixture set should cover distinct algorithm families and failure modes rather than attempting to snapshot more than 180 algorithms immediately.

The initial set should include:

- one classic error-diffusion algorithm
- one ordered or pattern algorithm
- one halftone or screen algorithm
- one deterministic noise-aware algorithm with a fixed seed
- one image-aware or edge-aware algorithm that does not require a loaded browser source
- one advanced painterly algorithm only after the harness can provide its required source-analysis dependency honestly

The first four categories are required for Plan 1 exit. More complex source-dependent families can be added in later fixture waves.

### 3.4 Separate fixture hashes from human-readable invariants

A fixture record contains:

- algorithm ID
- source fixture ID
- width and height
- explicit parameters
- output constructor
- output length
- minimum and maximum value
- count of unique values
- sum and weighted checksum
- SHA-256 digest

The digest detects any change. The invariants make failures interpretable and catch malformed output even when a fixture update is being reviewed.

### 3.5 Typed contracts remain pure

Document and render code introduced in Plan 1 must be independent of the DOM, Canvas, workers, and legacy globals. It must be importable in Vitest and usable by a later worker or browser adapter without modification.

## 4. Fixture architecture

### 4.1 Test-only legacy loader

`tests/helpers/load-legacy-dither.mjs` reads `dither.js`, creates an isolated VM context, evaluates the source, and appends a single statement that exposes `DitherAlgorithms` to the context.

The loader returns a frozen catalog reference and fails when:

- the script does not evaluate
- the registry is not an array
- an algorithm has no stable ID
- IDs are duplicated
- an entry has no `apply` function
- an entry has malformed parameter definitions

### 4.2 Source fixtures

Source fixtures are generated in code so they remain small, reviewable, and platform-independent.

Required fixtures:

- `gradient-16`: horizontal and vertical luminance gradient
- `checker-edge-16`: hard transitions, flat regions, and diagonal edges
- `detail-field-24`: deterministic mixed-frequency structure

Every source fixture returns a fresh `Float32Array` and an immutable descriptor.

### 4.3 Parameter resolution

Fixture parameters are never inferred from live application state. A helper resolves catalog defaults, deep-clones structured defaults, and applies explicit fixture overrides.

Seed parameters must always be specified for fixture algorithms that expose them. No test may rely on `Math.random()`.

### 4.4 Fixture records

Approved records live in a committed JSON file under `tests/fixtures/rendering/`.

A generator may print a candidate record, but CI must never update the approved fixture file automatically. Fixture changes require a human-readable diff and an explicit commit message that states whether the change is intentional.

### 4.5 Cross-environment strategy

Plan 1 protects output in Node first because the algorithms are typed-array operations and the Node VM provides fast deterministic feedback.

A small browser parity test will execute at least one protected algorithm in Chromium and compare its digest with the Node record. This checks that the fixture harness is not protecting a Node-only interpretation.

## 5. Document model

### 5.1 Identity types

Document, stage, checkpoint, and render request identities use branded strings. Constructors validate non-empty, trimmed values and keep ID generation injectable.

Plan 1 does not choose a persistence-wide UUID strategy. It defines the contract and permits the caller to supply a generator.

### 5.2 Source descriptor

A source descriptor records metadata, not live pixels:

```ts
interface SourceImageDescriptor {
  readonly id: SourceImageId;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
  readonly hasTransparency: boolean;
  readonly revision: number;
}
```

The live source pixel buffer remains owned by the rendering adapter. This prevents document snapshots from duplicating large pixel arrays.

### 5.3 Creative stages

The initial stage union is:

```ts
type CreativeStage = DitherStage | GrainStage | PaintStage;
```

Shared fields:

- stable ID
- type
- name
- enabled state
- revision

Stage-specific payloads remain serializable:

- Dither stage stores an ordered algorithm chain and global tone or color parameters.
- Grain stage stores ordered grain layers and compositing parameters.
- Paint stage stores a paint revision reference and tool metadata, not a full canvas bitmap.

Plan 1 defines the data shape and validators. It does not migrate the live application state.

### 5.4 Document state

A document contains:

- stable ID
- source descriptor
- ordered stages
- selected stage ID
- version
- export settings

Checkpoints and history are intentionally deferred to Plan 2. Placeholder arrays or speculative fields are not added in Plan 1.

### 5.5 Validation rules

A valid document must have:

- positive source dimensions
- a non-negative source revision
- unique stage IDs
- a selected stage that exists or is null
- non-negative document and stage revisions
- serializable stage parameters
- supported export dimensions and format

Validation returns structured issues rather than throwing on user-originated data. Constructors may throw only for programmer contract violations.

## 6. Render contract

### 6.1 Render request

A render request contains:

- request ID
- document ID
- document version
- source revision
- ordered renderable stages
- output size
- priority: `interactive` or `final`

The request is a serializable snapshot. It contains no DOM node, Canvas context, ImageBitmap, callback, or mutable application reference.

### 6.2 Render result

A render result contains:

- matching request ID
- document ID
- document version
- output width and height
- pixel payload reference or typed array
- duration in milliseconds
- warnings

The first pure contract uses `Uint8ClampedArray` for tests. A later worker adapter may transfer its buffer without changing the semantic contract.

### 6.3 Stale result rejection

A result is current only when all required identity fields match the active request and active document version. Request ID match alone is insufficient because a document may be replaced or restored.

The decision function returns an explicit result:

```ts
type RenderAcceptance =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: RenderRejectionReason };
```

Required rejection reasons:

- request ID mismatch
- document ID mismatch
- document version mismatch
- invalid output dimensions
- invalid pixel length

### 6.4 Cancellation

Plan 1 defines cancellation identity but does not move work into a worker. The existing runtime token remains untouched. The new contract must support a later adapter that marks requests superseded and ignores stale results.

## 7. Error and warning model

Render warnings are structured and non-fatal. Initial codes:

- `output-downscaled`
- `alpha-flattened`
- `stage-skipped`
- `unsupported-stage-parameter`

Validation issues and render warnings must include a stable code and readable message. They may include stage or field context.

Unexpected algorithm exceptions remain failures. They are not converted into warnings.

## 8. Test strategy

### 8.1 Registry contracts

- registry evaluates in isolation
- IDs are unique
- entries have stable names, categories, parameters, and apply functions
- parameter IDs are unique within each entry
- defaults are cloneable and serializable

### 8.2 Fixture contracts

- source fixtures are deterministic and fresh per call
- selected algorithms are deterministic with fixed parameters
- outputs have correct constructor and length
- values are finite bytes
- output hashes match approved records
- one Chromium result matches the Node record

### 8.3 Document contracts

- valid construction
- unique stage IDs
- selected-stage validation
- immutable snapshots
- serializable output
- invalid dimensions and revisions produce issues

### 8.4 Render contracts

- stable request creation
- input snapshots are not aliased
- acceptance of exact current result
- each stale-result rejection reason
- invalid pixel length rejection
- warning structure validation

## 9. CI and evidence

Plan 1 adds separate evidence so rendering fixtures do not disappear inside the generic unit job.

Required gates:

- legacy registry contract
- protected rendering fixtures
- typed document and render unit tests
- browser parity fixture
- existing Plan 0 gates

Fixture candidate generation may run as an explicit local or manual command, never as an automatic write action in CI.

## 10. Migration boundary

Plan 1 may expose a read-only typed adapter around legacy catalog metadata after fixture protection is green. It may not route live rendering through the new request contract until the adapter has its own characterization test.

The recommended Plan 1 end state is:

- legacy runtime still serves users
- representative outputs are protected
- typed document and render contracts are complete and tested
- a read-only catalog adapter exists
- no intentional visual or output change occurred
- Plan 2 can build history and checkpoints on stable document identities

## 11. Risks

### Fixture brittleness

Hash-only fixtures can be hard to interpret. Mitigation: record readable invariants and source descriptors beside the hash.

### False determinism

An algorithm may call uncontrolled randomness even when it exposes a seed. Mitigation: run each fixture multiple times in one process and across fresh VM contexts.

### Harness divergence

The Node VM may not match the browser. Mitigation: browser parity test for protected output and no source patching beyond test export.

### Premature type hierarchy

A large domain model can encode assumptions that Plan 2 later rejects. Mitigation: model only identities, stages, source metadata, export settings, requests, results, validation, and stale-result behavior required by the approved design.

### Accidental runtime coupling

Typed modules may import browser globals or legacy scripts. Mitigation: strict pure-module tests and no DOM libraries in the document or render folders.

## 12. Exit criteria

Plan 1 is review-ready only when:

- the unmodified legacy registry loads through the test adapter
- registry integrity tests pass
- at least four distinct deterministic algorithm families have approved fixture records
- repeated fresh-context runs produce identical records
- at least one protected output matches in Node and Chromium
- document, stage, source, export, render request, result, warning, and rejection contracts are typed and tested
- invalid documents return structured issues
- stale render results are rejected with explicit reasons
- no creative engine file changed without a fixture-backed reason
- no live runtime route uses the new model without a characterization test
- all Plan 0 gates remain green
- findings, decisions, claims, and verification records are reconciled
