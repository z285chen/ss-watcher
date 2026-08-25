import { pngDimensions } from "./png-evidence";
import { readStoredZip } from "../export/stored-zip";

export const SSW_DESIGN_SCHEMA_VERSION = 2 as const;
export const SSW_DESIGN_LEGACY_SCHEMA_VERSION = 1 as const;
export const MAX_SSW_DESIGN_STATES = 6;
export const MAX_SSW_DESIGN_NODES_PER_CAPTURE = 4_000;
export const MAX_SSW_DESIGN_ASSETS = 1_000;
export const MAX_SSW_DESIGN_FILES = 128;
export const MAX_SSW_DESIGN_FILE_BYTES = 30 * 1_024 * 1_024;

export const SSW_DESIGN_VIEWPORTS = ["desktop", "tablet", "mobile"] as const;
export const SSW_DESIGN_STATE_KINDS = ["default", "interaction"] as const;
export const SSW_DESIGN_CAPTURE_STATUSES = ["complete", "partial"] as const;
export const SSW_DESIGN_NODE_ROLES = [
  "banner", "navigation", "main", "region", "contentinfo", "complementary",
  "form", "dialog", "list", "listitem", "heading", "paragraph", "link",
  "button", "textbox", "img", "video", "presentation", "generic", "unknown",
] as const;
export const SSW_DESIGN_TEXT_PURPOSES = [
  "none", "brand", "heading", "body", "label", "action", "metadata",
] as const;
export const SSW_DESIGN_ASSET_KINDS = ["image", "video", "font", "icon"] as const;

export type ViewportName = (typeof SSW_DESIGN_VIEWPORTS)[number];
type StateKind = (typeof SSW_DESIGN_STATE_KINDS)[number];
type CaptureStatus = (typeof SSW_DESIGN_CAPTURE_STATUSES)[number];
export type NodeRole = (typeof SSW_DESIGN_NODE_ROLES)[number];
type TextPurpose = (typeof SSW_DESIGN_TEXT_PURPOSES)[number];
type AssetKind = (typeof SSW_DESIGN_ASSET_KINDS)[number];

export type EvidenceRect = Readonly<{ x: number; y: number; width: number; height: number }>;

export type EvidenceNode = Readonly<{
  nodeNumber: number;
  parentNodeNumber: number | null;
  tag: string;
  role: NodeRole;
  textPurpose: TextPurpose;
  textLength: number;
  rect: EvidenceRect;
  style: Readonly<{
    display: string;
    position: string;
    color: string;
    backgroundColor: string;
    border: string;
    borderRadius: string;
    boxShadow: string;
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    padding: string;
    gap: string;
  }>;
}>;

export type EvidenceDynamicRegion = Readonly<{
  regionNumber: number;
  rect: EvidenceRect;
  currentItem: number | null;
  itemCount: number | null;
  behavior: "carousel" | "video" | "animation" | "unknown";
  pixelPolicy: "mask-content";
}>;

export type EvidenceCapture = Readonly<{
  captureId: string;
  stateId: string;
  viewport: Readonly<{
    name: ViewportName;
    width: number;
    height: number;
    devicePixelRatio: number;
  }>;
  status: CaptureStatus;
  documentHeight: number;
  screenshotSegments: readonly Readonly<{ path: string; scrollY: number }>[];
  nodes: readonly EvidenceNode[];
  dynamicRegions: readonly EvidenceDynamicRegion[];
  gaps: readonly string[];
}>;

export type EvidenceState = Readonly<{
  stateId: string;
  kind: StateKind;
  ordinal: number;
  trigger: "initial" | "user-confirmed";
  enteredFromStateId: string | null;
  canExit: boolean;
  canReset: boolean;
}>;

export const SSW_DESIGN_INTERACTION_ACTIONS = [
  "activate", "toggle", "select", "dismiss", "navigate", "scroll", "hover", "focus", "other",
] as const;
export type InteractionActionKind = (typeof SSW_DESIGN_INTERACTION_ACTIONS)[number];

export type EvidenceTransition = Readonly<{
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  viewportScope: readonly ViewportName[];
  trigger: Readonly<{
    kind: InteractionActionKind;
    targetRole: NodeRole | "unknown";
    confirmation: "user-confirmed";
    replay: "not-automated";
  }>;
  status: CaptureStatus;
  comparisons: readonly Readonly<{
    viewport: ViewportName;
    beforeCaptureId: string;
    afterCaptureId: string;
    screenshotPairs: readonly Readonly<{
      scrollY: number;
      beforePath: string;
      afterPath: string;
    }>[];
    nodeCountDelta: number;
    addedNodeCount: number;
    removedNodeCount: number;
    restyledNodeCount: number;
    movedOrResizedNodeCount: number;
    textLengthChangedNodeCount: number;
    dialogCountDelta: number;
    navigationCountDelta: number;
    documentHeightDelta: number;
  }>[];
  gaps: readonly string[];
}>;

export type EvidenceAsset = Readonly<{
  assetNumber: number;
  kind: AssetKind;
  url: string;
  width: number | null;
  height: number | null;
  usageNodeNumbers: readonly number[];
  acquisition: "reference-only";
}>;

