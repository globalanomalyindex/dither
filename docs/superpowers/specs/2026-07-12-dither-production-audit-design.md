# DITHER Production Audit and Modernization Design

## Document status

- Status: approved
- Approved direction: serious creative tool first, inspectable portfolio artifact second
- Repository baseline: `faf52b24391cadd7b39a657918c80558df9979eb`
- Approved on: 2026-07-12
- Authoritative master specification: `DITHER_MASTER_SPEC.md`
- Master specification SHA-256: `b5ac2ea8599364d53da8150497fa1892d5f767195c5d4f67af3c21edb01ba193`
- Master specification size: 77,514 bytes
- Master specification length: 3,279 lines

This repository document is the executable design summary for implementation and review. The master specification remains the full narrative authority. This summary translates that authority into stable product, design, engineering, verification, and release requirements that can be cited from the repository.

## 1. Product posture

DITHER is a browser-based creative workshop for transforming images through dithering, grain, and direct pixel painting. It is not a novelty filter page, a generic parameter dashboard, or a visual simulation of professional software. It must behave like a serious creative instrument whose mechanisms, consequences, and limits remain legible.

The product must satisfy two audiences without splitting into two products:

1. A maker who wants to import an image, develop a visual treatment, compare states, paint directly, recover from mistakes, and export confidently.
2. A senior product design or design engineering reviewer who wants to inspect product judgment, interaction quality, systems thinking, accessibility, performance, architecture, testing, and authorship.

The working product takes priority. Portfolio credibility must emerge from the quality of the tool and the evidence surrounding it. The interface must not become a case-study exhibit that compromises repeated creative use.

## 2. Governing design authority

Every product and interface decision is evaluated in this order:

1. **Exposed Logic**
   - Make mechanisms visible enough to understand.
   - Show state, sequence, limits, dependencies, and consequences.
   - Prefer honest controls and feedback over simulated technical atmosphere.

2. **DITHER mechanics**
   - Derive form, motion, terminology, and hierarchy from real image transformation behavior.
   - Use pixel structure, threshold behavior, sampling, diffusion, grain, masking, and paint pickup as meaningful visual material.

3. **SIGNAL//BODY v2**
   - Approximately 80 percent truth and system.
   - Approximately 15 percent controlled signal.
   - Approximately 5 percent earned rupture.
   - Typography is architecture.
   - Color is semantic.
   - Grid precedes rupture.
   - Motion communicates state and causality.

4. **Current DITHER identity**
   - Dark workshop surface.
   - Disciplined typography.
   - Semantic tab signals.
   - Expressive moments tied to the canvas and transformation state.

5. **Novelty**
   - Novelty is accepted only when the first four layers remain intact.

The shell is **Standard**, controls are **Quiet**, and the canvas can become **Exhibition**.

### Rejected design behavior

The product must not rely on:

- fake HUD language
- fake telemetry
- barcodes
- pseudo-localization
- ornamental microtype
- random glyphs
- ambient scanlines
- meaningless glitch
- decorative technical density
- copied Marathon motifs
- generic SaaS card stacks
- three separately branded workspaces
- effects that do not communicate state, cause, hierarchy, or capability

## 3. Goals

### 3.1 Product goals

- Make the first successful transformation understandable without reducing expert depth.
- Preserve the large creative algorithm surface while reducing scanning cost.
- Make Dither, Grain, and Paint feel like coordinated capabilities inside one document.
- Make current state, selected stage, render state, checkpoint state, and export state unambiguous.
- Make Bake understandable and recoverable.
- Make comparison a primary creative operation rather than a hidden utility.
- Make export confidence visible before file creation.
- Support repeated editing through predictable history and persistence.

### 3.2 Design goals

- Preserve DITHER's authored workshop character.
- Build hierarchy from information and task importance rather than decoration.
- Use semantic signal color sparingly and consistently.
- Let the canvas carry the strongest expressive behavior.
- Make advanced controls discoverable through context and progressive disclosure.
- Make motion clarify transitions, render progress, selection, checkpoints, and state changes.
- Establish coherent keyboard focus, reduced motion, high zoom, and screen-reader semantics.

