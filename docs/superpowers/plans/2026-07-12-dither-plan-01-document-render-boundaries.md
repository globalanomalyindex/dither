# DITHER Plan 1 Document and Render Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development when available, otherwise superpowers:executing-plans. Use superpowers:test-driven-development for every behavior change and superpowers:systematic-debugging for every unexpected failure.

**Goal:** Protect representative legacy algorithm outputs, then define pure typed document and render contracts without changing the current creative runtime.

**Architecture:** A test-only Node VM adapter loads the unmodified classic `dither.js` registry. Deterministic source generators, explicit parameters, readable invariants, and SHA-256 records protect selected algorithm families. New TypeScript modules model source metadata, creative stages, document identity, export settings, render requests, render results, validation, and stale-result rejection. The live browser continues to use the current scripts throughout Plan 1.

**Tech Stack:** Node.js VM and crypto modules, TypeScript 6.0.3, Vitest 4.1.10, Playwright 1.61.1, Chromium, existing GitHub Actions foundation.

## Global constraints

- Do not edit algorithm implementation code before fixture protection is green.
- Do not update an approved fixture automatically in CI.
- Do not rely on `Math.random()` in a fixture.
- Do not snapshot live application state as a substitute for a source fixture.
- Do not introduce DOM, Canvas, worker, or storage dependencies into `src/document` or `src/render`.
- Do not route live rendering through the new contracts in Plan 1 unless an explicit characterization test is added first.
- Keep the shipped runtime static and client-side.
- Preserve every Plan 0 verification gate.
- No em dashes in project-authored copy.

---

## Planned file structure

### Test-only legacy fixture surface

- `tests/helpers/load-legacy-dither.mjs`
- `tests/helpers/render-fixture-utils.mjs`
- `tests/fixtures/rendering/sources.mjs`
- `tests/fixtures/rendering/approved-fixtures.json`
- `tests/foundation/legacy-dither-registry.test.mjs`
- `tests/rendering/legacy-dither-fixtures.test.mjs`
- `tests/e2e/render-parity.spec.js`
- `scripts/inspect-dither-registry.mjs`
- `scripts/generate-render-fixture-candidates.mjs`

### Typed document boundary

- `src/shared/result.ts`
- `src/document/identity.ts`
- `src/document/types.ts`
- `src/document/validation.ts`
- `src/document/create-document.ts`
- `tests/unit/document/identity.test.ts`
- `tests/unit/document/validation.test.ts`
- `tests/unit/document/create-document.test.ts`

### Typed render boundary

- `src/render/types.ts`
- `src/render/create-request.ts`
- `src/render/accept-result.ts`
- `src/render/validation.ts`
- `tests/unit/render/create-request.test.ts`
- `tests/unit/render/accept-result.test.ts`
- `tests/unit/render/validation.test.ts`

### Evidence and automation

- `.github/workflows/verify.yml`
- `package.json`
- `vitest.config.mjs`
- `docs/audits/FINDINGS_LEDGER.md`
- `docs/audits/RISK_REGISTER.md`
- `docs/audits/VERIFICATION_MATRIX.md`
- `docs/decisions/DECISION_LOG.md`
- `docs/evidence/CLAIMS_LEDGER.md`
- `docs/releases/RELEASE_READINESS.md`
- this plan document

---

## Task 1: Open the isolated Plan 1 review boundary

**Files:**
- Branch: `agent/dither-01-document-render-boundaries`
- Draft pull request based on `agent/dither-00-verification-foundation`

- [x] **Step 1: Create the branch from the verified Plan 0 head**

Starting SHA:

```text
50f722a87bf2995dc39f62dbb1056b16a98c8cb8
```

- [x] **Step 2: Commit the Plan 1 design and implementation plan**

Expected: the branch differs from Plan 0 only by Plan 1 documentation.

- [ ] **Step 3: Create a draft pull request**

The pull request must state:

- fixture protection precedes extraction
- no algorithm rewrite
- no UI redesign
- no live render migration yet
- Plan 0 remains the base

---

## Task 2: Define the legacy registry integrity contract

