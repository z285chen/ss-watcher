# Design Intelligence v2 progress

Updated: 2026-08-13

## Current gate

Gate 4 passed real-pilot package validation and isolated UX reconstruction
acceptance. It closes the selected UX gap with user-confirmed before/after
interaction evidence, not automated replay. Gate 1–3 remains frozen. The
public preview is a single squashed change on
`codex/design-intelligence-preview`; it has not been merged into `main`.

## Completed

- Product decisions and acceptance boundaries locked.
- TourBox English home page accepted as the real pilot after read-only inspection.
- v1 Goal contract and product specification written.
- Real validation output excluded through `validation/.artifacts/`.
- Gate 1 strict `.ssw-design` contract and deterministic projections implemented.
- The exported deterministic ZIP now uses the canonical single suffix `<page>.ssw-design` rather than the ambiguous `<page>.ssw-design.zip`.
- SHA-256 round trip, tamper/missing/unregistered-file rejection, query removal, and six privacy-field negative cases passed.
- Bounded full-page capture planner implemented with scroll/wait/capture-only actions, explicit truncation, timeout, and scroll restoration contract.
- Gate 1 hard acceptance passed, including the corrected ordered screenshot-segment contract and continuous-coverage rejection.
- Seven-day isolated IndexedDB design sessions, atomic screenshot writes, TTL purge, explicit delete, and package export are implemented.
- Reopened side panels and detached controllers resume the newest unexpired session for the exact origin/path, including states and per-state viewport completion; different pages and expired sessions are not resumed.
- User-triggered 1440/768/390 capture orchestration is implemented with exact-width checks, scroll/wait/capture-only checkpoints, 650 ms screenshot throttling, and guaranteed scroll restoration.
- Active long-page capture now exposes a user cancellation action. Cancellation is routed through an `AbortSignal`, and the coordinator still restores the original scroll position before reporting the abort.
- Trailing-slash page identity is normalized without weakening origin or meaningful-path checks.
- Dynamic page-bottom drift is preserved as `partial + coverage-drift` instead of being promoted to complete or discarded.
- PNG dimensions are now required to equal `viewport × devicePixelRatio`; this prevents a layout override from masquerading as a larger visible screenshot.
- A detached extension-owned capture controller is implemented without new permissions. Its narrow sender exception requires this extension origin, `detachedCapture=1`, top-level frame, exact sender/tab URL equality, explicit target tab id, and the existing target origin/path/document checks. Ordinary side-panel sessions retain the focused-window gate.
- Real controller exercise exposed a focus-lifecycle defect: focusing the detached popup revoked its target-window session before capture. Focus cleanup now preserves only strictly established detached sessions across controller-window focus and transient `WINDOW_ID_NONE`; ordinary sessions retain the original revocation behavior, and every detached operation still revalidates target tab, active state, origin/path, and document id.
- A second real exercise proved Browser viewport overrides do not change the physical width observed by `captureVisibleTab`. The permission-free physical-resize attempt subsequently proved unsuitable because macOS Chrome clamps normal windows to a 500px content minimum, preventing a clean 390px mobile capture.
- The first post-resize real run timed out during an unbounded component-graph pass. The redacted graph now has an explicit 8-second computation deadline and reports `truncated`, which becomes `partial + component-graph-limit`; the 15-second service-worker fault gate remains intact and now names the timed-out message type.
- The bounded real desktop rerun passed at physical 1440×742 @2 DPR with 11 continuous PNG segments, 862 redacted nodes, 9 dynamic masks, complete coverage, and restored scroll position.
- Strict inspection of the first downloaded candidate rejected older resumed tablet/mobile captures: tablet declared 768×900 @1 but PNG was 1536×1800; mobile declared 390×844 @1 but PNG was 780×1688. Desktop was valid. Physical PNG checks now run in both package creation and strict import, so stale evidence cannot be exported or accepted again.
- The first physical tablet retry passed width preparation at 768px @2 DPR but one `captureVisibleTab` checkpoint exceeded the generic 15-second RPC limit. Design checkpoints now have a 30-second per-call response bound while the full capture enforces its previously declared 60-second runtime budget. If time expires after evidence exists, the result is `partial + time-limit` and scroll is restored; failure to obtain the first image still aborts.
- Screenshot-group slots are implemented for one default plus at most five user-marked groups. Every registered group must have exactly one desktop, tablet, and mobile capture before export; dangling parents, duplicate ordinals, duplicate group/viewport slots, and incomplete coverage fail schema validation. These groups no longer claim enter/exit/reset behavior until before/after fingerprints and reproducible trigger metadata exist.
- Dynamic regions are converted into screenshot-space masks and masked before persistence. PNG dimensions are rechecked after masking; a masking failure aborts capture rather than exporting unredacted pixels.
- Public HTTPS image/video references are exported as reference-only assets with query/fragment removal, observed dimensions, and redacted usage node numbers; no asset body is downloaded into the package.
- The `.ssw-design` capture workflow is now the primary UI. The previous colors/typography/spacing dashboard is explicitly labeled as a non-contract auxiliary probe and is collapsed by default.
- The user separately approved `debugger` for this spike branch. All three targets now use fixed 1440×900, 768×900, and 390×844 profiles at 2× DPR through `Emulation.setDeviceMetricsOverride`; screenshots use `Page.captureScreenshot` with beyond-viewport capture disabled. The implementation exposes no general CDP surface to the UI.
- The debugger lifecycle is fail-closed and tied to the authorized run/tab. It saves the physical scroll position before emulation, rejects cross-run capture/end calls, clears metrics and detaches on success/failure/cancel, then restores scroll after returning to the physical viewport. Navigation, tab closure, session revocation, and service-worker suspension also trigger cleanup.
- The first unified real export passed strict import and all physical PNG gates. Desktop (1440×900, 9 segments) and tablet (768×900, 17 segments) were complete. Mobile produced valid 390×844 @2 PNGs but correctly remained `partial + coverage-drift`: CDP `mobile: true` made its maximum layout scroll 160.5px shorter than the range implied by `innerHeight`. The responsive-width contract now uses `mobile: false` for 390px as well, avoiding device page-scale/UA/touch emulation.
- The second unified export again passed strict import and PNG gates. Its last mobile image visibly reached the footer/copyright and root scrollbar bottom, while the manifest still reported a 73.5px gap. Root cause: the probe used the larger `body.scrollHeight`, which included narrow-layout overflow outside the reachable root scrolling range. Capture planning now uses `document.scrollingElement.scrollHeight`; completeness allows only a 1 CSS px integer/subpixel rounding delta, while larger gaps still fail. A final mobile-only recapture remains.
- The third export proved raw root `scrollHeight` alone also overstates coverage under the extension's CDP emulation: `innerHeight` stays 844 while root `clientHeight` is larger. Read-only live Chrome verification at 390×844 measured a reachable evidence height of 7161px, matching the captured footer and maximum scroll. The canonical planning height is now `root.scrollHeight - root.clientHeight + innerHeight`, with the existing 1px rounding tolerance. A final mobile-only recapture remains.
- A subsequent mobile run still reported `coverage-drift`, satisfying the contract's three-repeat strategy-change trigger. Static initial-height inference is no longer the final completeness authority. Every screenshot checkpoint now scrolls, waits, then performs a second identity-bound metrics read immediately before the PNG; it records live document height, maximum scroll and `atBottom`. If the page grows after the initial plan, the coordinator appends overlapping tail segments within the existing 50,000px/40-screen/60-second bounds. Only the final live `atBottom` signal can declare coverage complete.
- Full hard validation after these changes: 327 tests passed, 16 configured skips (the real-artifact test is opt-in); production build and `git diff --check` passed. Manifest permissions are now `activeTab`, `debugger`, `scripting`, `storage`, and `sidePanel` on the spike branch only.
- Final real TourBox Gate 2 package passed ZIP integrity, strict importer, digest/file registration, source identity, privacy declaration, and physical PNG dimension gates. Default desktop is complete at 1440×900 @2 with 9 segments and 6780px coverage; tablet is complete at 768×900 @2 with 17 segments and 13200px coverage; mobile is complete at 390×844 @2 with 10 segments and 7220px coverage. All three have `gaps=[]`; the final mobile frame visibly contains the footer, copyright line, and root scrollbar bottom.
- Real TourBox run captured desktop/tablet/mobile metadata and exported 41 ZIP entries. ZIP integrity and privacy fields passed, but pixel inspection found desktop screenshots were 2252×1526 (1126×763 at 2× DPR), not the declared 2880×1800. Tablet 1536×1800 and mobile 780×1688 matched their declarations.
- Gate 3 blind reconstruction passed 27/27 structural coverage in all three
  viewports and the agreed visual band; the user accepted the result while
  explicitly noting that original UX behavior was not fully reproduced.
