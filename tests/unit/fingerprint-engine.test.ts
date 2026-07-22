import { describe, expect, it } from "vitest";

import {
  detectFingerprints,
  summarizeFingerprintCatalog,
} from "../../src/core/frontend/fingerprint-engine";
import { FINGERPRINT_RULES } from "../../src/core/frontend/fingerprint-rules";
import frozenReport from "../../docs/evidence/m3-fingerprint-holdout.json";
import { FINGERPRINT_POST_FREEZE_HOLDOUT_EVIDENCE } from "../fixtures/fingerprint-post-freeze-holdout";
import {
  FINGERPRINT_DEVELOPMENT_SAMPLES,
  FINGERPRINT_HOLDOUT_NEGATIVES,
  FINGERPRINT_HOLDOUT_POSITIVES,
  FINGERPRINT_POSITIVE_SAMPLES,
  FINGERPRINT_PUBLIC_EVIDENCE,
  type FingerprintBenchmarkSample,
} from "../fixtures/fingerprint-benchmark";

describe("stable fingerprint catalog", () => {
  it("contains 40 stable rules including 8 independent pixel rules", () => {
    expect(summarizeFingerprintCatalog()).toEqual({
      version: "public-signals-v1.0.0",
      stableRules: 40,
      stableApps: 32,
      stablePixels: 8,
      minimumSignalsPerRule: 2,
    });
    expect(new Set(FINGERPRINT_RULES.map((rule) => rule.id)).size).toBe(40);
    for (const rule of FINGERPRINT_RULES) {
      expect(rule.maturity).toBe("stable");
      expect(rule.minimumSignals).toBe(2);
      expect(rule.signals.length).toBeGreaterThanOrEqual(3);
      expect(new Set(rule.signals.map((signal) => signal.id)).size).toBe(
        rule.signals.length,
      );
      for (const signal of rule.signals) {
        expect(signal.pattern.global).toBe(false);
        expect(signal.pattern.sticky).toBe(false);
      }
    }
  });

  it("separates the original development corpus from the post-freeze holdout", () => {
    expect(FINGERPRINT_PUBLIC_EVIDENCE).toHaveLength(40);
    expect(FINGERPRINT_POST_FREEZE_HOLDOUT_EVIDENCE).toHaveLength(40);
    expect(FINGERPRINT_POSITIVE_SAMPLES).toHaveLength(239);
    expect(FINGERPRINT_DEVELOPMENT_SAMPLES).toHaveLength(120);
    expect(FINGERPRINT_HOLDOUT_POSITIVES).toHaveLength(119);
    expect(FINGERPRINT_HOLDOUT_NEGATIVES).toHaveLength(40);
    expect(
      new Set(FINGERPRINT_PUBLIC_EVIDENCE.map((group) => group.ruleId)),
    ).toEqual(new Set(FINGERPRINT_RULES.map((rule) => rule.id)));

    for (const group of FINGERPRINT_PUBLIC_EVIDENCE) {
      expect(new Set(group.rows.map((row) => new URL(row[0]).hostname)).size).toBe(
        3,
      );
      for (const [pageUrl, scanId, capturedAt, resourceUrl] of group.rows) {
        expect(new URL(pageUrl).protocol).toBe("https:");
        expect(scanId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(Number.isFinite(Date.parse(capturedAt))).toBe(true);
        const host = new URL(resourceUrl).hostname;
        expect(
          host === group.queryHost || host.endsWith(`.${group.queryHost}`),
        ).toBe(true);
      }
    }

    expect(
      new Set(
        FINGERPRINT_POST_FREEZE_HOLDOUT_EVIDENCE.map((group) => group.ruleId),
      ),
    ).toEqual(new Set(FINGERPRINT_RULES.map((rule) => rule.id)));
    for (const group of FINGERPRINT_POST_FREEZE_HOLDOUT_EVIDENCE) {
      expect(group.rows.length).toBeGreaterThanOrEqual(2);
      expect(group.rows.length).toBeLessThanOrEqual(3);
      for (const [pageUrl, scanId, capturedAt, resourceUrl] of group.rows) {
        const page = new URL(pageUrl);
        const resource = new URL(resourceUrl);
        expect(page.protocol).toBe("https:");
        expect(page.search).toBe("");
        expect(page.hash).toBe("");
        expect(resource.protocol).toBe("https:");
        expect(resource.search).toBe("");
        expect(resource.hash).toBe("");
        expect(scanId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(Number.isFinite(Date.parse(capturedAt))).toBe(true);
      }
    }

    const splitsByShop = new Map<string, Set<string>>();
    for (const sample of FINGERPRINT_POSITIVE_SAMPLES) {
      const splits = splitsByShop.get(sample.shopKey) ?? new Set<string>();
      splits.add(sample.split);
      splitsByShop.set(sample.shopKey, splits);
    }
    expect(
      [...splitsByShop.entries()]
        .filter(([, splits]) => splits.size > 1)
        .map(([shop]) => shop),
    ).toEqual([]);
  });

  it("detects every label in the development corpus", () => {
    const failures = FINGERPRINT_DEVELOPMENT_SAMPLES.flatMap((sample) => {
      const detected = detectedRuleIds(sample);
      return setsEqual(detected, new Set(sample.expectedRuleIds))
        ? []
        : [{ sampleId: sample.sampleId, detected: [...detected] }];
    });
    expect(failures).toEqual([]);
  });

  it("does not stitch a vendor hostname to an unrelated generic path", () => {
    expect(
      detectFingerprints([
        {
          resourceId: "vendor-host-only",
          url: "https://static.klaviyo.com/unrelated.js",
        },
        {
          resourceId: "unrelated-path-only",
          url: "https://example.com/onsite/js/unrelated.js",
        },
      ]).map((match) => match.ruleId),
    ).not.toContain("app.klaviyo");
  });

  it("meets the independent holdout false-positive and false-negative gates", () => {
    const positiveLabels = FINGERPRINT_HOLDOUT_POSITIVES.reduce(
      (count, sample) => count + sample.expectedRuleIds.length,
      0,
    );
    const missedLabels = FINGERPRINT_HOLDOUT_POSITIVES.reduce((count, sample) => {
      const detected = detectedRuleIds(sample);
      return (
        count + sample.expectedRuleIds.filter((ruleId) => !detected.has(ruleId)).length
      );
    }, 0);
    const missedSampleIds = FINGERPRINT_HOLDOUT_POSITIVES.flatMap((sample) => {
      const detected = detectedRuleIds(sample);
      return sample.expectedRuleIds.some((ruleId) => !detected.has(ruleId))
        ? [sample.sampleId]
        : [];
    });
    const falsePositivePages = FINGERPRINT_HOLDOUT_NEGATIVES.filter(
      (sample) => detectedRuleIds(sample).size > 0,
    ).length;
    const unexpectedLabels = FINGERPRINT_HOLDOUT_POSITIVES.reduce(
      (count, sample) => {
        const expected = new Set(sample.expectedRuleIds);
        return (
          count +
          [...detectedRuleIds(sample)].filter((ruleId) => !expected.has(ruleId))
            .length
        );
      },
      0,
    );
    const report = {
      rules: FINGERPRINT_RULES.length,
      pixels: FINGERPRINT_RULES.filter((rule) => rule.category === "pixel").length,
      developmentPositivePages: FINGERPRINT_DEVELOPMENT_SAMPLES.length,
      holdoutPositivePages: FINGERPRINT_HOLDOUT_POSITIVES.length,
      holdoutNegativePages: FINGERPRINT_HOLDOUT_NEGATIVES.length,
      positiveLabels,
      missedLabels,
      missedSampleIds,
      unexpectedLabels,
      falsePositivePages,
      falseNegativeRate: missedLabels / positiveLabels,
      pageFalsePositiveRate:
        falsePositivePages / FINGERPRINT_HOLDOUT_NEGATIVES.length,
    };

    expect(report).toMatchObject({
      rules: 40,
      pixels: 8,
      developmentPositivePages: 120,
      holdoutPositivePages: 119,
      holdoutNegativePages: 40,
      positiveLabels: 119,
      unexpectedLabels: 0,
      falsePositivePages: 0,
      pageFalsePositiveRate: 0,
    });
    expect(frozenReport).toMatchObject({
      rulesetVersion: "public-signals-v1.0.0",
      catalog: {
        stableRules: report.rules,
        stableApps: 32,
        stablePixels: report.pixels,
        minimumSignalsPerRule: 2,
      },
      development: {
        positivePages: report.developmentPositivePages,
      },
      holdout: {
        positivePages: report.holdoutPositivePages,
        negativePages: report.holdoutNegativePages,
        positiveLabels: report.positiveLabels,
        missedLabels: report.missedLabels,
        missedSampleIds: report.missedSampleIds,
        unexpectedLabels: report.unexpectedLabels,
        falsePositivePages: report.falsePositivePages,
        falseNegativeRate: report.falseNegativeRate,
        pageFalsePositiveRate: report.pageFalsePositiveRate,
      },
      thresholds: {
        maxFalseNegativeRate: 0.15,
        maxPageFalsePositiveRate: 0.05,
      },
      pass: true,
    });
    expect(report.pageFalsePositiveRate).toBeLessThanOrEqual(0.05);
    expect(report.falseNegativeRate).toBeLessThanOrEqual(0.15);
  });
});

function detectedRuleIds(sample: FingerprintBenchmarkSample): Set<string> {
  return new Set(
    detectFingerprints(sample.resources).map((match) => match.ruleId),
  );
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}