**Files:**
- Create: `tests/helpers/load-legacy-dither.mjs`
- Create: `tests/foundation/legacy-dither-registry.test.mjs`
- Modify: `.github/workflows/verify.yml`

**Interface:**

```js
export async function loadLegacyDitherRegistry(options = {})
```

Returns:

```js
{
  sourceSha256,
  algorithms,
  findAlgorithm(id),
}
```

- [ ] **Step 1: Write the failing loader test**

Required assertions:

```js
assert.equal(Array.isArray(registry.algorithms), true);
assert.ok(registry.algorithms.length >= 100);
assert.equal(typeof registry.findAlgorithm("missing"), "undefined");
```

The first run should fail because the helper does not exist.

- [ ] **Step 2: Implement the smallest VM loader**

Implementation requirements:

1. Read `dither.js` as UTF-8.
2. Hash the exact source text.
3. Create an isolated VM context.
4. Append only:

```js
globalThis.__DITHER_TEST_REGISTRY__ = DitherAlgorithms;
```

5. Evaluate the source and appended export in one script.
6. Return the exposed array without editing an algorithm entry.

- [ ] **Step 3: Add registry integrity assertions**

For every entry:

- non-empty string ID
- non-empty string name
- non-empty string category
- `apply` is a function
- `params` is an array
- parameter IDs are unique within the algorithm
- defaults are cloneable with `structuredClone` or a documented JSON fallback

Across the catalog:

- algorithm IDs are unique
- ordering is stable across fresh contexts

- [ ] **Step 4: Run the registry test twice in fresh contexts**

```bash
node --test tests/foundation/legacy-dither-registry.test.mjs
node --test tests/foundation/legacy-dither-registry.test.mjs
```

Expected: identical count, IDs, and source digest.

- [ ] **Step 5: Add the test to the Foundation contracts job**

Expected: the existing wildcard picks it up without weakening other jobs.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/load-legacy-dither.mjs tests/foundation/legacy-dither-registry.test.mjs .github/workflows/verify.yml
git commit -m "test: protect legacy dither registry contract"
```

---

## Task 3: Produce a reviewable registry inventory

**Files:**
- Create: `scripts/inspect-dither-registry.mjs`
- Modify: `package.json`

**Interface:**

```bash
npm run inspect:algorithms
```

Outputs JSON to standard output only.

- [ ] **Step 1: Write a failing test for inventory normalization**

The inventory should contain:

- source digest
- algorithm count
- ordered entries with ID, name, category, parameter IDs, and seed presence
- category counts
- duplicate lists, expected empty

- [ ] **Step 2: Implement the inventory script using the test loader**

The script must not import or reimplement algorithm logic.

- [ ] **Step 3: Add the command**

```json
"inspect:algorithms": "node scripts/inspect-dither-registry.mjs"
```

- [ ] **Step 4: Run and inspect the inventory**

Use the output to select fixture candidates by family and dependency profile.

- [ ] **Step 5: Record the selected initial fixture algorithms in the Plan 1 PR body and verification matrix**

- [ ] **Step 6: Commit**

```bash
git add scripts/inspect-dither-registry.mjs package.json tests/
git commit -m "tools: add legacy algorithm inventory"
```

---

## Task 4: Define deterministic source fixtures

**Files:**
- Create: `tests/fixtures/rendering/sources.mjs`
- Create: `tests/rendering/source-fixtures.test.mjs`
- Modify: `vitest.config.mjs`

**Interfaces:**

```js
export function createGradient16()
export function createCheckerEdge16()
export function createDetailField24()
export const SOURCE_FIXTURES
```

Each factory returns:

```js
{
  id,
  width,
  height,
  pixels: Float32Array,
}
```

- [ ] **Step 1: Write failing determinism and freshness tests**

Required behavior:

- repeated calls produce equal bytes
- repeated calls do not share the same pixel array
- pixel count equals width times height
- every value is finite and within 0 through 255
- each fixture has an expected source digest

- [ ] **Step 2: Implement minimal code-generated fixtures**

`gradient-16` includes horizontal and vertical influence.

`checker-edge-16` includes:

- flat dark region
- flat light region
- hard vertical edge
- diagonal edge
- checker detail

`detail-field-24` combines deterministic waves, blocks, and a center accent without random functions.

- [ ] **Step 3: Extend Vitest include patterns**

Support:

```text
tests/unit/**/*.test.{js,ts}
tests/rendering/**/*.test.{js,ts,mjs}
```

Keep foundation Node tests in their separate job.

- [ ] **Step 4: Run source fixture tests**

```bash
npm run test:unit
```

Expected: all existing and new tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/rendering/sources.mjs tests/rendering/source-fixtures.test.mjs vitest.config.mjs
git commit -m "test: add deterministic rendering sources"
```

