# SS Watcher

M0–M3 已完成：本机 MV3 Side Panel 扩展能够识别 Shopify 与 `storefrontKind`，匿名扫描公开产品目录，核验 market/currency/价格来源，生成公开畅销排序、A–D 上新证据和店铺统计，并提供正式产品表及安全的 CSV/JSON 导出。M3 Frontend Intelligence 的受限资源清单、同源公开文本哈希、external source-map 派生、轻量静态分析、40 条稳定 App/Pixel 规则、Technology 页面，以及与普通快照隔离的显式公开源码导出均已通过自动门禁和最终 Chrome 验收。

设计基线见 `docs/DESIGN.md`；阶段证据见 `docs/spikes.md`、`docs/m1.md`、`docs/m2.md`、`docs/m3.md`。

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- npm（随受支持的 Node.js 版本安装）
- Chrome 116 或更高版本

## 获取与构建

```bash
git clone https://github.com/z285chen/ss-watcher.git
cd ss-watcher
npm ci
npm test
npm run build
npm run test:m3-fingerprints
```

本机双端口网络 fixture：

```bash
M0_PORT=0 M0_CROSS_PORT=0 npm run m3:server
M0_TEST_ORIGIN=http://127.0.0.1:<ready 输出端口> npm run test:m3-network
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
3. 打开获准测试的公开 Shopify 店铺，点击扩展图标；只有这次明确点击会取得 `activeTab` 并签发临时 ScanSession。Side Panel 只绑定这一个标签：切到其他标签自动隐藏，切回时恢复；若在另一标签点击图标，唯一绑定随之迁移。
4. 点击「扫描并分析当前店铺」。完成后 Overview 显示统计、公开畅销 scope/声明、A–D 上新证据与分布；Products 提供产品检索；Technology 展示脱敏资源清单、同源分析状态、技术栈、API 代码引用、性能/source map 与 App/Pixel 规则证据。
5. 「产品 CSV」同时下载 RFC 4180 CSV 与 `.meta.json` sidecar；「完整 JSON」保留原始字段和 committed 快照元数据。
6. 每次重新构建后，在扩展卡片点击「重新加载」再验收。扩展重载、跨站导航、切换标签或 Chrome 窗口失焦会按设计吊销旧会话，但不会删除已提交快照；同一店铺 origin 内导航保留面板可见性，重新点击扩展图标即可重新授权。

边界：只处理匿名公开信息，固定 `credentials: "omit"`，不跟随重定向；跨源资源只保存元数据，原始源码默认不入 IndexedDB；不调用 PPSpy 私有接口，不复制其 UI/代码，不提供销量间谍、流量或广告历史。

## 许可证

本项目采用 [MIT License](LICENSE)。
