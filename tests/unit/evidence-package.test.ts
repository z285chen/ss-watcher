import { describe, expect, it } from "vitest";

import {
  createSswDesignPackage,
  evidenceCaptureFailureReason,
  readSswDesignPackage,
  readSswDesignZip,
  sswDesignFilename,
  type CreateSswDesignPackageInput,
  type SswDesignPackageFile,
} from "../../src/core/design/evidence-package";
import { createStoredZip } from "../../src/core/export/stored-zip";
import { deriveEvidenceTransition } from "../../src/core/design/interaction-evidence";

describe(".ssw-design evidence package", () => {
  it("uses one canonical .ssw-design suffix for the ZIP container", () => {
    expect(sswDesignFilename("tourbox-home-20260812")).toBe("tourbox-home-20260812.ssw-design");
    expect(() => sswDesignFilename("tourbox.zip")).toThrow("package id");
  });
  it("round-trips deterministic projections and removes asset queries", async () => {
    const first = await createSswDesignPackage(fixture());
    const second = await createSswDesignPackage(fixture());

    expect(first.packageDigest).toBe(second.packageDigest);
    expect(first.files.map((file) => file.path)).toEqual([
      "manifest.json",
      "state-graph.json",
      "interaction-evidence.json",
      "asset-manifest.json",
      "evidence-index.json",
      "implementation-brief.md",
      "screenshots/default-desktop-00.png",
      "screenshots/default-desktop-01.png",
      "screenshots/default-desktop-02.png",
      "screenshots/default-desktop-03.png",
      "screenshots/default-desktop-04.png",
      "screenshots/default-desktop-05.png",
      "screenshots/default-desktop-06.png",
      "screenshots/default-desktop-07.png",
      "screenshots/default-tablet-00.png",
      "screenshots/default-mobile-00.png",
    ]);
    expect(first.manifest.assets[0]?.url).toBe("https://cdn.example/hero.jpg");
    expect(first.manifest.privacy).toEqual({
      visibleText: "length-and-purpose-only",
      inputValues: "excluded",
      identifiers: "excluded",
      selectors: "excluded",
      dom: "redacted-component-graph",
      assetQueries: "removed",
    });

    await expect(readSswDesignPackage(first.files)).resolves.toEqual({
      manifest: first.manifest,
      packageDigest: first.packageDigest,
    });
    const zip = createStoredZip(first.files, new Date(first.manifest.createdAt));
    await expect(readSswDesignZip(zip)).resolves.toEqual({
      manifest: first.manifest,
      packageDigest: first.packageDigest,
    });
  });

  it("keeps strict read compatibility with schema-v1 packages", async () => {
    const current = await createSswDesignPackage(fixture());
    const legacyBrief = new TextEncoder().encode(
      "# Implementation brief\n\n- Package: tourbox-home-20260812\n- Page: https://www.tourboxtech.com/en/\n- States: 1\n- Viewports observed: desktop, tablet, mobile\n- Partial captures: 0\n\nUse manifest.json as the factual source. Visible copy and original brand assets are intentionally excluded; gaps and dynamic masks are acceptance boundaries, not implementation facts.\n",
    );
    const payload = current.files
      .filter((file) => file.path !== "manifest.json" && file.path !== "interaction-evidence.json")
      .map((file) => file.path === "implementation-brief.md" ? { ...file, bytes: legacyBrief } : file);
    const descriptors = await Promise.all(payload.map(async (file) => ({
      path: file.path,
      mediaType: file.mediaType,
      byteLength: file.bytes.byteLength,
      sha256: await digest(file.bytes),
    })));
    const { transitions: _transitions, ...withoutTransitions } = current.manifest;
    const legacyManifest = { ...withoutTransitions, schemaVersion: 1, files: descriptors };
    const legacyFiles = [{
      path: "manifest.json",
      mediaType: "application/json",
      bytes: new TextEncoder().encode(`${JSON.stringify(legacyManifest)}\n`),
    }, ...payload];
    await expect(readSswDesignPackage(legacyFiles)).resolves.toMatchObject({
      manifest: { schemaVersion: 1 },
    });
  });

  it("rejects tampered, missing, and unregistered evidence files", async () => {
    const pkg = await createSswDesignPackage(fixture());
    const tampered = pkg.files.map((file) =>
      file.path === "state-graph.json"
        ? { ...file, bytes: new TextEncoder().encode('{"states":[]}\n') }
        : file,
    );
    await expect(readSswDesignPackage(tampered)).rejects.toThrow("digest mismatch");
    await expect(readSswDesignPackage(pkg.files.slice(0, -1))).rejects.toThrow(
      "missing or unregistered",
    );
    await expect(
      readSswDesignPackage([
        ...pkg.files,
        binaryFile("screenshots/unregistered.png", [9]),
      ]),
    ).rejects.toThrow("missing or unregistered");
  });

  it.each([
    ["state-graph.json", '{"states":[]}\n'],
    ["interaction-evidence.json", '{"transitions":[]}\n\n'],
    ["evidence-index.json", '{"captures":[]}\n'],
    ["implementation-brief.md", "# Attacker-controlled brief\n"],
  ])("rejects synchronized descriptor tampering of %s", async (path, content) => {
    const pkg = await createSswDesignPackage(fixture());
    const bytes = new TextEncoder().encode(content);
    const manifest = structuredClone(pkg.manifest) as unknown as {
      files: Array<{ path: string; mediaType: string; byteLength: number; sha256: string }>;
    };
    const descriptor = manifest.files.find((file) => file.path === path);
    if (descriptor === undefined) throw new Error(`${path} descriptor missing`);
    descriptor.byteLength = bytes.byteLength;
    descriptor.sha256 = await digest(bytes);
    const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest)}\n`);
    const synchronized = pkg.files.map((file) =>
      file.path === "manifest.json"
        ? { ...file, bytes: manifestBytes }
        : file.path === path
          ? { ...file, bytes }
          : file,
    );
    await expect(readSswDesignPackage(synchronized)).rejects.toThrow(
      `Deterministic projection mismatch: ${path}`,
    );
  });

  it("rejects a ZIP whose local and central headers disagree", async () => {
    const pkg = await createSswDesignPackage(fixture());
    const zip = createStoredZip(pkg.files, new Date(pkg.manifest.createdAt));
    const central = findSignature(zip, 0x02014b50);
    const mutated = zip.slice();
    mutated[central + 46] = "M".charCodeAt(0);
    await expect(readSswDesignZip(mutated)).rejects.toThrow("headers disagree");
  });

  it.each([
    ["visible text", { visibleText: "Secret product copy" }],
    ["input value", { inputValue: "person@example.com" }],
    ["class name", { className: "hero secret-token" }],
    ["DOM selector", { selector: "#checkout .email" }],
    ["element id", { id: "customer-email" }],
    ["HTML", { outerHTML: "<input value='secret'>" }],
  ])("rejects a node containing %s", async (_label, forbidden) => {
    const pkg = await createSswDesignPackage(fixture());
    const manifestFile = pkg.files[0];
    if (manifestFile === undefined) throw new Error("fixture manifest missing");
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes)) as {
      captures: Array<{ nodes: Array<Record<string, unknown>> }>;
    };
    Object.assign(manifest.captures[0]?.nodes[0] ?? {}, forbidden);
    const mutated: SswDesignPackageFile[] = [
      { ...manifestFile, bytes: new TextEncoder().encode(`${JSON.stringify(manifest)}\n`) },
      ...pkg.files.slice(1),
    ];
    await expect(readSswDesignPackage(mutated)).rejects.toThrow("schema validation");
  });

  it("rejects a package whose screenshot list does not match capture evidence", async () => {
    const input = fixture();
    await expect(
      createSswDesignPackage({ ...input, screenshots: [] }),
    ).rejects.toThrow("exactly match");
  });

  it("rejects physical PNG dimensions during both creation and strict import", async () => {
    const input = fixture();
    const wrong = pngFile("screenshots/default-tablet-00.png", 768, 900);
    await expect(createSswDesignPackage({
      ...input,
      screenshots: input.screenshots.map((file) => file.path === wrong.path ? wrong : file),
    })).rejects.toThrow("dimension mismatch");

    const pkg = await createSswDesignPackage(input);
    const manifest = structuredClone(pkg.manifest) as unknown as {
      files: Array<{ path: string; mediaType: string; byteLength: number; sha256: string }>;
    };
    const descriptor = manifest.files.find((file) => file.path === wrong.path);
    if (descriptor === undefined) throw new Error("tablet descriptor missing");
    descriptor.byteLength = wrong.bytes.byteLength;
    descriptor.sha256 = await digest(wrong.bytes);
    const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest)}\n`);
    const mutated = pkg.files.map((file) =>
      file.path === "manifest.json"
        ? { ...file, bytes: manifestBytes }
        : file.path === wrong.path
          ? wrong
          : file,
    );
    await expect(readSswDesignPackage(mutated)).rejects.toThrow("dimension mismatch");
  });

  it("rejects a complete long-page capture with screenshot coverage gaps", async () => {
    const input = fixture();
    const capture = input.captures[0];
    if (capture === undefined) throw new Error("fixture capture missing");
    await expect(createSswDesignPackage({
      ...input,
      captures: [{
        ...capture,
        screenshotSegments: [
          { path: "screenshots/default-desktop-00.png", scrollY: 0 },
          { path: "screenshots/default-desktop-07.png", scrollY: 5_902 },
        ],
      }],
      screenshots: [input.screenshots[0]!, input.screenshots[7]!],
    })).rejects.toThrow("factual input");
  });

  it("accepts root-scroll rounding up to one CSS pixel and rejects larger gaps", async () => {
    const input = fixture();
    const capture = input.captures[0];
    if (capture === undefined) throw new Error("fixture capture missing");
    await expect(createSswDesignPackage({
      ...input,
      captures: [{ ...capture, documentHeight: 6_802.5 }, ...input.captures.slice(1)],
    })).resolves.toBeDefined();
    await expect(createSswDesignPackage({
      ...input,
      captures: [{ ...capture, documentHeight: 6_803.5 }, ...input.captures.slice(1)],
    })).rejects.toThrow("factual input");
  });

  it("enforces complete iff gaps is empty", async () => {
    const input = fixture();
    const desktop = input.captures[0]!;
    expect(evidenceCaptureFailureReason({ ...desktop, gaps: ["coverage-drift"] })).toBe("capture-status-gaps");
    expect(evidenceCaptureFailureReason({ ...desktop, status: "partial" })).toBe("capture-status-gaps");
    await expect(createSswDesignPackage({
      ...input,
      captures: [{ ...desktop, gaps: ["coverage-drift"] }, ...input.captures.slice(1)],
    })).rejects.toThrow("factual input");
  });

  it("rejects incomplete, duplicate, or dangling state graphs", async () => {
    const input = fixture();
    await expect(createSswDesignPackage({
      ...input,
      captures: input.captures.filter((capture) => capture.viewport.name !== "mobile"),
      screenshots: input.screenshots.filter((file) => !file.path.includes("mobile")),
    })).rejects.toThrow("factual input");

    const interaction = {
      stateId: "interaction-1",
      kind: "interaction" as const,
      ordinal: 1,
      trigger: "user-confirmed" as const,
      enteredFromStateId: "missing-state",
      canExit: true,
      canReset: true,
    };
    await expect(createSswDesignPackage({
      ...input,
      states: [...input.states, interaction],
    })).rejects.toThrow("factual input");
  });

  it("does not let a user-marked screenshot group claim verified exit or reset behavior", async () => {
    const input = fixture();
    const interaction = {
      stateId: "interaction-1",
      kind: "interaction" as const,
      ordinal: 1,
      trigger: "user-confirmed" as const,
      enteredFromStateId: "default",
      canExit: true,
      canReset: true,
    };
    await expect(createSswDesignPackage({
      ...input,
      states: [...input.states, interaction],
    })).rejects.toThrow("factual input");
  });

  it("round-trips a strict three-viewport user-confirmed transition", async () => {
    const input = fixture();
    const interactionState = {
      stateId: "interaction-1",
      kind: "interaction" as const,
      ordinal: 1,
      trigger: "user-confirmed" as const,
      enteredFromStateId: "default",
      canExit: false,
      canReset: false,
    };
    const interactionCaptures = input.captures.map((capture) => ({
      ...capture,
      captureId: `interaction-1-${capture.viewport.name}`,
      stateId: "interaction-1",
      nodes: [...capture.nodes, {
        ...capture.nodes[0]!,
        nodeNumber: 1,
        tag: "dialog",
        role: "dialog" as const,
        rect: { x: 100, y: 100, width: 400, height: 300 },
      }],
      screenshotSegments: capture.screenshotSegments.map((segment) => ({
        ...segment,
        path: segment.path.replace("default-", "interaction-1-"),
      })),
    }));
    const captures = [...input.captures, ...interactionCaptures];
    const transition = deriveEvidenceTransition({
      transitionId: "transition-1",
      fromStateId: "default",
      toStateId: "interaction-1",
      actionKind: "toggle",
      targetRole: "button",
      captures,
    });
    const pkg = await createSswDesignPackage({
      ...input,
      states: [...input.states, interactionState],
      captures,
      transitions: [transition],
      screenshots: [
        ...input.screenshots,
        ...input.screenshots.map((file) => ({
          ...file,
          path: file.path.replace("default-", "interaction-1-"),
        })),
      ],
    });
    expect(pkg.manifest.transitions[0]).toMatchObject({
      status: "complete",
      trigger: { kind: "toggle", targetRole: "button", replay: "not-automated" },
    });
    await expect(readSswDesignPackage(pkg.files)).resolves.toMatchObject({
      manifest: { schemaVersion: 2, transitions: [{ transitionId: "transition-1" }] },
    });
  });

  it("accepts a breakpoint-specific interaction state without inventing other viewport behavior", async () => {
    const input = fixture();
    const source = input.captures.find((capture) => capture.viewport.name === "desktop")!;
    const target = {
      ...source,
      captureId: "interaction-1-desktop",
      stateId: "interaction-1",
      screenshotSegments: source.screenshotSegments.map((segment) => ({
        ...segment,
        path: segment.path.replace("default-", "interaction-1-"),
      })),
    };
    const captures = [...input.captures, target];
    const pkg = await createSswDesignPackage({
      ...input,
      states: [...input.states, {
        stateId: "interaction-1",
        kind: "interaction",
        ordinal: 1,
        trigger: "user-confirmed",
        enteredFromStateId: "default",
        canExit: false,
        canReset: false,
      }],
      captures,
      transitions: [deriveEvidenceTransition({
        transitionId: "transition-1",
        fromStateId: "default",
        toStateId: "interaction-1",
        viewportScope: ["desktop"],
        actionKind: "hover",
        targetRole: "navigation",
        captures,
      })],
      screenshots: [...input.screenshots, ...input.screenshots
        .filter((file) => file.path.includes("default-desktop"))
        .map((file) => ({ ...file, path: file.path.replace("default-", "interaction-1-") }))],
    });
    expect(pkg.manifest.transitions[0]).toMatchObject({
      viewportScope: ["desktop"],
      status: "complete",
      trigger: { kind: "hover" },
    });
  });

  it.each([
    ["unknown trigger field", (manifest: any) => { manifest.transitions[0].trigger.selector = "#menu"; }],
    ["dangling capture", (manifest: any) => { manifest.transitions[0].comparisons[0].afterCaptureId = "missing-capture"; }],
  ])("rejects %s in transition evidence", async (_label, mutate) => {
    const pkg = await createSswDesignPackage(interactionFixture());
    const manifestFile = pkg.files[0];
    if (manifestFile === undefined) throw new Error("fixture manifest missing");
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes));
    mutate(manifest);
    await expect(readSswDesignPackage([
      { ...manifestFile, bytes: new TextEncoder().encode(`${JSON.stringify(manifest)}\n`) },
      ...pkg.files.slice(1),
    ])).rejects.toThrow("schema validation");
  });
});

