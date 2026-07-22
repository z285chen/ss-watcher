#!/usr/bin/env node

import { createServer } from "node:http";

const host = process.env.M0_HOST ?? "127.0.0.1";
const requestedPort = parsePort(process.env.M0_PORT ?? process.env.PORT ?? "4173");
const requestedCrossPort = parsePort(
  process.env.M0_CROSS_PORT ??
    (requestedPort === 0 ? "0" : String(requestedPort + 1)),
);

const stats = {
  startedAt: new Date().toISOString(),
  total: 0,
  main: 0,
  cross: 0,
  byPath: Object.create(null),
  redirectTargets: { sameOrigin: 0, crossOrigin: 0 },
};

const products = [
  {
    id: 1001,
    handle: "m0-alpha",
    title: "M0 Alpha",
    created_at: "2026-01-01T00:00:00Z",
    published_at: "2026-01-02T00:00:00Z",
    variants: [{ id: 1101, title: "Default Title", price: "12.00" }],
  },
  {
    id: 1002,
    handle: "m0-beta",
    title: "M0 Beta",
    created_at: "2026-02-01T00:00:00Z",
    published_at: "2026-02-02T00:00:00Z",
    variants: [{ id: 1102, title: "Default Title", price: "24.00" }],
  },
  {
    id: 1003,
    handle: "m0-gamma",
    title: "M0 Gamma",
    created_at: "2026-03-01T00:00:00Z",
    published_at: "2026-03-02T00:00:00Z",
    variants: [{ id: 1103, title: "Default Title", price: "36.00" }],
  },
];

let mainOrigin = "";
let crossOrigin = "";

const crossServer = createServer((request, response) => {
  void route(request, response, "cross").catch((error) => {
    sendJson(response, 500, { error: safeMessage(error) });
  });
});

const mainServer = createServer((request, response) => {
  void route(request, response, "main").catch((error) => {
    sendJson(response, 500, { error: safeMessage(error) });
  });
});

await listen(crossServer, requestedCrossPort, host);
const crossAddress = crossServer.address();
if (crossAddress === null || typeof crossAddress === "string") {
  throw new Error("Could not resolve cross-origin fixture port");
}
crossOrigin = `http://${host}:${crossAddress.port}`;

try {
  await listen(mainServer, requestedPort, host);
} catch (error) {
  crossServer.close();
  throw error;
}
const mainAddress = mainServer.address();
if (mainAddress === null || typeof mainAddress === "string") {
  throw new Error("Could not resolve main fixture port");
}
mainOrigin = `http://${host}:${mainAddress.port}`;

process.stdout.write(
  `${JSON.stringify({
    event: "ready",
    host,
    port: mainAddress.port,
    origin: mainOrigin,
    crossPort: crossAddress.port,
    crossOrigin,
    pid: process.pid,
  })}\n`,
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    Promise.all([close(mainServer), close(crossServer)])
      .then(() => {
        process.stdout.write(`${JSON.stringify({ event: "closed", signal })}\n`);
        process.exit(0);
      })
      .catch(() => process.exit(1));
  });
}