---

## Task 5: Define fixture record and parameter resolution utilities

**Files:**
- Create: `tests/helpers/render-fixture-utils.mjs`
- Create: `tests/rendering/render-fixture-utils.test.mjs`

**Interfaces:**

```js
export function resolveAlgorithmParameters(algorithm, overrides)
export function summarizeByteOutput(output, width, height)
export function createRenderFixtureRecord(input)
```

- [ ] **Step 1: Write failing parameter resolution tests**

Required behavior:

- clones defaults deeply
- applies explicit overrides
- does not mutate catalog defaults
- requires an explicit seed when a fixture algorithm exposes a seed parameter
- rejects unknown override keys unless explicitly allowed by the catalog contract

- [ ] **Step 2: Write failing output summary tests**

Summary fields:

```js
{
  constructor,
  length,
  min,
  max,
  uniqueCount,
  sum,
  weightedChecksum,
  sha256,
}
```

- [ ] **Step 3: Implement pure utilities**

The weighted checksum uses index-aware integer arithmetic and must remain below JavaScript safe integer limits for fixture sizes.

- [ ] **Step 4: Run tests**

```bash
npm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/render-fixture-utils.mjs tests/rendering/render-fixture-utils.test.mjs
git commit -m "test: define rendering fixture records"
```

---

## Task 6: Select and prove the initial protected algorithm set

**Files:**
- Create: `tests/rendering/legacy-dither-fixtures.test.mjs`
- Create: `scripts/generate-render-fixture-candidates.mjs`
- Create: `tests/fixtures/rendering/approved-fixtures.json`
- Modify: `package.json`

- [ ] **Step 1: Select at least four algorithms from distinct families**

Selection criteria:

- deterministic with explicit parameters
- no loaded browser source requirement for the first wave
- covers materially different output behavior
- stable on small generated fixtures

Record:

- algorithm ID
- family or category
- source fixture
- parameter overrides
- reason for selection

- [ ] **Step 2: Write the failing fixture test against an empty approval file**

For each selection:

1. load a fresh registry context
2. resolve parameters
3. run the algorithm three times
4. assert identical records
5. compare with the committed approved record

The first run must fail because no approved record exists.

- [ ] **Step 3: Implement a candidate generator**

```bash
npm run fixtures:render:candidates
```

The command prints candidate JSON. It must not write `approved-fixtures.json`.

- [ ] **Step 4: Review candidate output**

For each record inspect:

- non-empty variation
- expected binary or tonal range
- output length
- unique count
- deterministic repeat result
- source and parameter identity

- [ ] **Step 5: Commit the first approved fixture file explicitly**

The commit message must name the protected families.

- [ ] **Step 6: Verify fresh-context determinism**

```bash
npm run test:unit -- legacy-dither-fixtures
npm run test:unit -- legacy-dither-fixtures
```

Expected: both runs pass.

- [ ] **Step 7: Add an independent Rendering fixtures CI job**

The job runs the focused suite and uploads no auto-generated approval changes.

- [ ] **Step 8: Commit**

```bash
git add tests/rendering/legacy-dither-fixtures.test.mjs scripts/generate-render-fixture-candidates.mjs tests/fixtures/rendering/approved-fixtures.json package.json .github/workflows/verify.yml
git commit -m "test: approve representative dither fixtures"
```

---

## Task 7: Add Node and Chromium parity for one protected algorithm

**Files:**
- Create: `tests/e2e/render-parity.spec.js`
- Modify: `playwright.config.mjs` only if an additional route is required

