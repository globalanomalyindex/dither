# DITHER Verification Matrix

| Area | Evidence | Baseline | Plan 0 exit criterion | Program exit criterion | Current status |
|---|---|---|---|---|---|
| Local run | Python contract and clean checkout launch | Baseline path is machine-specific | `python3 serve.py` resolves the repository from any checkout | Setup path is documented and cross-platform | Passing on branch |
| Static build | Runtime manifest, integrity manifest, and CI build | No build output contract | `npm run build` creates complete static `dist` output | Release build has deterministic asset versioning | In progress |
| Dependency reproducibility | Exact package manifest and lockfile drift check | No package files | `npm ci` succeeds from committed lock | Automated dependency review and controlled update policy | In progress |
| Entry smoke | Chromium browser test | Manual only | Entry screen loads with no page errors | Supported browsers cover primary workflows | Test committed, not yet passing |
| Privacy | Request capture in browser test | Remote Google Fonts requests | No third-party runtime request on entry | All processing and normal use remain local unless explicitly disclosed | Red by design until fixed |
| Core workflow | Upload, effect, tune, bake, paint, undo, export | Pending | Characterization path is defined | All paths pass without stale state or hidden mode leaks | Open |
| File handling | PNG, JPEG, WebP, transparency, large and malformed input | Pending | Fixture strategy is documented | Supported files succeed and unsupported cases explain recovery | Open |
| Rendering fidelity | Seeded golden images and invariants | No visible automated coverage | Fixture harness is planned and bounded | Protected outputs pass across supported browsers | Open |
| Undo and redo | State and pixel history scenarios | Pending | History risk is documented | Parameter, grain, paint, checkpoint, reset, and mode history is predictable | Open |
| Pointer input | Mouse, touch, pen, pressure, tilt, capture cancellation | Pending | Regression targets are recorded | No stuck modes, lost clicks, or inaccessible primary actions | Open |
| Keyboard | Tab order, shortcuts, Escape, focus restoration | Pending | Audit path is documented | All primary workflows are keyboard operable with visible focus | Open |
| Screen reader | Names, roles, live state, modal semantics | Pending | Automated baseline can run | Primary controls and state changes have useful programmatic meaning | Open |
| Motion | Reduced-motion behavior | Partial local checks | Unified requirement is recorded | Nonessential motion is suppressible without information loss | Open |
| Responsive layout | Desktop, laptop, narrow, and high zoom | Pending | Supported viewport policy is recorded | No essential supported control is clipped or unreachable | Open |
| Performance | Interaction latency, render timing, memory, long tasks | Pending | Measurement harness is planned | Explicit budgets pass on representative files and hardware | Open |
| Release | CI, smoke, accessibility, build, and deployment | No baseline checks | Draft PR shows repeatable required jobs | Protected release gate passes on every proposed change | In progress |
| Documentation | Setup, architecture, limits, contribution, provenance | Sparse README | Durable audit records exist | Reviewer can run, understand, test, and evaluate the product | In progress |
