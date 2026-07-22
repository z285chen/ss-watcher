export type PostFreezeEvidenceRow = readonly [
  pageUrl: string,
  scanId: string,
  capturedAt: string,
  resourceUrl: string,
];

export type PostFreezeEvidenceGroup = Readonly<{
  ruleId: string;
  rows: readonly PostFreezeEvidenceRow[];
}>;

const h = (
  ruleId: string,
  rows: readonly PostFreezeEvidenceRow[],
): PostFreezeEvidenceGroup => ({ ruleId, rows });

/**
 * Public URLScan results selected only after public-signals-v1.0.0 and the
 * same-resource two-signal rule were frozen. These rows were never used to
 * modify a rule. Capture timestamps can predate selection; the result was not
 * part of the development fixture until this sealed holdout pass.
 *
 * Query strings and fragments are removed from page/resource URLs. Algolia has
 * two rows because the newest third result was already in the development set.
 */
export const FINGERPRINT_POST_FREEZE_HOLDOUT_EVIDENCE: readonly PostFreezeEvidenceGroup[] = [
  h("app.klaviyo", [
    ["https://trywisdom.com/", "019f8776-c90d-77c2-9736-06f585bab6df", "2026-07-22T01:36:02.539Z", "https://static.klaviyo.com/onsite/js/WrbBq2/klaviyo.js"],
    ["https://truewestmagazine.myshopify.com/", "019f8776-c432-71c1-bdd2-817d15afa00a", "2026-07-22T01:35:57.931Z", "https://static.klaviyo.com/onsite/js/VmUmrS/klaviyo.js"],
    ["https://theimperialluxe.com/", "019f8776-7914-74d6-b7c9-82fe0f94dcab", "2026-07-22T01:35:28.721Z", "https://static.klaviyo.com/onsite/js/WH3X3E/klaviyo.js"],
  ]),
  h("app.judgeme", [
    ["https://urbannaturals.co.nz/", "019f8776-ee00-754f-83e5-3199240913b0", "2026-07-22T01:35:56.975Z", "https://cdn.judge.me/reviews/reviews_for_carousel"],
    ["https://thefaceshop-jo.com/", "019f8776-69b5-75b4-84d7-6829e97139a0", "2026-07-22T01:35:25.592Z", "https://cdn.judge.me/loader.js"],
    ["https://www.suneetalondon.co.uk/", "019f8775-5f8f-70f8-b05f-67dcd78783f4", "2026-07-22T01:34:27.653Z", "https://cdn.judge.me/reviews/reviews_for_carousel"],
  ]),
  h("app.loox", [
    ["https://themapstores.com/", "019f8776-7f1d-72e6-8407-fda419991787", "2026-07-22T01:36:00.128Z", "https://loox.io/widget/N1-6l3KDfa/loox.1665047772503.js"],
    ["https://thetruemandingos.com/", "019f8776-93e7-7388-94b4-e430c34184c6", "2026-07-22T01:35:40.347Z", "https://loox.io/widget/9AuvD5AWVe/loox.1700710197876.js"],
    ["https://tech4smartlife.com/", "019f8775-7802-71fc-b0ee-3913f69e78d6", "2026-07-22T01:34:20.154Z", "https://loox.io/widget/NybvibiyCK/loox.1610003078724.js"],
  ]),
  h("app.yotpo", [
    ["https://travelstylemood.com/en-ca", "019f8776-bb12-7040-b93d-22683e040a5a", "2026-07-22T01:35:59.891Z", "https://staticw2.yotpo.com/nsfvtHx2bXdO2ozeTLDMBA7jLSzEPDrrMKciQCjU/widget.js"],
    ["https://www.sproutdesignlab.com/", "019f8775-2a0a-7517-894d-058a27cd1dca", "2026-07-22T01:34:12.830Z", "https://staticw2.yotpo.com/ggO4bxdUmsokx4I9wmbN7gyD4STOIjQ8fbqKlxtP/widget.js"],
    ["https://www.solomissionclothing.com/", "019f8774-fe40-7301-a368-c4b13781d828", "2026-07-22T01:33:53.751Z", "https://staticw2.yotpo.com//widget.js"],
  ]),
  h("app.stamped", [
    ["https://www.togethernomad.com/", "019f8776-ad90-72a3-bbf0-2c2f2e06e57e", "2026-07-22T01:35:39.966Z", "https://cdn1.stamped.io/files/widget.min.js"],
    ["https://polkiandyou.com/", "019f8770-3ca8-74d4-aaa1-12f1a5057f92", "2026-07-22T01:29:05.512Z", "https://cdn1.stamped.io/files/widget.min.js"],
    ["https://barefootscientist.com/", "019f8770-5dc3-760e-9701-66f0012ee016", "2026-07-22T01:28:48.581Z", "https://cdn1.stamped.io/files/widget.min.js"],
  ]),
  h("app.okendo", [
    ["https://thefete.com/", "019f8778-02b3-74aa-9f6d-cbdec21119b1", "2026-07-22T01:37:06.172Z", "https://cdn-static.okendo.io/reviews-widget-plus/js/okendo-reviews.js"],
    ["https://www.prescription-swimming-goggles.co.uk/", "019f8770-5f97-740c-a0bd-1870a3ba47ce", "2026-07-22T01:28:58.481Z", "https://cdn-static.okendo.io/referrals/js/referrals-api.js"],
    ["https://111skin.com/en-us", "019f8758-38cf-773d-9f3d-7ee7d2489a6e", "2026-07-22T01:02:48.141Z", "https://cdn-static.okendo.io/reviews-widget-plus/js/okendo-reviews.js"],
  ]),
  h("app.reviewsio", [
    ["https://www.justhorseriders.co.uk/", "019f8766-cb97-7444-9782-21eedf0ed6fb", "2026-07-22T01:18:42.733Z", "https://widget.reviews.io/rating-snippet/dist.js"],
    ["https://www.hatemeloveme.com/de-na", "019f8764-663c-752a-ac7a-a57cd657e0c2", "2026-07-22T01:15:41.231Z", "https://widget.reviews.io/carousel-inline-iframeless/dist.js"],
    ["https://gadgetbag.co.uk/password", "019f8762-1d7e-718d-8e38-3062e14efc83", "2026-07-22T01:13:10.430Z", "https://widget.reviews.io/rating-snippet/dist.js"],
  ]),
  h("app.fera", [
    ["https://www.meta360fitness.com/", "019f876b-6272-7578-beea-23f0ce9d0608", "2026-07-22T01:23:36.205Z", "https://cdn.fera.ai/js/fera.js"],
    ["https://lerinnbeauty.com/", "019f8768-b7e9-7217-b204-b53e62801a1e", "2026-07-22T01:20:43.372Z", "https://cdn.fera.ai/js/fera.placeholder.js"],
    ["https://indipeepal.com/", "019f8765-fd3b-753a-a644-c6961c7a8ab0", "2026-07-22T01:17:35.666Z", "https://cdn.fera.ai/js/v3/fera.css"],
  ]),
  h("app.trustpilot", [
    ["https://shop.vinyljunkie.uk/", "019f8777-2fc3-703d-8709-749c2936c127", "2026-07-22T01:36:17.951Z", "https://widget.trustpilot.com/bootstrap/v5/tp.widget.sync.bootstrap.min.js"],
    ["https://www.visagri.it/", "019f8777-35d7-70e2-9cca-3637d9b6bd0c", "2026-07-22T01:36:12.419Z", "https://widget.trustpilot.com/bootstrap/v5/tp.widget.sync.bootstrap.min.js"],
    ["https://shop.tena.fr/", "019f8775-871e-7198-b607-56fc45af1a9d", "2026-07-22T01:34:26.226Z", "https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js"],
  ]),
  h("app.rebuy", [
    ["https://bitetoothpastebits.com/", "019f876f-c74a-7087-bf5f-de939f098107", "2026-07-22T01:28:08.654Z", "https://cdn.rebuyengine.com/onsite/js/rebuy.js"],
    ["https://pestects.co.uk/", "019f876f-2fe7-70bb-bfc2-01e4f9eb1a64", "2026-07-22T01:27:53.573Z", "https://cdn.rebuyengine.com/onsite/js/rebuy.js"],
    ["https://giantchemistharbourtown.com.au/", "019f8762-f1ce-74a8-91e1-7a467c3fbfb6", "2026-07-22T01:14:09.275Z", "https://cdn.rebuyengine.com/onsite/js/rebuy.js"],
  ]),
  h("app.gorgias", [
    ["https://bitetoothpastebits.com/", "019f876f-c74a-7087-bf5f-de939f098107", "2026-07-22T01:28:08.654Z", "https://config.gorgias.chat/gorgias-chat-bundle-loader.js"],
    ["https://www.nurserywarehouse.com.au/", "019f876d-60f8-75c4-babe-044dd3eba3df", "2026-07-22T01:25:32.376Z", "https://config.gorgias.chat/bundle-loader/shopify/6071f9-3d.myshopify.com"],
    ["https://prints.mikkeller.com/", "019f876b-75b2-724c-ac31-adc9b64e0234", "2026-07-22T01:23:56.501Z", "https://config.gorgias.chat/gorgias-chat-bundle.js"],
  ]),
  h("app.tidio", [
    ["https://theimperialluxe.com/", "019f8776-7914-74d6-b7c9-82fe0f94dcab", "2026-07-22T01:35:28.721Z", "https://code.tidio.co/widget-v4/1_445_0/static/js/chunk-WidgetIframe-bf78af1c95cff1ac6343.js"],
    ["https://tesorofinejewelry.com/", "019f8775-8dbd-765f-841a-68493b3222c5", "2026-07-22T01:34:30.005Z", "https://code.tidio.co/widget-v4/1_445_0/static/js/chunk-WidgetIframe-bf78af1c95cff1ac6343.js"],
    ["https://smfit.bg/", "019f8775-375e-746e-b670-16bf18d7b5c8", "2026-07-22T01:34:09.862Z", "https://code.tidio.co/widget-v4/1_445_0/static/js/chunk-WidgetIframe-bf78af1c95cff1ac6343.js"],
  ]),
  h("app.zendesk", [
    ["https://shop.tena.fr/", "019f8775-871e-7198-b607-56fc45af1a9d", "2026-07-22T01:34:26.226Z", "https://static.zdassets.com/web_widget/messenger/latest/web-widget-main-60051f3.js"],
    ["https://razvajanja.si/", "019f8771-da51-764a-b383-5c3fb77710bf", "2026-07-22T01:30:24.999Z", "https://static.zdassets.com/web_widget/classic/latest/web-widget-main-60051f3.js"],
    ["https://kodak.photosys.com/", "019f8770-0739-741e-b061-a314267a8ce7", "2026-07-22T01:28:37.993Z", "https://static.zdassets.com/web_widget/classic/latest/web-widget-main-60051f3.js"],
  ]),
  h("app.intercom", [
    ["https://miamistar.com/", "019f8731-9a0a-74b9-96bb-17f3294fd83b", "2026-07-22T00:20:19.215Z", "https://widget.intercom.io/widget/o2uvkn5p"],
    ["https://billybubbles.com/", "019f86a9-50f3-733b-8682-3f148687945f", "2026-07-21T21:51:22.464Z", "https://widget.intercom.io/widget/kq6rhpff"],
    ["https://lumos.tech/", "019f8656-79a3-71cc-b18b-5efd5fdd74d8", "2026-07-21T20:21:07.131Z", "https://widget.intercom.io/widget/m3jc7i1o"],
  ]),
  h("app.recharge", [
    ["https://vibrantsea.ca/", "019f8777-1cd6-767b-89a8-34b60a540938", "2026-07-22T01:36:09.207Z", "https://static.rechargecdn.com/assets/js/widget.min.js"],
    ["https://tkftackle.com/en-ca", "019f8776-a580-77b2-91a5-bd81d915e19a", "2026-07-22T01:35:44.147Z", "https://static.rechargecdn.com/assets/js/widget.min.js"],
    ["https://thetruemandingos.com/", "019f8776-93e7-7388-94b4-e430c34184c6", "2026-07-22T01:35:40.347Z", "https://static.rechargecdn.com/assets/js/widget.min.js"],
  ]),
  h("app.appstle", [
    ["https://vertical.coffee/", "019f8777-131e-750b-819f-2d73300a357c", "2026-07-22T01:36:09.851Z", "https://subscription-admin.appstle.com/assets/js/appstle-subscription.min.js"],
    ["https://pestects.co.uk/", "019f876f-2fe7-70bb-bfc2-01e4f9eb1a64", "2026-07-22T01:27:53.573Z", "https://subscription-admin.appstle.com/assets/js/appstle-subscription.min.js"],
    ["https://www.nooi.life/", "019f876d-4ea0-7101-a743-0066ae35539d", "2026-07-22T01:25:45.901Z", "https://subscription-admin.appstle.com/assets/js/appstle-subscription.min.js"],
  ]),
  h("app.skio", [
    ["https://buy.milacares.com/en-ca", "019f8731-a971-779a-bf37-22b7c66eb880", "2026-07-22T00:20:25.159Z", "https://cdn.skio.com/scripts/shopify/head/shopify.ba9807f79b5cdb6483d5.js"],
    ["https://stradpizza.com/", "019f86d3-110c-7625-bfd7-ce4da537d663", "2026-07-21T22:36:55.411Z", "https://cdn.skio.com/scripts/shopify/head/shopify.ba9807f79b5cdb6483d5.js"],
    ["https://shop.lifepharm.com/", "019f8656-1835-740b-ba5b-bdc33bc5812d", "2026-07-21T20:20:52.290Z", "https://cdn.skio.com/scripts/shopify/head/shopify.ba9807f79b5cdb6483d5.js"],
  ]),
  h("app.seal-subscriptions", [
    ["https://trywisdom.com/", "019f8776-c90d-77c2-9736-06f585bab6df", "2026-07-22T01:36:02.539Z", "https://app.sealsubscriptions.com/shopify/public/status/shop/ecb5d7-2.myshopify.com.js"],
    ["https://thesecretskincare.com/", "019f8776-8d08-7029-9002-9d34a6f18ad8", "2026-07-22T01:35:33.770Z", "https://app.sealsubscriptions.com/shopify/public/status/shop/the-secret-partnership-pty-ltd.myshopify.com.js"],
    ["https://www.skincareboulevard.be/", "019f8774-1058-73db-9dc2-df280fd21101", "2026-07-22T01:32:57.065Z", "https://app.sealsubscriptions.com/shopify/public/status/shop/skincare-boulevard.myshopify.com.js"],
  ]),
  h("app.smile", [
    ["https://www.zestandzing.com/", "019f8778-6bef-775d-ac27-ef58deb87a47", "2026-07-22T01:37:37.004Z", "https://js.smile.io/v1/smile-shopify.js"],
    ["https://st-argo.com/", "019f8775-2ea7-74ef-abfe-d82972d7be50", "2026-07-22T01:34:04.555Z", "https://js.smile.io/v1/smile-shopify.js"],
    ["https://silkylicious.com/", "019f8773-fa14-7308-a713-528f4e18ba50", "2026-07-22T01:33:16.178Z", "https://js.smile.io/v1/smile-shopify.js"],
  ]),
  h("app.loyaltylion", [
    ["https://www.mapleleafpromotions.ca/", "019f876a-46ee-703b-bdf7-0baaace68bd2", "2026-07-22T01:22:19.206Z", "https://sdk.loyaltylion.net/static/2/loader.js"],
    ["https://www.loquetlondon.com/", "019f8769-be6a-77bf-9a8d-401423d27e4f", "2026-07-22T01:21:56.848Z", "https://sdk.loyaltylion.net/static/2/loader.js"],
    ["https://111skin.com/en-us", "019f8758-38cf-773d-9f3d-7ee7d2489a6e", "2026-07-22T01:02:48.141Z", "https://sdk.loyaltylion.net/static/2/20260722/loader.js"],
  ]),
  h("app.privy", [
    ["https://www.wallpops.co.uk/", "019f8777-f3d5-713a-91ed-b4f7c7dc1ffe", "2026-07-22T01:37:02.238Z", "https://widget.privy.com/assets/widget.js"],
    ["https://toyota-hotaru.com/", "019f8776-b660-73b8-944c-52ce90aad30a", "2026-07-22T01:36:08.381Z", "https://widget.privy.com/assets/widget.js"],
    ["https://theimperialluxe.com/", "019f8776-7914-74d6-b7c9-82fe0f94dcab", "2026-07-22T01:35:28.721Z", "https://widget.privy.com/assets/widget.js"],
  ]),
  h("app.omnisend", [
    ["https://www.wallpops.co.uk/", "019f8777-f3d5-713a-91ed-b4f7c7dc1ffe", "2026-07-22T01:37:02.238Z", "https://omnisrc.com/inShop/Embed/shopify.js"],
    ["https://www.chicmoda.com/", "019f875b-c5bf-75da-802d-96359721bfd3", "2026-07-22T01:06:34.723Z", "https://omnisrc.com/inShop/Embed/shopify.js"],
    ["https://untouchables.ca/", "019f873b-8b25-7353-9a8f-8cf8d708aae9", "2026-07-22T00:31:14.409Z", "https://omnisrc.com/inShop/Embed/shopify.js"],
  ]),
  h("app.pushowl", [
    ["https://workmenwear.com/", "019f8778-3b25-7167-9ac4-f6ba8ea5a935", "2026-07-22T01:37:29.188Z", "https://cdn.pushowl.com/latest/sdks/pushowl-shopify.js"],
    ["https://www.meta360fitness.com/", "019f876b-6272-7578-beea-23f0ce9d0608", "2026-07-22T01:23:36.205Z", "https://cdn.pushowl.com/latest/sdks/pushowl-shopify.js"],
    ["https://fenixegg.com/", "019f8761-99e1-76b2-a802-9fbf1077db99", "2026-07-22T01:12:54.439Z", "https://cdn.pushowl.com/latest/sdks/pushowl-shopify.js"],
  ]),
  h("app.aftership", [
    ["https://www.classictitanium.com/", "019f8777-7115-734d-bbae-d9bb8856d7b0", "2026-07-22T01:36:58.310Z", "https://sdks.automizely-analytics.com/analytics/v1/dc.js"],
    ["https://tesorofinejewelry.com/", "019f8775-8dbd-765f-841a-68493b3222c5", "2026-07-22T01:34:30.005Z", "https://sdks.automizely-analytics.com/analytics/v1/dc.js"],
    ["https://www.sigridolsen.com/", "019f8773-f5c6-72ce-b4b8-836449d30670", "2026-07-22T01:32:44.739Z", "https://sdks.automizely-analytics.com/analytics/v1/dc.js"],
  ]),
  h("app.route", [
    ["https://www.ubarandco.com/", "019f8776-d920-73af-9beb-c2e1d45061b6", "2026-07-22T01:36:14.650Z", "https://cdn.routeapp.io/route-widget-shopify/v2/route-widget-shopify-stable-v2.min.js"],
    ["https://siouxsievee.com/password", "019f8773-fc93-7014-86f3-250fd0379594", "2026-07-22T01:32:55.255Z", "https://cdn.routeapp.io/route-widget-shopify/v2/route-widget-shopify-stable-v2.min.js"],
    ["https://myamericanbadass.com/", "019f876c-c9d0-772f-a0a3-3e22112aee8b", "2026-07-22T01:24:50.246Z", "https://cdn.routeapp.io/route-widget-shopify/v2/route-widget-shopify-stable-v2.min.js"],
  ]),
  h("app.nosto", [
    ["https://www.finsbury-shoes.com/", "019f86f2-912f-7348-b887-c4a986e68de2", "2026-07-21T23:11:35.394Z", "https://connect.nosto.com/include/shopify-89823543633"],
    ["https://www.lspace.com/collections/new-arrivals", "019f86bb-cf66-708a-bd48-78ad1b73363a", "2026-07-21T22:11:47.666Z", "https://connect.nosto.com/ev1"],
    ["https://sportstationshop.com/", "019f869b-f0c6-765f-b0e6-5f9492860a1e", "2026-07-21T21:36:51.525Z", "https://connect.nosto.com/include/script/shopify-55073276117.js"],
  ]),
  h("app.searchanise", [
    ["https://www.colourflooring.co.uk/", "019f86b8-5a3c-76ec-bb8c-c65b09d91b17", "2026-07-21T22:07:51.185Z", "https://www.searchanise.com/widgets/shopify/init.js"],
    ["https://bonito.hu/", "019f84ca-c842-77bb-986e-1371b5f07628", "2026-07-21T13:08:47.997Z", "https://www.searchanise.com/widgets/shopify/init.js"],
    ["https://4littleblossoms.com/", "019f83e9-201b-7718-8e84-1d86651ca4bc", "2026-07-21T09:02:16.158Z", "https://www.searchanise.com/widgets/shopify/init.js"],
  ]),
  h("app.algolia", [
    ["https://olaplex.com/", "019f828b-6b36-742a-ad00-c358de5f8d2b", "2026-07-21T02:40:26.270Z", "https://d3jw7o24m6-dsn.algolia.net/1/indexes/shopify_products/query"],
    ["https://www.lawsonproducts.com/", "019f7ffb-391d-743d-a69d-9d1af8177908", "2026-07-20T14:43:28.686Z", "https://kr15fczds1-dsn.algolia.net/1/indexes/shopify_products/query"],
  ]),
  h("app.swym", [
    ["https://www.ubarandco.com/", "019f8776-d920-73af-9beb-c2e1d45061b6", "2026-07-22T01:36:14.650Z", "https://freecdn.swymrelay.com/code/v3/apps.bundle.js"],
    ["https://www.vadepekes.com/", "019f8776-f98e-72c5-bfbb-e884f171185a", "2026-07-22T01:36:12.289Z", "https://freecdn.swymrelay.com/code/v3/apps.bundle.js"],
    ["https://toyota-hotaru.com/", "019f8776-b660-73b8-944c-52ce90aad30a", "2026-07-22T01:36:08.381Z", "https://swymstore-v3free-01.swymrelay.com/api/v3/provider/checkAndGet"],
  ]),
  h("app.growave", [
    ["https://yeinyoung.com/", "019f8778-5c31-714d-b80f-2a263d395c0e", "2026-07-22T01:37:30.923Z", "https://static.growave.io/growave-build/main.CdT34eBV.js"],
    ["https://yamamasa-koyamaen.com/", "019f8778-51fc-7534-bff4-c43b212136ad", "2026-07-22T01:37:28.095Z", "https://static.growave.io/instagram-build/main.w4NBAXR7.js"],
    ["https://smfit.bg/", "019f8775-375e-746e-b670-16bf18d7b5c8", "2026-07-22T01:34:09.862Z", "https://static.growave.io/growave-build/main.CdT34eBV.js"],
  ]),
  h("app.pagefly", [
    ["https://sorbables.com/", "019f8775-0754-766b-927a-8e51ac8e8b9c", "2026-07-22T01:34:17.155Z", "https://cdn.pagefly.io/static/assets/jarallax.min.js"],
    ["https://powerquadfitness.com/", "019f8770-5a2b-73ad-baab-03874cf406b9", "2026-07-22T01:28:46.340Z", "https://cdn.pagefly.io/pagefly/4.13.5/core/helper.js"],
    ["https://datingwithkaty.com/", "019f875d-8cfd-7165-b798-8aab86998978", "2026-07-22T01:08:12.975Z", "https://cdn.pagefly.io/pagefly/4.9.2/core/helper.js"],
  ]),
  h("app.gempages", [
    ["https://solis.de/", "019f8774-fc0c-7565-8082-826d1dddc2ca", "2026-07-22T01:33:48.837Z", "https://assets.gemcommerce.com/assets-v2/gp-button-v7-5.js"],
    ["https://respivox.com/", "019f8772-0ec5-705e-a57d-e2c31943cb8e", "2026-07-22T01:30:47.417Z", "https://assets.gemcommerce.com/assets-v2/gp-lazyload.v2.js"],
    ["https://shop.rcntechnologies.com/", "019f8771-dee6-776f-93ce-63ca7416ef6b", "2026-07-22T01:30:28.114Z", "https://assets.gemcommerce.com/assets-v2/gp-button-v7-5.js"],
  ]),
  h("pixel.google-tag", [
    ["https://cabinhold.com/", "019f877c-0f8f-7639-afd5-c5447aa80315", "2026-07-22T01:41:34.875Z", "https://www.googletagmanager.com/gtag/js"],
    ["https://www.cafebritt.com/", "019f877b-2356-775e-8f73-a73793cee103", "2026-07-22T01:40:58.648Z", "https://www.googletagmanager.com/gtag/js"],
    ["https://www.theglitterdoctor.com/", "019f877b-1bbf-7228-ba28-b293ebed56fc", "2026-07-22T01:40:33.617Z", "https://www.googletagmanager.com/gtag/js"],
  ]),
  h("pixel.meta", [
    ["https://www.cafebritt.com/", "019f877b-2356-775e-8f73-a73793cee103", "2026-07-22T01:40:58.648Z", "https://connect.facebook.net/en_US/fbevents.js"],
    ["https://bella-liscious.com.au/", "019f877b-1eeb-7318-ab8d-715514072515", "2026-07-22T01:40:33.901Z", "https://connect.facebook.net/en_US/fbevents.js"],
    ["https://www.theglitterdoctor.com/", "019f877b-1bbf-7228-ba28-b293ebed56fc", "2026-07-22T01:40:33.617Z", "https://connect.facebook.net/en_US/fbevents.js"],
  ]),
  h("pixel.tiktok", [
    ["https://viralgiftsdaily.com/", "019f8777-335b-7219-a21b-35ed3eb86c24", "2026-07-22T01:36:21.550Z", "https://analytics.tiktok.com/i18n/pixel/events.js"],
    ["https://bvabbigliamento.com/", "019f8772-65cc-7548-a9ce-ad7a62f221bd", "2026-07-22T01:30:59.102Z", "https://analytics.tiktok.com/i18n/pixel/events.js"],
    ["https://www.queenou.com/", "019f8770-ba33-74b9-9b45-7754242117f6", "2026-07-22T01:29:16.551Z", "https://analytics.tiktok.com/i18n/pixel/events.js"],
  ]),
  h("pixel.pinterest", [
    ["https://www.warmi.org/", "019f8777-f63e-7229-af6a-2fb9e1bc2ee1", "2026-07-22T01:37:07.298Z", "https://s.pinimg.com/ct/core.js"],
    ["https://shop.stoneponyonline.com/", "019f8775-4cdb-7589-b96a-4dac213a46c3", "2026-07-22T01:34:09.658Z", "https://s.pinimg.com/ct/core.js"],
    ["https://peerieshop.co.uk/", "019f876f-22f3-715e-b20b-488b479c8588", "2026-07-22T01:27:25.261Z", "https://s.pinimg.com/ct/core.js"],
  ]),
  h("pixel.snapchat", [
    ["https://shop.wodumedia.com/", "019f8778-29b9-7161-a25c-4423ec41484a", "2026-07-22T01:37:17.380Z", "https://sc-static.net/scevent.min.js"],
    ["https://winnerofvictories.com/", "019f8778-24d5-764c-8486-c006cddc1360", "2026-07-22T01:37:16.363Z", "https://sc-static.net/scevent.min.js"],
    ["https://vembley.com/", "019f8777-119e-70c2-87c8-f74e66d30874", "2026-07-22T01:36:13.370Z", "https://sc-static.net/scevent.min.js"],
  ]),
  h("pixel.microsoft-uet", [
    ["https://shop.wodumedia.com/", "019f8778-29b9-7161-a25c-4423ec41484a", "2026-07-22T01:37:17.380Z", "https://bat.bing.com/bat.js"],
    ["https://urbn-chic.myshopify.com/", "019f8776-ef2d-7143-a63b-b275b0f0ceb5", "2026-07-22T01:36:12.159Z", "https://bat.bing.com/bat.js"],
    ["https://thewaterfiltermen.ie/", "019f8776-9a15-70dc-9ef7-67d93c3f8ec5", "2026-07-22T01:35:44.447Z", "https://bat.bing.com/bat.js"],
  ]),
  h("pixel.hotjar", [
    ["https://shop.rcntechnologies.com/", "019f8771-dee6-776f-93ce-63ca7416ef6b", "2026-07-22T01:30:28.114Z", "https://static.hotjar.com/c/hotjar-6449405.js"],
    ["https://shop.justforkix.com/", "019f8766-c955-7478-8a8d-f90db2c16330", "2026-07-22T01:18:19.940Z", "https://static.hotjar.com/c/hotjar-3586039.js"],
    ["https://annetteundheim.com/", "019f8766-20c3-7432-9dd1-ef3f6edb524a", "2026-07-22T01:17:39.101Z", "https://static.hotjar.com/c/hotjar-3336591.js"],
  ]),
  h("pixel.clarity", [
    ["https://www.butterflies-eyecare.co.uk/", "019f877c-ddaa-72e4-bb4b-274fa170d1d0", "2026-07-22T01:42:27.207Z", "https://www.clarity.ms/tag/uet/343046559"],
    ["https://zielcosmetics.com.br/", "019f8778-70e6-7641-8f74-dce6ff91d60b", "2026-07-22T01:38:14.818Z", "https://www.clarity.ms/tag/tivrr8ykmn"],
    ["https://www.zestandzing.com/", "019f8778-6bef-775d-ac27-ef58deb87a47", "2026-07-22T01:37:37.004Z", "https://www.clarity.ms/tag/wf3hxp7r8n"],
  ]),
];
