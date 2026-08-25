import { describe, expect, it } from "vitest";

import { deriveEvidenceTransition } from "../../src/core/design/interaction-evidence";
import type { EvidenceCapture, EvidenceNode } from "../../src/core/design/evidence-package";

describe("UX interaction evidence", () => {
  it("derives bounded, content-free before/after facts for all three viewports", () => {
    const captures = (["desktop", "tablet", "mobile"] as const).flatMap((viewport) => [
      capture("default", viewport, [node("button", 100, "block")]),
      capture("interaction-1", viewport, [
        node("button", 100, "block"),
        node("dialog", 240, "grid"),
      ]),
    ]);
    const transition = deriveEvidenceTransition({
      transitionId: "transition-1",
      fromStateId: "default",
      toStateId: "interaction-1",
      actionKind: "toggle",
      targetRole: "button",
      captures,
    });

    expect(transition.status).toBe("complete");
    expect(transition.gaps).toEqual([]);
    expect(transition.comparisons).toHaveLength(3);
    expect(transition.comparisons[0]).toMatchObject({
      nodeCountDelta: 1,
      addedNodeCount: 1,
      dialogCountDelta: 1,
      beforeCaptureId: "default-desktop",
      afterCaptureId: "interaction-1-desktop",
    });
    expect(JSON.stringify(transition)).not.toContain("visible copy");
  });

  it("remains explicitly partial when a viewport pair is missing", () => {
    const transition = deriveEvidenceTransition({
      transitionId: "transition-1",
      fromStateId: "default",
      toStateId: "interaction-1",
      actionKind: "activate",
      targetRole: "link",
      captures: [
        capture("default", "desktop", []),
        capture("interaction-1", "desktop", []),
      ],
    });
    expect(transition.status).toBe("partial");
    expect(transition.gaps).toEqual([
      "missing-tablet-before-after",
      "missing-mobile-before-after",
    ]);
  });
});

function capture(
  stateId: string,
  viewport: "desktop" | "tablet" | "mobile",
  nodes: readonly EvidenceNode[],
): EvidenceCapture {
  const profile = viewport === "mobile"
    ? { width: 390, height: 844 }
    : { width: viewport === "tablet" ? 768 : 1440, height: 900 };
  return {
    captureId: `${stateId}-${viewport}`,
    stateId,
    viewport: { name: viewport, ...profile, devicePixelRatio: 2 },
    status: "complete",
    documentHeight: profile.height,
    screenshotSegments: [{ path: `screenshots/${stateId}-${viewport}-00.png`, scrollY: 0 }],
    nodes,
    dynamicRegions: [],
    gaps: [],
  };
}

function node(role: EvidenceNode["role"], width: number, display: string): EvidenceNode {
  return {
    nodeNumber: role === "dialog" ? 1 : 0,
    parentNodeNumber: null,
    tag: role === "dialog" ? "dialog" : "button",
    role,
    textPurpose: role === "button" ? "action" : "none",
    textLength: 0,
    rect: { x: 0, y: 0, width, height: 40 },
    style: {
      display,
      position: "static",
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgb(255, 255, 255)",
      border: "0px none rgb(0, 0, 0)",
      borderRadius: "0px",
      boxShadow: "none",
      fontFamily: "Arial",
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "24px",
      letterSpacing: "normal",
      padding: "0px",
      gap: "normal",
    },
  };
}