async function route(request, response, role) {
  const base = role === "main" ? mainOrigin : crossOrigin;
  const url = new URL(request.url ?? "/", base);

  setCommonHeaders(response, role);

  if (url.pathname === "/__stats") {
    sendJson(response, 200, snapshotStats());
    return;
  }
  if (url.pathname === "/__reset") {
    resetStats();
    sendJson(response, 200, { ok: true, stats: snapshotStats() });
    return;
  }

  record(role, url.pathname);

  if (url.pathname.startsWith("/__redirect_target")) {
    if (role === "main") stats.redirectTargets.sameOrigin += 1;
    else stats.redirectTargets.crossOrigin += 1;
    sendJson(response, 200, {
      reached: true,
      role,
      warning: "A redirect:error request must never reach this target",
    });
    return;
  }

  // Valid locale-shaped route roots used by RequestPolicy's live tests.
  if (url.pathname === "/rr/cart.js") {
    redirect(response, `${mainOrigin}/__redirect_target/same`);
    return;
  }
  if (url.pathname === "/rx/cart.js") {
    redirect(response, `${crossOrigin}/__redirect_target/cross`);
    return;
  }

  if (url.pathname === "/redirect/same") {
    redirect(response, `${mainOrigin}/__redirect_target/same`);
    return;
  }
  if (url.pathname === "/redirect/cross") {
    redirect(response, `${crossOrigin}/__redirect_target/cross`);
    return;
  }
  if (url.pathname.startsWith("/redirect-same/")) {
    redirect(
      response,
      `${mainOrigin}/__redirect_target${url.pathname.slice("/redirect-same".length)}`,
    );
    return;
  }
  if (url.pathname.startsWith("/redirect-cross/")) {
    redirect(
      response,
      `${crossOrigin}/__redirect_target${url.pathname.slice("/redirect-cross".length)}`,
    );
    return;
  }

  if (
    url.pathname === "/429" ||
    url.pathname === "/status/429" ||
    url.pathname === "/status/429/cart.js" ||
    url.pathname === "/rl/cart.js"
  ) {
    response.setHeader("Retry-After", url.searchParams.get("retryAfter") ?? "2");
    sendJson(response, 429, { error: "rate_limited" });
    return;
  }
  if (
    url.pathname === "/430" ||
    url.pathname === "/status/430" ||
    url.pathname === "/status/430/cart.js" ||
    url.pathname === "/rs/cart.js"
  ) {
    sendJson(response, 430, { error: "security_rejected" });
    return;
  }
  if (url.pathname === "/rate-limit") {
    const failures = boundedInteger(url.searchParams.get("failures"), 1, 20, 2);
    const seen = stats.byPath[`${role}:/rate-limit`] ?? 0;
    if (seen <= failures) {
      response.setHeader("Retry-After", "1");
      sendJson(response, 429, { error: "rate_limited", attempt: seen });
    } else {
      sendJson(response, 200, { ok: true, attempt: seen });
    }
    return;
  }

  if (url.pathname === "/password") {
    sendHtml(response, 200, passwordPage());
    return;
  }
  if (url.pathname === "/challenge") {
    sendHtml(response, 200, challengePage());
    return;
  }
  if (url.pathname === "/zz/cart.js") {
    sendHtml(response, 200, challengePage());
    return;
  }
  if (url.pathname === "/html-as-json") {
    sendHtml(response, 200, hostedPage("/"));
    return;
  }
  if (url.pathname === "/invalid.json") {
    sendJson(response, 200, { products: "not-an-array" });
    return;
  }
  if (url.pathname === "/large.json") {
    const bytes = boundedInteger(
      url.searchParams.get("bytes"),
      1,
      12 * 1024 * 1024,
      11 * 1024 * 1024,
    );
    sendJson(response, 200, { padding: "x".repeat(bytes) });
    return;
  }

  if (url.pathname === "/assets/m3-theme.js") {
    send(
      response,
      200,
      "text/javascript; charset=utf-8",
      [
        "window.Shopify = window.Shopify || {};",
        "Shopify.theme = { name: 'M3 Fixture' };",
        "const publicEndpoint = '/cart.js';",
        "gtag('config', 'G-FIXTURE');",
        "//# sourceMappingURL=m3-theme.js.map?v=1",
      ].join("\n"),
    );
    return;
  }
  if (url.pathname === "/assets/m3-theme.css") {
    send(
      response,
      200,
      "text/css; charset=utf-8",
      ".m3-fixture { display: grid; }\n/*# sourceMappingURL=m3-theme.css.map?v=1 */",
    );
    return;
  }
  if (
    url.pathname === "/assets/m3-theme.js.map" ||
    url.pathname === "/assets/m3-theme.css.map"
  ) {
    sendJson(response, 200, {
      version: 3,
      sources: ["src/m3-fixture.ts"],
      names: ["publicEndpoint"],
      mappings: "AAAA",
      sourcesContent: ["const rawFixtureSource = true;"],
    });
    return;
  }
  if (url.pathname === "/assets/m3-wrong-mime.js") {
    send(response, 200, "image/png", "not-a-script");
    return;
  }
  if (url.pathname === "/assets/m3-large.js") {
    send(
      response,
      200,
      "text/javascript; charset=utf-8",
      "x".repeat(2 * 1_024 * 1_024 + 1),
    );
    return;
  }

  if (url.pathname === "/meta.json") {
    sendJson(response, 200, {
      name: "M0 Hosted Fixture",
      domain: new URL(mainOrigin).host,
      myshopify_domain: "m0-fixture.myshopify.com",
      currency: "USD",
    });
    return;
  }

  if (url.pathname === "/products.json") {
    const limit = boundedInteger(url.searchParams.get("limit"), 1, 250, 50);
    const page = boundedInteger(url.searchParams.get("page"), 1, 100_000, 1);
    const start = (page - 1) * limit;
    sendJson(response, 200, { products: products.slice(start, start + limit) });
    return;
  }

  const collectionJson = url.pathname.match(
    /^\/collections\/([^/]+)\/products\.json$/u,
  );
  if (collectionJson !== null) {
    sendJson(response, 200, {
      products,
      collection: decodeURIComponent(collectionJson[1] ?? "all"),
    });
    return;
  }

  const cartMatch = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?cart\.js$/iu);
  if (cartMatch !== null) {
    // Extra sensitive-looking fields ensure RequestPolicy proves it keeps only
    // currency and does not leak the anonymous cart payload to its caller.
    sendJson(response, 200, {
      token: "m0-do-not-persist",
      note: null,
      attributes: {},
      items: [],
      currency: url.pathname.toLowerCase().startsWith("/fr/") ? "EUR" : "USD",
      item_count: 0,
      total_price: 0,
    });
    return;
  }

  const productJs = url.pathname.match(
    /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/([^/]+)\.js$/iu,
  );
  if (productJs !== null) {
    const handle = decodeURIComponent(productJs[1] ?? "");
    const product = products.find((entry) => entry.handle === handle);
    if (product === undefined) {
      sendJson(response, 404, { error: "not_found" });
    } else {
      sendJson(response, 200, {
        ...product,
        // Shopify's Ajax Product API exposes integer minor units, unlike the
        // decimal strings returned by the B-grade products.json fixture.
        variants: product.variants.map((variant) => ({
          ...variant,
          price: decimalToMinorUnits(variant.price, 2),
        })),
      });
    }
    return;
  }

  const collectionHtml = url.pathname.match(
    /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?collections\/([^/]+)$/iu,
  );
  if (collectionHtml !== null) {
    const handle = escapeHtml(decodeURIComponent(collectionHtml[1] ?? "all"));
    const handles = products
      .map(
        (product) =>
          `<a class="product-card" href="/products/${product.handle}">${escapeHtml(product.title)}</a>`,
      )
      .join("\n");
    sendHtml(
      response,
      200,
      `<!doctype html><html><body><main data-collection="${handle}">${handles}</main></body></html>`,
    );
    return;
  }

  if (url.pathname === "/sitemap.xml") {
    sendXml(
      response,
      200,
      `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${mainOrigin}/sitemap_products_1.xml?from=1001&amp;to=1003</loc></sitemap></sitemapindex>`,
    );
    return;
  }
  if (/^\/sitemap_products_\d+\.xml$/u.test(url.pathname)) {
    const entries = products
      .map(
        (product) =>
          `<url><loc>${mainOrigin}/products/${product.handle}</loc><lastmod>2026-03-03T00:00:00Z</lastmod></url>`,
      )
      .join("");
    sendXml(
      response,
      200,
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,
    );
    return;
  }

  if (isSensitiveFixturePath(url.pathname)) {
    sendHtml(
      response,
      200,
      `<!doctype html><html><body><main data-sensitive="true">Sensitive fixture: ${escapeHtml(url.pathname)}</main></body></html>`,
    );
    return;
  }

  if (url.pathname === "/spa" || url.pathname.startsWith("/spa/")) {
    sendHtml(response, 200, spaPage());
    return;
  }
  if (
    url.pathname === "/" ||
    url.pathname === "/hosted" ||
    url.pathname === "/fr/" ||
    url.pathname === "/fr/hosted" ||
    url.pathname === "/shopify-globals"
  ) {
    sendHtml(
      response,
      200,
      hostedPage(url.pathname.startsWith("/fr/") ? "/fr/" : "/"),
    );
    return;
  }
  if (url.pathname === "/shopify-globals-mutated") {
    sendHtml(response, 200, mutatedGlobalsPage());
    return;
  }
  if (url.pathname === "/custom") {
    sendHtml(response, 200, customPage());
    return;
  }

  sendJson(response, 404, { error: "fixture_not_found", path: url.pathname });
}