export type EvidenceFileDescriptor = Readonly<{
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}>;

export type SswDesignManifest = Readonly<{
  schemaVersion: typeof SSW_DESIGN_SCHEMA_VERSION;
  packageId: string;
  createdAt: string;
  source: Readonly<{ origin: string; pathname: string }>;
  privacy: Readonly<{
    visibleText: "length-and-purpose-only";
    inputValues: "excluded";
    identifiers: "excluded";
    selectors: "excluded";
    dom: "redacted-component-graph";
    assetQueries: "removed";
  }>;
  states: readonly EvidenceState[];
  captures: readonly EvidenceCapture[];
  transitions: readonly EvidenceTransition[];
  assets: readonly EvidenceAsset[];
  files: readonly EvidenceFileDescriptor[];
}>;

export type LegacySswDesignManifest = Readonly<{
  schemaVersion: typeof SSW_DESIGN_LEGACY_SCHEMA_VERSION;
  packageId: string;
  createdAt: string;
  source: Readonly<{ origin: string; pathname: string }>;
  privacy: SswDesignManifest["privacy"];
  states: readonly EvidenceState[];
  captures: readonly EvidenceCapture[];
  assets: readonly EvidenceAsset[];
  files: readonly EvidenceFileDescriptor[];
}>;

export type ReadableSswDesignManifest = SswDesignManifest | LegacySswDesignManifest;

export type SswDesignPackageFile = Readonly<{
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}>;

export type SswDesignPackage = Readonly<{
  manifest: SswDesignManifest;
  packageDigest: string;
  files: readonly SswDesignPackageFile[];
}>;

export type CreateSswDesignPackageInput = Readonly<{
  packageId: string;
  createdAt: string;
  source: Readonly<{ origin: string; pathname: string }>;
  states: readonly EvidenceState[];
  captures: readonly EvidenceCapture[];
  transitions: readonly EvidenceTransition[];
  assets: readonly EvidenceAsset[];
  screenshots: readonly SswDesignPackageFile[];
}>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function createSswDesignPackage(
  input: CreateSswDesignPackageInput,
): Promise<SswDesignPackage> {
  const normalizedAssets = input.assets.map((asset) => ({
    ...asset,
    url: normalizeAssetUrl(asset.url),
  }));
  const factual = {
    schemaVersion: SSW_DESIGN_SCHEMA_VERSION,
    packageId: input.packageId,
    createdAt: input.createdAt,
    source: input.source,
    privacy: privacyContract(),
    states: input.states,
    captures: input.captures,
    transitions: input.transitions,
    assets: normalizedAssets,
    files: [],
  } satisfies SswDesignManifest;
  if (!isSswDesignManifest(factual, { allowEmptyFiles: true })) {
    throw new Error("Invalid .ssw-design factual input");
  }

  const screenshotPaths = new Set(input.captures.flatMap((capture) => capture.screenshotSegments.map((segment) => segment.path)));
  if (
    screenshotPaths.size !== input.screenshots.length ||
    input.screenshots.some(
      (file) => !screenshotPaths.has(file.path) || file.mediaType !== "image/png",
    )
  ) {
    throw new Error("Screenshot files must exactly match capture screenshot paths");
  }
  assertScreenshotDimensions(input.captures, input.screenshots);

  const projections: SswDesignPackageFile[] = [
    jsonFile("state-graph.json", stateGraphProjection(factual.states)),
    jsonFile("interaction-evidence.json", interactionEvidenceProjection(factual.transitions)),
    jsonFile("asset-manifest.json", { assets: factual.assets }),
    jsonFile("evidence-index.json", evidenceIndexProjection(factual.captures)),
    textFile("implementation-brief.md", implementationBrief(factual)),
    ...input.screenshots.map(cloneFile),
  ];
  assertUniqueFilePaths(projections);

  const descriptors = await Promise.all(projections.map(describeFile));
  const manifest: SswDesignManifest = { ...factual, files: descriptors };
  if (!isSswDesignManifest(manifest)) throw new Error("Generated manifest is invalid");
  const manifestFile = jsonFile("manifest.json", manifest);
  const packageDigest = await sha256(manifestFile.bytes);
  return { manifest, packageDigest, files: [manifestFile, ...projections] };
}

