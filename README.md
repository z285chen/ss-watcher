# SS Watcher

M0–M2 已完成：本机 MV3 Side Panel 扩展能够识别 Shopify 与 `storefrontKind`，匿名扫描公开产品目录，核验 market/currency/价格来源，生成公开畅销排序、A–D 上新证据和店铺统计，并提供正式产品表及安全的 CSV/JSON 导出。

设计基线见 `docs/DESIGN.md`；M0、M1、M2 的实现证据分别见 `docs/spikes.md`、`docs/m1.md`、`docs/m2.md`。

```bash
npm install
npm test
npm run build
```

本机双端口网络 fixture：

```bash
M0_PORT=0 M0_CROSS_PORT=0 npm run m2:server
M0_TEST_ORIGIN=http://127.0.0.1:<ready 输出端口> npm run test:m2-network
```

对获准测试的自有 Shopify 店铺运行低频 live 门禁：

```bash
M0_SHOPIFY_ORIGIN=https://cheerble.com \
M0_MYSHOPIFY_ORIGIN=https://cheerble.myshopify.com \
npm run test:m2-shopify-live
```

构建后手动加载：

1. Chrome 打开 `chrome://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本目录的 `dist/`，不要选择项目根目录。
3. 打开获准测试的公开 Shopify 店铺，点击扩展图标；只有这次明确点击会取得 `activeTab` 并签发临时 ScanSession。
4. 点击「扫描并分析当前店铺」。完成后 Overview 显示统计、公开畅销 scope/声明、A–D 上新证据与分布；Products 提供搜索、Vendor/Product Type/Tag/库存筛选、排序和分页。
5. 「产品 CSV」同时下载 RFC 4180 CSV 与 `.meta.json` sidecar；「完整 JSON」保留原始字段和 committed 快照元数据。
6. 每次重新构建后，在扩展卡片点击「重新加载」再验收。扩展重载、导航、切换标签或 Chrome 窗口失焦会按设计吊销旧会话，但不会删除已提交快照；重新点击扩展图标即可授权。

边界：只处理匿名公开信息，固定 `credentials: "omit"`，不跟随重定向；不调用 PPSpy 私有接口，不复制其 UI/代码，不提供销量间谍、流量或广告历史。