- [ ] **Step 1: Write a browser parity test**

The test should:

1. open the built DITHER page
2. dismiss the intro
3. evaluate a protected algorithm through the browser's existing `DitherAlgorithms` lexical global
4. generate the same source fixture values in the page
5. resolve the same explicit parameters
6. calculate the same digest and invariants
7. compare with the approved Node fixture record

- [ ] **Step 2: Confirm the test fails if one expected digest character is changed**

Revert the deliberate test corruption before committing.

- [ ] **Step 3: Run browser parity twice**

```bash
npm run build
npm run test:e2e -- render-parity.spec.js
npm run test:e2e -- render-parity.spec.js
```

Expected: identical pass results.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/render-parity.spec.js
git commit -m "test: verify Node and Chromium render parity"
```

---

## Task 8: Define shared result and branded identity types

**Files:**
- Create: `src/shared/result.ts`
- Create: `src/document/identity.ts`
- Create: `tests/unit/document/identity.test.ts`

**Interfaces:**

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type DocumentId = string & { readonly __brand: "DocumentId" };
export type SourceImageId = string & { readonly __brand: "SourceImageId" };
export type StageId = string & { readonly __brand: "StageId" };
export type RenderRequestId = string & { readonly __brand: "RenderRequestId" };
```

- [ ] **Step 1: Write failing identity constructor tests**

Required behavior:

- trims input
- rejects empty values
- preserves valid caller-supplied identity exactly after trim
- returns structured error, not an untyped thrown string

- [ ] **Step 2: Implement the smallest constructors and `Result` helpers**

Do not add UUID generation in this task.

- [ ] **Step 3: Run tests and typecheck**

```bash
npm run typecheck
npm run test:unit
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/result.ts src/document/identity.ts tests/unit/document/identity.test.ts
git commit -m "feat: define typed document identities"
```

---

## Task 9: Define document, source, stage, and export contracts

**Files:**
- Create: `src/document/types.ts`
- Create: `src/document/validation.ts`
- Create: `tests/unit/document/validation.test.ts`

**Required types:**

- `SourceImageDescriptor`
- `DitherAlgorithmSelection`
- `DitherStage`
- `GrainLayerSelection`
- `GrainStage`
- `PaintStage`
- `CreativeStage`
- `ExportSettings`
- `DitherDocument`
- `DocumentValidationIssue`

- [ ] **Step 1: Write valid-document tests**

Cover one document with all three stage types.

- [ ] **Step 2: Write invalid-document tests**

Required issue codes:

- `invalid-source-width`
- `invalid-source-height`
- `invalid-source-revision`
- `duplicate-stage-id`
- `missing-selected-stage`
- `invalid-document-version`
- `invalid-stage-revision`
- `invalid-export-dimensions`
- `unsupported-export-format`

- [ ] **Step 3: Implement serializable readonly contracts**

Use `Readonly<Record<string, unknown>>` for legacy parameter payloads. Do not use `any`.

- [ ] **Step 4: Implement structured validation**

```ts
export function validateDocument(document: DitherDocument): readonly DocumentValidationIssue[]
```

The function must collect all detectable issues rather than returning only the first.

- [ ] **Step 5: Verify JSON serialization**

A valid document must round-trip through `JSON.stringify` and `JSON.parse` without special browser types.

- [ ] **Step 6: Commit**

```bash
git add src/document/types.ts src/document/validation.ts tests/unit/document/validation.test.ts
git commit -m "feat: define document and stage contracts"
```

---

## Task 10: Add pure document construction

**Files:**
- Create: `src/document/create-document.ts`
- Create: `tests/unit/document/create-document.test.ts`

**Interface:**

```ts
export function createDocument(input: CreateDocumentInput): Result<DitherDocument, CreateDocumentError>
```

- [ ] **Step 1: Write failing construction tests**

Required behavior:

- creates an immutable document snapshot
- copies stage arrays and nested parameter records
- defaults selected stage to the first stage when caller omits it
- uses null when no stages exist
- does not alias caller-owned arrays or parameter objects
- validates the resulting document

