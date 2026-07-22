import { describe, expect, it } from "vitest";

import { shouldRetryActionAuthorization } from "../../src/sidepanel/action-authorization-policy";

describe("Side Panel action authorization retry policy", () => {
  it("allows an idle panel in the clicked window to inspect or renew its session", () => {
    expect(
      shouldRetryActionAuthorization({
        actionWindowId: 7,
        currentWindowId: 7,
        operationBusy: false,
      }),
    ).toBe(true);
  });

  it.each([
    { operationBusy: true, currentWindowId: 7 },
    { operationBusy: false, currentWindowId: 8 },
    { operationBusy: false, currentWindowId: undefined },
  ])("does not retry a busy or other-window session", (state) => {
    expect(
      shouldRetryActionAuthorization({
        actionWindowId: 7,
        ...state,
      }),
    ).toBe(false);
  });
});
