import type { CatalogProduct } from "../shopify/catalog-scanner";
import type { PublicCollectionRanking } from "./collection-ranking";

export type NewnessGrade = "A" | "B" | "C" | "D";

export type NewnessEvidence = Readonly<{
  grade: NewnessGrade;
  kind: "created-at" | "published-at" | "collection-order" | "sitemap-lastmod";
  value?: string;
  rank?: number;
  sourceUrl?: string;
  meaning: string;
}>;

export type NewnessCandidate = Readonly<{
  id?: string;
  handle?: string;
  title?: string;
  canonicalUrl?: string;
  primaryGrade: NewnessGrade;
  primaryTimestamp?: string;
  collectionRank?: number;
  evidence: readonly NewnessEvidence[];
}>;

export type NewnessAnalysis = Readonly<{
  status: "completed" | "candidate-only" | "unavailable";
  candidates: readonly NewnessCandidate[];
  hasAbsoluteDateEvidence: boolean;
  disclaimer: string;
}>;

export function analyzeProductNewness(
  products: readonly CatalogProduct[],
  createdDescending?: PublicCollectionRanking,
): NewnessAnalysis {
  const byHandle = new Map<string, CatalogProduct>();
  for (const product of products) {
    if (product.handle !== undefined) byHandle.set(product.handle, product);
  }
  const collectionItems = new Map(
    (createdDescending?.items ?? []).map((item) => [item.handle, item]),
  );
  const candidates: NewnessCandidate[] = [];
  const seenHandles = new Set<string>();

  for (const product of products) {
    const collectionItem =
      product.handle === undefined
        ? undefined
        : collectionItems.get(product.handle);
    const candidate = candidateFor(product, collectionItem);
    if (candidate !== undefined) candidates.push(candidate);
    if (product.handle !== undefined) seenHandles.add(product.handle);
  }

  for (const item of createdDescending?.items ?? []) {
    if (seenHandles.has(item.handle) || byHandle.has(item.handle)) continue;
    const candidate = candidateFor(
      {
        ...(item.id === undefined ? {} : { id: item.id }),
        handle: item.handle,
        ...(item.title === undefined ? {} : { title: item.title }),
        ...(item.canonicalUrl === undefined
          ? {}
          : { canonicalUrl: item.canonicalUrl }),
        tags: [],
        variants: [],
        images: [],
        sources: ["collection-html"],
      },
      item,
    );
    if (candidate !== undefined) candidates.push(candidate);
  }

  candidates.sort(compareCandidates);
  const hasAbsoluteDateEvidence = candidates.some((candidate) =>
    candidate.evidence.some(
      (evidence) => evidence.grade === "A" || evidence.grade === "B",
    ),
  );
  return {
    status:
      candidates.length === 0
        ? "unavailable"
        : hasAbsoluteDateEvidence
          ? "completed"
          : "candidate-only",
    candidates,
    hasAbsoluteDateEvidence,
    disclaimer: hasAbsoluteDateEvidence
      ? "A/B 为公开日期证据；C 仅为相对顺序；D 仅表示内容修改时间。"
      : "缺少 created_at / published_at；当前仅为候选排序，不能断言上新日期。",
  };
}

function candidateFor(
  product: CatalogProduct,
  collectionItem: PublicCollectionRanking["items"][number] | undefined,
): NewnessCandidate | undefined {
  const createdAt = validTimestamp(product.createdAt);
  const publishedAt = validTimestamp(product.publishedAt);
  const sitemapLastmod = validTimestamp(product.sitemapLastmod);
  const evidence: NewnessEvidence[] = [];

  if (createdAt !== undefined) {
    evidence.push({
      grade: "A",
      kind: "created-at",
      value: createdAt,
      meaning: "公开 created_at，表示明确创建时间。",
    });
  }
  if (publishedAt !== undefined) {
    evidence.push({
      grade: "B",
      kind: "published-at",
      value: publishedAt,
      meaning: "公开 published_at；重新发布可能使其偏新。",
    });
  }
  if (collectionItem !== undefined) {
    evidence.push({
      grade: "C",
      kind: "collection-order",
      rank: collectionItem.rank,
      sourceUrl: collectionItem.sourceUrl,
      meaning: "created-descending 公开 Collection 的相对顺序。",
    });
  }
  if (sitemapLastmod !== undefined) {
    evidence.push({
      grade: "D",
      kind: "sitemap-lastmod",
      value: sitemapLastmod,
      meaning: "sitemap lastmod 仅表示修改时间，不等于上新日期。",
    });
  }
  if (evidence.length === 0) return undefined;

  const primary = evidence[0] as NewnessEvidence;
  return {
    ...(product.id === undefined ? {} : { id: product.id }),
    ...(product.handle === undefined ? {} : { handle: product.handle }),
    ...(product.title === undefined ? {} : { title: product.title }),
    ...(product.canonicalUrl === undefined
      ? {}
      : { canonicalUrl: product.canonicalUrl }),
    primaryGrade: primary.grade,
    ...(primary.value === undefined ? {} : { primaryTimestamp: primary.value }),
    ...(collectionItem === undefined
      ? {}
      : { collectionRank: collectionItem.rank }),
    evidence,
  };
}

function compareCandidates(
  left: NewnessCandidate,
  right: NewnessCandidate,
): number {
  const gradeDelta = gradeWeight(left.primaryGrade) - gradeWeight(right.primaryGrade);
  if (gradeDelta !== 0) return gradeDelta;
  if (left.primaryTimestamp !== undefined || right.primaryTimestamp !== undefined) {
    return timestampValue(right.primaryTimestamp) - timestampValue(left.primaryTimestamp);
  }
  if (left.collectionRank !== undefined || right.collectionRank !== undefined) {
    return (left.collectionRank ?? Number.MAX_SAFE_INTEGER) -
      (right.collectionRank ?? Number.MAX_SAFE_INTEGER);
  }
  return (left.handle ?? left.id ?? "").localeCompare(
    right.handle ?? right.id ?? "",
  );
}

function gradeWeight(grade: NewnessGrade): number {
  return grade === "A" ? 0 : grade === "B" ? 1 : grade === "C" ? 2 : 3;
}

function validTimestamp(value: string | undefined): string | undefined {
  return value !== undefined && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

function timestampValue(value: string | undefined): number {
  return value === undefined ? Number.NEGATIVE_INFINITY : Date.parse(value);
}