- [ ] **Step 2: Implement minimal deep-copy policy**

Use `structuredClone` through an injectable or isolated helper where supported by the current Node target. Reject non-serializable values.

- [ ] **Step 3: Prove caller mutation cannot change the document**

Mutate the original input after construction and assert the result remains unchanged.

- [ ] **Step 4: Run tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/document/create-document.ts tests/unit/document/create-document.test.ts
git commit -m "feat: add pure document construction"
```

---

## Task 11: Define render request and result contracts

**Files:**
- Create: `src/render/types.ts`
- Create: `src/render/validation.ts`
- Create: `tests/unit/render/validation.test.ts`

**Required types:**

- `RenderPriority`
- `RenderSize`
- `RenderableStage`
- `RenderRequest`
- `RenderWarningCode`
- `RenderWarning`
- `RenderResult`
- `RenderValidationIssue`

- [ ] **Step 1: Write valid request and result tests**

- [ ] **Step 2: Write invalid tests**

Required issue codes:

- `invalid-output-width`
- `invalid-output-height`
- `invalid-document-version`
- `invalid-source-revision`
- `invalid-duration`
- `invalid-pixel-length`
- `invalid-pixel-value`

- [ ] **Step 3: Implement pure types and validators**

Pixel validation may sample for large arrays in production adapters later. Plan 1 unit validation checks every byte because fixture payloads are small.

- [ ] **Step 4: Run tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/render/types.ts src/render/validation.ts tests/unit/render/validation.test.ts
git commit -m "feat: define render request and result contracts"
```

---

## Task 12: Create immutable render requests

**Files:**
- Create: `src/render/create-request.ts`
- Create: `tests/unit/render/create-request.test.ts`

**Interface:**

```ts
export function createRenderRequest(input: CreateRenderRequestInput): Result<RenderRequest, CreateRenderRequestError>
```

- [ ] **Step 1: Write failing request-construction tests**

Required behavior:

- snapshots document ID, version, source revision, stages, size, and priority
- does not alias document stage data
- rejects disabled or unsupported stages only when the adapter policy requires it
- preserves stage order
- requires caller-supplied request ID

- [ ] **Step 2: Implement the smallest pure request builder**

- [ ] **Step 3: Verify request serialization**

No function, DOM object, Canvas object, Blob, or callback may appear in the request.

- [ ] **Step 4: Run tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/render/create-request.ts tests/unit/render/create-request.test.ts
git commit -m "feat: create immutable render requests"
```

---

## Task 13: Reject stale and malformed render results explicitly

**Files:**
- Create: `src/render/accept-result.ts`
- Create: `tests/unit/render/accept-result.test.ts`

**Interface:**

```ts
export type RenderRejectionReason =
  | "request-id-mismatch"
  | "document-id-mismatch"
  | "document-version-mismatch"
  | "invalid-output-dimensions"
  | "invalid-pixel-length";

