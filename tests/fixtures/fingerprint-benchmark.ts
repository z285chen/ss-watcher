import type { FingerprintResourceInput } from "../../src/core/frontend/fingerprint-engine";
import { FINGERPRINT_POST_FREEZE_HOLDOUT_EVIDENCE } from "./fingerprint-post-freeze-holdout";

export type FingerprintBenchmarkSample = Readonly<{
  sampleId: string;
  split: "development" | "holdout";
  shopKey: string;
  pageUrl: string;
  sourceUrl: string;
  capturedAt: string;
  expectedRuleIds: readonly string[];
  resources: readonly FingerprintResourceInput[];
  kind: "public-positive" | "hard-negative";
}>;

type EvidenceRow = readonly [
  pageUrl: string,
  scanId: string,
  capturedAt: string,
  resourceUrl: string,
];

type EvidenceGroup = Readonly<{
  ruleId: string;
  queryHost: string;
  rows: readonly [EvidenceRow, EvidenceRow, EvidenceRow];
}>;

const g = (
  ruleId: string,
  queryHost: string,
  rows: readonly [EvidenceRow, EvidenceRow, EvidenceRow],
): EvidenceGroup => ({ ruleId, queryHost, rows });

/**
 * Frozen minimal URLs from the original public URLScan research pass. All
 * three rows are development evidence because the rule authors saw them while
 * tuning public-signals-v1.0.0. The independent holdout lives in the separate
 * post-freeze fixture. No response body is copied.
 */