function hostedPage(routeRoot) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta name="generator" content="Shopify">
    <link rel="canonical" href="${mainOrigin}${routeRoot}">
    <link rel="stylesheet" href="${mainOrigin}/assets/m3-theme.css?v=1">
    <link rel="preconnect" href="https://cdn.shopify.com">
    <script defer src="${mainOrigin}/assets/m3-theme.js?v=1"></script>
    <script>
      window.Shopify = {
        shop: "m0-fixture.myshopify.com",
        locale: ${JSON.stringify(routeRoot === "/fr/" ? "fr" : "en")},
        country: ${JSON.stringify(routeRoot === "/fr/" ? "FR" : "US")},
        routes: { root: ${JSON.stringify(routeRoot)} },
        currency: { active: ${JSON.stringify(routeRoot === "/fr/" ? "EUR" : "USD")}, rate: "1.0" },
        theme: { name: "M0 Fixture", id: 1, schema_name: "Dawn" }
      };
    </script>
  </head>
  <body><main><h1>Hosted Shopify fixture</h1><a href="/products/m0-alpha">Alpha</a></main></body>
</html>`;
}

function customPage() {
  return `<!doctype html>
<html><head>
  <link rel="preconnect" href="https://cdn.shopify.com">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"M0 custom storefront"}</script>