export async function readSswDesignPackage(
  files: readonly SswDesignPackageFile[],
): Promise<Readonly<{ manifest: ReadableSswDesignManifest; packageDigest: string }>> {
  if (files.length < 2 || files.length > MAX_SSW_DESIGN_FILES) {
    throw new Error("Invalid .ssw-design file count");
  }
  assertUniqueFilePaths(files);
  const manifestFile = files.find((file) => file.path === "manifest.json");
  if (manifestFile === undefined || manifestFile.mediaType !== "application/json") {
    throw new Error("manifest.json is required");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(textDecoder.decode(manifestFile.bytes));
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }
  if (!isReadableSswDesignManifest(candidate)) throw new Error("manifest.json failed schema validation");

  const expectedPaths = new Set(["manifest.json", ...candidate.files.map((file) => file.path)]);
  if (expectedPaths.size !== files.length || files.some((file) => !expectedPaths.has(file.path))) {
    throw new Error("Package contains missing or unregistered files");
  }
  for (const descriptor of candidate.files) {
    const file = files.find((item) => item.path === descriptor.path);
    if (
      file === undefined ||
      file.mediaType !== descriptor.mediaType ||
      file.bytes.byteLength !== descriptor.byteLength ||
      (await sha256(file.bytes)) !== descriptor.sha256
    ) {
      throw new Error(`Evidence digest mismatch: ${descriptor.path}`);
    }
  }
  const deterministicProjections: readonly SswDesignPackageFile[] = [
    jsonFile("state-graph.json", stateGraphProjection(candidate.states)),
    ...(candidate.schemaVersion === SSW_DESIGN_SCHEMA_VERSION
      ? [jsonFile("interaction-evidence.json", interactionEvidenceProjection(candidate.transitions))]
      : []),
    jsonFile("evidence-index.json", evidenceIndexProjection(candidate.captures)),
    textFile("implementation-brief.md", implementationBrief(candidate)),
  ];
  for (const expected of deterministicProjections) {
    const actual = files.find((file) => file.path === expected.path);
    if (actual === undefined || actual.mediaType !== expected.mediaType || !equalBytes(actual.bytes, expected.bytes)) {
      throw new Error(`Deterministic projection mismatch: ${expected.path}`);
    }
  }
  assertScreenshotDimensions(candidate.captures, files);
  return { manifest: candidate, packageDigest: await sha256(manifestFile.bytes) };
}

/** Strict public importer for the complete .ssw-design ZIP container. */
export async function readSswDesignZip(
  bytes: Uint8Array,
): Promise<Readonly<{ manifest: ReadableSswDesignManifest; packageDigest: string }>> {
  const entries = readStoredZip(bytes, {
    maxEntries: MAX_SSW_DESIGN_FILES,
    maxEntryBytes: MAX_SSW_DESIGN_FILE_BYTES,
  });
  const files: SswDesignPackageFile[] = entries.map((entry) => ({
    path: entry.path,
    mediaType: mediaTypeForPackagePath(entry.path),
    bytes: entry.bytes,
  }));
  return await readSswDesignPackage(files);
}

export function isSswDesignManifest(
  value: unknown,
  options: Readonly<{ allowEmptyFiles?: boolean }> = {},
): value is SswDesignManifest {
  if (!recordWithKeys(value, ["schemaVersion", "packageId", "createdAt", "source", "privacy", "states", "captures", "transitions", "assets", "files"])) return false;
  if (
    value.schemaVersion !== SSW_DESIGN_SCHEMA_VERSION ||
    !safeSlug(value.packageId, 80) ||
    !isoDate(value.createdAt) ||
    !validSource(value.source) ||
    !validPrivacy(value.privacy) ||
    !Array.isArray(value.states) || value.states.length < 1 || value.states.length > MAX_SSW_DESIGN_STATES ||
    !value.states.every(validState) ||
    value.states.filter((state) => isRecord(state) && state.kind === "default").length !== 1 ||
    !Array.isArray(value.captures) || value.captures.length < 1 || value.captures.length > MAX_SSW_DESIGN_STATES * SSW_DESIGN_VIEWPORTS.length ||
    !value.captures.every(validCapture) ||
    !Array.isArray(value.transitions) || value.transitions.length > MAX_SSW_DESIGN_STATES - 1 || !value.transitions.every(validTransition) ||
    !Array.isArray(value.assets) || value.assets.length > MAX_SSW_DESIGN_ASSETS || !value.assets.every(validAsset) ||
    !Array.isArray(value.files) || value.files.length > MAX_SSW_DESIGN_FILES || !value.files.every(validDescriptor)
  ) return false;
  if (value.files.length === 0 && options.allowEmptyFiles !== true) return false;
  const states = value.states as EvidenceState[];
  const captures = value.captures as EvidenceCapture[];
  const transitions = value.transitions as EvidenceTransition[];
  const stateIds = new Set(states.map((state) => state.stateId));
  if (stateIds.size !== states.length || captures.some((capture) => !stateIds.has(capture.stateId))) return false;
  const stateOrdinals = new Set(states.map((state) => state.ordinal));
  if (
    stateOrdinals.size !== states.length ||
    states.some((_state, index) => !stateOrdinals.has(index))
  ) return false;
  const statesById = new Map(states.map((state) => [state.stateId, state]));
  if (states.some((state) => {
    if (state.kind === "default") return state.stateId !== "default";
    const parent = state.enteredFromStateId === null ? undefined : statesById.get(state.enteredFromStateId);
    return parent === undefined || parent.ordinal >= state.ordinal;
  })) return false;
  const captureIds = new Set(captures.map((capture) => capture.captureId));
  const captureSlots = new Set(captures.map((capture) => `${capture.stateId}:${capture.viewport.name}`));
  const descriptorPaths = new Set((value.files as EvidenceFileDescriptor[]).map((file) => file.path));
  if (captureIds.size !== captures.length || captureSlots.size !== captures.length || descriptorPaths.size !== value.files.length) return false;
  if (!validTransitionGraph(states, captures, transitions)) return false;
  const incoming = new Map(transitions.map((transition) => [transition.toStateId, transition]));
  return states.every((state) => {
    const required: readonly ViewportName[] = state.kind === "default"
      ? SSW_DESIGN_VIEWPORTS
      : incoming.get(state.stateId)?.viewportScope ?? [];
    return required.every((viewport) => captureSlots.has(`${state.stateId}:${viewport}`)) &&
      SSW_DESIGN_VIEWPORTS.every((viewport) => required.includes(viewport) || !captureSlots.has(`${state.stateId}:${viewport}`));
  });
}

