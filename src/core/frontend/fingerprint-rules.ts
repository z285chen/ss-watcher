export const FINGERPRINT_RULESET_VERSION = "public-signals-v1.0.0";

export type FingerprintCategory = "app" | "pixel";
export type FingerprintSignalSurface = "hostname" | "pathname" | "text";

export type FingerprintSignalRule = Readonly<{
  id: string;
  surface: FingerprintSignalSurface;
  pattern: RegExp;
}>;

export type FingerprintRule = Readonly<{
  id: string;
  label: string;
  category: FingerprintCategory;
  maturity: "stable";
  minimumSignals: 2;
  baseConfidence: number;
  signals: readonly FingerprintSignalRule[];
}>;

const h = (id: string, pattern: RegExp): FingerprintSignalRule => ({
  id,
  surface: "hostname",
  pattern,
});
const p = (id: string, pattern: RegExp): FingerprintSignalRule => ({
  id,
  surface: "pathname",
  pattern,
});
const t = (id: string, pattern: RegExp): FingerprintSignalRule => ({
  id,
  surface: "text",
  pattern,
});

function fingerprint(
  id: string,
  label: string,
  category: FingerprintCategory,
  signals: readonly FingerprintSignalRule[],
  baseConfidence = 0.9,
): FingerprintRule {
  return {
    id,
    label,
    category,
    maturity: "stable",
    minimumSignals: 2,
    baseConfidence,
    signals,
  };
}

/**
 * Public-browser fingerprints only. A rule requires two distinct signal groups
 * on the same observed resource; a vendor hostname by itself is deliberately
 * insufficient and signals from unrelated requests are never stitched.
 */
