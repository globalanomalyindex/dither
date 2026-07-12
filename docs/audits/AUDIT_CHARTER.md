# DITHER Production Audit Charter

## Objective

Bring DITHER to a level that can withstand review by a senior product design and design engineering lead. The finished product must be coherent as a creative tool, credible as an engineering artifact, accessible, performant, maintainable, and clearly authored.

## Product posture

DITHER is a serious browser-based creative workshop first. Its repository, documentation, demonstrations, and case study must also make the underlying design and engineering decisions easy to inspect.

The shipped product remains static, client-side, local-first, and private by default. Professional development tooling is allowed. TypeScript, ES modules, workers, and component boundaries are introduced only where they reduce risk or clarify responsibility. A framework migration requires evidence and is not a default goal.

## Review standard

Every recommendation must be tied to repository evidence, live behavior, or a reproducible test. Visual taste alone is not sufficient. A change must improve at least one of the following without silently damaging another:

- task clarity and workflow confidence
- interaction predictability and recoverability
- visual hierarchy and authored identity
- accessibility and input coverage
- runtime performance and output fidelity
- code architecture and maintainability
- testability, deployment confidence, and documentation

## Design authority

DITHER is evaluated in this order:

1. Exposed Logic: mechanisms, state, limits, and consequences remain legible.
2. DITHER mechanics: the visual language grows from actual image transformation behavior.
3. SIGNAL//BODY v2: approximately 80 percent truth and system, 15 percent controlled signal, and 5 percent earned rupture.
4. Current DITHER identity: dark workshop surface, disciplined typography, semantic tab signals, and expressive moments tied to the canvas.
5. Novelty: used only when the first four layers remain intact.

Additional anchors:

- typography is architecture
- color is semantic
- grid precedes rupture
- motion communicates state and causality
- the shell is Standard, controls are Quiet, and the canvas can become Exhibition
- generic cards, fake technical language, ornamental sci-fi density, and vibe-only effects are rejected

## Working method

1. Establish a repository and product baseline.
2. Protect current behavior with contracts and characterization tests.
3. Audit product strategy, information architecture, workflows, accessibility, visual system, motion, content, performance, rendering correctness, architecture, testing, deployment, and documentation.
4. Rank findings by severity, confidence, effort, and product leverage.
5. Implement in isolated, reviewable plans and branches.
6. Verify with automated checks, manual interaction passes, performance measurements, and visual evidence.
7. Prepare a reviewer-facing case study based on verified decisions and outcomes.

## Evidence rules

- Separate observed defects from hypotheses.
- Record the exact file, function, selector, interaction, or test case.
- Preserve before and after evidence for material visual and behavior changes.
- Do not call work complete until the relevant verification row passes.
- Keep unresolved tradeoffs visible in the decision log.
- Do not use generated imagery as product evidence.
- Record provenance for every non-original asset.