function isReadableSswDesignManifest(value: unknown): value is ReadableSswDesignManifest {
  return isSswDesignManifest(value) || isLegacySswDesignManifest(value);
}

function isLegacySswDesignManifest(value: unknown): value is LegacySswDesignManifest {
  if (!recordWithKeys(value, ["schemaVersion", "packageId", "createdAt", "source", "privacy", "states", "captures", "assets", "files"])) return false;
  if (
    value.schemaVersion !== SSW_DESIGN_LEGACY_SCHEMA_VERSION || !safeSlug(value.packageId, 80) ||
    !isoDate(value.createdAt) || !validSource(value.source) || !validPrivacy(value.privacy) ||
    !Array.isArray(value.states) || value.states.length < 1 || value.states.length > MAX_SSW_DESIGN_STATES || !value.states.every(validState) ||
    value.states.filter((state) => isRecord(state) && state.kind === "default").length !== 1 ||
    !Array.isArray(value.captures) || value.captures.length < 1 || value.captures.length > MAX_SSW_DESIGN_STATES * SSW_DESIGN_VIEWPORTS.length || !value.captures.every(validCapture) ||
    !Array.isArray(value.assets) || value.assets.length > MAX_SSW_DESIGN_ASSETS || !value.assets.every(validAsset) ||
    !Array.isArray(value.files) || value.files.length < 1 || value.files.length > MAX_SSW_DESIGN_FILES || !value.files.every(validDescriptor)
  ) return false;
  const states = value.states as EvidenceState[];
  const captures = value.captures as EvidenceCapture[];
  const stateById = new Map(states.map((state) => [state.stateId, state]));
  if (stateById.size !== states.length || states.some((state, index) => state.ordinal !== index ||
    (state.kind === "default" ? state.stateId !== "default" :
      state.enteredFromStateId === null || (stateById.get(state.enteredFromStateId)?.ordinal ?? Infinity) >= state.ordinal))) return false;
  const captureIds = new Set(captures.map((capture) => capture.captureId));
  const captureSlots = new Set(captures.map((capture) => `${capture.stateId}:${capture.viewport.name}`));
  const descriptorPaths = new Set((value.files as EvidenceFileDescriptor[]).map((file) => file.path));
  return captureIds.size === captures.length && captureSlots.size === captures.length &&
    descriptorPaths.size === value.files.length && captures.every((capture) => stateById.has(capture.stateId)) &&
    states.every((state) => SSW_DESIGN_VIEWPORTS.every((viewport) => captureSlots.has(`${state.stateId}:${viewport}`)));
}

export function isEvidenceState(value: unknown): value is EvidenceState {
  return validState(value);
}

export function isEvidenceCapture(value: unknown): value is EvidenceCapture {
  return validCapture(value);
}

export function isEvidenceTransition(value: unknown): value is EvidenceTransition {
  return validTransition(value);
}

export function evidenceCaptureFailureReason(value: unknown): string | undefined {
  if (!isRecord(value)) return "capture-not-record";
  if (!recordWithKeys(value, ["captureId", "stateId", "viewport", "status", "documentHeight", "screenshotSegments", "nodes", "dynamicRegions", "gaps"])) return "capture-fields";
  if (!safeSlug(value.captureId, 96) || !safeSlug(value.stateId, 64)) return "capture-identity";
  if (!validViewport(value.viewport)) return "capture-viewport";
  if (!oneOf(value.status, SSW_DESIGN_CAPTURE_STATUSES) || !finite(value.documentHeight, 1, 200_000)) return "capture-bounds";
  if (!Array.isArray(value.screenshotSegments) || value.screenshotSegments.length < 1 || value.screenshotSegments.length > 40) return "capture-segment-count";
  const invalidSegment = value.screenshotSegments.findIndex((segment) => !validScreenshotSegment(segment));
  if (invalidSegment >= 0) return `capture-segment-${invalidSegment}`;
  if (new Set(value.screenshotSegments.map((segment) => isRecord(segment) ? segment.path : undefined)).size !== value.screenshotSegments.length) return "capture-segment-paths";
  const segments = value.screenshotSegments as Array<{ path: string; scrollY: number }>;
  const viewportHeight = (value.viewport as { height: number }).height;
  if (segments[0]?.scrollY !== 0) return "capture-first-scroll";
  if (segments.some((segment, index) => index > 0 && (segment.scrollY <= (segments[index - 1]?.scrollY ?? -1) || segment.scrollY - (segments[index - 1]?.scrollY ?? 0) > viewportHeight))) return "capture-scroll-continuity";
  const last = segments.at(-1);
  if (value.status === "complete" && (last === undefined || last.scrollY + viewportHeight + 1 < Number(value.documentHeight))) return "capture-incomplete-coverage";
  if (!Array.isArray(value.nodes) || value.nodes.length > MAX_SSW_DESIGN_NODES_PER_CAPTURE) return "capture-node-count";
  const invalidNode = value.nodes.findIndex((node) => !validNode(node));
  if (invalidNode >= 0) return `capture-node-${invalidNode}`;
  if (!Array.isArray(value.dynamicRegions) || value.dynamicRegions.length > 100) return "capture-dynamic-count";
  const invalidDynamic = value.dynamicRegions.findIndex((region) => !validDynamicRegion(region));
  if (invalidDynamic >= 0) return `capture-dynamic-${invalidDynamic}`;
  if (!Array.isArray(value.gaps) || value.gaps.length > 32 || value.gaps.some((gap) => !safeCode(gap, 80))) return "capture-gaps";
  if ((value.status === "complete") !== (value.gaps.length === 0)) return "capture-status-gaps";
  return undefined;
}