### 3.3 Engineering goals

- Preserve a static, client-side, local-first shipped runtime.
- Introduce a professional development toolchain without creating runtime service dependencies.
- Protect algorithm output before extracting or rewriting engine code.
- Introduce TypeScript at high-value boundaries instead of converting the entire codebase for appearance.
- Introduce modules, workers, and focused components where they reduce coupling or improve responsiveness.
- Establish deterministic fixtures, browser flows, accessibility checks, performance evidence, and reproducible release output.

### 3.4 Portfolio goals

- Make the repository understandable from a clean checkout.
- Record decisions, tradeoffs, risks, claims, provenance, and verification.
- Show real before and after evidence from tested builds.
- Explain why major changes were selected and what was intentionally preserved.
- Avoid unsupported claims about research, accessibility, privacy, performance, or production readiness.

## 4. Non-goals

- A full framework rewrite.
- Replacing every legacy file before value is proven.
- Rebuilding every algorithm.
- Making the tool mobile-first.
- Hiding expert controls to create a superficially simple interface.
- Adding cloud accounts, uploads, collaboration, or remote processing.
- Adding generated imagery as product evidence.
- Replacing meaningful text with decorative icons.
- Introducing a design system detached from DITHER's actual creative mechanisms.
- Claiming production readiness before all required release gates pass.

## 5. Target product model

### 5.1 One document

A DITHER session is one document. The document owns:

- source image metadata
- source pixel reference
- ordered creative stages
- stage parameters
- stage visibility
- selected stage
- viewport state
- checkpoints
- history position
- export preferences
- recovery metadata

Dither, Grain, and Paint are stage capabilities inside this document. They retain recognizable behavior and visual signals, but they do not maintain separate products, separate histories, or separate mental models.

### 5.2 Ordered stages

A stage is an ordered transformation or direct-edit unit. Initial stage types are:

- Dither
- Grain
- Paint

Each stage has:

- stable identifier
- stage type
- display name
- enabled state
- parameters
- optional stage-specific data
- render status
- validation state

A user can:

- add a stage
- select a stage
- reorder a stage
- enable or disable a stage
- duplicate a stage when semantics are safe
- remove a stage with history support
- inspect stage-specific controls

The stage model must not imply that Paint is a simple repeatable filter when it contains destructive pixel edits. Its state and replay strategy must be explicit.

### 5.3 Checkpoints instead of opaque Bake behavior

Bake becomes a named checkpoint operation.

A checkpoint records a meaningful document state that can be compared, named, restored, and used as a new editing base. The interface may continue to use the familiar word **Bake** as the action label, but the surrounding model must explain the consequence.

Checkpoint behavior must answer:

- What becomes committed?
- What remains editable?
- Can the previous state be restored?
- Does history remain valid?
- Which image is used as the base for later stages?
- Which state is exported?

The product must not present Bake as a mysterious destructive optimization.

### 5.4 Comparison model

Comparison is a primary canvas capability. At minimum, the user can compare:

- original source
- latest checkpoint
- current result

Supported comparison presentations may include:

- press-and-hold original
- side-by-side
- split view
- overlay or difference presentation when visually useful

The first implementation should favor the smallest set that remains fast, understandable, and accessible. Comparison controls must never obscure the image or create a separate navigation mode without a clear exit.

### 5.5 Export model

Export is a production check, not only a download button. Before export, the product exposes:

- output dimensions
- file format
- alpha behavior
- estimated or actual file size when reliable
- source of exported pixels, such as current result or checkpoint
- known limitations

PNG remains the required baseline format. Other formats require explicit support and verification rather than browser capability assumptions.

## 6. Target information architecture

### 6.1 Entry surface

The entry surface offers two honest paths:

1. Import an image.
2. Open one curated editable sample.

The sample must be project-owned or explicitly licensed and recorded in asset provenance. It must demonstrate a real creative path without pretending to be user research or output evidence.

The entry surface may retain one authored expressive moment, but it must not delay access, trap keyboard users, or create motion that cannot be reduced.

### 6.2 Workspace shell

The target workspace is organized into three stable regions:

1. **Stage rail or stage list**
   - Ordered creative stages.
   - Selection, visibility, state, and reordering.
   - Compact enough to preserve canvas space.

2. **Canvas workspace**
   - Primary image viewport.
   - Pan, zoom, fit, one-to-one, comparison, and contextual tool feedback.
   - Strongest expressive and motion behavior.

3. **Inspector**
   - Controls for the selected stage or selected tool.
   - Progressive disclosure based on current task and expertise level.
   - No unrelated parameter wall.

A compact top bar owns document actions such as import, undo, redo, checkpoint, compare, export, and reset. The top bar must distinguish global document actions from stage-local actions.

### 6.3 Progressive expert disclosure

DITHER's depth is an asset. The design reduces cognitive load by changing presentation, not by deleting capability.

Controls are disclosed through:

- stage selection
- tool selection
- grouped primary controls
- optional advanced sections
- search within large algorithm libraries
- meaningful presets
- contextual explanations located near the work

Default views prioritize controls that produce an understandable first transformation. Advanced controls remain reachable without hidden gestures.

## 7. State and command architecture

### 7.1 Document state

The target TypeScript boundary should model:

```ts
export interface DitherDocument {
  readonly id: string;
  readonly source: SourceImageDescriptor;
  readonly stages: readonly CreativeStage[];
  readonly selectedStageId: string | null;
  readonly checkpoints: readonly DocumentCheckpoint[];
  readonly exportSettings: ExportSettings;
  readonly version: number;
}
```

The exact final shape may evolve through tests, but responsibility must remain stable:

- document state describes creative intent
- viewport state describes presentation
- transient interaction state describes active gestures or tools
- render state describes processing progress and output

These categories must not be merged into one mutable global object.

### 7.2 Commands

Every meaningful user mutation should become an explicit command. Examples:

- `AddStage`
- `RemoveStage`
- `MoveStage`
- `SelectStage`
- `SetStageEnabled`
- `UpdateStageParameters`
- `BeginPaintStroke`
- `CommitPaintStroke`
- `CreateCheckpoint`
- `RestoreCheckpoint`
- `ResetDocument`
- `UpdateExportSettings`

Commands provide one place to define:

- preconditions
- state transition
- history behavior
- render invalidation
- error reporting
- analytics-free audit evidence in tests

This does not require a large command framework. The smallest typed and testable implementation is preferred.

### 7.3 Transient interaction state

Pointer capture, marquee selection, painting, panning, comparison, dialog state, and contextual prompts must have explicit lifecycle transitions.

Every mode must define:

- entry condition
- active state
- success exit
- cancel exit
- Escape behavior
- tool-switch behavior
- stage-switch behavior
- tab or document-switch behavior
- pointer cancellation behavior
- focus restoration behavior

No mode may depend on scattered boolean teardown across unrelated event listeners.

## 8. Rendering architecture

### 8.1 Protected legacy engines

The existing engine files are valuable product behavior. They remain in place until representative outputs are protected.

Before extraction:

- choose representative deterministic algorithms
- use fixed source fixtures
- fix seeds where randomness exists
- record pixel hashes or image fixtures
- record invariants for alpha, dimensions, ranges, and determinism
- record expected performance envelope

A refactor that changes output must be treated as a product decision with before and after evidence.

### 8.2 Render request boundary

The interface should submit a typed render request that contains only the data required for processing. A target shape is:

```ts
export interface RenderRequest {
  readonly requestId: string;
  readonly sourceRevision: number;
  readonly documentVersion: number;
  readonly stages: readonly RenderableStage[];
  readonly outputSize: RenderSize;
  readonly priority: "interactive" | "final";
}
```