export function evaluateRenderResult(
  activeRequest: RenderRequest,
  result: RenderResult,
): RenderAcceptance;
```

- [ ] **Step 1: Write the acceptance test**

Exact identity, version, dimensions, and pixel length must pass.

- [ ] **Step 2: Write one failing test for every rejection reason**

Change only one field per case.

- [ ] **Step 3: Implement ordered rejection logic**

Identity mismatches are checked before payload validation so the reason remains stable and actionable.

- [ ] **Step 4: Prove the function is pure**

Freeze request and result inputs in tests.

- [ ] **Step 5: Run tests and typecheck**

- [ ] **Step 6: Commit**

```bash
git add src/render/accept-result.ts tests/unit/render/accept-result.test.ts
git commit -m "feat: reject stale render results explicitly"
```

---

## Task 14: Add a read-only legacy catalog adapter

**Files:**
- Create: `src/render/legacy-catalog-types.ts`
- Create: `tests/unit/render/legacy-catalog-types.test.ts`
- Create: `scripts/generate-legacy-catalog-snapshot.mjs`
- Create: `src/render/legacy-catalog.snapshot.json`

**Purpose:** Provide typed catalog metadata without importing or executing the classic engine inside production TypeScript.

- [ ] **Step 1: Write a failing snapshot schema test**

Snapshot fields:

- source digest
- ordered algorithm ID
- name
- category
- parameter definitions with serializable defaults

No apply function is copied into the snapshot.

- [ ] **Step 2: Generate a candidate snapshot from the test loader**

The generator prints or writes only when invoked explicitly. CI checks drift but does not update the snapshot.

- [ ] **Step 3: Review and commit the snapshot**

- [ ] **Step 4: Add a drift check**

The test compares current normalized legacy metadata with the committed snapshot.

- [ ] **Step 5: Commit**

```bash
git add src/render/legacy-catalog-types.ts src/render/legacy-catalog.snapshot.json tests/unit/render/legacy-catalog-types.test.ts scripts/generate-legacy-catalog-snapshot.mjs
git commit -m "feat: add typed legacy catalog snapshot"
```

---

## Task 15: Reconcile CI and evidence

**Files:**
- Modify: `.github/workflows/verify.yml`
- Modify: `docs/audits/FINDINGS_LEDGER.md`
- Modify: `docs/audits/RISK_REGISTER.md`
- Modify: `docs/audits/VERIFICATION_MATRIX.md`
- Modify: `docs/decisions/DECISION_LOG.md`
- Modify: `docs/evidence/CLAIMS_LEDGER.md`
- Modify: `docs/releases/RELEASE_READINESS.md`
- Modify: this plan

- [ ] **Step 1: Add independent jobs**

Required additional gates:

- Legacy registry contract
- Rendering fixtures
- Typed document and render contracts
- Browser render parity

- [ ] **Step 2: Upload fixture evidence**

Upload the approved fixture file and current candidate summary as read-only evidence. Do not upload unreviewed binary snapshots as accepted output.

- [ ] **Step 3: Update findings and risks**

At minimum record:

- registry metadata or default anomalies
- nondeterministic algorithms discovered
- source-dependent algorithm families deferred
- document-model assumptions
- any Node and Chromium parity difference

- [ ] **Step 4: Update claims**

Only after green evidence permit:

- representative algorithm outputs are protected by deterministic fixtures
- typed document and render contracts exist
- stale result behavior is explicitly tested

Do not claim the live runtime uses the new model.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/verify.yml docs/
git commit -m "docs: reconcile Plan 1 verification evidence"
```

---

## Task 16: Final Plan 1 verification and review

- [ ] **Step 1: Run the full clean command sequence**

```bash
rm -rf node_modules dist playwright-report test-results
npm ci --ignore-scripts
python -m unittest tests/test_serve.py -v
node --test tests/foundation/*.test.mjs
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run build
npm run test:e2e
```

- [ ] **Step 2: Run fixture-focused checks twice**

```bash
npm run test:unit -- legacy-dither-fixtures
npm run test:unit -- legacy-dither-fixtures
```

- [ ] **Step 3: Verify no creative engine implementation changed**

```bash
git diff --name-status agent/dither-00-verification-foundation...HEAD
```

Expected: `dither.js`, `engine.js`, `grain.js`, and `paintstroke.js` remain unchanged unless a separately reviewed fixture-backed correction was required.

- [ ] **Step 4: Inspect the complete diff and pull-request evidence**

- [ ] **Step 5: Invoke verification-before-completion and requesting-code-review**

- [ ] **Step 6: Record the final verified commit and workflow run**

## Plan 1 exit checklist

- [ ] legacy registry loads in a test-only isolated context
- [ ] registry identity and metadata integrity pass
- [ ] at least four algorithm families have explicit approved records
- [ ] repeated fresh contexts produce identical records
- [ ] one Node record matches Chromium
- [ ] source fixtures are deterministic and reviewable
- [ ] typed document and stage contracts pass
- [ ] typed render request and result contracts pass
- [ ] stale result rejection reasons pass
- [ ] read-only legacy catalog metadata is typed and drift-checked
- [ ] live runtime behavior remains on the protected legacy path
- [ ] Plan 0 verification remains green
- [ ] evidence ledgers are reconciled
- [ ] final read-only workflow is green