function interactionFixture(): CreateSswDesignPackageInput {
  const input = fixture();
  const interactionState = {
    stateId: "interaction-1",
    kind: "interaction" as const,
    ordinal: 1,
    trigger: "user-confirmed" as const,
    enteredFromStateId: "default",
    canExit: false,
    canReset: false,
  };
  const interactionCaptures = input.captures.map((capture) => ({
    ...capture,
    captureId: `interaction-1-${capture.viewport.name}`,
    stateId: "interaction-1",
    screenshotSegments: capture.screenshotSegments.map((segment) => ({
      ...segment,
      path: segment.path.replace("default-", "interaction-1-"),
    })),
  }));
  const captures = [...input.captures, ...interactionCaptures];
  return {
    ...input,
    states: [...input.states, interactionState],
    captures,
    transitions: [deriveEvidenceTransition({
      transitionId: "transition-1",
      fromStateId: "default",
      toStateId: "interaction-1",
      actionKind: "toggle",
      targetRole: "button",
      captures,
    })],
    screenshots: [
      ...input.screenshots,
      ...input.screenshots.map((file) => ({
        ...file,
        path: file.path.replace("default-", "interaction-1-"),
      })),
    ],
  };
}

function fixture(): CreateSswDesignPackageInput {
  return {
    packageId: "tourbox-home-20260812",
    createdAt: "2026-08-12T10:30:00.000Z",
    source: { origin: "https://www.tourboxtech.com", pathname: "/en/" },
    states: [
      {
        stateId: "default",
        kind: "default",
        ordinal: 0,
        trigger: "initial",
        enteredFromStateId: null,
        canExit: false,
        canReset: true,
      },
    ],
    captures: (() => {
      const desktop = {
        captureId: "default-desktop",
        stateId: "default",
        viewport: { name: "desktop", width: 1440, height: 900, devicePixelRatio: 2 },
        status: "complete",
        documentHeight: 6_802,
        screenshotSegments: [
          { path: "screenshots/default-desktop-00.png", scrollY: 0 },
          { path: "screenshots/default-desktop-01.png", scrollY: 900 },
          { path: "screenshots/default-desktop-02.png", scrollY: 1_800 },
          { path: "screenshots/default-desktop-03.png", scrollY: 2_700 },
          { path: "screenshots/default-desktop-04.png", scrollY: 3_600 },
          { path: "screenshots/default-desktop-05.png", scrollY: 4_500 },
          { path: "screenshots/default-desktop-06.png", scrollY: 5_400 },
          { path: "screenshots/default-desktop-07.png", scrollY: 5_902 },
        ],
        nodes: [
          {
            nodeNumber: 0,
            parentNodeNumber: null,
            tag: "main",
            role: "main",
            textPurpose: "none",
            textLength: 0,
            rect: { x: 0, y: 64, width: 1440, height: 6_738 },
            style: {
              display: "block",
              position: "static",
              color: "rgb(20, 20, 20)",
              backgroundColor: "rgb(255, 255, 255)",
              border: "0px none rgb(20, 20, 20)",
              borderRadius: "0px",
              boxShadow: "none",
              fontFamily: "Arial, sans-serif",
              fontSize: "16px",
              fontWeight: "400",
              lineHeight: "24px",
              letterSpacing: "normal",
              padding: "0px",
              gap: "normal",
            },
          },
        ],
        dynamicRegions: [
          {
            regionNumber: 0,
            rect: { x: 0, y: 64, width: 1440, height: 560 },
            currentItem: 2,
            itemCount: 7,
            behavior: "carousel",
            pixelPolicy: "mask-content",
          },
        ],
        gaps: [],
      } as const;
      return [
        desktop,
        {
          ...desktop,
          captureId: "default-tablet",
          viewport: { name: "tablet" as const, width: 768, height: 900, devicePixelRatio: 2 },
          documentHeight: 800,
          screenshotSegments: [{ path: "screenshots/default-tablet-00.png", scrollY: 0 }],
          dynamicRegions: [],
        },
        {
          ...desktop,
          captureId: "default-mobile",
          viewport: { name: "mobile" as const, width: 390, height: 844, devicePixelRatio: 2 },
          documentHeight: 800,
          screenshotSegments: [{ path: "screenshots/default-mobile-00.png", scrollY: 0 }],
          dynamicRegions: [],
        },
      ];
    })(),
    transitions: [],
    assets: [
      {
        assetNumber: 0,
        kind: "image",
        url: "https://cdn.example/hero.jpg?token=not-exported#frame",
        width: 1_440,
        height: 560,
        usageNodeNumbers: [0],
        acquisition: "reference-only",
      },
    ],
    screenshots: [
      pngFile("screenshots/default-desktop-00.png", 2_880, 1_800),
      ...Array.from({ length: 7 }, (_, index) =>
        pngFile(`screenshots/default-desktop-0${index + 1}.png`, 2_880, 1_800),
      ),
      pngFile("screenshots/default-tablet-00.png", 1_536, 1_800),
      pngFile("screenshots/default-mobile-00.png", 780, 1_688),
    ],
  };
}

function binaryFile(path: string, bytes: number[]): SswDesignPackageFile {
  return { path, mediaType: "image/png", bytes: Uint8Array.from(bytes) };
}

function pngFile(path: string, width: number, height: number): SswDesignPackageFile {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return { path, mediaType: "image/png", bytes };
}

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index <= bytes.byteLength - 4; index += 1) {
    if (view.getUint32(index, true) === signature) return index;
  }
  return -1;
}