export function isEvidenceAsset(value: unknown): value is EvidenceAsset {
  return validAsset(value);
}

export function sswDesignFilename(packageId: string): string {
  if (!safeSlug(packageId, 80)) throw new Error("Invalid .ssw-design package id");
  return `${packageId}.ssw-design`;
}

function validState(value: unknown): value is EvidenceState {
  return recordWithKeys(value, ["stateId", "kind", "ordinal", "trigger", "enteredFromStateId", "canExit", "canReset"]) &&
    safeSlug(value.stateId, 64) && oneOf(value.kind, SSW_DESIGN_STATE_KINDS) && integer(value.ordinal, 0, 5) &&
    oneOf(value.trigger, ["initial", "user-confirmed"] as const) &&
    (value.enteredFromStateId === null || safeSlug(value.enteredFromStateId, 64)) &&
    typeof value.canExit === "boolean" && typeof value.canReset === "boolean" &&
    (value.kind === "default"
      ? value.ordinal === 0 && value.trigger === "initial" && value.enteredFromStateId === null
      : value.ordinal >= 1 && value.trigger === "user-confirmed" && value.enteredFromStateId !== null &&
        value.canExit === false && value.canReset === false);
}

function validTransition(value: unknown): value is EvidenceTransition {
  if (!recordWithKeys(value, ["transitionId", "fromStateId", "toStateId", "viewportScope", "trigger", "status", "comparisons", "gaps"]) ||
    !safeSlug(value.transitionId, 80) || !safeSlug(value.fromStateId, 64) || !safeSlug(value.toStateId, 64) ||
    value.fromStateId === value.toStateId || !Array.isArray(value.viewportScope) || value.viewportScope.length < 1 ||
    value.viewportScope.length > SSW_DESIGN_VIEWPORTS.length || !value.viewportScope.every((viewport) => oneOf(viewport, SSW_DESIGN_VIEWPORTS)) ||
    new Set(value.viewportScope).size !== value.viewportScope.length || !validTransitionTrigger(value.trigger) ||
    !oneOf(value.status, SSW_DESIGN_CAPTURE_STATUSES) || !Array.isArray(value.comparisons) ||
    value.comparisons.length > SSW_DESIGN_VIEWPORTS.length || !value.comparisons.every(validTransitionComparison) ||
    !Array.isArray(value.gaps) || value.gaps.length > 16 || !value.gaps.every((gap) => safeCode(gap, 80))) return false;
  const viewports = new Set((value.comparisons as EvidenceTransition["comparisons"]).map((comparison) => comparison.viewport));
  if (viewports.size !== value.comparisons.length) return false;
  const scope = new Set(value.viewportScope as ViewportName[]);
  if ([...viewports].some((viewport) => !scope.has(viewport))) return false;
  return value.status === "complete"
    ? value.gaps.length === 0 && viewports.size === scope.size && [...scope].every((viewport) => viewports.has(viewport))
    : value.gaps.length > 0;
}

function validTransitionTrigger(value: unknown): boolean {
  return recordWithKeys(value, ["kind", "targetRole", "confirmation", "replay"]) &&
    oneOf(value.kind, SSW_DESIGN_INTERACTION_ACTIONS) &&
    oneOf(value.targetRole, SSW_DESIGN_NODE_ROLES) &&
    value.confirmation === "user-confirmed" && value.replay === "not-automated";
}

