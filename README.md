# SS Watcher — Design Intelligence Preview

> 当前分支：`codex/design-intelligence-preview`。Gate 4 已通过 TourBox 真实取证与隔离盲复刻验收；Gate 5 的第二类站点泛化尚未完成，因此暂不并入稳定 `main`。

这套预览能力面向“参考公开网页 → 可交给编码 Agent 的 UI/UX 证据包 → 隔离环境复刻”。它采集三档 viewport 的截图、脱敏结构与设计 token，并记录由用户亲自触发的前后交互状态；SS Watcher 不替用户点击、悬停、输入、提交或导航。输出为严格校验、可移植的 `.ssw-design` 包。

TourBox 试点的默认页、桌面 mega menu、平板/手机导航抽屉已经完成真实取证。隔离盲复刻在 1440、768、390 CSS px 下通过结构覆盖与约 85–90% 视觉目标带验收。这个结果只证明当前试点，不代表任意网站都能达到相同还原度。

实现边界、试用方法与验收状态见：

- [`docs/design-intelligence-spike.md`](docs/design-intelligence-spike.md)：同事试用入口与安全边界；
- [`docs/design-intelligence-gate4.md`](docs/design-intelligence-gate4.md)：交互证据与盲复刻验收合同；
- [`docs/design-intelligence-v2-progress.md`](docs/design-intelligence-v2-progress.md)：逐项实测证据与已知限制。

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- npm（随受支持的 Node.js 版本安装）
- Chrome 116 或更高版本

## 获取与构建

```bash
git clone --branch codex/design-intelligence-preview https://github.com/z285chen/ss-watcher.git
cd ss-watcher
npm ci
npm test
npm run build
npm run test:m3-fingerprints
```

构建后在 Chrome 扩展管理页加载 `dist/`。只在获准测试的公开页面点击扩展图标；Design Intelligence 的三档截图会临时使用受限 `debugger` 权限进行 viewport 模拟，并在成功、失败或取消时清理模拟状态并断开连接。真实站点证据包和复刻输出默认位于被 Git 忽略的 `validation/.artifacts/`，不会随仓库分发。

## 原有店铺分析能力

M0–M3 已完成：扩展能够识别 Shopify 与 `storefrontKind`，匿名扫描公开产品目录，核验 market/currency/价格来源，生成公开畅销排序、A–D 上新证据和店铺统计，并提供 CSV/JSON 导出。设计基线见 `docs/DESIGN.md`；阶段证据见 `docs/spikes.md`、`docs/m1.md`、`docs/m2.md`、`docs/m3.md`。

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
