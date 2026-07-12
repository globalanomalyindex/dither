# DITHER Plan 0 Verification Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a portable, reproducible, evidence-backed development and verification foundation around the existing static DITHER runtime before any product-model, engine, or interface redesign.

**Architecture:** Preserve the current HTML, CSS, and classic JavaScript runtime as the shipped product. Add a pinned development toolchain, a deterministic static build, focused TypeScript boundaries, browser characterization, and durable audit records around it. Protect behavior first, then permit selective modernization in later plans.

**Tech Stack:** Python 3.12 standard library, Node.js 24 in CI, npm lockfile version 3, TypeScript 6.0.3, ESLint 10.7.0, Prettier 3.9.4, Vitest 4.1.10, Playwright 1.61.1, axe-core Playwright 4.11.3, Vite 8.1.4, GitHub Actions.

## Global Constraints

- The shipped runtime remains static, client-side, and independent of runtime services.
- Do not change algorithm output in Plan 0.
- Do not redesign the interface in Plan 0.
- Do not convert the legacy engine files to modules or TypeScript in Plan 0.
- Exact development dependencies must be pinned without caret or tilde ranges.
- `package-lock.json` must be committed and checked for drift.
- The build must preserve every current runtime entry and emit a deterministic integrity manifest.
- Browser verification must run against built output, not only source files.
- No third-party request may occur on the tested entry surface.
- Critical and serious automated accessibility violations block Plan 0 unless evidence justifies a narrower documented gate.
- Copy and documentation must not use em dashes.
- The repository must not claim broad privacy, accessibility, or production readiness beyond verified evidence.
- No generated image may be used as product evidence.

---

## File Structure

### Existing files modified

- `.github/workflows/verify.yml`: read-only pull-request verification pipeline.
- `README.md`: accurate product, setup, architecture, verification, and limitation guide.
- `index.html`: remove remote font requests only.
- `serve.py`: portable repository-relative static server.

### New foundation files

- `.gitignore`: generated dependency, build, and browser-test output.
- `.prettierrc.json`: formatting contract for the modernized surface.
- `eslint.config.mjs`: focused lint boundary that excludes unprotected legacy runtime files.
- `package.json`: exact development dependency and command contract.
- `package-lock.json`: reproducible dependency graph.
- `playwright.config.mjs`: built-output browser verification.
- `tsconfig.json`: strict TypeScript boundary.
- `vite.config.mjs`: development and preview server configuration.
- `vitest.config.mjs`: deterministic unit test configuration.
- `scripts/build.mjs`: deterministic static output and integrity manifest.
- `scripts/static-runtime-manifest.mjs`: canonical legacy runtime membership and copy plan.
- `src/foundation/runtime-boundary.ts`: initial typed verification interfaces.
- `tests/test_serve.py`: portable-server contract.
- `tests/foundation/static-runtime-manifest.test.mjs`: runtime membership and build-copy contract.
- `tests/foundation/toolchain-contract.test.mjs`: dependency, lockfile, script, and config contract.
- `tests/unit/static-runtime-manifest.test.js`: focused copy-plan unit test.
- `tests/e2e/entry.spec.js`: entry, privacy, and accessibility characterization.

### New evidence and design files

- `docs/audits/AUDIT_CHARTER.md`
- `docs/audits/BASELINE_INVENTORY.md`
- `docs/audits/FINDINGS_LEDGER.md`
- `docs/audits/RISK_REGISTER.md`
- `docs/audits/VERIFICATION_MATRIX.md`
- `docs/decisions/DECISION_LOG.md`
- `docs/evidence/CLAIMS_LEDGER.md`
- `docs/evidence/ASSET_PROVENANCE.md`
- `docs/releases/RELEASE_READINESS.md`
- `docs/superpowers/specs/2026-07-12-dither-production-audit-design.md`
- `docs/superpowers/plans/2026-07-12-dither-program-roadmap.md`
- `docs/superpowers/plans/2026-07-12-dither-plan-00-verification-foundation.md`

---

### Task 1: Create the isolated Plan 0 review boundary

**Files:**
- Create branch: `agent/dither-00-verification-foundation`
- Create draft pull request: `Plan 0: establish verification foundation`

**Interfaces:**
- Consumes: baseline `main` at `faf52b24391cadd7b39a657918c80558df9979eb`.
- Produces: one isolated branch and draft review surface for all Plan 0 changes.