</head><body>
  <main data-custom-storefront="true"><h1>Custom storefront fixture</h1></main>
  <a href="https://m0-fixture.myshopify.com/checkouts/cn/example">Checkout evidence</a>
</body></html>`;
}

function mutatedGlobalsPage() {
  return `<!doctype html><html><body><h1>Mutated globals fixture</h1><script>
    Object.defineProperty(window, "Shopify", {
      configurable: true,
      get() { throw new Error("page-owned getter"); }
    });
  </script></body></html>`;
}

function passwordPage() {
  return `<!doctype html><html><body><div id="shopify-section-main-password"><form action="/password" method="post"><input name="password" type="password"></form></div></body></html>`;
}

function challengePage() {
  return `<!doctype html><html><body><form id="challenge-form"><h1>Checking your browser</h1><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></form></body></html>`;
}

function spaPage() {
  return `<!doctype html><html><body>
    <p id="spa-path"></p>
    <button id="spa-safe">pushState safe path</button>
    <button id="spa-sensitive">pushState sensitive path</button>
    <script>
      const render = () => { document.querySelector("#spa-path").textContent = location.pathname; };
      document.querySelector("#spa-safe").onclick = () => { history.pushState({}, "", "/spa/next"); render(); };
      document.querySelector("#spa-sensitive").onclick = () => { history.pushState({}, "", "/fr/account"); render(); };
      addEventListener("popstate", render); render();
    </script>
  </body></html>`;
}

function isSensitiveFixturePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname).replace(/\/+/gu, "/").toLowerCase();
  } catch {
    return true;
  }
  const parts = decoded.split("/").filter(Boolean);
  if (/^[a-z]{2}(?:-[a-z]{2})?$/u.test(parts[0] ?? "")) parts.shift();
  return ["admin", "account", "checkout", "checkouts", "orders", "cart"].includes(
    parts[0] ?? "",
  );
}

function record(role, pathname) {
  stats.total += 1;
  stats[role] += 1;
  const key = `${role}:${pathname}`;
  stats.byPath[key] = (stats.byPath[key] ?? 0) + 1;
}

function resetStats() {
  stats.startedAt = new Date().toISOString();
  stats.total = 0;
  stats.main = 0;
  stats.cross = 0;
  stats.byPath = Object.create(null);
  stats.redirectTargets.sameOrigin = 0;
  stats.redirectTargets.crossOrigin = 0;
}

function snapshotStats() {
  return {
    ...stats,
    byPath: { ...stats.byPath },
    redirectTargets: { ...stats.redirectTargets },
  };
}

function setCommonHeaders(response, role) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-M0-Fixture-Origin", role);
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response, status, value) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(value));
}

function sendHtml(response, status, value) {
  send(response, status, "text/html; charset=utf-8", value);
}

function sendXml(response, status, value) {
  send(response, status, "application/xml; charset=utf-8", value);
}

function send(response, status, contentType, value) {
  const body = Buffer.from(value);
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", String(body.byteLength));
  response.end(body);
}

function redirect(response, location) {
  response.statusCode = 302;
  response.setHeader("Location", location);
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("redirect must be blocked");
}

function boundedInteger(value, minimum, maximum, fallback) {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid fixture port: ${value}`);
  }
  return port;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function decimalToMinorUnits(value, fractionDigits) {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (match === null) throw new Error("Invalid fixture decimal price");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > fractionDigits) {
    throw new Error("Fixture price exceeds currency precision");
  }
  return Number(`${whole}${fraction.padEnd(fractionDigits, "0")}`);
}

function listen(server, port, hostname) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, hostname, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