- Gate 4 schema v2 adds strict user-confirmed transitions and deterministic
  `interaction-evidence.json`; schema-v1 packages remain readable.
- Interaction captures now use a two-stage flow: SS Watcher prepares one fixed
  viewport, the user manually performs the action, and the same control then
  confirms and captures the state. No automated page interaction was added.
- Gate 4 real capture established a desktop-only `toggle -> navigation`
  transition for the Product mega menu. Its desktop target state completed with
  9 continuous screenshot segments. A separate `tablet + mobile` transition
  was established for the responsive navigation drawer so the package does not
  falsely merge two breakpoint-specific behaviors.
- Real controller use exposed an authorization-lifecycle UX defect: the local
  evidence session could resume while its short-lived target-tab handle was no
  longer present, leaving every viewport button silently disabled. Detached
  capture controls now remain actionable in that state and re-establish the
  explicitly pinned target tab on click before preparing the viewport. Ordinary
  side panels still require an existing handle, and busy/export states still
  disable capture. The regression suite now has 41 passing files and 364
  passing tests, with 3 files / 17 tests intentionally skipped; TypeScript,
  production build, and `git diff --check` pass.
- The next real tablet attempt exposed two recovery gaps. First, Chrome could
  quantize root scroll by at most one CSS pixel between the settled checkpoint
  and 2x-DPR rasterization; the previous exact-equality check rejected that
  otherwise stable frame. Post-screenshot validation now uses the same 1px
  rounding bound as scroll restoration and bottom coverage, while viewport
  width/height/DPR remain exact and document-height changes still fail closed.
  Larger scroll movement is still rejected, and failures now name the changed
  metric without exposing page content. Second, a mistaken extra confirmation
  created an empty `interaction-3`. The controller can now explicitly remove
  only the latest leaf interaction state with no captured viewport; the store
  deletes its transition atomically and preserves every earlier state and
  screenshot. Full regression after these changes is 41 passing files / 365
  passing tests, with 3 files / 17 tests intentionally skipped; production
  build and `git diff --check` pass.