- [x] **Step 1: Create the branch from the baseline**

```bash
git switch main
git pull --ff-only
git switch -c agent/dither-00-verification-foundation
```

Expected: branch points to `faf52b24391cadd7b39a657918c80558df9979eb` before Plan 0 commits.

- [x] **Step 2: Create the draft pull request**

```bash
gh pr create \
  --draft \
  --base main \
  --head agent/dither-00-verification-foundation \
  --title "Plan 0: establish verification foundation" \
  --body-file /tmp/dither-plan-0-pr.md
```

Expected: draft pull request 3 exists and targets `main`.

- [x] **Step 3: Verify scope isolation**

```bash
git diff --stat main...HEAD
```

Expected: only Plan 0 verification, documentation, portability, and privacy files appear. No algorithm implementation or visual redesign is included.

---

### Task 2: Make the local static server portable through TDD

**Files:**
- Create: `tests/test_serve.py`
- Modify: `serve.py`

**Interfaces:**
- Consumes: repository root and Python standard library.
- Produces: `create_server(port: int, root: Path, host: str) -> ThreadingHTTPServer`, `parse_args(argv)`, and `main(argv) -> int`.

- [x] **Step 1: Write the failing portability contract**

```python
from __future__ import annotations

import ast
from pathlib import Path
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SERVER_SOURCE = REPOSITORY_ROOT / "serve.py"

class PortableServerContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.source = SERVER_SOURCE.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)

    def test_server_does_not_contain_a_machine_specific_user_path(self) -> None:
        self.assertNotIn("/Users/", self.source)

    def test_server_resolves_the_default_root_from_its_own_file(self) -> None:
        self.assertIn("Path(__file__).resolve().parent", self.source)

    def test_server_exposes_a_testable_factory_and_main_guard(self) -> None:
        function_names = {
            node.name for node in self.tree.body if isinstance(node, ast.FunctionDef)
        }
        self.assertIn("create_server", function_names)
```

- [x] **Step 2: Run the contract and confirm the intended red state**

Run:

```bash
python -m unittest tests/test_serve.py -v
```

Expected: three failures identifying the private `/Users/` path, missing repository-relative root, and missing factory or main guard.

- [x] **Step 3: Implement the smallest portable server**

```python
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Sequence

DEFAULT_ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8080

def create_server(
    port: int = DEFAULT_PORT,
    root: Path = DEFAULT_ROOT,
    host: str = DEFAULT_HOST,
) -> ThreadingHTTPServer:
    resolved_root = root.expanduser().resolve()
    if not resolved_root.is_dir():
        raise ValueError(f"Server root is not a directory: {resolved_root}")
    handler = partial(SimpleHTTPRequestHandler, directory=str(resolved_root))
    return ThreadingHTTPServer((host, port), handler)
```

- [x] **Step 4: Verify the green state**

Run:

```bash
python -m unittest tests/test_serve.py -v
```

Expected: all three tests pass.

- [x] **Step 5: Commit the red contract and minimal fix in reviewable commits**

```bash
git add tests/test_serve.py .github/workflows/verify.yml
git commit -m "test: define portable server contract"
git add serve.py
git commit -m "fix: make local server portable"
```

---

### Task 3: Define and protect the current static runtime

**Files:**
- Create: `tests/foundation/static-runtime-manifest.test.mjs`
- Create: `scripts/static-runtime-manifest.mjs`

**Interfaces:**
- Consumes: repository root and output root paths.
- Produces:
  - `STATIC_RUNTIME_FILES: readonly string[]`
  - `createStaticRuntimeCopyPlan(repositoryRoot, outputRoot)`
  - `validateStaticRuntimeManifest(repositoryRoot)`

- [x] **Step 1: Write the failing runtime-membership test**

```js
const REQUIRED_RUNTIME_ENTRIES = [
  "index.html",
  "style.css",
  "dither.js",
  "engine.js",
  "grain.js",
  "paintstroke.js",
  "app.js",
  "fonts",
];

test("the static runtime manifest preserves every current product entry", () => {
  assert.deepEqual(STATIC_RUNTIME_FILES, REQUIRED_RUNTIME_ENTRIES);
});
```

- [x] **Step 2: Verify the test fails because the manifest module does not exist**

Run:

```bash
node --test tests/foundation/static-runtime-manifest.test.mjs
```

Expected: module-not-found failure for `scripts/static-runtime-manifest.mjs`.

- [x] **Step 3: Implement the manifest and copy plan**

```js
export const STATIC_RUNTIME_FILES = Object.freeze([
  "index.html",
  "style.css",
  "dither.js",
  "engine.js",
  "grain.js",
  "paintstroke.js",
  "app.js",
  "fonts",
]);

export function createStaticRuntimeCopyPlan(repositoryRoot, outputRoot) {
  return STATIC_RUNTIME_FILES.map((relativePath) => ({
    relativePath,
    sourcePath: resolve(repositoryRoot, relativePath),
    destinationPath: resolve(outputRoot, relativePath),
  }));
}
```

- [x] **Step 4: Verify runtime membership and repository ownership**

Run:

```bash
node --test tests/foundation/static-runtime-manifest.test.mjs
```

Expected: all runtime manifest tests pass and no resolved entry contains `/Users/`.

- [x] **Step 5: Commit**

```bash
git add tests/foundation/static-runtime-manifest.test.mjs scripts/static-runtime-manifest.mjs
git commit -m "build: define legacy runtime manifest"
```

---

### Task 4: Add a pinned, framework-free development toolchain

**Files:**
- Create: `tests/foundation/toolchain-contract.test.mjs`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.prettierrc.json`
- Create: `eslint.config.mjs`
- Create: `tsconfig.json`
- Create: `vite.config.mjs`
- Create: `vitest.config.mjs`
- Create: `playwright.config.mjs`
- Create: `src/foundation/runtime-boundary.ts`
- Create: `.gitignore`

**Interfaces:**
- Consumes: Node.js 22.12 or newer and npm 10.9 or newer.
- Produces: exact commands `build`, `dev`, `format`, `format:check`, `lint`, `preview`, `test`, `test:e2e`, `test:unit`, `typecheck`, and `verify`.

- [x] **Step 1: Write the failing pinned-toolchain contract**

```js
const EXPECTED_DEV_DEPENDENCIES = {
  "@axe-core/playwright": "4.11.3",
  "@playwright/test": "1.61.1",
  eslint: "10.7.0",
  prettier: "3.9.4",
  typescript: "6.0.3",
  vite: "8.1.4",
  vitest: "4.1.10",
};

