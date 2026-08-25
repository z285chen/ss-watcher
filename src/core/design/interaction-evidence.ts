import {
  SSW_DESIGN_VIEWPORTS,
  type EvidenceCapture,
  type EvidenceNode,
  type EvidenceTransition,
  type InteractionActionKind,
  type NodeRole,
} from "./evidence-package";

export function deriveEvidenceTransition(input: Readonly<{
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  viewportScope?: readonly (typeof SSW_DESIGN_VIEWPORTS)[number][];
  actionKind: InteractionActionKind;
  targetRole: NodeRole | "unknown";
  captures: readonly EvidenceCapture[];
}>): EvidenceTransition {
  const comparisons: EvidenceTransition["comparisons"][number][] = [];
  const gaps: string[] = [];
  const viewportScope = input.viewportScope ?? SSW_DESIGN_VIEWPORTS;
  for (const viewport of viewportScope) {
    const before = input.captures.find(
      (capture) => capture.stateId === input.fromStateId && capture.viewport.name === viewport,
    );
    const after = input.captures.find(
      (capture) => capture.stateId === input.toStateId && capture.viewport.name === viewport,
    );
    if (before === undefined || after === undefined) {
      gaps.push(`missing-${viewport}-before-after`);
      continue;
    }
    comparisons.push(compareCaptures(before, after));
    if (before.status !== "complete" || after.status !== "complete") {
      gaps.push(`partial-${viewport}-capture`);
    }
  }
  return {
    transitionId: input.transitionId,
    fromStateId: input.fromStateId,
    toStateId: input.toStateId,
    viewportScope: [...viewportScope],
    trigger: {
      kind: input.actionKind,
      targetRole: input.targetRole,
      confirmation: "user-confirmed",
      replay: "not-automated",
    },
    status: gaps.length === 0 ? "complete" : "partial",
    comparisons,
    gaps,
  };
}

function compareCaptures(
  before: EvidenceCapture,
  after: EvidenceCapture,
): EvidenceTransition["comparisons"][number] {
  const maximum = Math.max(before.nodes.length, after.nodes.length);
  const addedNodeCount = multisetSurplus(after.nodes, before.nodes);
  const removedNodeCount = multisetSurplus(before.nodes, after.nodes);
  let restyledNodeCount = 0;
  let movedOrResizedNodeCount = 0;
  let textLengthChangedNodeCount = 0;
  for (let index = 0; index < maximum; index += 1) {
    const left = before.nodes[index];
    const right = after.nodes[index];
    if (left === undefined || right === undefined || !sameIdentity(left, right)) continue;
    if (!sameStyle(left, right)) restyledNodeCount += 1;
    if (!sameRect(left, right)) movedOrResizedNodeCount += 1;
    if (left.textLength !== right.textLength) textLengthChangedNodeCount += 1;
  }
  return {
    viewport: before.viewport.name,
    beforeCaptureId: before.captureId,
    afterCaptureId: after.captureId,
    screenshotPairs: after.screenshotSegments.flatMap((afterSegment) => {
      const beforeSegment = before.screenshotSegments.find(
        (segment) => Math.abs(segment.scrollY - afterSegment.scrollY) <= 1,
      );
      return beforeSegment === undefined ? [] : [{
        scrollY: afterSegment.scrollY,
        beforePath: beforeSegment.path,
        afterPath: afterSegment.path,
      }];
    }),
    nodeCountDelta: after.nodes.length - before.nodes.length,
    addedNodeCount,
    removedNodeCount,
    restyledNodeCount,
    movedOrResizedNodeCount,
    textLengthChangedNodeCount,
    dialogCountDelta: roleCount(after.nodes, "dialog") - roleCount(before.nodes, "dialog"),
    navigationCountDelta: roleCount(after.nodes, "navigation") - roleCount(before.nodes, "navigation"),
    documentHeightDelta: round(after.documentHeight - before.documentHeight),
  };
}

function multisetSurplus(primary: readonly EvidenceNode[], baseline: readonly EvidenceNode[]): number {
  const primaryCounts = semanticCounts(primary);
  const baselineCounts = semanticCounts(baseline);
  let surplus = 0;
  for (const [key, count] of primaryCounts) {
    surplus += Math.max(0, count - (baselineCounts.get(key) ?? 0));
  }
  return surplus;
}

function semanticCounts(nodes: readonly EvidenceNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = `${node.tag}\u0000${node.role}\u0000${node.textPurpose}\u0000${node.textLength}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sameIdentity(left: EvidenceNode, right: EvidenceNode): boolean {
  return left.tag === right.tag && left.role === right.role &&
    left.textPurpose === right.textPurpose && left.parentNodeNumber === right.parentNodeNumber;
}

function sameStyle(left: EvidenceNode, right: EvidenceNode): boolean {
  return JSON.stringify(left.style) === JSON.stringify(right.style);
}

function sameRect(left: EvidenceNode, right: EvidenceNode): boolean {
  return Math.abs(left.rect.x - right.rect.x) <= 1 &&
    Math.abs(left.rect.y - right.rect.y) <= 1 &&
    Math.abs(left.rect.width - right.rect.width) <= 1 &&
    Math.abs(left.rect.height - right.rect.height) <= 1;
}

function roleCount(nodes: readonly EvidenceNode[], role: NodeRole): number {
  return nodes.filter((node) => node.role === role).length;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