export const FINGERPRINT_PUBLIC_EVIDENCE: readonly EvidenceGroup[] = [
  g("app.klaviyo", "static.klaviyo.com", [
    ["https://posterdaddy.co/", "019f7fd2-30af-748c-ab3f-3f8416c14dca", "2026-07-20T13:58:45.147Z", "https://static.klaviyo.com/onsite/js/Tq4H3u/klaviyo.js"],
    ["https://picturekeeper.com/", "019f7fcf-47a4-71fb-89b5-c531c9d09084", "2026-07-20T13:55:28.086Z", "https://static.klaviyo.com/onsite/js/Hz4q4C/klaviyo.js"],
    ["https://lipsmackingsauces.com/", "019f7fcd-b10b-73cf-adcc-abc81cdc0752", "2026-07-20T13:53:48.257Z", "https://static.klaviyo.com/onsite/js/RBFNLS/klaviyo.js"],
  ]),
  g("app.judgeme", "cdn.judge.me", [
    ["https://packagemate.com.au/collections/mailing-tube-boxes", "019f7fca-d222-7782-b93b-a95e1f4ec4f3", "2026-07-20T13:50:38.914Z", "https://cdn.judge.me/checkout_comment.js"],
    ["https://coc-onlineservice.pl/", "019f7fc3-c87a-743d-ba42-4946919cf281", "2026-07-20T13:42:53.053Z", "https://cdn.judge.me/widget/base.css"],
    ["https://xn--trkkinn-fxa.no/", "019f7fbc-b075-75e0-8058-40abd544ae8f", "2026-07-20T13:35:14.177Z", "https://cdn.judge.me/reviews/reviews_for_carousel"],
  ]),
  g("app.loox", "loox.io", [
    ["https://vogliediseta.com/en", "019f7fbc-516d-725b-bee7-cc726d58eba8", "2026-07-20T13:34:54.715Z", "https://loox.io/widget/bwPFxAsLSF/loox.1693628061838.js"],
    ["https://timetoyellow.com/", "019f7fba-d8d6-7699-866e-c2281aeafd1a", "2026-07-20T13:33:31.679Z", "https://loox.io/widget/EkWH7P3IkF/loox.1594738692731.js"],
    ["https://thestoragelab.com/", "019f7fba-b141-74fe-b7c6-11044b9b9b55", "2026-07-20T13:33:01.947Z", "https://loox.io/widget/F2LcmatFGY/loox.1733851355439.js"],
  ]),
  g("app.yotpo", "staticw2.yotpo.com", [
    ["https://thethrivingwild.co.uk/", "019f7fba-b4ce-7301-a570-170bf3a1ffda", "2026-07-20T13:33:09.836Z", "https://staticw2.yotpo.com/2tZW2uLjIwi436nu7n0ulynEHGoUfoPqK6GnBQod/widget.js"],
    ["https://thefishranch.com/", "019f7fb6-fca5-75a6-bac8-26ffd7de95df", "2026-07-20T13:28:58.031Z", "https://staticw2.yotpo.com/T1ZGefOmQKAVQPDcLUTjOJmSBL4Y9ziGHPjDewih/widget.js"],
    ["https://thecurvygirldepotllc.com/", "019f7fb6-a19f-734b-8c72-5f80766274fc", "2026-07-20T13:28:32.617Z", "https://staticw2.yotpo.com/MrfvlO0a9FSoOh2osMS8Th1HaHjNfKpy84Vh4bmf/widget.js"],
  ]),
  g("app.stamped", "stamped.io", [
    ["https://rejuvco.com/", "019f7fb3-ddc0-71dd-a954-8e195239df2c", "2026-07-20T13:25:59.203Z", "https://cdn1.stamped.io/files/widget.min.js"],
    ["https://roraclothing.com/", "019f7fb3-fc60-7699-a3cf-02526fa721a6", "2026-07-20T13:25:45.098Z", "https://cdn1.stamped.io/files/widget.min.js"],
    ["https://www.pptrailmaps.com/", "019f7fb2-0c2e-725f-925d-36bc20ef1f06", "2026-07-20T13:23:44.470Z", "https://cdn1.stamped.io/files/widget.min.js"],
  ]),
  g("app.okendo", "cdn-static.okendo.io", [
    ["https://picturekeeper.com/", "019f7fcf-47a4-71fb-89b5-c531c9d09084", "2026-07-20T13:55:28.086Z", "https://cdn-static.okendo.io/styles/main.min.css"],
    ["https://xplorermaps.com/", "019f7fbf-c82c-705d-b8e5-925a0d6cc22f", "2026-07-20T13:38:33.085Z", "https://cdn-static.okendo.io/loyalty/js/init-onsite.js"],
    ["https://tworoads.au/", "019f7fbb-145e-7619-a386-e8d05baf9507", "2026-07-20T13:33:32.899Z", "https://cdn-static.okendo.io/reviews-widget-plus/js/okendo-reviews.js"],
  ]),
  g("app.reviewsio", "widget.reviews.io", [
    ["https://tomandteddy.eu/", "019f7fba-e4f1-729f-8723-b5ee8eddc115", "2026-07-20T13:33:13.261Z", "https://widget.reviews.io/product/dist.js"],
    ["https://experimentalperfumeclub.com/en-us/", "019f7fa6-c32a-745d-af75-a8fb62bde767", "2026-07-20T13:11:23.792Z", "https://widget.reviews.io/badge-ribbon/dist.js"],
    ["https://www.schwabenpower.de/", "019f7f4a-5293-7784-a2c4-d4d988dc60ac", "2026-07-20T11:30:15.417Z", "https://widget.reviews.io/rating-snippet/dist.js"],
  ]),
  g("app.fera", "cdn.fera.ai", [
    ["https://nutrimaris.com/", "019f7fb0-825f-7799-8057-ca5cbf67aaac", "2026-07-20T13:21:52.035Z", "https://cdn.fera.ai/js/v3/fera.css"],
    ["https://www.neodrift.in/", "019f7fb0-3a73-7326-b276-6a2ae43b5701", "2026-07-20T13:21:36.468Z", "https://cdn.fera.ai/js/fera.placeholder.js"],
    ["https://lovelybs.com/en-ca", "019f7fad-da12-7008-8cd5-f8e0f1d30163", "2026-07-20T13:19:04.955Z", "https://cdn.fera.ai/js/fera.placeholder.js"],
  ]),
  g("app.trustpilot", "widget.trustpilot.com", [
    ["https://thehalvalab.com/", "019f7fb8-0d21-7239-b239-8442eb6e6f48", "2026-07-20T13:30:07.791Z", "https://widget.trustpilot.com/bootstrap/v5/tp.widget.sync.bootstrap.min.js"],
    ["https://qoozii.com/", "019f7fb2-4254-779f-bfe5-5a14aea2c623", "2026-07-20T13:24:33.512Z", "https://widget.trustpilot.com/bootstrap/v5/tp.widget.sync.bootstrap.min.js"],
    ["https://probiotic.co.uk/", "019f7fb2-19d7-7625-8519-7129927dd0fd", "2026-07-20T13:23:37.245Z", "https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js"],
  ]),
  g("app.rebuy", "cdn.rebuyengine.com", [
    ["https://coc-onlineservice.pl/", "019f7fc3-c87a-743d-ba42-4946919cf281", "2026-07-20T13:42:53.053Z", "https://cdn.rebuyengine.com/onsite/js/rebuy.js"],
    ["https://therancherhatco.com/en-ca", "019f7fba-8f45-71bc-b0f8-1d7d4bb3260d", "2026-07-20T13:33:01.186Z", "https://cdn.rebuyengine.com/onsite/js/rebuy.js"],
    ["https://pupwell.com/en-ca", "019f7fba-7ce3-7602-82ed-a2115f988b8e", "2026-07-20T13:32:49.926Z", "https://cdn.rebuyengine.com/onsite/js/rebuy.js"],
  ]),
  g("app.gorgias", "config.gorgias.chat", [
    ["https://thedownbeatuk.shop/", "019f7fb6-c57a-7083-83aa-5c3e4fdcd4d9", "2026-07-20T13:28:41.136Z", "https://config.gorgias.chat/bundle-loader/shopify/the-downbeat-store.myshopify.com"],
    ["https://bymayberry.co/", "019f7fb5-5d16-751f-ba5a-5f9e878c0436", "2026-07-20T13:27:13.895Z", "https://config.gorgias.chat/bundle-loader/shopify/mx50hi-e0.myshopify.com"],
    ["https://shouldersleeper.com/", "019f7fb5-0880-77e8-809e-c376e7902ad5", "2026-07-20T13:26:50.192Z", "https://config.gorgias.chat/gorgias-chat-bundle.js"],
  ]),
  g("app.tidio", "code.tidio.co", [
    ["https://posterdaddy.co/", "019f7fd2-30af-748c-ab3f-3f8416c14dca", "2026-07-20T13:58:45.147Z", "https://code.tidio.co/widget-v4/1_444_0/static/js/chunk-WidgetIframe-73f109c79aaf9adb34ce.js"],
    ["https://zonaferramenta.it/", "019f7fbd-79e1-743b-a241-a25eecd753e6", "2026-07-20T13:36:06.388Z", "https://code.tidio.co/widget-v4/1_444_0/static/js/chunk-WidgetIframe-73f109c79aaf9adb34ce.js"],
    ["https://zenbamboo.com.au/", "019f7fbd-6e04-75e8-adba-e254d6f23444", "2026-07-20T13:35:58.908Z", "https://code.tidio.co/widget-v4/1_444_0/static/js/chunk-WidgetIframe-73f109c79aaf9adb34ce.js"],
  ]),
  g("app.zendesk", "static.zdassets.com", [
    ["https://store.thisissigrid.com/", "019f7fba-c479-7710-8b99-57748a526979", "2026-07-20T13:33:04.327Z", "https://static.zdassets.com/ekr/snippet.js"],
    ["https://shop.revibecollective.com/", "019f7fb3-e3af-75d7-b90a-4d8bc2cb0622", "2026-07-20T13:25:54.366Z", "https://static.zdassets.com/web_widget/messenger/latest/web-widget-main-cf61b48.js"],
    ["https://www.gargi.shop/", "019f7fa9-d332-70b8-89f1-0b0f7216b0b8", "2026-07-20T13:15:01.181Z", "https://static.zdassets.com/web_widget/classic/latest/web-widget-main-cf61b48.js"],
  ]),
  g("app.intercom", "widget.intercom.io", [
    ["https://www.everystamp.store/", "019f7e5d-8b6f-7389-99ad-cff831b59bac", "2026-07-20T07:11:38.727Z", "https://widget.intercom.io/widget/ij429zwa"],
    ["https://almondcow.co/blogs/pro-milk-recipes/pro-unsweetened-almond-milk", "019f7e35-d284-7284-a1c5-95346f2dd205", "2026-07-20T06:28:35.021Z", "https://widget.intercom.io/widget/imjr2zal"],
    ["https://friiway.com/", "019f7dee-f968-728e-8940-e1922d38cc47", "2026-07-20T05:11:16.785Z", "https://widget.intercom.io/widget/tyuxftlw"],
  ]),
  g("app.recharge", "static.rechargecdn.com", [
    ["https://sfgbiome.com/", "019f7fb4-51ba-735d-9a31-14fedde23174", "2026-07-20T13:26:04.071Z", "https://static.rechargecdn.com/assets/storefront-experiences/storefront-experiences.js"],
    ["https://fishstrong.com/", "019f7fb4-1866-73ab-a9cd-902a2c0c45e9", "2026-07-20T13:25:52.797Z", "https://static.rechargecdn.com/assets/js/widget.min.js"],
    ["https://redbirdcoffee.com/", "019f7fb3-d36f-73b0-b54f-e0f472a3e6c7", "2026-07-20T13:25:49.163Z", "https://static.rechargecdn.com/static/js/recharge.js"],
  ]),
  g("app.appstle", "subscription-admin.appstle.com", [
    ["https://onairwarning.com/", "019f7fc0-6002-7228-b342-ae46d16986cc", "2026-07-20T13:39:21.399Z", "https://subscription-admin.appstle.com/assets/js/appstle-subscription.min.js"],
    ["https://thrivalist.com/", "019f7fba-c92d-7619-b658-30301ec422d7", "2026-07-20T13:33:14.945Z", "https://subscription-admin.appstle.com/assets/js/appstle-subscription.min.js"],
    ["https://thehappyhomeline.com/", "019f7fb8-11db-71c1-a09b-2b6a1fb86f74", "2026-07-20T13:30:12.885Z", "https://subscription-admin.appstle.com/assets/js/appstle-subscription.min.js"],
  ]),
  g("app.skio", "cdn.skio.com", [
    ["https://granolaful.com/", "019f7fce-5045-71fb-bd4a-9c4fe46ae3c5", "2026-07-20T13:54:30.766Z", "https://cdn.skio.com/scripts/shopify/head/shopify.ba9807f79b5cdb6483d5.js"],
    ["https://manukarx.co.nz/a/account/login", "019f7ebf-053f-707e-a793-f785e028933a", "2026-07-20T08:58:05.295Z", "https://cdn.skio.com/scripts/shopify/head/shopify.ba9807f79b5cdb6483d5.js"],
    ["https://www.bonescoffee.com/products/sir-fry-alot-12oz", "019f7da3-1568-76b1-9bb6-8d20e7a4fb20", "2026-07-20T03:47:59.068Z", "https://cdn.skio.com/scripts/shopify/head/shopify.ba9807f79b5cdb6483d5.js"],
  ]),
  g("app.seal-subscriptions", "app.sealsubscriptions.com", [
    ["https://dspiked.com/", "019f7fda-9755-768e-8488-4b91f7de68c3", "2026-07-20T14:07:49.139Z", "https://app.sealsubscriptions.com/shopify/public/status/shop/8da7e2.myshopify.com.js"],
    ["https://bismarck-braeu.de/", "019f7fd7-542a-77d3-bab1-ac44de74c449", "2026-07-20T14:04:54.150Z", "https://app.sealsubscriptions.com/shopify/public/status/shop/bismarck-brau.myshopify.com.js"],
    ["https://ankhlifestore.com/", "019f7fd5-f0ea-751b-9f60-a4652f54f424", "2026-07-20T14:02:49.988Z", "https://app.sealsubscriptions.com/shopify/public/status/shop/ankh-life-store.myshopify.com.js"],
  ]),
  g("app.smile", "cdn.sweettooth.io", [
    ["https://givingunlimited.com/", "019f7af2-1168-7263-a3b3-3da2aa84f134", "2026-07-19T15:15:21.740Z", "https://cdn.sweettooth.io/assets/storefront.js"],
    ["https://www.sumomotoparts.com/", "019f7a56-d3bd-743b-8824-dda030aaed9d", "2026-07-19T12:25:51.649Z", "https://cdn.sweettooth.io/v1/images/launcher_icons/star.svg"],
    ["https://dressconnect.com.br/", "019f7524-a4fa-7550-b814-d33d4f3912cd", "2026-07-18T12:13:04.876Z", "https://cdn.sweettooth.io/v1/images/launcher_icons/star.svg"],
  ]),
  g("app.loyaltylion", "sdk.loyaltylion.net", [
    ["https://enrage.pl/", "019f7fa6-771f-7738-9ca3-f50a39a920c8", "2026-07-20T13:10:52.149Z", "https://sdk.loyaltylion.net/static/2/loader.js"],
    ["https://shop.elvaquero.it/", "019f7fa6-5c5e-77db-97e1-9986d9c674de", "2026-07-20T13:10:48.789Z", "https://sdk.loyaltylion.net/static/2/loader.js"],
    ["https://deliveryhair.com/", "019f7f92-73a3-75a0-aed9-dd03525b8ff2", "2026-07-20T12:49:02.522Z", "https://sdk.loyaltylion.net/static/2/loader.js"],
  ]),
  g("app.privy", "widget.privy.com", [
    ["https://centralbetterwearclothing.com/", "019f7fd8-7d08-72b4-875b-aa90025c73b8", "2026-07-20T14:05:40.059Z", "https://widget.privy.com/assets/widget.js"],
    ["https://builtdifferentathletes.com/", "019f7fd8-50ee-747b-bb35-5ac1c61f930b", "2026-07-20T14:05:31.143Z", "https://widget.privy.com/assets/widget.js"],
    ["https://www.wholesalecamel.com/", "019f7fbc-82b9-74d9-b476-df3b47fb8a41", "2026-07-20T13:34:58.758Z", "https://widget.privy.com/assets/widget.js"],
  ]),
  g("app.omnisend", "omnisrc.com", [
    ["https://shop.tomtommag.com/", "019f7fba-e57e-757e-b718-66582b36ee44", "2026-07-20T13:33:22.906Z", "https://omnisrc.com/inShop/Embed/shopify.js"],
    ["https://account.kalinparts.de/", "019f7fac-9e56-70be-a335-27115fafb785", "2026-07-20T13:17:42.808Z", "https://omnisrc.com/inShop/Embed/shopify.js"],
    ["https://www.ahanacandles.com.au/", "019f7f9e-c973-748d-9b93-f0a082919765", "2026-07-20T13:02:33.327Z", "https://omnisrc.com/inShop/Embed/shopify.js"],
  ]),
  g("app.pushowl", "cdn.pushowl.com", [
    ["https://picturekeeper.com/", "019f7fcf-47a4-71fb-89b5-c531c9d09084", "2026-07-20T13:55:28.086Z", "https://cdn.pushowl.com/latest/sdks/pushowl-shopify.js"],
    ["https://andreas-boutique.com/password", "019f7f9f-0972-73ca-b7d3-7297fb3e026a", "2026-07-20T13:02:50.833Z", "https://cdn.pushowl.com/latest/sdks/pushowl-shopify.js"],
    ["https://victoryflagpoles.com/", "019f7f85-28f0-710b-9e5f-0111d1cd07e7", "2026-07-20T12:34:32.312Z", "https://cdn.pushowl.com/latest/sdks/pushowl-shopify.js"],
  ]),
  g("app.aftership", "automizely-analytics.com", [
    ["https://thedollaquarium.com/", "019f7fb6-bfb2-74c3-85e0-277541aed28e", "2026-07-20T13:28:53.393Z", "https://sdks.automizely-analytics.com/analytics/v1/dc.js"],
    ["https://thedreamdollsbeauty.com/password", "019f7fb6-c961-7177-bd84-8967e80ca7bc", "2026-07-20T13:28:43.318Z", "https://sdks.automizely-analytics.com/analytics/v1/dc.js"],
    ["https://proudlyusa.com/", "019f7fb2-20cf-757b-8812-3c87bc849348", "2026-07-20T13:23:51.123Z", "https://sdks.automizely-analytics.com/analytics/v1/dc.js"],
  ]),
  g("app.route", "cdn.routeapp.io", [
    ["https://goatvintage.ca/", "019f7fdc-b2b3-76cc-9e4f-87afbaba3c60", "2026-07-20T14:10:06.798Z", "https://cdn.routeapp.io/route-widget-shopify/stable/route-widget-shopify-stable.min.js"],
    ["https://lovelycreationsslv.com/password", "019f7fad-db13-70b4-b4d3-7d3c2a6ea536", "2026-07-20T13:19:02.734Z", "https://cdn.routeapp.io/route-widget-shopify/v2/route-widget-shopify-stable-v2.min.js"],
    ["https://proudlyusa.com/", "019f7fb2-20cf-757b-8812-3c87bc849348", "2026-07-20T13:23:51.123Z", "https://cdn.routeapp.io/route-widget-shopify/v2/route-widget-shopify-stable-v2.min.js"],
  ]),
  g("app.nosto", "connect.nosto.com", [
    ["https://www.hollowaysofludlow.com/products/leverint-temple-rod-pendant-light", "019f7f87-7d31-72ad-9b4d-c1eb4d2fb36c", "2026-07-20T12:37:06.627Z", "https://connect.nosto.com/include/shopify-70506643680"],
    ["https://www.princesspolly.com.au/", "019f7d81-08a2-7416-96c7-3bd845472c66", "2026-07-20T03:10:55.734Z", "https://connect.nosto.com/include/script/shopify-7660404818.js"],
    ["https://www.safestyle.us/", "019f7d4e-a541-758a-9540-cb76d2a6d466", "2026-07-20T02:15:48.867Z", "https://connect.nosto.com/script/shopify/market/init.js"],
  ]),
  g("app.searchanise", "searchanise.com", [
    ["https://giftr.my/", "019f7e62-edd8-734b-a747-d845a2f81bab", "2026-07-20T07:17:55.137Z", "https://www.searchanise.com/widgets/shopify/init.js"],
    ["https://meterport.com/", "019f7c04-0f5f-77f2-804d-90d3805281e9", "2026-07-19T20:15:15.084Z", "https://www.searchanise.com/widgets/shopify/init.js"],
    ["https://thecrowdcontroller.com/", "019f7945-f1e2-72c3-ba87-3f8c5a84ecf1", "2026-07-19T07:28:04.227Z", "https://www.searchanise.com/widgets/shopify/init.js"],
  ]),
  g("app.algolia", "algolia.net", [
    ["https://www.staples.ca/", "019f7d3b-a8f3-73bc-a863-e0c079d54872", "2026-07-20T01:55:04.544Z", "https://h5yovykinu-dsn.algolia.net/1/indexes/all/queries"],
    ["https://iceboys.fi/", "019f7c00-6e28-71d2-babd-1232e371ccd8", "2026-07-19T20:10:40.828Z", "https://oaqfcp79mo-dsn.algolia.net/1/indexes/all/queries"],
    ["https://eu.stanley1913.com/", "019f7bcf-f106-702f-9f48-a6978fd23dd7", "2026-07-19T19:17:56.114Z", "https://so4w5ff9lb-dsn.algolia.net/1/indexes/shopify_eu_live_products_international_en/query"],
  ]),
  g("app.swym", "swymrelay.com", [
    ["https://gongaii.com/", "019f7fdf-16b7-74cf-a27b-65a734c0861d", "2026-07-20T14:12:46.644Z", "https://swymstore-v3pro-01.swymrelay.com/api/v3/provider/checkAndGet"],
    ["https://shop.st-andrews.ac.uk/", "019f7fbb-2736-7409-9b16-b1ad001db71c", "2026-07-20T13:33:35.935Z", "https://swymstore-v3free-01.swymrelay.com/api/v3/provider/checkAndGet"],
    ["https://namedcollective.com/", "019f7fdf-5ae1-71c5-9a80-7d8c87d08ac0", "2026-07-20T14:13:12.430Z", "https://swymstore-v3pro-01.swymrelay.com/api/v3/provider/checkAndGet"],
  ]),
  g("app.growave", "static.growave.io", [
    ["https://shop.shelleyhusbandcrochet.com/", "019f7fb4-5db7-77cd-a874-91633ed52be1", "2026-07-20T13:26:14.162Z", "https://static.growave.io/growave-build/main.R8u15mfO.js"],
    ["https://homegrownnurseries.farm/", "019f7fab-f8fe-70b9-957e-774e70896649", "2026-07-20T13:17:18.949Z", "https://static.growave.io/growave-build/main.R8u15mfO.js"],
    ["https://fromthisisland.com/", "019f7fa8-2abf-735b-83c5-6ceb7e5bcb56", "2026-07-20T13:15:05.874Z", "https://static.growave.io/growave-build/main.R8u15mfO.js"],
  ]),
  g("app.pagefly", "cdn.pagefly.io", [
    ["https://workhardergym.com/", "019f7fbc-929e-751d-b303-9a6fa9f55349", "2026-07-20T13:35:02.990Z", "https://cdn.pagefly.io/static/assets/jarallax.min.js"],
    ["https://shop.teamgullit.com/", "019f7fb5-e365-7752-98dc-a35106d3c1a1", "2026-07-20T13:27:54.751Z", "https://cdn.pagefly.io/static/assets/jarallax.min.js"],
    ["https://mission-link.jp/", "019f7faf-0b94-706a-a360-6df54f57bd18", "2026-07-20T13:20:15.693Z", "https://cdn.pagefly.io/pagefly/3.30.16/core/helper.js"],
  ]),
  g("app.gempages", "assets.gemcommerce.com", [
    ["https://www.wonderlyy.com/en-ca", "019f7fbc-900f-7572-9c3c-70e73246d923", "2026-07-20T13:35:07.459Z", "https://assets.gemcommerce.com/assets-v2/gp-button-v7-5.js"],
    ["https://waydesignnow.com.br/", "019f7fbc-6d0b-71bc-82bc-e4e4c155826f", "2026-07-20T13:35:02.797Z", "https://assets.gemcommerce.com/assets-v2/gp-hero-banner-v2-v7-5.js"],
    ["https://shop.fire.org/", "019f7fb6-f7f5-72a9-9646-c74638cc9d30", "2026-07-20T13:28:56.048Z", "https://assets.gemcommerce.com/assets-v2/gp-button-v7-5.js"],
  ]),
  g("pixel.google-tag", "www.googletagmanager.com", [
    ["https://maisonnoora.com/", "019f7fe7-df45-7072-bc48-f8b39ee85786", "2026-07-20T14:22:38.579Z", "https://www.googletagmanager.com/gtag/js"],
    ["https://marchon.co.uk/", "019f7fe7-ed60-74d9-a13a-8dbbfe2623e9", "2026-07-20T14:22:38.239Z", "https://www.googletagmanager.com/gtag/js"],
    ["https://maisonvanite.com/", "019f7fe7-e4d1-75f2-a40c-20e5bc5d147e", "2026-07-20T14:22:37.401Z", "https://www.googletagmanager.com/gtag/js"],
  ]),
  g("pixel.meta", "connect.facebook.net", [
    ["https://maisonnoora.com/", "019f7fe7-df45-7072-bc48-f8b39ee85786", "2026-07-20T14:22:38.579Z", "https://connect.facebook.net/en_US/fbevents.js"],
    ["https://marchon.co.uk/", "019f7fe7-ed60-74d9-a13a-8dbbfe2623e9", "2026-07-20T14:22:38.239Z", "https://connect.facebook.net/en_US/fbevents.js"],
    ["https://maisonvanite.com/", "019f7fe7-e4d1-75f2-a40c-20e5bc5d147e", "2026-07-20T14:22:37.401Z", "https://connect.facebook.net/en_US/fbevents.js"],
  ]),
  g("pixel.tiktok", "analytics.tiktok.com", [
    ["https://ksiclt.com/", "019f7fe2-4df0-76ae-a647-3632d4d2693c", "2026-07-20T14:16:16.549Z", "https://analytics.tiktok.com/i18n/pixel/events.js"],
    ["https://kewusuma.com/", "019f7fe0-dad2-7308-bf59-b5fcaf250c6a", "2026-07-20T14:15:06.184Z", "https://analytics.tiktok.com/i18n/pixel/events.js"],
    ["https://kemeticscienceinstitute.com/", "019f7fe0-abf2-7571-92da-ff4aa464a023", "2026-07-20T14:14:31.786Z", "https://analytics.tiktok.com/i18n/pixel/events.js"],
  ]),
  g("pixel.pinterest", "s.pinimg.com", [
    ["https://kilariajoy.com/", "019f7fe2-038a-7118-b1cd-eca869aaf7cf", "2026-07-20T14:15:59.334Z", "https://s.pinimg.com/ct/core.js"],
    ["https://dippedndiamondz.com/", "019f7fda-5753-746f-a9e6-4c61c1ba9026", "2026-07-20T14:07:43.846Z", "https://s.pinimg.com/ct/core.js"],
    ["https://jisulife.com/", "019f7fac-84bc-707e-b074-95f0a1dd6dcf", "2026-07-20T13:17:47.884Z", "https://s.pinimg.com/ct/core.js"],
  ]),
  g("pixel.snapchat", "sc-static.net", [
    ["https://lushbyleah.com/", "019f7fe5-2985-727f-8b33-abd2c8e6a3ad", "2026-07-20T14:19:32.008Z", "https://sc-static.net/scevent.min.js"],
    ["https://luredbylenny.com/", "019f7fe5-23d0-711f-8419-822bd832bbfa", "2026-07-20T14:19:23.881Z", "https://sc-static.net/scevent.min.js"],
    ["https://namedcollective.com/", "019f7fdf-5ae1-71c5-9a80-7d8c87d08ac0", "2026-07-20T14:13:12.430Z", "https://sc-static.net/scevent.min.js"],
  ]),
  g("pixel.microsoft-uet", "bat.bing.com", [
    ["https://marvelousonmainstreet.com/", "019f7fe8-d3f9-76d9-92d6-8b3192ec20ab", "2026-07-20T14:23:22.831Z", "https://bat.bing.com/bat.js"],
    ["https://loxingtonhatch.com/", "019f7fe3-ff09-717b-ad93-9b1c2f3fd2c6", "2026-07-20T14:18:05.262Z", "https://bat.bing.com/bat.js"],
    ["https://klettertau.de/", "019f7fe2-3754-7658-9006-d53a8a530796", "2026-07-20T14:16:08.049Z", "https://bat.bing.com/bat.js"],
  ]),
  g("pixel.hotjar", "static.hotjar.com", [
    ["https://nurosym.com/pages/scientific-evidence", "019f7fea-080e-716e-abc3-2216aec453da", "2026-07-20T14:25:15.573Z", "https://static.hotjar.com/c/hotjar-2709293.js"],
    ["https://shop.p3global.com/", "019f7fea-05ca-76d8-928b-830876ce9783", "2026-07-20T14:24:53.425Z", "https://static.hotjar.com/c/hotjar-2151718.js"],
    ["https://designersandus.com/", "019f7fda-492e-7025-9232-07f41ad6db10", "2026-07-20T14:07:37.525Z", "https://static.hotjar.com/c/hotjar-6516106.js"],
  ]),
  g("pixel.clarity", "www.clarity.ms", [
    ["https://the-skinconcept.com/account", "019f7feb-4856-74ad-aa8d-c65cc244aa46", "2026-07-20T14:26:13.280Z", "https://www.clarity.ms/tag/bvh7a1p8lg"],
    ["https://eu.bonjourdrink.co/", "019f7fea-fb0a-759c-9954-f06b8ac8ad10", "2026-07-20T14:25:48.935Z", "https://www.clarity.ms/tag/jov2sc2apw"],
    ["https://spatheory.in/", "019f7fea-7c2d-733d-8557-1699f1704507", "2026-07-20T14:25:18.795Z", "https://www.clarity.ms/tag/qc3vva09h7"],
  ]),
];

