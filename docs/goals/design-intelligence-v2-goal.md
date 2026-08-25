# Goal: export an agent-ready single-page implementation evidence package

Version: 2

## Why

The v1 spike proves bounded computed-style collection, but it answers “which values exist” rather than “how should an agent rebuild this page.” Completion means a coding agent can consume a portable evidence package without viewing the original website.

## Completed result

- A versioned `.ssw-design` contract and strict importer.
- Guided, privacy-preserving full-page/multi-viewport capture, with optional
  user-marked screenshot groups that do not yet claim reproducible states.
- Explicit local retention and user-initiated export.
- A real TourBox package and an isolated blind rebuild that pass the three acceptance gates in `docs/design-intelligence-v2.md`.

## Facts and assumptions

- Observed: the existing spike collects bounded colors, typography, spacing, component variants, and layout nodes on real pages.
- Observed: the TourBox English home page is long and includes an automatically changing hero plus a product mega menu.
- Resolved: physical-window capture cannot cleanly reach 390px on macOS Chrome; the user separately approved a spike-only `debugger` permission for bounded viewport emulation and screenshots across all three targets.
- Unverified: the redacted graph plus screenshots is sufficient for 85–90% reconstruction. Gate 3 decides this.

## Boundaries

- May read: this spike worktree, public TourBox page state after explicit user action, and ignored local validation artifacts.
- May write: this spike worktree and `validation/.artifacts/`; the user separately authorized the explicit browser download used for the Gate 2 startup-package diagnostic.
- Must not modify: `main`, installed main-build source, credentials, external systems, or cloud storage.
- Non-goals: whole-site mapping, original brand-asset cloning, production code generation inside the extension.
- Priority on conflict: privacy and evidence integrity > correctness > completeness > speed > presentation polish.

## Tasks and dependencies

1. Gate 1: freeze v2 contract; implement strict package schema, deterministic projections, digest verification, privacy rejection, and bounded-scroll planning; independently rerun tests/build/diff checks.
2. Gate 2: only after Gate 1 passes, implement local sessions, screenshots, real three-viewport capture, guided states, dynamic masks, and the TourBox export.
3. Gate 3: only after Gate 2 passes and the Agent map is shown, dispatch the isolated blind rebuild and independently judge it.

## Approval gates

Approved: recoverable local edits in the spike; ignored validation artifacts; build/test/read-only diagnostics; explicit user-triggered public-page capture; bounded auto-scroll as specified; spike-only `debugger` permission limited to target-tab viewport emulation and screenshots with mandatory cleanup.

Requires separate approval: any further Chrome permissions or broader debugger commands; automated clicks/hover/focus/forms; external upload; real artifacts in Git; sub-agent dispatch; commit; push; merge; release; wider page/state/viewport scope.

## Agent map for Gate 3

- Integration and acceptance owner: root Agent.
- Blind builder input: `.ssw-design`, this acceptance contract, blank Vite/TypeScript/CSS project.
- Blind builder denied context: TourBox URL, source-site access, this conversation, and SS Watcher implementation internals not present in the package.
- Blind builder only write target: ignored `validation/.artifacts/<timestamp>/tourbox-blind-rebuild/`.
- Integration order: package freeze -> blind build -> root hard acceptance -> user visual acceptance.

The sub-agent is not dispatched merely because this map exists. Dispatch remains a separate approval gate.

## Validation and stop conditions

- Hard validation: strict schema and unknown-field rejection; export/import round trip; SHA-256 mismatch and unregistered-file rejection; privacy negative tests; scroll-plan bounds and restoration contract; full test suite; build; `git diff --check`.
- Intent validation: no result may claim completeness when evidence is missing; the package must organize implementation evidence rather than style counts.
- Prohibited shortcuts: viewing the source site during blind build, weakening privacy tests, changing viewports or visual band after seeing results, or treating a valid JSON file as proof of reconstruction utility.
- Same-category acceptance failure three times requires a strategy change.
- Any permission or scope expansion stops for a versioned change request.

## Progress and recovery

`docs/design-intelligence-v2-progress.md` records completed work, next action, evidence, decisions, and blockers. A resumed session reads it first and does not repeat already-proven work.