export const FINGERPRINT_RULES: readonly FingerprintRule[] = [
  fingerprint("app.klaviyo", "Klaviyo", "app", [
    h("vendor-host", /(^|\.)static\.klaviyo\.com$/iu),
    p("onsite-loader", /\/(?:onsite\/js|klaviyo(?:\.js)?)(?:\/|$)/iu),
    t("runtime-token", /\b(?:_learnq|KlaviyoSubscribe)\b/u),
  ]),
  fingerprint("app.judgeme", "Judge.me", "app", [
    h("vendor-host", /(^|\.)judge\.me$/iu),
    p("widget-loader", /\/(?:assets\/installed\.js|checkout_comment\.js|judge[-_.]?me|loader|reviews?|widget)/iu),
    t("runtime-token", /\bjdgm[-_.a-zA-Z0-9]*/u),
  ]),
  fingerprint("app.loox", "Loox", "app", [
    h("vendor-host", /(^|\.)(?:loox\.io|loox\.app)$/iu),
    p("widget-loader", /\/(?:loox|widget|reviews?)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:looxReviews|LooxWidgets|loox-rating)\b/iu),
  ]),
  fingerprint("app.yotpo", "Yotpo", "app", [
    h("vendor-host", /(^|\.)staticw2\.yotpo\.com$/iu),
    p("widget-loader", /\/(?:batch|widget|yotpo)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:yotpo-main-widget|yotpoWidgetsContainer)\b/u),
  ]),
  fingerprint("app.stamped", "Stamped.io", "app", [
    h("vendor-host", /(^|\.)stamped\.io$/iu),
    p("widget-loader", /\/(?:files\/widget|widget|stamped)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:StampedFn|stamped-main-badge)\b/u),
  ]),
  fingerprint("app.okendo", "Okendo", "app", [
    h("vendor-host", /(^|\.)okendo\.io$/iu),
    p("widget-loader", /\/(?:loyalty|reviews-widget-plus|shopify|styles\/main|widget)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:okeReviews|oke-star-rating)\b/u),
  ]),
  fingerprint("app.reviewsio", "REVIEWS.io", "app", [
    h("vendor-host", /(^|\.)reviews\.io$/iu),
    p("widget-loader", /\/(?:badge-ribbon|widget|product\/dist|rating)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:ReviewsWidget|ruk_rating_snippet)\b/u),
  ]),
  fingerprint("app.fera", "Fera Reviews", "app", [
    h("vendor-host", /(^|\.)fera\.ai$/iu),
    p("widget-loader", /\/(?:api\/v2\/public|js|static|widget|shopify)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:feraWidget|fera-allReviews)\b/u),
  ]),
  fingerprint("app.trustpilot", "Trustpilot", "app", [
    h("vendor-host", /^widget\.trustpilot\.com$/iu),
    p("widget-loader", /\/bootstrap\/v5\/tp\.widget\.(?:sync\.)?bootstrap\.min\.js$/iu),
    t("runtime-token", /\btrustpilot-widget\b/iu),
  ]),
  fingerprint("app.rebuy", "Rebuy", "app", [
    h("vendor-host", /(^|\.)rebuyengine\.com$/iu),
    p("widget-loader", /\/(?:rebuy|storefront|smartcart)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:Rebuy|rebuyCart)\b/u),
  ]),
  fingerprint("app.gorgias", "Gorgias Chat", "app", [
    h("vendor-host", /(^|\.)gorgias\.chat$/iu),
    p("chat-loader", /\/(?:app|bundle-loader|chat|gorgias-chat|loader)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:GorgiasChat|gorgias-chat)\b/u),
  ]),
  fingerprint("app.tidio", "Tidio Chat", "app", [
    h("vendor-host", /^code\.tidio\.co$/iu),
    p("site-loader", /\/[a-zA-Z0-9_-]{16,}\.js$/u),
    t("runtime-token", /\btidioChatApi\b/u),
  ]),
  fingerprint("app.zendesk", "Zendesk Web Widget", "app", [
    h("vendor-host", /^static\.zdassets\.com$/iu),
    p("widget-loader", /\/(?:ekr\/snippet|web_widget\/(?:messenger|classic)\/latest\/web-widget-main-[a-zA-Z0-9_-]+)\.js$/iu),
    t("runtime-token", /\b(?:zE|zESettings)\b/u),
  ]),
  fingerprint("app.intercom", "Intercom", "app", [
    h("vendor-host", /^widget\.intercom\.io$/iu),
    p("widget-loader", /\/widget\/[a-zA-Z0-9_-]+/u),
    t("runtime-token", /\b(?:Intercom|intercomSettings)\b/u),
  ]),
  fingerprint("app.recharge", "Recharge Subscriptions", "app", [
    h("vendor-host", /(^|\.)(?:rechargecdn\.com|rechargepayments\.com)$/iu),
    p("subscription-loader", /\/(?:storefront|widget|shopify|recharge)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:ReCharge|rechargeWidget)\b/u),
  ]),
  fingerprint("app.appstle", "Appstle Subscriptions", "app", [
    h("vendor-host", /(^|\.)appstle\.com$/iu),
    p("subscription-loader", /\/(?:assets\/js\/appstle|subscription|widget|shopify)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\bappstle[-_.a-zA-Z0-9]*/iu),
  ]),
  fingerprint("app.skio", "Skio Subscriptions", "app", [
    h("vendor-host", /(^|\.)skio\.com$/iu),
    p("subscription-loader", /\/(?:scripts\/shopify|storefront|widget|skio)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:Skio|skio-widget)\b/u),
  ]),
  fingerprint("app.seal-subscriptions", "Seal Subscriptions", "app", [
    h("vendor-host", /(^|\.)sealsubscriptions\.com$/iu),
    p("subscription-loader", /\/shopify\/public\/(?:js\/seal-subscriptions(?:\.min)?|status\/shop\/[^/]+\.myshopify\.com)\.js$/iu),
    t("runtime-token", /\b(?:seal_subscriptions|seal-subscriptions)\b/u),
  ]),
  fingerprint("app.smile", "Smile.io", "app", [
    h("vendor-host", /(^|\.)(?:smile\.io|sweettooth\.io)$/iu),
    p("loyalty-loader", /\/(?:assets\/storefront\.js|js\/v1\/smile-shopify|smile-ui|v1\/images\/launcher_icons)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:SmileUI|smile-shopify)\b/u),
  ]),
  fingerprint("app.loyaltylion", "LoyaltyLion", "app", [
    h("vendor-host", /(^|\.)loyaltylion\.net$/iu),
    p("loyalty-loader", /\/(?:sdk|loader|shopify)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\bloyaltylion\b/iu),
  ]),
  fingerprint("app.privy", "Privy", "app", [
    h("vendor-host", /(^|\.)privy\.com$/iu),
    p("widget-loader", /\/(?:assets\/widget|widget)(?:\.js|\/)/iu),
    t("runtime-token", /\b(?:Privy|_privy)\b/u),
  ]),
  fingerprint("app.omnisend", "Omnisend", "app", [
    h("vendor-host", /(^|\.)omnisrc\.com$/iu),
    p("onsite-loader", /\/(?:inshop|launcher)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\bomnisend[-_.a-zA-Z0-9]*/iu),
  ]),
  fingerprint("app.pushowl", "PushOwl", "app", [
    h("vendor-host", /(^|\.)pushowl\.com$/iu),
    p("push-loader", /\/(?:sdks?|shopify|pushowl)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\bpushowl[-_.a-zA-Z0-9]*/iu),
  ]),
  fingerprint("app.aftership", "AfterShip", "app", [
    h("vendor-host", /(^|\.)(?:aftership\.com|aftershipcdn\.com|automizely-analytics\.com)$/iu),
    p("widget-loader", /\/(?:analytics\/v1\/dc\.js|track|widget|automizely)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\bAfterShip\b/u),
  ]),
  fingerprint("app.route", "Route", "app", [
    h("vendor-host", /(^|\.)routeapp\.io$/iu),
    p("widget-loader", /\/(?:route|widget|shopify)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:RouteWidget|routeapp)\b/u),
  ]),
  fingerprint("app.nosto", "Nosto", "app", [
    h("vendor-host", /^connect\.nosto\.com$/iu),
    p("account-loader", /\/(?:include|script)\/[a-zA-Z0-9_/-]+(?:\.js)?/u),
    t("runtime-token", /\bnostojs\b/u),
  ]),
  fingerprint("app.searchanise", "Searchanise", "app", [
    h("vendor-host", /(^|\.)searchanise\.com$/iu),
    p("search-loader", /\/widgets\/shopify\/init\.js$/iu),
    t("runtime-token", /\bSearchanise\b/u),
  ]),
  fingerprint("app.algolia", "Algolia Search", "app", [
    h("vendor-host", /(^|\.)algolia\.net$/iu),
    p("search-endpoint", /\/(?:1\/indexes|client-search|queries)(?:\/|$)/iu),
    t("runtime-token", /\balgoliasearch\b/u),
  ]),
  fingerprint("app.swym", "Wishlist Plus (Swym)", "app", [
    h("vendor-host", /(^|\.)swymrelay\.com$/iu),
    p("wishlist-loader", /\/(?:api\/v3\/provider|swym|shopify|wishlist)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:_swat|swym)\b/iu),
  ]),
  fingerprint("app.growave", "Growave", "app", [
    h("vendor-host", /(^|\.)growave\.io$/iu),
    p("suite-loader", /\/(?:app|growave-build|widget|shopify)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:growave|ssw-widget)\b/iu),
  ]),
  fingerprint("app.pagefly", "PageFly", "app", [
    h("vendor-host", /(^|\.)pagefly\.io$/iu),
    p("builder-asset", /\/(?:pagefly|cdn|assets?)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:__pf|pf-[a-z][a-z0-9_-]+)\b/iu),
  ]),
  fingerprint("app.gempages", "GemPages", "app", [
    h("vendor-host", /(^|\.)(?:gempages\.net|gemcommerce\.com)$/iu),
    p("builder-asset", /\/(?:assets-v2\/gp-|assets?|shopify|gempages?)[-/.a-zA-Z0-9]*/iu),
    t("runtime-token", /\b(?:GemPage|gp-[a-z][a-z0-9_-]+)\b/iu),
  ]),

  fingerprint("pixel.google-tag", "Google Analytics / Google tag", "pixel", [
    h("vendor-host", /^www\.googletagmanager\.com$/iu),
    p("gtag-loader", /\/gtag\/js$/iu),
    t("runtime-token", /\b(?:gtag|dataLayer)\b/u),
  ], 0.94),
  fingerprint("pixel.meta", "Meta Pixel", "pixel", [
    h("vendor-host", /^connect\.facebook\.net$/iu),
    p("pixel-loader", /\/fbevents\.js$/iu),
    t("runtime-token", /\bfbq\s*\(/u),
  ], 0.95),
  fingerprint("pixel.tiktok", "TikTok Pixel", "pixel", [
    h("vendor-host", /^analytics\.tiktok\.com$/iu),
    p("pixel-loader", /\/i18n\/pixel\/(?:events\.js|static\/[^/]+\.js)$/iu),
    t("runtime-token", /\bttq(?:\.|\[)/u),
  ], 0.94),
  fingerprint("pixel.pinterest", "Pinterest Tag", "pixel", [
    h("vendor-host", /^s\.pinimg\.com$/iu),
    p("pixel-loader", /\/ct\/core\.js$/iu),
    t("runtime-token", /\bpintrk\s*\(/u),
  ], 0.95),
  fingerprint("pixel.snapchat", "Snapchat Pixel", "pixel", [
    h("vendor-host", /^sc-static\.net$/iu),
    p("pixel-loader", /\/scevent\.min\.js$/iu),
    t("runtime-token", /\bsnaptr\s*\(/u),
  ], 0.95),
  fingerprint("pixel.microsoft-uet", "Microsoft Advertising UET", "pixel", [
    h("vendor-host", /^bat\.bing\.com$/iu),
    p("pixel-loader", /\/bat\.js$/iu),
    t("runtime-token", /\buetq\b/u),
  ], 0.95),
  fingerprint("pixel.hotjar", "Hotjar", "pixel", [
    h("vendor-host", /^static\.hotjar\.com$/iu),
    p("tracking-loader", /\/c\/hotjar-[0-9]+\.js$/u),
    t("runtime-token", /\b(?:hjid|hj)\b/u),
  ], 0.94),
  fingerprint("pixel.clarity", "Microsoft Clarity", "pixel", [
    h("vendor-host", /^www\.clarity\.ms$/iu),
    p("tracking-loader", /\/tag\/[a-zA-Z0-9_-]+$/u),
    t("runtime-token", /\bclarity\s*\(/u),
  ], 0.94),
];