test("the development toolchain is pinned and reproducible", () => {
  assert.equal(existsSync("package.json"), true);
  assert.equal(existsSync("package-lock.json"), true);
  const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));
  assert.deepEqual(packageJson.devDependencies, EXPECTED_DEV_DEPENDENCIES);
});
```

- [x] **Step 2: Verify the intended red state**

Run:

```bash
node --test tests/foundation/toolchain-contract.test.mjs
```

Expected: failure because `package.json`, lockfile, and configuration do not exist.

- [x] **Step 3: Add the exact manifest**

```json
{
  "name": "@globalanomalyindex/dither",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.12.0",
    "npm": ">=10.9.0"
  },
  "devDependencies": {
    "@axe-core/playwright": "4.11.3",
    "@playwright/test": "1.61.1",
    "eslint": "10.7.0",
    "prettier": "3.9.4",
    "typescript": "6.0.3",
    "vite": "8.1.4",
    "vitest": "4.1.10"
  }
}
```

- [x] **Step 4: Generate and commit the lockfile**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: `package-lock.json` uses lockfile version 3 and repeats the exact root dependency versions.

- [x] **Step 5: Add strict but bounded configuration**

The TypeScript include remains limited to `src/**/*.ts`. ESLint excludes the unprotected legacy engine files and checks only new scripts, tests, and configuration.

- [x] **Step 6: Run the foundation contract**

Run:

```bash
node --test tests/foundation/*.test.mjs
```

Expected: all contract tests pass.

- [x] **Step 7: Run a clean install**

Run:

```bash
rm -rf node_modules
npm ci --ignore-scripts
```

Expected: installation succeeds without modifying `package-lock.json`.

- [x] **Step 8: Commit**

```bash
git add package.json package-lock.json .prettierrc.json eslint.config.mjs tsconfig.json vite.config.mjs vitest.config.mjs playwright.config.mjs src/foundation/runtime-boundary.ts .gitignore tests/foundation/toolchain-contract.test.mjs
git commit -m "build: pin development toolchain"
```

---

### Task 5: Build complete deterministic static output

**Files:**
- Create: `scripts/build.mjs`
- Create: `tests/unit/static-runtime-manifest.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createStaticRuntimeCopyPlan` and `validateStaticRuntimeManifest`.
- Produces: `dist` containing the current runtime and `dist/build-manifest.json` containing `schemaVersion`, file path, byte count, and SHA-256.

- [x] **Step 1: Write the copy-plan unit test**

```js
it("keeps source and destination paths aligned by relative entry", () => {
  const plan = createStaticRuntimeCopyPlan("/workspace/dither", "/workspace/dist");
  expect(plan[2]).toEqual({
    destinationPath: "/workspace/dist/dither.js",
    relativePath: "dither.js",
    sourcePath: "/workspace/dither/dither.js",
  });
});
```

- [x] **Step 2: Verify the unit test passes against the protected copy-plan boundary**

Run:

```bash
npm run test:unit
```

Expected: one Vitest test passes.

- [x] **Step 3: Implement the deterministic builder**

Required behavior:

```js
await validateStaticRuntimeManifest(repositoryRoot);
await rm(outputRoot, { force: true, recursive: true });
await mkdir(outputRoot, { recursive: true });

for (const entry of createStaticRuntimeCopyPlan(repositoryRoot, outputRoot)) {
  await cp(entry.sourcePath, entry.destinationPath, {
    force: true,
    recursive: true,
  });
}
```

The manifest must not contain a timestamp, machine path, random identifier, or environment-specific value.

- [x] **Step 4: Build twice and compare integrity manifests**

Run:

```bash
npm run build
cp dist/build-manifest.json /tmp/dither-build-manifest.json
npm run build
cmp /tmp/dither-build-manifest.json dist/build-manifest.json
```

Expected: `cmp` exits 0.

- [x] **Step 5: Commit**

```bash
git add scripts/build.mjs tests/unit/static-runtime-manifest.test.js package.json
git commit -m "build: add deterministic static build"
```

---

### Task 6: Characterize the built entry experience and privacy boundary

**Files:**
- Create: `tests/e2e/entry.spec.js`
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Consumes: built static product at `http://127.0.0.1:4173/dither/`.
- Produces: browser evidence for runtime errors, core entry controls, and third-party requests.

- [x] **Step 1: Write the entry behavior test**

```js
test("the entry screen exposes the current creative workflow", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("./");
  await dismissIntro(page);
  await expect(page.getByRole("button", { name: "Upload" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export" })).toBeDisabled();
  await expect(pageErrors).toEqual([]);
});
```

- [x] **Step 2: Write the privacy characterization test**

```js
test("the entry screen loads without third-party runtime requests", async ({ page }) => {
  const thirdPartyRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4173") {
      thirdPartyRequests.push(request.url());
    }
  });
  await page.goto("./");
  await dismissIntro(page);
  expect(thirdPartyRequests).toEqual([]);
});
```

- [x] **Step 3: Confirm the first browser run fails only at the intended privacy boundary**

Run:

```bash
npm run build
npx playwright install chromium
npm run test:e2e
```

Expected before correction:

- entry behavior test passes
- privacy test fails with requests to `fonts.googleapis.com` and `fonts.gstatic.com`
- no unrelated page error is reported

- [x] **Step 4: Remove only the remote font links**

Delete the three remote-font lines from `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?..." rel="stylesheet">
```

Keep the existing local stylesheet and CSS fallback stacks.

- [x] **Step 5: Verify the corrected privacy boundary**

Run:

```bash
npm run build
npm run test:e2e
```

Expected: entry and third-party request tests pass.

- [x] **Step 6: Record the typography consequence**

Update the decision log, findings, risk register, claims ledger, provenance ledger, and verification matrix to state that system-font fit remains a later cross-platform audit requirement.

- [x] **Step 7: Commit**

```bash
git add tests/e2e/entry.spec.js index.html docs/
git commit -m "fix: remove remote runtime font requests"
```

---

### Task 7: Add the automated entry accessibility baseline

**Files:**
- Modify: `tests/e2e/entry.spec.js`
- Potentially modify exact semantic defects identified by axe in `index.html` or `style.css`
- Update: `docs/audits/FINDINGS_LEDGER.md`
- Update: `docs/audits/VERIFICATION_MATRIX.md`
- Update: `docs/releases/RELEASE_READINESS.md`

**Interfaces:**
- Consumes: built entry surface after the intro is dismissed.
- Produces: attached axe JSON and a blocking list containing only `critical` or `serious` violations.

- [x] **Step 1: Write the failing or passing accessibility characterization**

```js
import AxeBuilder from "@axe-core/playwright";

test("the entry screen has no critical or serious automated accessibility violations", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await dismissIntro(page);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  await testInfo.attach("axe-entry-results", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });

  const blockingViolations = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );

  expect(blockingViolations).toEqual([]);
});
```

- [ ] **Step 2: Run the browser suite and inspect axe evidence**

Run:

```bash
npm run build
npm run test:e2e
```

Expected: the test either passes with zero critical and serious violations or fails with exact rule identifiers, selectors, help URLs, and impact. The JSON attachment must be retained in browser evidence.

- [ ] **Step 3: Fix only evidence-backed blocking defects**

For each blocking violation:

1. Record the rule and affected selector in `docs/audits/FINDINGS_LEDGER.md`.
2. Write or preserve the failing browser assertion.
3. Make the smallest semantic or contrast correction.
4. Rerun the exact browser test.
5. Record the resolved evidence.

Do not suppress rules globally. Do not convert a serious violation into a nonblocking status without manual evidence and a documented decision.

- [ ] **Step 4: Verify the complete browser suite**

Run:

```bash
npm run test:e2e
```

Expected: entry, privacy, and automated accessibility tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/entry.spec.js index.html style.css docs/audits/FINDINGS_LEDGER.md docs/audits/VERIFICATION_MATRIX.md docs/releases/RELEASE_READINESS.md
git commit -m "test: establish entry accessibility baseline"
```

---

### Task 8: Establish the read-only CI release evidence pipeline

**Files:**
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Consumes: clean pull-request checkout.
- Produces: separate status gates and build or browser artifacts without writing source commits.

- [x] **Step 1: Add independent jobs**

Required job names:

- `Portable server contract`
- `Foundation contracts`
- `Package lock drift`
- `Toolchain verification`
- `Browser smoke verification`

- [x] **Step 2: Expose each toolchain boundary as its own step**

```yaml
- name: Type check
  run: npm run typecheck
- name: Lint new toolchain files
  run: npm run lint
- name: Verify formatting
  run: npm run format:check
- name: Run unit tests
  run: npm run test:unit
- name: Build static runtime
  run: npm run build
```

- [x] **Step 3: Verify deterministic output in CI**

```yaml
- name: Verify deterministic build manifest
  shell: bash
  run: |
    cp dist/build-manifest.json /tmp/build-manifest.json
    npm run build
    cmp /tmp/build-manifest.json dist/build-manifest.json
```

- [x] **Step 4: Upload inspectable evidence**

Upload:

- `dist/build-manifest.json`
- `playwright-report`
- `test-results`

- [x] **Step 5: Remove one-time CI migration jobs**

Expected: the final workflow has `contents: read` only and never commits formatting, lockfiles, source fixes, or privacy corrections.

- [x] **Step 6: Verify the clean pipeline**

Run through GitHub Actions on the draft pull request.

Expected before Task 7 completion:

- portable server passes
- foundation contracts pass
- package-lock drift passes
- typecheck passes
- lint passes
- formatting passes
- unit tests pass
- build passes
- deterministic manifest passes
- browser entry and privacy pass
- accessibility state is determined by Task 7

---

### Task 9: Commit durable product and audit anchors

**Files:**
- Create all files listed under `New evidence and design files`.
- Modify: `README.md`

**Interfaces:**
- Consumes: approved master specification and verified repository evidence.
- Produces: stable review criteria for every later plan.

- [x] **Step 1: Record baseline evidence**

Document:

- repository and baseline commit
- live product
- core file sizes and responsibilities
- script order
- delivery risks
- current visual direction

- [x] **Step 2: Record findings, risks, decisions, claims, and provenance separately**

Expected: no document silently overwrites another concern. A finding has severity and acceptance criteria. A risk has mitigation and owner plan. A claim has allowed wording and evidence status.

- [x] **Step 3: Commit the approved design summary**

The design summary must contain:

- master specification hash
- product posture
- goals and non-goals
- design authority
- one-document and stage model
- checkpoint model
- target information architecture
- state, command, rendering, history, and persistence boundaries
- visual and accessibility systems
- verification architecture
- migration sequence
- definition of done

- [x] **Step 4: Replace the baseline README**

The README must distinguish:

- static shipped runtime
- Node development toolchain
- verified setup
- deterministic build
- CI checks
- current architecture
- audit documents
- current limitations
- unresolved license posture

- [x] **Step 5: Verify copy rules**

Run:

```bash
grep -RIn $'\u2014' README.md docs scripts src tests .github || true
```

Expected: no em dash appears in project-authored Plan 0 copy.

- [x] **Step 6: Commit**

```bash
git add README.md docs/
git commit -m "docs: establish DITHER audit and design record"
```

---

### Task 10: Final Plan 0 verification and review gate

**Files:**
- Modify: draft pull request body
- Review: every changed Plan 0 file

**Interfaces:**
- Consumes: complete Plan 0 branch.
- Produces: evidence-backed review checkpoint before Plan 1.

- [ ] **Step 1: Run the complete clean verification sequence**

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
cp dist/build-manifest.json /tmp/dither-build-manifest.json
npm run build
cmp /tmp/dither-build-manifest.json dist/build-manifest.json
npm run test:e2e
```

Expected: every command exits 0.

- [ ] **Step 2: Inspect the final branch diff**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff --name-status main...HEAD
```

Expected:

- no whitespace errors
- no engine algorithm changes
- no broad visual redesign
- no remote font links
- no private machine path
- no generated output committed

- [ ] **Step 3: Inspect dependency and runtime claims**

```bash
npm install --package-lock-only --ignore-scripts
git diff --exit-code -- package-lock.json
rg "fonts\.googleapis\.com|fonts\.gstatic\.com|/Users/" . \
  --glob '!node_modules/**' \
  --glob '!dist/**'
```

Expected: lockfile has no drift and the search returns no active runtime or private-path occurrence outside historical documentation that explicitly describes the baseline.

- [ ] **Step 4: Verify GitHub Actions on the final pull-request head**

Expected required results:

- Portable server contract: success
- Foundation contracts: success
- Package lock drift: success
- Toolchain verification: success
- Browser smoke verification: success

- [ ] **Step 5: Update the draft pull request body with actual evidence**

The pull request body must include:

- completed scope
- red-green fixes
- exact CI gates
- privacy correction
- accessibility result
- evidence documents
- explicit non-scope
- remaining program blockers
- review checklist

- [ ] **Step 6: Invoke verification and code-review skills**

Required skills:

- `superpowers:verification-before-completion`
- `superpowers:requesting-code-review`

Expected: no completion claim is made before fresh evidence is inspected.

- [ ] **Step 7: Commit any final evidence reconciliation**

```bash
git add docs README.md .github tests scripts src package.json package-lock.json serve.py index.html
git commit -m "docs: finalize Plan 0 verification evidence"
```

Do not create an empty commit. If no file changes are required, record the verified commit SHA in the pull request body.

## Plan 0 Exit Criteria

Plan 0 can be presented for review only when:

- [x] the local server is portable
- [x] the exact dependency graph is committed
- [x] package-lock drift is checked
- [x] the current static runtime is explicitly listed
- [x] the build creates complete static output
- [x] the build integrity manifest is deterministic
- [x] the entry surface loads without page errors
- [x] the entry surface makes no third-party runtime requests
- [ ] the entry surface has no critical or serious automated accessibility violation
- [x] the README is accurate
- [x] the design, findings, risks, decisions, claims, provenance, verification, and release records are committed
- [ ] the final pull-request head has a fully green read-only workflow
- [ ] the final diff has completed verification and review

## Remaining Program Blockers After Plan 0

Plan 0 does not resolve:

- representative algorithm output fixtures
- one-document and stage state architecture
- explicit interaction-mode transitions
- unified history and checkpoints
- full upload-through-export browser coverage
- full workflow privacy coverage
- keyboard and screen-reader paths
- reduced-motion and high-zoom coverage
- supported viewport tiers
- performance and memory budgets
- browser and stylus matrix
- final font system and bundled font provenance
- license and contribution posture
- release case study

These blockers remain assigned to Plans 1 through 7 and must stay visible in the release readiness record.