export const FINGERPRINT_DEVELOPMENT_SAMPLES: readonly FingerprintBenchmarkSample[] =
  FINGERPRINT_PUBLIC_EVIDENCE.flatMap((group) =>
    group.rows.map((row, index) => developmentSample(group, row, index)),
  );

export const FINGERPRINT_HOLDOUT_POSITIVES: readonly FingerprintBenchmarkSample[] =
  FINGERPRINT_POST_FREEZE_HOLDOUT_EVIDENCE.flatMap((group) =>
    group.rows.map((row, index) => holdoutSample(group.ruleId, row, index)),
  );

export const FINGERPRINT_POSITIVE_SAMPLES: readonly FingerprintBenchmarkSample[] = [
  ...FINGERPRINT_DEVELOPMENT_SAMPLES,
  ...FINGERPRINT_HOLDOUT_POSITIVES,
];

/**
 * One hostname-only hard negative per stable rule. These deliberately share
 * the vendor domain while omitting every independent path/body marker.
 */
export const FINGERPRINT_HOLDOUT_NEGATIVES: readonly FingerprintBenchmarkSample[] =
  FINGERPRINT_POST_FREEZE_HOLDOUT_EVIDENCE.map((group, index) => {
    const source = group.rows[0];
    if (source === undefined) {
      throw new TypeError(`missing post-freeze holdout for ${group.ruleId}`);
    }
    const url = new URL(source[3]);
    url.pathname = `/legal/ss-watcher-hard-negative-${index + 1}`;
    url.search = "";
    url.hash = "";
    return {
      sampleId: `negative:${group.ruleId}`,
      split: "holdout",
      shopKey: `negative-${index + 1}.fixture.invalid`,
      pageUrl: `https://negative-${index + 1}.fixture.invalid/`,
      sourceUrl: "local-hard-negative",
      capturedAt: "2026-07-20T00:00:00.000Z",
      expectedRuleIds: [],
      resources: [
        {
          resourceId: `negative-resource-${index + 1}`,
          url: url.href,
        },
      ],
      kind: "hard-negative",
    };
  });