function validTransitionComparison(value: unknown): boolean {
  const countFields = [
    "addedNodeCount", "removedNodeCount", "restyledNodeCount", "movedOrResizedNodeCount",
    "textLengthChangedNodeCount",
  ];
  const deltaFields = ["nodeCountDelta", "dialogCountDelta", "navigationCountDelta", "documentHeightDelta"];
  return recordWithKeys(value, [
    "viewport", "beforeCaptureId", "afterCaptureId", "screenshotPairs", ...deltaFields, ...countFields,
  ]) && oneOf(value.viewport, SSW_DESIGN_VIEWPORTS) && safeSlug(value.beforeCaptureId, 96) &&
    safeSlug(value.afterCaptureId, 96) && Array.isArray(value.screenshotPairs) && value.screenshotPairs.length <= 40 &&
    value.screenshotPairs.every(validScreenshotPair) && countFields.every((field) => integer(value[field], 0, MAX_SSW_DESIGN_NODES_PER_CAPTURE * 2)) &&
    deltaFields.every((field) => finite(value[field], -200_000, 200_000));
}

function validScreenshotPair(value: unknown): boolean {
  return recordWithKeys(value, ["scrollY", "beforePath", "afterPath"]) && finite(value.scrollY, 0, 200_000) &&
    safePackagePath(value.beforePath) && value.beforePath.startsWith("screenshots/") &&
    safePackagePath(value.afterPath) && value.afterPath.startsWith("screenshots/");
}

function validTransitionGraph(
  states: readonly EvidenceState[],
  captures: readonly EvidenceCapture[],
  transitions: readonly EvidenceTransition[],
): boolean {
  const stateById = new Map(states.map((state) => [state.stateId, state]));
  const captureById = new Map(captures.map((capture) => [capture.captureId, capture]));
  const transitionIds = new Set(transitions.map((transition) => transition.transitionId));
  const targetIds = new Set(transitions.map((transition) => transition.toStateId));
  if (transitionIds.size !== transitions.length || targetIds.size !== transitions.length) return false;
  if (states.filter((state) => state.kind === "interaction").length !== transitions.length) return false;
  return transitions.every((transition) => {
    const from = stateById.get(transition.fromStateId);
    const to = stateById.get(transition.toStateId);
    if (from === undefined || to?.kind !== "interaction" || to.enteredFromStateId !== from.stateId) return false;
    return transition.comparisons.every((comparison) => {
      const before = captureById.get(comparison.beforeCaptureId);
      const after = captureById.get(comparison.afterCaptureId);
      if (before?.stateId !== from.stateId || after?.stateId !== to.stateId ||
        before.viewport.name !== comparison.viewport || after.viewport.name !== comparison.viewport) return false;
      if (transition.status === "complete" && (before.status !== "complete" || after.status !== "complete")) return false;
      const beforePaths = new Set(before.screenshotSegments.map((segment) => segment.path));
      const afterPaths = new Set(after.screenshotSegments.map((segment) => segment.path));
      return comparison.screenshotPairs.every((pair) => beforePaths.has(pair.beforePath) && afterPaths.has(pair.afterPath));
    });
  });
}

function validCapture(value: unknown): value is EvidenceCapture {
  if (!(recordWithKeys(value, ["captureId", "stateId", "viewport", "status", "documentHeight", "screenshotSegments", "nodes", "dynamicRegions", "gaps"]) &&
    safeSlug(value.captureId, 96) && safeSlug(value.stateId, 64) && validViewport(value.viewport) &&
    oneOf(value.status, SSW_DESIGN_CAPTURE_STATUSES) && finite(value.documentHeight, 1, 200_000) &&
    Array.isArray(value.screenshotSegments) && value.screenshotSegments.length >= 1 && value.screenshotSegments.length <= 40 &&
    value.screenshotSegments.every(validScreenshotSegment) &&
    new Set(value.screenshotSegments.map((segment) => isRecord(segment) ? segment.path : undefined)).size === value.screenshotSegments.length &&
    Array.isArray(value.nodes) && value.nodes.length <= MAX_SSW_DESIGN_NODES_PER_CAPTURE && value.nodes.every(validNode) &&
    Array.isArray(value.dynamicRegions) && value.dynamicRegions.length <= 100 && value.dynamicRegions.every(validDynamicRegion) &&
    Array.isArray(value.gaps) && value.gaps.length <= 32 && value.gaps.every((gap) => safeCode(gap, 80)))) return false;
  const segments = value.screenshotSegments as Array<{ path: string; scrollY: number }>;
  const viewportHeight = (value.viewport as { height: number }).height;
  if (segments[0]?.scrollY !== 0 || segments.some((segment, index) => index > 0 && (segment.scrollY <= (segments[index - 1]?.scrollY ?? -1) || segment.scrollY - (segments[index - 1]?.scrollY ?? 0) > viewportHeight))) return false;
  const last = segments.at(-1);
  return (value.status === "complete") === (value.gaps.length === 0) &&
    (value.status !== "complete" || (last !== undefined && last.scrollY + viewportHeight + 1 >= Number(value.documentHeight)));
}

function validScreenshotSegment(value: unknown): boolean {
  return recordWithKeys(value, ["path", "scrollY"]) && safePackagePath(value.path) && value.path.startsWith("screenshots/") && finite(value.scrollY, 0, 200_000);
}