A render result should include:

```ts
export interface RenderResult {
  readonly requestId: string;
  readonly documentVersion: number;
  readonly imageData: ImageData;
  readonly durationMs: number;
  readonly warnings: readonly RenderWarning[];
}
```

Stale results must be discarded by version or request identity. Cancellation must not rely on visual timing alone.

### 8.3 Worker strategy

Workers are introduced only where profiling shows main-thread contention. The preferred sequence is:

1. Protect output with fixtures.
2. Isolate request and result contracts.
3. Move one expensive deterministic path.
4. Compare output and timing.
5. Expand only when the boundary remains stable.

The UI must remain functional when a worker fails. Failure should produce a recoverable message and preserve the last valid canvas state.

### 8.4 Interactive rendering

The product should distinguish:

- live interaction feedback
- committed final render

The interface may preserve the previous complete image while a new render is running. It must show enough state to explain that processing is active without covering the image or creating false precision.

Performance decisions must be based on measured representative files, not animation preference.

## 9. History and persistence

### 9.1 History contract

History must cover:

- parameter changes
- stage operations
- paint strokes
- checkpoints
- reset
- selected restoration operations

History must define whether viewport changes are included. The default recommendation is to exclude pan and zoom from creative history unless user testing identifies a strong reason otherwise.

Undo and redo must restore a coherent visual and document state. A restored state must not silently rerender into a different image because of uncontrolled randomness.

### 9.2 Bounded storage

History and checkpoints can consume substantial memory. The product must define:

- maximum retained operations or memory budget
- bitmap snapshot strategy
- compression or replay strategy
- checkpoint retention policy
- behavior when the budget is reached

The user should not lose recent work without warning.

### 9.3 Persistence

Persistence is local and bounded. Candidate storage includes IndexedDB for document metadata, stage parameters, checkpoints, and recoverable source references where browser security permits.

Persistence must be:

- explicit
- recoverable
- versioned
- migratable
- clearable
- private to the browser profile

A corrupt or incompatible saved document must not prevent the product from opening.

## 10. Visual system

### 10.1 Structure

The visual system begins with layout truth:

- stable shell
- clear canvas priority
- visible stage sequence
- selected inspector context
- consistent action placement
- predictable spacing and density

Cards are used only when grouping requires a bounded object. Borders, rules, and spacing should usually carry structure before surfaces do.

### 10.2 Typography

Typography establishes hierarchy and rhythm. Required roles include:

- product identity
- global action
- stage identity
- inspector group
- control label
- value readout
- status or warning
- contextual instruction

Display typography is reserved for authored moments. Monospace is reserved for data that benefits from alignment or technical scanning. It must not be used to make ordinary copy appear technical.

The current runtime uses local and system fallback stacks after remote fonts were removed. Cross-platform layout must be tested before a final typography decision. Any bundled font requires verified redistribution rights and provenance.

### 10.3 Color

Color is semantic.

Initial semantic signals:

- Dither: orange
- Grain: pink
- Paint: cyan
- success: green
- warning: amber
- destructive or blocking error: red

Signal color should indicate selection, active processing, stage type, state, or consequence. Large decorative washes should not compete with the image.

Contrast requirements apply to text, controls, focus, status, disabled states, and canvas overlays.

### 10.4 Icons

Interface icons must be original editable SVG or come from a documented licensed source. An icon must improve one of:

- recognition
- scanning
- spatial economy
- state distinction

Text remains present when an icon alone would be ambiguous. Every icon-only control requires an accessible name and visible tooltip behavior that does not replace the accessible name.

### 10.5 Motion

Motion communicates:

- state transition
- hierarchy
- selection
- render progress
- checkpoint creation
- comparison change
- cause and effect

Motion must not be ambient decoration. Every motion system needs a reduced-motion equivalent. Reduced motion may remove spatial travel, looping, flourish, and parallax, but it must preserve state information.

