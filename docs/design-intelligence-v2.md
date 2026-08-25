# Design Intelligence v2

Status: accepted product specification; implementation remains gated.

## Product outcome

Design Intelligence v2 produces a portable, versioned `.ssw-design` evidence package for a coding agent. The coding agent must be able to rebuild one public page at roughly 85–90% visual fidelity without revisiting the source website.

`.ssw-design` is the user-facing extension of a deterministic ZIP container; callers must not append a second `.zip` suffix.

This is not a style-count dashboard, a whole-site crawler, or an in-extension code generator. The current computed-style spike remains useful as a feasibility probe, but its aggregate presentation is not the v2 product contract.

## Scope

- One page per package.
- Three observed viewport widths: desktop 1440, tablet 768, mobile 390.
- One default state plus at most five user-marked screenshot groups. Until a
  before/after fingerprint and reproducible trigger record exist, these groups
  are not described as enterable/exitable/resettable interaction states.
- User-triggered screenshot grouping; no indiscriminate automated clicking.
- User-authorized bounded auto-scroll may scroll, wait, and capture only. It must be cancellable, restore the original scroll position, and report height, screen-count, or timeout truncation.
- Dynamic regions use a stable capture window. Their changing pixels may be masked during comparison, but container geometry, typography, controls, active item, item count, and transition behavior remain evidence.

## Privacy-preserving component graph

The package may contain semantic tags, ARIA role, parent/child relationships, ephemeral node numbers, geometry, selected computed styles, asset type and dimensions, and visible-text length/purpose.

Structured fields must not contain visible text, input values, `class`, `id`, selectors, complete DOM/HTML, credentials, authenticated state, or cross-origin response bodies. Screenshot pixels must mask probe-identified text, form controls, dynamic content, and opaque embedded surfaces; any inability to complete that masking fails closed or remains an explicit partial gap. Asset references omit query strings and fragments. Brand copy and assets are evidence references, not files to clone by default.

## Package contract

`manifest.json` is the only factual source. Other files are deterministic projections or evidence blobs:

```text
<page>.ssw-design/
├── manifest.json
├── implementation-brief.md
├── state-graph.json
├── asset-manifest.json
├── evidence-index.json
└── screenshots/
```

Every derived file is registered in the manifest with a SHA-256 digest and byte count. Import must strictly validate the schema, reject unknown fields, verify every digest, and reject unregistered files. Missing or truncated evidence remains explicit and cannot be represented as complete.

## Local retention

In-progress screenshots and states stay in local browser storage for seven days by default and can be cleared manually. A persistent `.ssw-design` package exists only after an explicit export action. No cloud upload is part of v2.

Real TourBox artifacts and blind-rebuild output live under ignored `validation/.artifacts/<timestamp>/`. Git may retain only code, schema, synthetic fixtures, automated tests, content-free metrics, and hashes.

## Pilot and acceptance

The real pilot is `https://www.tourboxtech.com/en/`. It has a long page, automatic hero carousel, mega menu, multiple content patterns, and enough responsive complexity to test the contract.

Acceptance proceeds through three gates:

1. A strict schema, deterministic export/import with digest verification, a desktop full-page capture skeleton, and negative privacy tests.
2. Real TourBox evidence at 1440/768/390, bounded scrolling, stable dynamic-region handling, the default state, and no more than five guided states.
3. An isolated coding agent receives only the package, acceptance contract, and blank Vite/TypeScript/CSS project. It must achieve at least 90% major-section/component coverage and the agreed 85–90% visual band. Entry/exit/reset behavior is tested only after a future state contract records and validates those facts; current user-marked screenshot groups do not claim them.

Gate 4 is specified separately in `design-intelligence-gate4.md`. It adds
user-confirmed before/after UX transition evidence while preserving the rule
that SS Watcher does not automate page interactions or claim unobserved replay,
exit, or reset behavior.

A gate must pass before the next begins. The same acceptance failure three times requires a strategy change. Failure to prove the approach is a valid result; lowering the standard is not.

## Permission change control

The user separately approved the `debugger` permission on the spike branch for target-tab viewport emulation and screenshots only. Metrics must be cleared and the debugger detached on success, failure, and cancellation. Any broader debugger command, further Chrome permission, automated click/hover/focus/form behavior, cloud transfer, Git storage of real site content, commit, push, merge, or release still requires new explicit approval.
