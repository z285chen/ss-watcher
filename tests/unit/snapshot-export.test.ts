import { describe, expect, it } from "vitest";

import {
  createFullJsonExport,
  createProductCsvExport,
  parseProductCsvProducts,
  protectFormula,
} from "../../src/core/export/snapshot-export";
import type { CommittedSnapshotBundle } from "../../src/core/storage/staging-store";

describe("M2 snapshot exports", () => {
  it.each(["=SUM(A1:A2)", "+cmd", "-1+2", "@payload", "\tformula", "\rformula"])(
    "prefixes a dangerous CSV cell: %j",
    (value) => {
      expect(protectFormula(value)).toBe(`'${value}`);
    },
  );

  it("writes RFC 4180 CSV, defends visible fields and round-trips raw products", () => {
    const bundle = fixtureBundle();
    const exported = createProductCsvExport(bundle, {
      generatedAt: "2026-07-20T00:00:00.000Z",
    });

    expect(exported.csv).toContain("'=SUM(A1:A2)");
    expect(exported.csv).toContain("'+Vendor");
    expect(exported.csv).toContain("'-tag");
    expect(exported.csv).toContain('"Line 1\n""quoted"",Line 2"');
    expect(exported.csv).toContain("15.00,true,https://cdn.example/image.jpg");
    expect(exported.sanitizedCellCount).toBeGreaterThanOrEqual(3);
    expect(exported.meta).toMatchObject({
      schemaVersion: 1,
      rowCount: 1,
      fieldsSanitized: true,
      csvFormulaDefense: "apostrophe-prefix",
      truncated: false,
    });
    expect(parseProductCsvProducts(exported.csv)).toEqual([
      bundle.products[0]?.value,
    ]);
  });

  it("distinguishes enabled formula defense from actual sanitation", () => {
    const bundle = fixtureBundle();
    Object.assign(bundle.products[0]!.value, {
      title: "Safe product",
      vendor: "Safe vendor",
      productType: "Safe type",
      tags: ["safe-tag"],
    });
    const exported = createProductCsvExport(bundle, {
      generatedAt: "2026-07-20T00:00:00.000Z",
    });

    expect(exported.sanitizedCellCount).toBe(0);
    expect(exported.meta.fieldsSanitized).toBe(false);
    expect(exported.meta.csvFormulaDefense).toBe("apostrophe-prefix");
  });

  it("preserves malicious-looking and >=32 KB values in JSON without sanitation", () => {
    const bundle = fixtureBundle();
    const long = `@${"x".repeat(32 * 1024)}`;
    bundle.products[0]!.value.title = long;
    const exported = createFullJsonExport(
      bundle,
      "2026-07-20T00:00:00.000Z",
    );
    expect(exported.value.meta.fieldsSanitized).toBe(false);
    expect(exported.value.products[0]?.value.title).toBe(long);
    expect(JSON.parse(exported.json).products[0].value.title).toBe(long);
  });
});

function fixtureBundle(): CommittedSnapshotBundle {
  return {
    snapshot: {
      schemaVersion: 1,
      snapshotId: "snapshot-1",
      storeKey: "https://store.example",
      committed: true,
      context: { currency: "USD", priceContextVerified: true },
      coverage: { productsFetched: 1, truncated: false, sources: ["products-json"] },
    },
    products: [
      {
        schemaVersion: 1,
        snapshotId: "snapshot-1",
        productKey: "1",
        value: {
          id: "1",
          handle: "alpha",
          title: "=SUM(A1:A2)",
          vendor: "+Vendor",
          productType: "@Type",
          tags: ["-tag", "safe"],
          canonicalUrl: "https://store.example/products/alpha",
          createdAt: "Line 1\n\"quoted\",Line 2",
          variants: [
            {
              id: "10",
              sku: "SKU-10",
              price: "12.00",
              compareAtPrice: "15.00",
              available: true,
              priceSource: "products-json",
            },
          ],
          images: ["https://cdn.example/image.jpg"],
          sources: ["products-json"],
        },
      },
    ],
    moduleResults: [],
  };
}