## 11. Accessibility

Accessibility is a product requirement, not a final checklist.

### 11.1 Keyboard

The product must support:

- logical tab order
- visible focus
- stage selection
- inspector operation
- canvas navigation where meaningful
- modal entry and exit
- Escape cancellation
- undo and redo
- comparison controls
- export flow

Shortcuts must not fire while typing in inputs and must not conflict with platform expectations without a visible alternative.

### 11.2 Pointer and stylus

Mouse, touch, and pen behavior must define:

- pointer capture
- cancellation
- pressure
- tilt
- twist
- velocity
- hover dependency
- minimum target size

A primary workflow cannot require hover.

### 11.3 Screen reader semantics

Required semantics include:

- correct heading structure
- named controls
- actual tab semantics when a tab pattern is used
- selected and expanded state
- dialog semantics
- live processing state
- recoverable errors
- canvas alternatives that communicate purpose and current state without pretending to describe every pixel

### 11.4 Zoom and responsive behavior

The desktop workshop must remain usable at high browser zoom. Supported viewport tiers must be explicit.

The product may provide a limited narrow-screen mode instead of full editing, but it must state the limitation clearly and preserve access to source, preview, and export where feasible.

### 11.5 Automated and manual evidence

Automated tools cover only detectable issues. Required evidence combines:

- axe checks
- keyboard walkthrough
- screen-reader walkthrough
- contrast measurement
- zoom and reflow inspection
- reduced-motion inspection
- pointer and stylus scenarios

## 12. Performance and reliability

### 12.1 Representative fixtures

Performance must be measured with representative image classes:

- small opaque image
- medium photographic image
- transparent image
- large image near supported limits
- high-detail image
- low-detail gradient image
- malformed or unsupported input

### 12.2 Metrics

Track at minimum:

- import time
- first render time
- interactive parameter latency
- final render duration
- paint response
- memory growth
- checkpoint creation time
- export time
- long tasks
- cancellation success

Budgets must be documented after baseline measurements. A budget cannot be invented only to create a green test.

### 12.3 Reliability

The product must recover from:

- unsupported files
- image decode failure
- canvas allocation failure
- worker failure
- render cancellation
- stale render result
- export failure
- persistence migration failure
- storage quota failure

The last valid image should remain visible whenever possible.

## 13. Verification architecture

### 13.1 Foundation contracts

Foundation tests protect:

- portable local setup
- exact development dependencies
- committed lockfile
- static runtime membership
- build copy paths
- repository-owned configuration

### 13.2 Unit tests

Unit tests protect focused logic such as:

- document transitions
- command validation
- stage ordering
- history behavior
- checkpoint behavior
- render request creation
- stale result rejection
- export validation

### 13.3 Rendering fixtures

Rendering tests protect:

- deterministic representative algorithms
- alpha preservation
- dimensions
- expected value ranges
- fixed-seed output
- unchanged output across extraction

Fixture updates require an explicit review of visual differences.

### 13.4 Browser tests

Browser tests cover real paths:

- entry
- import
- first transformation
- parameter change
- algorithm selection
- grain stage
- paint stroke
- pickup mode
- cancel and Escape
- undo and redo
- checkpoint
- comparison
- export
- reset
- reload recovery

Browser tests should assert user-visible behavior, not implementation selectors alone.

### 13.5 Accessibility tests

Automated accessibility checks run against:

- entry surface
- loaded workspace
- representative open inspector
- dialogs
- export flow

Critical and serious violations block progression unless a documented exception is justified and manually verified.

### 13.6 Visual regression

Visual regression is applied to stable layouts and states, not stochastic canvas output unless the seed and environment are controlled.

Required stable captures may include:

- entry
- workspace shell
- selected Dither stage
- selected Grain stage
- selected Paint stage
- comparison state
- export state
- reduced-motion state
- high-zoom state

