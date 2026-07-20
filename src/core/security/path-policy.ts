const MAX_PATHNAME_LENGTH = 8_192;
const MALFORMED_PERCENT_ESCAPE = /%(?![0-9a-f]{2})/iu;
const ENCODED_VALUE_REMAINING = /%[0-9a-f]{2}/iu;
const UNSAFE_DECODED_CHARACTER = /[\u0000-\u001f\u007f\\/?#]/u;
const LOCALE_SEGMENT = /^[a-z]{2,3}(?:-(?:[a-z]{2}|[0-9]{3}))?$/u;

export const SENSITIVE_ROOT_SEGMENTS = new Set([
  "admin",
  "account",
  "checkout",
  "checkouts",
  "orders",
  "cart",
]);

export type PathPolicyRejectionReason = "invalid_path" | "sensitive_path";

export type PathPolicyDecision =
  | {
      ok: true;
      normalizedPathname: string;
      effectiveSegments: string[];
    }
  | {
      ok: false;
      reason: PathPolicyRejectionReason;
      normalizedPathname?: string;
      sensitiveSegment?: string;
    };

/**
 * Normalizes a browser pathname for the public-storefront security boundary.
 * Ambiguous encodings are rejected instead of being guessed at.
 */
export function checkPublicPath(pathname: string): PathPolicyDecision {
  if (
    pathname.length === 0 ||
    pathname.length > MAX_PATHNAME_LENGTH ||
    !pathname.startsWith("/") ||
    pathname.includes("\\")
  ) {
    return { ok: false, reason: "invalid_path" };
  }

  const queryIndex = pathname.indexOf("?");
  const fragmentIndex = pathname.indexOf("#");
  const suffixIndexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const pathOnly =
    suffixIndexes.length === 0 ? pathname : pathname.slice(0, Math.min(...suffixIndexes));

  const decodedSegments: string[] = [];
  for (const rawSegment of pathOnly.split("/")) {
    if (rawSegment.length === 0) continue;
    if (MALFORMED_PERCENT_ESCAPE.test(rawSegment)) {
      return { ok: false, reason: "invalid_path" };
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawSegment).normalize("NFKC");
    } catch {
      return { ok: false, reason: "invalid_path" };
    }

    // A decoded separator, dot segment, control character, or another encoded
    // value would make different URL layers interpret the path differently.
    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      UNSAFE_DECODED_CHARACTER.test(decoded) ||
      ENCODED_VALUE_REMAINING.test(decoded)
    ) {
      return { ok: false, reason: "invalid_path" };
    }

    decodedSegments.push(decoded.toLocaleLowerCase("en-US"));
  }

  const normalizedPathname =
    decodedSegments.length === 0 ? "/" : `/${decodedSegments.join("/")}`;
  const effectiveSegments = [...decodedSegments];
  if (effectiveSegments[0] !== undefined && LOCALE_SEGMENT.test(effectiveSegments[0])) {
    effectiveSegments.shift();
  }

  const firstEffectiveSegment = effectiveSegments[0];
  if (
    firstEffectiveSegment !== undefined &&
    SENSITIVE_ROOT_SEGMENTS.has(firstEffectiveSegment)
  ) {
    return {
      ok: false,
      reason: "sensitive_path",
      normalizedPathname,
      sensitiveSegment: firstEffectiveSegment,
    };
  }

  return { ok: true, normalizedPathname, effectiveSegments };
}

export function isPublicPath(pathname: string): boolean {
  return checkPublicPath(pathname).ok;
}