- After reloading that build and explicitly removing the empty accidental
  state, the real `interaction-2` tablet navigation-drawer capture completed
  with 18 continuous 768x900 screenshot segments and no reported gap. The
  transition still declares `tablet + mobile`; mobile 390 remains the final
  real viewport before schema-v2 export.
- The real `interaction-2` mobile navigation-drawer capture subsequently
  completed with 11 continuous 390x844 screenshot segments and no reported
  gap. Gate 4 runtime evidence is now complete for the desktop-only mega menu
  (9 segments) and the separate tablet/mobile drawer (18 / 11 segments); the
  controller has enabled explicit schema-v2 export.
- The first Gate 4 schema-v2 export was structurally valid and passed the strict
  ZIP importer, deterministic projections, registered-file digests, physical
  PNG dimensions, transition scope, and empty-gap checks. It is nevertheless
  invalid as UX evidence: after export the user confirmed that the tablet frame
  was captured without manually opening the intended navigation menu. The
  package and derived blind-build input are quarantined with `INVALID.md`; the
  fresh blind builder was interrupted before acceptance. This demonstrates why
  schema-valid user-confirmed metadata cannot substitute for truthful manual
  state confirmation. Tablet and mobile target states will both be recaptured
  before a new package is frozen.
- The state editor previously displayed fields for the *next* transition as if
  they described the selected state, causing the stored `tablet + mobile`
  contract to look like `desktop` after the form reset. The UI now shows a
  separate immutable current-state contract and relabels those controls as
  “next interaction” inputs; this presentation fix does not mutate existing
  transition evidence.