function developmentSample(
  group: EvidenceGroup,
  row: EvidenceRow,
  index: number,
): FingerprintBenchmarkSample {
  const pageUrl = sanitizedPublicPageUrl(row[0]);
  return {
    sampleId: `development:${group.ruleId}:${canonicalShopKey(pageUrl)}:${index + 1}`,
    split: "development",
    shopKey: canonicalShopKey(pageUrl),
    pageUrl,
    sourceUrl: `https://urlscan.io/result/${row[1]}/`,
    capturedAt: row[2],
    expectedRuleIds: [group.ruleId],
    resources: [
      {
        resourceId: `${group.ruleId}:${index + 1}`,
        url: row[3],
      },
    ],
    kind: "public-positive",
  };
}

function holdoutSample(
  ruleId: string,
  row: EvidenceRow,
  index: number,
): FingerprintBenchmarkSample {
  const pageUrl = sanitizedPublicPageUrl(row[0]);
  return {
    sampleId: `holdout:${ruleId}:${canonicalShopKey(pageUrl)}:${index + 1}`,
    split: "holdout",
    shopKey: canonicalShopKey(pageUrl),
    pageUrl,
    sourceUrl: `https://urlscan.io/result/${row[1]}/`,
    capturedAt: row[2],
    expectedRuleIds: [ruleId],
    resources: [
      {
        resourceId: `${ruleId}:holdout:${index + 1}`,
        url: row[3],
      },
    ],
    kind: "public-positive",
  };
}

function sanitizedPublicPageUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href;
}

function canonicalShopKey(value: string): string {
  return new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
}