function validViewport(value: unknown): boolean {
  return recordWithKeys(value, ["name", "width", "height", "devicePixelRatio"]) &&
    oneOf(value.name, SSW_DESIGN_VIEWPORTS) && integer(value.width, 240, 4_000) && integer(value.height, 240, 4_000) && finite(value.devicePixelRatio, 0.5, 8);
}

function validNode(value: unknown): value is EvidenceNode {
  return recordWithKeys(value, ["nodeNumber", "parentNodeNumber", "tag", "role", "textPurpose", "textLength", "rect", "style"]) &&
    integer(value.nodeNumber, 0, MAX_SSW_DESIGN_NODES_PER_CAPTURE - 1) &&
    (value.parentNodeNumber === null || integer(value.parentNodeNumber, 0, MAX_SSW_DESIGN_NODES_PER_CAPTURE - 1)) &&
    safeTag(value.tag) && oneOf(value.role, SSW_DESIGN_NODE_ROLES) && oneOf(value.textPurpose, SSW_DESIGN_TEXT_PURPOSES) &&
    integer(value.textLength, 0, 100_000) && validRect(value.rect) && validStyle(value.style);
}

function validStyle(value: unknown): boolean {
  const keys = ["display", "position", "color", "backgroundColor", "border", "borderRadius", "boxShadow", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "padding", "gap"];
  return recordWithKeys(value, keys) && keys.every((key) => safeStyle(value[key], 160));
}

function validDynamicRegion(value: unknown): value is EvidenceDynamicRegion {
  return recordWithKeys(value, ["regionNumber", "rect", "currentItem", "itemCount", "behavior", "pixelPolicy"]) &&
    integer(value.regionNumber, 0, 99) && validRect(value.rect) &&
    (value.currentItem === null || integer(value.currentItem, 1, 10_000)) &&
    (value.itemCount === null || integer(value.itemCount, 1, 10_000)) &&
    oneOf(value.behavior, ["carousel", "video", "animation", "unknown"] as const) && value.pixelPolicy === "mask-content";
}

function validAsset(value: unknown): value is EvidenceAsset {
  return recordWithKeys(value, ["assetNumber", "kind", "url", "width", "height", "usageNodeNumbers", "acquisition"]) &&
    integer(value.assetNumber, 0, MAX_SSW_DESIGN_ASSETS - 1) && oneOf(value.kind, SSW_DESIGN_ASSET_KINDS) &&
    validSanitizedAssetUrl(value.url) && (value.width === null || integer(value.width, 0, 100_000)) &&
    (value.height === null || integer(value.height, 0, 100_000)) && Array.isArray(value.usageNodeNumbers) &&
    value.usageNodeNumbers.length <= 100 && value.usageNodeNumbers.every((item) => integer(item, 0, MAX_SSW_DESIGN_NODES_PER_CAPTURE - 1)) &&
    value.acquisition === "reference-only";
}

function validDescriptor(value: unknown): value is EvidenceFileDescriptor {
  return recordWithKeys(value, ["path", "mediaType", "byteLength", "sha256"]) && safePackagePath(value.path) &&
    value.path !== "manifest.json" && safeCode(value.mediaType, 80) && integer(value.byteLength, 0, MAX_SSW_DESIGN_FILE_BYTES) &&
    typeof value.sha256 === "string" && /^[a-f0-9]{64}$/u.test(value.sha256);
}

function validSource(value: unknown): boolean {
  if (!recordWithKeys(value, ["origin", "pathname"]) || typeof value.origin !== "string" || typeof value.pathname !== "string") return false;
  try {
    const url = new URL(value.origin);
    return url.protocol === "https:" && url.origin === value.origin && value.pathname.startsWith("/") && !value.pathname.includes("?") && !value.pathname.includes("#");
  } catch { return false; }
}

function validPrivacy(value: unknown): boolean {
  return recordWithKeys(value, ["visibleText", "inputValues", "identifiers", "selectors", "dom", "assetQueries"]) &&
    value.visibleText === "length-and-purpose-only" && value.inputValues === "excluded" && value.identifiers === "excluded" &&
    value.selectors === "excluded" && value.dom === "redacted-component-graph" && value.assetQueries === "removed";
}

function privacyContract(): SswDesignManifest["privacy"] {
  return { visibleText: "length-and-purpose-only", inputValues: "excluded", identifiers: "excluded", selectors: "excluded", dom: "redacted-component-graph", assetQueries: "removed" };
}

function normalizeAssetUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only public HTTPS asset references are allowed");
  url.username = ""; url.password = ""; url.search = ""; url.hash = "";
  return url.toString();
}

function validSanitizedAssetUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.username === "" && url.password === "" && url.search === "" && url.hash === ""; } catch { return false; }
}

function stateGraphProjection(states: readonly EvidenceState[]): unknown {
  return { states: states.map((state) => ({ stateId: state.stateId, kind: state.kind, ordinal: state.ordinal, trigger: state.trigger, enteredFromStateId: state.enteredFromStateId, canExit: state.canExit, canReset: state.canReset })) };
}

function interactionEvidenceProjection(transitions: readonly EvidenceTransition[]): unknown {
  return { transitions };
}

