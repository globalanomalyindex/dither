# DITHER Verification Matrix

| Area | Evidence | Baseline | Plan 0 exit criterion | Program exit criterion | Current status |
|---|---|---|---|---|---|
| Local run | Python contract and clean checkout launch | Baseline path is machine-specific | `python3 serve.py` resolves the repository from any checkout | Setup path is documented and cross-platform | Passing on branch |
| Static build | Runtime manifest, integrity manifest, and CI build | No build output contract | `npm run build` creates complete static `dist` output | Release build has deterministic asset versioning | Passing on branch |
| Dependency reproducibility | Exact package manifest and lockfile drift check | No package files | `npm ci` succeeds from committed lock | Automated dependency review and controlled update policy | Passing on branch |
| Entry smoke | Chromium browser test | Manual only | Entry screen loads with no page errors | Supported browsers cover primary workflows | Passing on branch |
| Privacy | Request capture in browser test | Remote Google Fonts requests | No third-party runtime request on entry | All processing and normal use remain local unless explicitly disclosed | Entry passing; full workflow verification remains open |
| Entry accessibility | Axe WCAG 2A, 2AA, 2.1A, and 2.1AA scan plus direct tab regression | Critical `aria-required-children` failure on the creative mode tablist | No critical or serious automated violation; complete tab roles, selected state, controlled panels, and keyboard movement | Automated and manual checks pass throughout loaded workspace and dialogs | Passing on branch |
| Core workflow | Upload, effect, tune, bake, paint, undo, export | Pending | Characterization path is defined | All paths pass without stale state or hidden mode leaks | Open |
| File handling | PNG, JPEG, WebP, transparency, large and malformed input | Pending | Fixture strategy is documented | Supported files succeed and unsupported cases explain recovery | Open |
| Rendering fidelity | Seeded golden images and invariants | No visible automated coverage | Fixture harness is planned and bounded | Protected outputs pass across supported browsers | Open |
| Undo and redo | State and pixel history scenarios | Pending | History risk is documented | Parameter, grain, paint, checkpoint, reset, and mode history is predictable | Open |
| Pointer input | Mouse, touch, pen, pressure, tilt, capture cancellation | Pending | Regression targets are recorded | No stuck modes, lost clicks, or inaccessible primary actions | Open |
| Keyboard | Direct tab roles, roving focus, arrow keys, Home, and End; later full walkthrough | Creative mode had no complete keyboard tab contract | Entry creative-mode navigation passes | All primary workflows are keyboard operable with visible focus | Entry passing; full product remains open |
| Screen reader | Roles, names, selected state, controlled panels, live state, and dialog semantics | Creative-mode controls lacked required tab semantics | Entry tablist and tabpanel relationships pass automated checks | Primary controls and state changes have useful programmatic meaning across the loaded product | Entry passing; loaded workspace remains open |
| Motion | Reduced-motion behavior | Partial local checks | Unified requirement is recorded | Nonessential motion is suppressible without information loss | Open |
| Responsive layout | Desktop, laptop, narrow, and high zoom | Pending | Supported viewport policy is recorded | No essential supported control is clipped or unreachable | Open |
| Performance | Interaction latency, render timing, memory, long tasks | Pending | Measurement harness is planned | Explicit budgets pass on representative files and hardware | Open |
| Release | CI, smoke, accessibility, build, and deployment | No baseline checks | Draft PR shows repeatable required jobs | Protected release gate passes on every proposed change | Plan 0 pipeline established; full release gate remains open |
| Documentation | Setup, architecture, limits, contribution, provenance | Sparse README | Durable audit records exist | Reviewer can run, understand, test, and evaluate the product | Plan 0 passing; program documentation continues |