- The corrected Gate 4 package was exported after the user visibly opened the
  responsive menu in both prepared viewports. Direct pixel comparison confirms
  the hamburger becomes a close control in tablet and mobile target frames;
  the mobile frame also contains the masked drawer structure. Transition-2 now
  adds 164 redacted nodes on tablet and 165 on mobile, replacing the invalid
  tablet candidate's +11-node drift. The corrected package has SHA-256
  `6e552bff09994936c0f45670d64881c92008503482aa63ceeaeee963d97f58fe`;
  its manifest digest is
  `0a7fc314885a8cb6d9407d49b40f6effed2756e68e4a4fcb909cb3fe5dff4925`.
  Strict ZIP/schema/digest/deterministic-projection/PNG-dimension checks,
  registered-file count (78), privacy key and asset-query checks, transition
  scopes, provenance, comparison cardinality, complete status and empty gaps
  all pass. A fresh context-free blind builder was run from a new isolated
  directory; the agent that saw the invalid package was not reused.
- The corrected isolated reconstruction implements the desktop-only mega-menu
  transition and the separate tablet/mobile navigation drawer from the package
  evidence. Root-owned checks at exactly 1440, 768 and 390 CSS px confirmed
  valid default states, semantic control visibility, one-action target entry,
  breakpoint isolation (including guarded programmatic misclicks), no page
  overflow, no runtime exceptions and no page-level external requests. Visual
  inspection confirmed the expected downward desktop panel and responsive
  drawer/close-control changes. No evidence package, screenshot, review cache,
  QA cache or local dependency directory remains in the blind output.
- Final regression passes: 41 test files passed / 3 skipped, 365 tests passed /
  17 skipped, TypeScript and `git diff --check` pass, and both the blind output
  and extension production distributions build successfully. The blind README
  records the precise isolation boundary: the implementation has no external
  request path, while an earlier Chrome process attempted and failed background
  updater/GCM registration, so absolute browser-process network isolation is
  not claimed.

## Next

1. Run Gate 5 on a structurally different second public site with a default
   state and two materially different interactions.
2. Review privacy, `debugger` permission, compatibility, migration, code scope,
   and release shape before any merge into `main`.

## Evidence

- Public branch: `codex/design-intelligence-preview`.
- Existing real probe: TourBox/Petlibro computed-style collection succeeded without new permissions.
- Real diagnostic export (known invalid desktop evidence; quarantined and ignored; do not use for Gate 3): `validation/.artifacts/2026-08-12-tourbox-gate2-invalid/www-tourboxtech-com-2026-08-12.ssw-design.zip`, manifest digest prefix `aa939908ff47`.
- First canonical-suffix candidate (valid desktop, invalid resumed tablet/mobile; quarantined and ignored; do not use for Gate 3): `validation/.artifacts/2026-08-12-tourbox-gate2-invalid-old-viewports/www-tourboxtech-com-2026-08-12.ssw-design`, SHA-256 `cd1412d26bc1d26665453c1e72d5c71b54f2e301bc7a9284314bdcf7ac3bdd1c`.
- First unified-debugger candidate (strictly valid but mobile partial; user-owned evidence, not valid Gate 3 input): `~/Downloads/www-tourboxtech-com-2026-08-13.ssw-design`, SHA-256 `348484afb1e17a6d69258db565343ae302e73c82b164d26ec6565b577e7686c3`.
- Second unified-debugger candidate (visibly reaches the mobile footer but remains mobile partial because of the old root-height metric; not valid Gate 3 input): `~/Downloads/www-tourboxtech-com-2026-08-13 (1).ssw-design`, SHA-256 `928bda0b4e8bfc043672572a70fbe20764f0ed08521143292701e2b2cc96652f`.
- Third unified-debugger candidate (raw root scrollHeight still overstates CDP-emulated coverage; not valid Gate 3 input): `~/Downloads/www-tourboxtech-com-2026-08-13 (2).ssw-design`, SHA-256 `fb842579b6b3d43cf7889f024be54bd015eb85c0074c12efabde5ec6f7aa8b73`.
- Frozen Gate 2 pass package (ignored local artifact; only valid Gate 3 input): `validation/.artifacts/2026-08-13-tourbox-gate2-pass/www-tourboxtech-com-2026-08-13.ssw-design`, SHA-256 `658fc9f3c42dd5b37e779b107d1510562236f53bd7a06f3c65c9e7b33d8267c8`.

## Blockers

No known code blocker. Earlier diagnostic, partial and incorrectly confirmed
packages remain invalid inputs and are quarantined; only the corrected package
is accepted for this Gate.
