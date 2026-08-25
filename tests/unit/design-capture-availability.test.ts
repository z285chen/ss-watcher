import { describe, expect, it } from "vitest";

import { canAttemptDesignCapture } from "../../src/sidepanel/design-capture-availability";

describe("design capture availability", () => {
  it("keeps a detached controller actionable when its short-lived handle expired", () => {
    expect(canAttemptDesignCapture({
      detachedCaptureMode: true,
      hasSessionHandle: false,
      operationBusy: false,
      sourceExportBusy: false,
    })).toBe(true);
  });

  it("requires an existing handle in the ordinary side panel", () => {
    expect(canAttemptDesignCapture({
      detachedCaptureMode: false,
      hasSessionHandle: false,
      operationBusy: false,
      sourceExportBusy: false,
    })).toBe(false);
  });

  it("never enables capture during another operation", () => {
    expect(canAttemptDesignCapture({
      detachedCaptureMode: true,
      hasSessionHandle: false,
      operationBusy: true,
      sourceExportBusy: false,
    })).toBe(false);
    expect(canAttemptDesignCapture({
      detachedCaptureMode: true,
      hasSessionHandle: false,
      operationBusy: false,
      sourceExportBusy: true,
    })).toBe(false);
  });
});
