import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  readSswDesignPackage,
  readSswDesignZip,
  type SswDesignPackageFile,
} from "../../src/core/design/evidence-package";
import { pngDimensions } from "../../src/core/design/png-evidence";

const artifactDirectory = process.env.SSW_DESIGN_ARTIFACT_DIR;
const artifactFile = process.env.SSW_DESIGN_ARTIFACT_FILE;

describe("real .ssw-design artifact", () => {
  it.skipIf(artifactFile === undefined)(
    "passes the strict ZIP-container importer",
    async () => {
      if (artifactFile === undefined) throw new Error("artifact file missing");
      const result = await readSswDesignZip(new Uint8Array(await readFile(artifactFile)));
      expect(result.manifest.schemaVersion).toBe(2);
      if (result.manifest.schemaVersion !== 2) throw new Error("Gate 4 artifact must use schema v2");
      const manifest = result.manifest;
      const expectedCaptureCount = manifest.states.reduce((total, state) => {
        if (state.kind === "default") return total + 3;
        const transition = manifest.transitions.find((candidate) => candidate.toStateId === state.stateId);
        return total + (transition?.viewportScope.length ?? 0);
      }, 0);
      expect(manifest.captures).toHaveLength(expectedCaptureCount);
      expect(manifest.states.map((state) => state.stateId)).toEqual([
        "default",
        "interaction-1",
        "interaction-2",
      ]);
      expect(manifest.transitions).toMatchObject([
        {
          fromStateId: "default",
          toStateId: "interaction-1",
          viewportScope: ["desktop"],
          trigger: {
            kind: "toggle",
            targetRole: "navigation",
            confirmation: "user-confirmed",
            replay: "not-automated",
          },
          status: "complete",
          gaps: [],
        },
        {
          fromStateId: "default",
          toStateId: "interaction-2",
          viewportScope: ["tablet", "mobile"],
          trigger: {
            kind: "toggle",
            targetRole: "navigation",
            confirmation: "user-confirmed",
            replay: "not-automated",
          },
          status: "complete",
          gaps: [],
        },
      ]);
      for (const transition of manifest.transitions) {
        expect(transition.comparisons.map((comparison) => comparison.viewport)).toEqual(
          transition.viewportScope,
        );
      }
    },
  );
  it.skipIf(artifactDirectory === undefined)(
    "passes the strict importer and physical PNG dimension gates",
    async () => {
      if (artifactDirectory === undefined) throw new Error("artifact directory missing");
      const files = await packageFiles(artifactDirectory);
      const result = await readSswDesignPackage(files);
      expect(result.manifest.source).toEqual({
        origin: "https://www.tourboxtech.com",
        pathname: "/en",
      });
      expect(result.manifest.captures).toHaveLength(
        result.manifest.states.length * 3,
      );
      const byPath = new Map(files.map((file) => [file.path, file]));
      for (const capture of result.manifest.captures) {
        const expected = {
          width: Math.round(capture.viewport.width * capture.viewport.devicePixelRatio),
          height: Math.round(capture.viewport.height * capture.viewport.devicePixelRatio),
        };
        for (const segment of capture.screenshotSegments) {
          const file = byPath.get(segment.path);
          expect(file, segment.path).toBeDefined();
          expect(pngDimensions(file!.bytes), segment.path).toEqual(expected);
        }
      }
    },
  );
});

async function packageFiles(root: string): Promise<SswDesignPackageFile[]> {
  const paths = await walk(root);
  return await Promise.all(paths.map(async (path) => ({
    path: relative(root, path).split(sep).join("/"),
    mediaType: mediaType(path),
    bytes: new Uint8Array(await readFile(path)),
  })));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry);
    return (await stat(path)).isDirectory() ? await walk(path) : [path];
  }));
  return nested.flat().sort();
}

function mediaType(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
