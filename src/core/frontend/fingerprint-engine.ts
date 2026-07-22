import {
  FINGERPRINT_RULES,
  FINGERPRINT_RULESET_VERSION,
  type FingerprintCategory,
  type FingerprintRule,
  type FingerprintSignalRule,
} from "./fingerprint-rules";

export type FingerprintResourceInput = Readonly<{
  resourceId: string;
  url: string;
  text?: string;
}>;

export type FingerprintMatchEvidence = Readonly<{
  resourceId: string;
  signalId: string;
  excerpt: string;
}>;

export type FingerprintMatch = Readonly<{
  ruleId: string;
  label: string;
  category: FingerprintCategory;
  maturity: "stable";
  confidence: number;
  matchedSignalCount: number;
  evidence: FingerprintMatchEvidence[];
}>;

export type FingerprintCatalogSummary = Readonly<{
  version: typeof FINGERPRINT_RULESET_VERSION;
  stableRules: number;
  stableApps: number;
  stablePixels: number;
  minimumSignalsPerRule: number;
}>;

export function detectFingerprints(
  resources: readonly FingerprintResourceInput[],
  rules: readonly FingerprintRule[] = FINGERPRINT_RULES,
): FingerprintMatch[] {
  const parsed = resources.map((resource) => ({
    resource,
    url: safeUrl(resource.url),
  }));
  const matches: FingerprintMatch[] = [];

  for (const rule of rules) {
    let strongestEvidence: FingerprintMatchEvidence[] = [];
    for (const candidate of parsed) {
      const candidateEvidence: FingerprintMatchEvidence[] = [];
      for (const signal of rule.signals) {
        const value = signalValue(signal, candidate.url, candidate.resource.text);
        if (value === undefined) continue;
        const excerpt = firstPatternMatch(signal.pattern, value);
        if (excerpt === undefined) continue;
        candidateEvidence.push({
          resourceId: candidate.resource.resourceId,
          signalId: signal.id,
          excerpt: sanitizeFingerprintExcerpt(excerpt),
        });
      }
      // A vendor hostname on one request and a generic path on an unrelated
      // request must never be stitched into a detection. Independent signal
      // groups qualify only when they co-occur on the same observed resource.
      if (candidateEvidence.length > strongestEvidence.length) {
        strongestEvidence = candidateEvidence;
      }
    }
    if (strongestEvidence.length < rule.minimumSignals) continue;
    const extraSignals = strongestEvidence.length - rule.minimumSignals;
    matches.push({
      ruleId: rule.id,
      label: rule.label,
      category: rule.category,
      maturity: rule.maturity,
      confidence: Math.min(0.99, rule.baseConfidence + extraSignals * 0.03),
      matchedSignalCount: strongestEvidence.length,
      evidence: strongestEvidence.slice(0, 8),
    });
  }
  return matches;
}

export function summarizeFingerprintCatalog(
  rules: readonly FingerprintRule[] = FINGERPRINT_RULES,
): FingerprintCatalogSummary {
  return {
    version: FINGERPRINT_RULESET_VERSION,
    stableRules: rules.length,
    stableApps: rules.filter((rule) => rule.category === "app").length,
    stablePixels: rules.filter((rule) => rule.category === "pixel").length,
    minimumSignalsPerRule:
      rules.length === 0
        ? 0
        : Math.min(...rules.map((rule) => rule.minimumSignals)),
  };
}

function signalValue(
  signal: FingerprintSignalRule,
  url: URL | undefined,
  text: string | undefined,
): string | undefined {
  switch (signal.surface) {
    case "hostname":
      return url?.hostname;
    case "pathname":
      return url?.pathname;
    case "text":
      return text;
  }
}

function firstPatternMatch(pattern: RegExp, value: string): string | undefined {
  pattern.lastIndex = 0;
  const match = pattern.exec(value);
  pattern.lastIndex = 0;
  return match?.[0];
}

function safeUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeFingerprintExcerpt(value: string): string {
  return value
    .replace(/[a-zA-Z0-9_-]{48,}/gu, "[redacted-token]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
}
