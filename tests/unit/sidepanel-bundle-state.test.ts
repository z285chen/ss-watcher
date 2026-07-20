import { isProxy } from "vue";
import { describe, expect, it } from "vitest";

import { createProductCsvExport } from "../../src/core/export/snapshot-export";
import type { CommittedSnapshotBundle } from "../../src/core/storage/staging-store";
import { createCommittedBundleState } from "../../src/sidepanel/committed-bundle-state";

describe("Side Panel committed bundle state", () => {
  it("keeps IndexedDB values cloneable when the product and export views open", () => {
    const bundle = fixtureBundle();
    const state = createCommittedBundleState();
    state.value = bundle;

    expect(isProxy(state.value)).toBe(false);
    expect(isProxy(state.value?.products[0]?.value)).toBe(false);
    expect(() => structuredClone(state.value?.products[0]?.value)).not.toThrow();
    expect(() => createProductCsvExport(state.value!)).not.toThrow();
  });
});

function fixtureBundle(): CommittedSnapshotBundle {
  return {
    snapshot: {
      schemaVersion: 1,
      snapshotId: "snapshot-sidepanel",
      storeKey: "https://store.example",
      committed: true,
      context: { currency: "USD", priceContextVerified: true },
      coverage: {
        productsFetched: 1,
        truncated: false,
        sources: ["products-json"],
      },
    },
    products: [
      {
        schemaVersion: 1,
        snapshotId: "snapshot-sidepanel",
        productKey: "1",
        value: {
          id: "1",
          handle: "alpha",
          title: "Alpha",
          tags: ["fixture"],
          variants: [{ id: "10", price: "12.00" }],
          images: [],
          sources: ["products-json"],
        },
      },
    ],
    moduleResults: [],
  };
}