function evidenceIndexProjection(captures: readonly EvidenceCapture[]): unknown {
  return { captures: captures.map((capture) => ({ captureId: capture.captureId, stateId: capture.stateId, viewport: capture.viewport.name, status: capture.status, screenshotSegments: capture.screenshotSegments, nodeCount: capture.nodes.length, dynamicRegionCount: capture.dynamicRegions.length, gaps: capture.gaps })) };
}

function implementationBrief(manifest: ReadableSswDesignManifest | Omit<SswDesignManifest, "files"> & { files: readonly EvidenceFileDescriptor[] }): string {
  const viewportNames = [...new Set(manifest.captures.map((capture) => capture.viewport.name))].join(", ");
  const partial = manifest.captures.filter((capture) => capture.status === "partial").length;
  const transitionLine = "transitions" in manifest
    ? `- User-confirmed transitions: ${manifest.transitions.length}\n`
    : "";
  return `# Implementation brief\n\n- Package: ${manifest.packageId}\n- Page: ${manifest.source.origin}${manifest.source.pathname}\n- States: ${manifest.states.length}\n${transitionLine}- Viewports observed: ${viewportNames}\n- Partial captures: ${partial}\n\nUse manifest.json as the factual source. Visible copy and original brand assets are intentionally excluded; gaps and dynamic masks are acceptance boundaries, not implementation facts.\n`;
}

function assertScreenshotDimensions(
  captures: readonly EvidenceCapture[],
  files: readonly SswDesignPackageFile[],
): void {
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const capture of captures) {
    const expectedWidth = Math.round(capture.viewport.width * capture.viewport.devicePixelRatio);
    const expectedHeight = Math.round(capture.viewport.height * capture.viewport.devicePixelRatio);
    for (const segment of capture.screenshotSegments) {
      const file = byPath.get(segment.path);
      if (file === undefined || file.mediaType !== "image/png") {
        throw new Error(`Evidence PNG is missing: ${segment.path}`);
      }
      let dimensions: Readonly<{ width: number; height: number }>;
      try {
        dimensions = pngDimensions(file.bytes);
      } catch {
        throw new Error(`Evidence PNG header is invalid: ${segment.path}`);
      }
      if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
        throw new Error(
          `Evidence PNG dimension mismatch: ${segment.path} is ${dimensions.width}x${dimensions.height}, expected ${expectedWidth}x${expectedHeight}`,
        );
      }
    }
  }
}

function jsonFile(path: string, value: unknown): SswDesignPackageFile { return textFile(path, `${stableJson(value)}\n`, "application/json"); }
function textFile(path: string, content: string, mediaType = "text/markdown"): SswDesignPackageFile { return { path, mediaType, bytes: textEncoder.encode(content) }; }
function cloneFile(file: SswDesignPackageFile): SswDesignPackageFile { return { path: file.path, mediaType: file.mediaType, bytes: new Uint8Array(file.bytes) }; }
async function describeFile(file: SswDesignPackageFile): Promise<EvidenceFileDescriptor> { if (!safePackagePath(file.path) || file.bytes.byteLength > MAX_SSW_DESIGN_FILE_BYTES) throw new Error(`Invalid package file: ${file.path}`); return { path: file.path, mediaType: file.mediaType, byteLength: file.bytes.byteLength, sha256: await sha256(file.bytes) }; }
async function sha256(bytes: Uint8Array): Promise<string> { const input = Uint8Array.from(bytes); const digest = await crypto.subtle.digest("SHA-256", input); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function stableJson(value: unknown): string { return JSON.stringify(sortJson(value), null, 2); }
function sortJson(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortJson); if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])])); return value; }
function assertUniqueFilePaths(files: readonly Readonly<{ path: string }>[]): void { if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("Package file paths must be unique"); }
function mediaTypeForPackagePath(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
function equalBytes(left: Uint8Array, right: Uint8Array): boolean { return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]); }
function safePackagePath(value: unknown): value is string { return typeof value === "string" && value.length <= 180 && /^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*$/u.test(value) && !value.includes(".."); }
function safeSlug(value: unknown, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max && /^[a-z0-9][a-z0-9_-]*$/u.test(value); }
function safeCode(value: unknown, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max && /^[a-zA-Z0-9][a-zA-Z0-9+./;=_ -]*$/u.test(value); }
function safeTag(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/u.test(value); }
function safeStyle(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max && !/[<>\n\r]/u.test(value) && !/url\s*\(/iu.test(value); }
function isoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function integer(value: unknown, min: number, max: number): value is number { return Number.isInteger(value) && Number(value) >= min && Number(value) <= max; }
function finite(value: unknown, min: number, max: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function validRect(value: unknown): value is EvidenceRect { return recordWithKeys(value, ["x", "y", "width", "height"]) && finite(value.x, -200_000, 200_000) && finite(value.y, -200_000, 200_000) && finite(value.width, 0, 200_000) && finite(value.height, 0, 200_000); }
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T { return typeof value === "string" && (values as readonly string[]).includes(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function recordWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)); }
