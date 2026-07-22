#!/usr/bin/env node

/**
 * Manual evidence helper. It reads public URLScan search/result pages and emits
 * compact JSON lines; it never changes fixtures or submits a scan.
 */

const SPECS = [
  ["app.klaviyo", "static.klaviyo.com"],
  ["app.judgeme", "cdn.judge.me"],
  ["app.loox", "loox.io"],
  ["app.yotpo", "staticw2.yotpo.com"],
  ["app.stamped", "stamped.io"],
  ["app.okendo", "cdn-static.okendo.io"],
  ["app.reviewsio", "widget.reviews.io"],
  ["app.fera", "cdn.fera.ai"],
  ["app.trustpilot", "widget.trustpilot.com"],
  ["app.rebuy", "cdn.rebuyengine.com"],
  ["app.gorgias", "config.gorgias.chat"],
  ["app.tidio", "code.tidio.co"],
  ["app.zendesk", "static.zdassets.com"],
  ["app.intercom", "widget.intercom.io"],
  ["app.recharge", "static.rechargecdn.com"],
  ["app.appstle", "subscription-admin.appstle.com"],
  ["app.skio", "cdn.skio.com"],
  ["app.seal-subscriptions", "app.sealsubscriptions.com"],
  ["app.smile", "cdn.sweettooth.io"],
  ["app.loyaltylion", "sdk.loyaltylion.net"],
  ["app.privy", "widget.privy.com"],
  ["app.omnisend", "omnisrc.com"],
  ["app.pushowl", "cdn.pushowl.com"],
  ["app.aftership", "automizely-analytics.com"],
  ["app.route", "cdn.routeapp.io"],
  ["app.nosto", "connect.nosto.com"],
  ["app.searchanise", "searchanise.com"],
  ["app.algolia", "algolia.net"],
  ["app.swym", "swymrelay.com"],
  ["app.growave", "static.growave.io"],
  ["app.pagefly", "cdn.pagefly.io"],
  ["app.gempages", "assets.gemcommerce.com"],
  ["pixel.google-tag", "www.googletagmanager.com"],
  ["pixel.meta", "connect.facebook.net"],
  ["pixel.tiktok", "analytics.tiktok.com"],
  ["pixel.pinterest", "s.pinimg.com"],
  ["pixel.snapchat", "sc-static.net"],
  ["pixel.microsoft-uet", "bat.bing.com"],
  ["pixel.hotjar", "static.hotjar.com"],
  ["pixel.clarity", "www.clarity.ms"],
];

const overrideHost = normalizedHost(process.env.M3_AUDIT_HOST);
const selectedSpecs =
  overrideHost === undefined
    ? SPECS
    : [[process.env.M3_AUDIT_RULE_ID ?? `manual.${overrideHost}`, overrideHost]];
const start = boundedArgument(process.argv[2], 0);
const count = boundedArgument(process.argv[3], selectedSpecs.length);
for (const [ruleId, host] of selectedSpecs.slice(start, start + count)) {
  try {
    const query = `domain:${host} AND page.ptr:myshopify.com`;
    const searchUrl = new URL("https://urlscan.io/api/v1/search/");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("size", "40");
    const search = await fetchJson(searchUrl);
    const scans = distinctShopifyScans(search.results ?? []).slice(0, 3);
    const samples = [];
    for (const scan of scans) {
      const html = await fetchText(
        `https://urlscan.io/result/${encodeURIComponent(scan.uuid)}/`,
      );
      const resourceUrl = selectEvidenceUrl(extractHostUrls(html, host));
      samples.push({
        pageUrl: scan.pageUrl,
        shopKey: new URL(scan.pageUrl).hostname,
        capturedAt: scan.capturedAt,
        scanId: scan.uuid,
        resourceUrl,
      });
      await delay(150);
    }
    process.stdout.write(`${JSON.stringify({ ruleId, queryHost: host, samples })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ruleId, queryHost: host, error: String(error) })}\n`,
    );
  }
  await delay(200);
}

function boundedArgument(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizedHost(value) {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase().replace(/^\.+|\.+$/gu, "");
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}$/u.test(normalized)
    ? normalized
    : undefined;
}

function distinctShopifyScans(results) {
  const seen = new Set();
  const scans = [];
  for (const result of results) {
    const pageUrl = result?.page?.url;
    const domain = result?.page?.domain;
    const uuid = result?.task?.uuid;
    const capturedAt = result?.task?.time;
    if (
      typeof pageUrl !== "string" ||
      typeof domain !== "string" ||
      typeof uuid !== "string" ||
      typeof capturedAt !== "string" ||
      seen.has(domain)
    ) {
      continue;
    }
    seen.add(domain);
    scans.push({ pageUrl, uuid, capturedAt });
  }
  return scans;
}

function extractHostUrls(html, expectedHost) {
  const decoded = html
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&quot;", '"');
  const matches = decoded.match(/https?:\/\/[^\s"'<>]+/gu) ?? [];
  const urls = new Set();
  for (const match of matches) {
    try {
      const url = new URL(match.replace(/[),.;]+$/u, ""));
      if (
        url.hostname === expectedHost ||
        url.hostname.endsWith(`.${expectedHost}`) ||
        expectedHost.endsWith(`.${url.hostname}`)
      ) {
        url.hash = "";
        urls.add(url.href);
      }
    } catch {
      // Ignore display fragments that are not complete URLs.
    }
  }
  return [...urls];
}

function selectEvidenceUrl(values) {
  const selected =
    values.find((value) => /\.(?:js|css)(?:[?#]|$)/iu.test(value)) ?? values[0];
  if (selected === undefined) return undefined;
  const url = new URL(selected);
  url.search = "";
  url.hash = "";
  return url.href;
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "SS-Watcher-M3-Evidence/0.3" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