### 13.7 CI and evidence

Pull requests must expose separate gates for:

- lock drift
- type check
- lint
- formatting
- unit tests
- build
- deterministic build comparison
- browser smoke
- accessibility
- rendering fixtures when available

Build, browser, accessibility, performance, and visual evidence should be uploaded as inspectable artifacts.

## 14. Documentation and case study

### 14.1 Repository documentation

The repository must provide:

- accurate setup
- runtime and development dependency distinction
- architecture map
- test commands
- supported browsers and inputs
- known limitations
- privacy behavior
- asset provenance
- license posture
- contribution expectations
- release evidence

### 14.2 Decision evidence

Material decisions belong in the decision log. Findings, risks, claims, provenance, verification, and release state remain separate so that one document cannot silently redefine another.

### 14.3 Case study

The final case study should explain:

- original product thesis
- baseline strengths
- evidence-backed problems
- governing design principles
- alternatives considered
- product-model decision
- implementation sequence
- accessibility and performance work
- engineering boundaries
- verified outcomes
- remaining limitations

Use first-person singular for authored decisions. Use collective language only when a real collaboration occurred.

Screenshots must come from tested builds. Generated imagery may appear only as clearly labeled non-evidentiary presentation material.

## 15. Migration sequence

The program is divided into independently reviewable plans:

1. Verification foundation
2. Document and render boundaries
3. History, checkpoints, and persistence
4. Workspace and onboarding
5. Creative stages
6. Compare, Bake, and export
7. Visual, accessibility, and responsive polish
8. Hardening, case study, and release

Each plan starts from the reviewed result of the previous plan. No later plan may bypass an unresolved protection requirement from an earlier plan.

### Plan 0 exit

- portable server passes
- pinned install passes
- lock drift passes
- static build passes
- deterministic build manifest passes
- entry smoke passes
- entry third-party request test passes
- automated entry accessibility baseline is recorded
- audit and evidence records exist
- README is accurate

### Plan 1 entry condition

Plan 1 may begin only after Plan 0 is reviewed. It starts by protecting representative engine output before changing the document or render boundary.

## 16. Primary risks

- Silent algorithm output changes.
- Hidden interaction mode leaks.
- Main-thread stalls on representative images.
- Memory growth from history and checkpoints.
- Decorative redesign that reduces task legibility.
- Platform font variation after remote-font removal.
- Tests that pass selectors while real workflows fail.
- Case-study claims that exceed evidence.
- Broad changes that make review and rollback difficult.

Every risk must have a corresponding mitigation, owner plan, and verification path in the risk register.

## 17. Definition of done

DITHER is complete only when all of the following are true:

### Product

- Import through export works across the supported matrix.
- Dither, Grain, and Paint operate as coherent stages in one document.
- Checkpoints, history, comparison, and export are understandable and recoverable.
- No supported path leaves the product in a stuck or contradictory mode.

### Design

- The shell, controls, and canvas follow the approved hierarchy.
- Advanced capability remains accessible without a persistent parameter wall.
- Color, typography, motion, and icons communicate meaning.
- Expressive moments are earned by product state.

### Accessibility

- Required keyboard paths pass.
- Required screen-reader paths pass.
- Critical and serious automated violations are resolved or documented with valid manual evidence.
- Reduced motion, high zoom, and supported viewport behavior pass.
- Pointer and stylus cancellation are reliable.

### Engineering

- Protected output fixtures pass.
- Typed boundaries isolate document, commands, rendering, history, export, and persistence.
- Expensive work is moved off the main thread where measurement justifies it.
- Failure states preserve recoverability.
- Static deployment remains independent of runtime services.

### Quality and release

- Required CI gates pass.
- Performance budgets pass on representative fixtures.
- Documentation, provenance, license posture, and limitations are accurate.
- Case-study claims map to evidence.
- The release readiness document contains no required open gate.

Until these conditions are met, the repository must not describe DITHER as production-ready.
