export const MAX_SOURCE_MAP_TEXT_BYTES = 5 * 1_024 * 1_024;

export type SourceMapInspection =
  | Readonly<{ status: "none" }>
  | Readonly<{
      status: "external";
      url: string;
      originRelation: "same-origin" | "cross-origin";
    }>
  | Readonly<{
      status: "inline";
      sourceCount: number;
      nameCount: number;
      hasSourcesContent: boolean;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid_reference"
        | "unsupported_scheme"
        | "local_path"
        | "too_large"
        | "invalid_json"
        | "invalid_schema"
        | "cross_origin_source";
    }>;

export function inspectSourceMapReference(
  sourceText: string,
  resourceUrl: string,
): SourceMapInspection {
  const reference = lastSourceMapReference(sourceText);
  if (reference === undefined) return { status: "none" };
  if (reference.startsWith("data:")) {
    const decoded = decodeInlineSourceMap(reference);
    if (!decoded.ok) return { status: "rejected", reason: decoded.reason };
    return inspectSourceMapText(decoded.text, resourceUrl);
  }
  if (looksLikeLocalPath(reference)) {
    return { status: "rejected", reason: "local_path" };
  }
  let sourceUrl: URL;
  let mapUrl: URL;
  try {
    sourceUrl = new URL(resourceUrl);
    mapUrl = new URL(reference, sourceUrl);
  } catch {
    return { status: "rejected", reason: "invalid_reference" };
  }
  if (
    (mapUrl.protocol !== "http:" && mapUrl.protocol !== "https:") ||
    mapUrl.username.length > 0 ||
    mapUrl.password.length > 0
  ) {
    return { status: "rejected", reason: "unsupported_scheme" };
  }
  mapUrl.hash = "";
  return {
    status: "external",
    url: mapUrl.href,
    originRelation:
      mapUrl.origin === sourceUrl.origin ? "same-origin" : "cross-origin",
  };
}

export function inspectSourceMapText(
  mapText: string,
  mapUrl: string,
): SourceMapInspection {
  if (new TextEncoder().encode(mapText).byteLength > MAX_SOURCE_MAP_TEXT_BYTES) {
    return { status: "rejected", reason: "too_large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(mapText);
  } catch {
    return { status: "rejected", reason: "invalid_json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: "rejected", reason: "invalid_schema" };
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== 3 ||
    !Array.isArray(record.sources) ||
    record.sources.length > 10_000 ||
    !record.sources.every(
      (source) => typeof source === "string" && source.length <= 4_096,
    ) ||
    (record.names !== undefined &&
      (!Array.isArray(record.names) ||
        record.names.length > 100_000 ||
        !record.names.every(
          (name) => typeof name === "string" && name.length <= 1_024,
        ))) ||
    (record.sourcesContent !== undefined &&
      (!Array.isArray(record.sourcesContent) ||
        record.sourcesContent.length !== record.sources.length))
  ) {
    return { status: "rejected", reason: "invalid_schema" };
  }

  let base: URL;
  try {
    base = new URL(mapUrl);
  } catch {
    return { status: "rejected", reason: "invalid_reference" };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { status: "rejected", reason: "unsupported_scheme" };
  }
  const sourceRoot = typeof record.sourceRoot === "string" ? record.sourceRoot : "";
  if (sourceRoot.length > 4_096 || looksLikeLocalPath(sourceRoot)) {
    return { status: "rejected", reason: "local_path" };
  }
  for (const source of record.sources as string[]) {
    const joined = joinSourceRoot(sourceRoot, source);
    if (looksLikeLocalPath(joined)) {
      return { status: "rejected", reason: "local_path" };
    }
    let resolved: URL;
    try {
      resolved = new URL(joined, base);
    } catch {
      return { status: "rejected", reason: "invalid_reference" };
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return { status: "rejected", reason: "unsupported_scheme" };
    }
    if (resolved.origin !== base.origin) {
      return { status: "rejected", reason: "cross_origin_source" };
    }
  }
  return {
    status: "inline",
    sourceCount: record.sources.length,
    nameCount: Array.isArray(record.names) ? record.names.length : 0,
    hasSourcesContent: Array.isArray(record.sourcesContent),
  };
}

function lastSourceMapReference(text: string): string | undefined {
  const tail = text.slice(-256 * 1_024);
  const pattern = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=\s*([^\s*]+)(?:\s*\*\/)?/gu;
  let found: string | undefined;
  for (const match of tail.matchAll(pattern)) {
    const candidate = match[1]?.trim();
    if (candidate !== undefined && candidate.length <= 8 * 1_024) found = candidate;
  }
  return found;
}

function decodeInlineSourceMap(value: string):
  | { ok: true; text: string }
  | { ok: false; reason: "invalid_reference" | "too_large" } {
  const match = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/isu.exec(
    value,
  );
  if (match === null) return { ok: false, reason: "invalid_reference" };
  try {
    const encoded = match[2] ?? "";
    const text =
      match[1] === ";base64"
        ? new TextDecoder().decode(
            Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
          )
        : decodeURIComponent(encoded);
    return new TextEncoder().encode(text).byteLength <= MAX_SOURCE_MAP_TEXT_BYTES
      ? { ok: true, text }
      : { ok: false, reason: "too_large" };
  } catch {
    return { ok: false, reason: "invalid_reference" };
  }
}

function joinSourceRoot(root: string, source: string): string {
  if (root.length === 0) return source;
  return `${root.replace(/\/$/u, "")}/${source.replace(/^\//u, "")}`;
}

function looksLikeLocalPath(value: string): boolean {
  return (
    /^file:/iu.test(value) ||
    /^[a-zA-Z]:[\\/]/u.test(value) ||
    /^\/(?:Users|home|private|var|tmp|opt|etc)(?:\/|$)/u.test(value) ||
    /^\\\\/u.test(value)
  );
}
