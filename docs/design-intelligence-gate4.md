# Design Intelligence Gate 4 — UX Evidence

Status: passed real-pilot and isolated reconstruction acceptance on the spike branch.

## Outcome

Gate 4 upgrades a user-marked screenshot group into a user-confirmed state
transition. A coding Agent receives observable before/after evidence for the
same page and viewport without SS Watcher pretending that it replayed the
interaction.

## User workflow

1. Capture the source state at desktop, tablet, and mobile.
2. Manually perform one bounded interaction on the target page.
3. In the detached controller, select an enumerated action kind and semantic
   target role, then confirm the current state.
4. Declare the viewport scope that actually owns the behavior, then recreate
   and capture the state only in that scope. Desktop mega menus and mobile
   drawers remain separate transitions rather than being falsely merged.
5. Export only after every state and transition has complete evidence for its
   declared viewport scope.

While a prepared viewport is waiting for the user, SS Watcher disables ordinary
scan, public-source export, state switching, session clearing, and package
export. Cancellation independently attempts both debugger cleanup and scroll
restoration, so failure of one cleanup step does not skip the other.

SS Watcher does not click, hover, focus, type, submit, or navigate on behalf of
the user. The trigger record is user-confirmed and explicitly not automated.

## Package contract

Schema v2 adds `transitions` to `manifest.json` and the deterministic
`interaction-evidence.json` projection. Each transition records:

- source and target state IDs;
- a non-empty, explicit viewport scope;
- enumerated action kind and semantic target role;
- `user-confirmed` / `not-automated` provenance;
- per-viewport before/after capture IDs and aligned screenshot paths;
- bounded node-count, semantic-role, style, geometry, text-length, and document
  height deltas;
- explicit partial gaps when a viewport pair is missing.

Visible copy, input values, identifiers, selectors, HTML, and target-specific
free text remain excluded. Schema-v1 packages remain readable; new exports use
schema v2.

## Claims and non-claims

Gate 4 may claim that the observed source and target frames differ in the
recorded ways after a user-confirmed action. It may not claim deterministic
replay, exit, reset, animation timing, business logic, or hidden state unless a
future contract observes those facts separately.

## Acceptance

- Default state must have all three viewports before an interaction can be
  confirmed.
- Every interaction state has exactly one incoming transition.
- A complete transition has exactly one comparison for every declared viewport
  and no comparison outside that scope.
- Referenced captures, states, screenshot paths, and viewport slots must agree.
- Derived projections are byte-for-byte deterministic and strict import rejects
  unknown, dangling, duplicated, or tampered transition evidence.
- Full tests, build, `git diff --check`, real TourBox capture, and isolated UX
  reconstruction acceptance must pass before Gate 4 is complete.

## Isolated blind UX reconstruction contract

The Gate 4 blind builder receives only the frozen schema-v2 `.ssw-design`
package, this contract, and a blank local Vite/TypeScript/CSS project. It must
not receive the source URL, source-site access, prior Gate 3 output, the SS
Watcher repository, this conversation, or any unregistered evidence. The build
must not fetch or embed remote assets. Real evidence and rebuilt output remain
under ignored `validation/.artifacts/` and must not enter Git.

The builder implements only behavior supported by complete transitions. For
each transition and each viewport in its declared scope, the rebuilt page must:

1. render a source state whose major-section/component structure remains within
   the Gate 3 coverage and visual band;
2. expose a control with the recorded semantic target role;
3. enter the recorded target state after one local user action matching the
   recorded action kind;
4. preserve the observed responsive boundary: desktop-only transitions must
   not be invented on tablet/mobile, and tablet/mobile transitions must not be
   represented as the desktop mega-menu behavior;
5. produce the evidence-backed structural direction of change, including
   dialog/navigation presence, node add/remove direction, material
   move/resize/style changes, and document-height direction when those deltas
   are recorded; and
6. remain usable with keyboard activation when the target role is an
   interactive control.

The acceptance owner tests at exactly 1440, 768, and 390 CSS pixels using a
local server bound only to `127.0.0.1`. For every complete transition, the owner
captures the rebuilt source and target frames, checks semantic control
availability, performs the single supported entry action, and compares the
result against the package's aligned before/after evidence. A transition fails
if its control is absent, its target state cannot be entered, it appears outside
its declared viewport scope, its major structural change has the opposite
direction, or a console/runtime error occurs.

This contract does not require or permit claims for exit, reset, focus trap,
animation timing/easing, hover persistence, navigation destination, business
logic, or hidden state unless a later evidence contract observes them. A
builder may add a conventional local close/reset affordance for usability, but
that behavior is explicitly non-evidentiary and is not scored as source-site
fidelity.

Gate 4 passes only when all complete real-pilot transitions satisfy this UX
contract, Gate 3 structural coverage remains at least 90%, the agreed 85–90%
visual band is not materially regressed, strict package import succeeds, and
the root acceptance owner independently verifies the result. A static target
mockup, a test that only reads manifest fields, or a valid package without an
operable rebuilt transition is not a pass.
