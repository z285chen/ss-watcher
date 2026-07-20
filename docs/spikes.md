# M0 技术验证记录

> 状态：COMPLETE（M1 GO）
> 开始日期：2026-07-20
> 完成日期：2026-07-20
> 设计基线：`docs/DESIGN.md` Draft v0.3.2

## 1. 固定环境

| 项目 | 值 |
|---|---|
| OS | macOS（Apple Silicon） |
| Chrome | 150.0.7871.125 |
| Node.js | 25.3.0 |
| npm | 11.10.1 |
| 扩展形态 | Manifest V3，解压加载，Side Panel |
| 权限 | activeTab / scripting / storage / sidePanel；无 host permissions |
| 核心凭据模式 | `credentials: "omit"` |
| redirect 基线 | `redirect: "error"`；禁止 `follow` |

所有网络行为 spike 优先使用本机双端口测试服务器；真实 Shopify 行为只在自有店铺上作低频验证。本轮经用户确认使用自有公开店铺 `https://cheerble.com/`，不进入 account/cart/checkout 页面；核心请求保持 `credentials: "omit"`。没有自有店证据时必须标 `PARTIAL`，不得用模拟响应冒充平台结论。

## 2. 门禁总表

| Spike | 当前状态 | M1 门禁 | 证据位置 |
|---|---|---|---|
| SPK-1 Side Panel / activeTab 授权 | PASS | 必须 PASS 或冻结回退 | §3.1 |
| SPK-2 SW fetch 与 Collector 回退 | PASS | 必须 PASS 或冻结单一路径 | §3.2 |
| SPK-3 导航、documentId、标签/窗口竞态 | PASS | 必须 PASS | §3.3 |
| SPK-4 Side Panel toggle / 生命周期 | PASS（UX 已冻结） | 必须冻结 UX 与取消语义 | §3.4 |
| SPK-5 SW 终止、session 与消息恢复 | PASS | 必须 PASS 或冻结重新授权回退 | §3.5 |
| SPK-6 MAIN Probe 稳定性 | PASS | 必须至少完成受控 fixture；真实主题不足则 PARTIAL | §3.6 |
| SPK-7 IndexedDB staging / crash / quota | PASS | 必须 PASS | §3.7 |
| SPK-8 Shopify 端点、market、redirect、429/430 | PARTIAL（已接受并冻结降级） | 模拟测试必须 PASS；真实 Shopify 证据不足则 PARTIAL | §3.8 |

M1 只有在 SPK-1～8 全部取得可接受结论后才能启动。`PARTIAL` 是否可接受必须在对应章节明确冻结禁用/降级能力，不能只写“以后再测”。

## 3. 实验记录

### 3.1 SPK-1 — Side Panel 与 activeTab

- 假设：`openPanelOnActionClick: true` 打开面板后，最小 `executeScript` 探针可证明 activeTab 能力；单独加载/刷新面板不能伪造新授权。
- 方法：加载 `dist/`，在本机 fixture 公共页点击 action；对照直接打开 sidepanel、刷新、敏感路径点击。
- 期望：仅 action/context-menu 等显式手势后的最小探针成功；会话只在探针成功后签发。
- 实际（2026-07-20，Chrome 150）：
  - 解压扩展可加载，点击 action 能在当前 fixture 标签页右侧打开 Side Panel；SW 正常启动并返回 bootId。
  - Side Panel → SW 的真实 `MessageSender` 为：扩展 id/url/origin 均匹配、`sender.tab` 不存在，但 `sender.documentId` **也不存在**。这否定了 Draft v0.3.2 中“Side Panel sender 必有 documentId”的平台假设。
  - 已将面板绑定改成双轨：若 Chrome 提供 `documentId` 则绑定；否则要求面板文档加载时生成的随机 UUID `panelInstanceId`，并同时严格校验 extension id、`/sidepanel/` URL、origin（若存在）及无 `sender.tab`。原始 nonce 只存在面板内存；`storage.session` 仅保存 SHA-256。刷新文档会产生新 nonce；错误 nonce 会吊销会话。
  - fallback 单测已覆盖“无 documentId、无 nonce 拒绝；正确 nonce 建立/复核；原始 nonce 不落盘；新 trusted 面板即使读到旧 token＋hash 也无法重放”。
  - 真实用户在 `cheerble.com` 点击图标时，`openPanelOnActionClick: true` 能开面板但最小 `executeScript` 稳定返回 `authorization_probe_failed`；因此该分支判定不可靠。
  - 已冻结回退：设置 `openPanelOnActionClick: false`，由顶层 `chrome.action.onClicked` 在同一用户手势中调用 `chrome.sidePanel.open({windowId})`；新面板在 mount 建会话，已打开面板由无凭证的 `M0_ACTION_AUTHORIZED` 通知触发重试。通知本身不能签发权限，仍必须通过 Side Panel sender/nonce、聚焦窗口、活动标签和最小探针全部校验。
  - 重新加载后，在 `cheerble.com` 真实点击 action 成功显示 `ScanSession 已建立`；面板直接加载的先前对照仍为未授权，符合 fail closed 预期。
- 结论：PASS。Chrome 150 上冻结为显式 `action.onClicked → sidePanel.open → 最小探针`，不再依赖 `openPanelOnActionClick` 猜测授权。

### 3.2 SPK-2 — SW fetch / Collector fetch

- 假设：activeTab 临时 host 权限是否允许 SW 对当前 origin 执行 omit fetch 尚需实测。
- 方法：对本机 fixture 及自有 `cheerble.com` 的 `/cart.js`、`/products.json` 分别从 SW 发起；若失败，再测试 Collector 同源 fetch。manifest 不声明任意店铺 optional host pattern。
- 实际（2026-07-20，Chrome 150）：
  - `https://cheerble.com/products.json?page=1&limit=3` 从 SW 以 `credentials:"omit"`、`redirect:"error"` 发出，200 / `application/json`，通过响应 URL、体积、JSON 与 products Schema 校验。
  - `https://cheerble.com/cart.js` 同样从 SW 发出并返回 200；真实 Content-Type 为 `text/javascript; charset=utf-8`、303 bytes。首次被严格 JSON MIME 分类拒绝，证明传输已放行但 MIME 策略与 Shopify 历史 Ajax 行为不兼容。
  - RequestPolicy 已把 `text/javascript` 仅加入 `cart-context`、`product-ajax-js` 两个类型化 `.js` 端点的窄 allowlist；`products.json` 不继承。重新构建并实测后 `cart-context` 通过，策略出口只保留 `{currency:"USD"}`，不返回 token/items/note 等购物车字段。
  - 因 SW 通道已在真实店铺通过，M0 冻结 SW 为单一端点传输通道；不启用 Collector fetch 回退。
- 结论：PASS。activeTab 下 SW 对授权 origin 的 omit fetch 可用，且兼容例外保持端点级、Schema 级 fail closed。

### 3.3 SPK-3 — 导航与竞态

- 场景：same-origin reload、pushState、cross-origin/port、标签切换、窗口切换、敏感路径竞态。
- 判据：旧 session 在 URL/document/active/window 任一绑定变化后不可继续注入或请求。
- 实际（2026-07-20，`cheerble.com`）：
  - 建立会话后切到同窗口的 `chrome://extensions` 再返回，旧句柄执行时得到 `session_not_found`；证明 `tabs.onActivated` 已主动删除绑定会话。
  - 建立会话后把首页 URL 改为同文档 `#m0-spk3`，旧句柄同样得到 `session_not_found`；`tabs.onUpdated(changeInfo.url)` 对 documentId 不变的 URL 变化仍采取保守吊销。
  - 建立会话后点击首页公开 `SHOP NOW` 完成同源文档导航，旧句柄得到 `session_not_found`；随后返回首页。
  - Computer Use 把焦点短暂交还 Codex 时，`windows.onFocusChanged(WINDOW_ID_NONE)` 会按当前保守基线吊销所有会话；因此真实连续操作必须在同一 Chrome 前台会话中执行。这是既定失效策略，不是 fetch/探针失败。
- 实际（2026-07-20，本机双端口 fixture）：
  - 从已授权的 `cheerble.com` 导航到 `http://127.0.0.1:4173/spa` 后，旧句柄执行得到 `session_not_found`，跨源导航不会保留扩展会话。
  - 在同一 document 内点击 `pushState safe path`，URL 从 `/spa` 变为 `/spa/next`；旧句柄执行得到 `session_not_found`。证明 `tabs.onUpdated(changeInfo.url)` 对 SPA URL 变化采取保守吊销，不依赖 documentId 改变。
  - 重新授权 `/spa/next` 后点击 `pushState sensitive path`，URL 变为 `/fr/account`；旧句柄得到 `session_not_found`，随后在该页重新点击 action 明确得到 `sensitive_path`，不会签发新会话。
  - 端口属于 URL origin；实现不为“同 host 不同 port”保留例外，任意 `changeInfo.url` 均先吊销。跨端口 redirect 的零第二跳另由 SPK-8 双端口命中计数闭环。
- 结论：PASS。真实 Chrome 已覆盖标签切换、窗口失焦、同源文档导航、跨源导航、同 document SPA safe/sensitive pushState；实现冻结为任何 URL/document/active/window 变化即吊销，端口与 origin 不设宽松特例。

### 3.4 SPK-4 — Side Panel 生命周期

- 场景：再次点击 action、视觉关闭、刷新、切换标签后重新打开。
- 判据：冻结 toggle 行为、panel document/Port 生命周期以及“关闭是否取消”的真实语义；正确性不依赖视觉关闭自动吊销。
- 实际（2026-07-20）：
  - 显式 `action.onClicked → sidePanel.open()` 在面板已经打开时不会视觉 toggle 关闭；同一点击发送通知并重新走最小探针，可恢复先前的未授权状态，并签发新的 runId。
  - 用户完成原生关闭、重新打开与显式“吊销会话”操作，视觉开关正常；重开后重新走 panel sender/nonce 与最小探针协议，不把面板出现本身当成授权。
  - M0 不把视觉关闭解释为可靠取消事件，也不引入会改变 SW 空闲终止行为的常驻 Port。新面板无法复用旧 panel nonce；显式吊销、URL/tab/window 事件和 30 分钟 TTL 保证授权正确性。M1 扫描业务取消继续按“显式取消＋60 秒 stale-run 对账”实现。
- 结论：PASS（冻结 UX）。重复 action = 保持面板打开并重新授权；原生关闭/重开可用；视觉关闭不承诺自动取消扫描，正确性不依赖隐藏/卸载的未文档化差异。

### 3.5 SPK-5 — Service Worker 恢复

- 方法：记录 bootId，空闲终止/强制终止后再次发送消息，观察 bootId、`chrome.storage.session` 会话与 ScanRun 对账。
- 判据：无全局内存依赖；若 session 恢复不可靠，则冻结为 SW 重启后重新授权。
- 实际（2026-07-20，Chrome 150 / `cheerble.com`）：
  - 在同一 Chrome 前台会话通过 action 建立 ScanSession，记录 bootId=`4ef4192f-3ad5-492f-ac51-9d336f72483d`。
  - 无消息静置 35 秒后点击 `products.json`；新响应 bootId=`75874653-7839-494c-9646-0b3beb26e386`，证明 SW 已自然终止并由消息重新唤醒。
  - bootId 改变后旧 ScanSession 仍从 `chrome.storage.session` 读取并完成 document/origin/window/token 复核，`products-page` 请求通过策略校验；未依赖 SW 全局内存，也未要求重试或重新授权。
- 结论：PASS。自然终止、自动唤醒和 session 恢复闭环通过；保留 15 秒面板消息超时作为异常可观测边界。

### 3.6 SPK-6 — MAIN Probe

- 受控 fixture：标准 `window.Shopify`、字段缺失、getter 抛错、对象被替换、超长字符串。
- 真实主题：需要一个自有 Shopify dev store；若本轮未提供，只能得到 PARTIAL。
- 判据：只返回白名单扁平字段；异常整体返回 null；Collector 仍可继续。
- 实际（2026-07-20，受控层）：
  - `tests/unit/probes.test.ts` 共 5 项通过：MAIN 白名单扁平化、超长/非法字段、getter 抛错降级，以及 Collector 路径复核、URL 脱敏与敏感路径 DOM 前拒绝。
  - MAIN 与 ISOLATED 注入在 SW 中使用两个独立返回通道；MAIN 注入或 Schema 失败降级为 `null`，不阻塞 Collector/Endpoint；Collector 失败则吊销会话。
  - 真实 `cheerble.com` 上通过已签发 ScanSession 执行双探针：MAIN 返回 `country:"US"`、`currencyActive:"USD"`、`locale:"en"`、`routeRoot:"/"`、`shop:"cheerble.myshopify.com"`、themeId/themeName/themeSchemaName；ISOLATED Collector 返回同源 canonical、4 个 JSON-LD 块及经去 query/fragment 和数量/长度约束的脚本 URL 列表。
  - 双探针在同一 Chrome 前台会话显示“完成”；MAIN 与 Collector 独立返回，未读取账户、购物车或结账页面。
- 结论：PASS。受控异常边界与真实 hosted Shopify 主题的 MAIN/ISOLATED 注入均已闭环；MAIN 仍保持 best-effort `null` 降级语义。

### 3.7 SPK-7 — IndexedDB staging

- 方法：fake-indexeddb 单测＋浏览器 PoC；在 products/moduleResults/manifest/commit 各边界注入失败，小配额用可注入 `QuotaExceededError` 模拟。
- 判据：读路径只见 committed；中断后无半写可见快照；按 snapshotId 完整清理；重复写幂等。
- 实际（2026-07-20，fake-indexeddb）：
  - `tests/unit/staging-store.test.ts` 13/13 通过。
  - 覆盖内建 Snapshot/ScanContext/Coverage Schema、runId↔snapshotId 一对一、产品键严格派生、产品/模块幂等写、manifest 完整性、committed-only 读取、级联清理与 stale reconcile。
  - 事务内 fault injector 已覆盖 product batch 首次 put 后 abort，以及 snapshot committed put 与 run completed put 之间 abort；两者均证明整事务回滚。heartbeat/写入配额错误进入 `failed(quota_exceeded)` 并清理，历史 committed 快照不受影响。
- 实际（2026-07-20，Chrome 150 原生 IndexedDB Side Panel PoC）：
  - `nativeIndexedDb=true`；提交后关闭并重新打开数据库，committed snapshot 仍可见，包含 2 个产品和 1 个模块结果。
  - 产品 batch 在首次 put 后注入事务 fault；重新打开数据库后产品数与 attempted writes 均为 0，证明整批回滚。
  - snapshot committed put 后、run completed put 前注入事务 fault；故障后 committed 读取不可见，重新打开后重试可原子提交。
  - 在原生浏览器上下文注入 `QuotaExceededError` 后，run 进入 `failed / quota_exceeded`，staging 行数为 0。此项验证错误处理与级联清理，不通过写满约 10 GB 配额来制造破坏性测试。
  - `navigator.storage.estimate()` 返回 usage=88,608 bytes、quota=10,737,506,848 bytes；自检创建的四个随机命名临时数据库均确认删除。
- 结论：PASS。fake-indexeddb 的完整矩阵与 Chrome 原生 IndexedDB 的持久化、事务 fault、配额错误清理及临时库回收均已闭环。

### 3.8 SPK-8 — 端点与网络边界

- 本机 fixture：hosted/custom/uncertain、cart currency、匿名 country 可得/缺失、B 级价格一致/冲突、密码页、挑战页、429、430、同源/跨端口重定向命中计数。
- 真实 Shopify：自有 dev store 上低频核对 hosted/custom 分类、B 级端点、Markets 与 primary↔myshopify 行为。
- 判据：任何 redirect 目标命中 0；market/价格来源未验证则禁用价格 diff；430 不重试，429 有界退避。
- 实际（2026-07-20，本机双端口 HTTP fixture）：
  - 启动：`M0_PORT=0 M0_CROSS_PORT=0 npm run m0:server`；本轮主/跨源端口为 `63415/63414`（动态端口，仅作本轮证据）。
  - 执行：`M0_TEST_ORIGIN=http://127.0.0.1:4173 npm run test:m0-network`，5/5 通过（动态端口运行亦通过）。
  - 类型化 `meta`、`products-page`、`cart-context` 成功；cart 原始 fixture 含 token/items/note，但策略出口只保留 `{currency:"USD"}`。
  - 同源和跨端口 302 在 `redirect:"error"` 下均表现为 `network + redirectDetection:"unavailable"`；两类 redirect target 命中数分别为 0，证明没有第二跳。
  - live 429 分类为 `rate_limited` 并读取 `Retry-After: 2`；430 为 `security_rejected`；200 密码页与挑战页分别被识别为 `password_page` / `challenge_page`。
  - 新增纯函数重试决策器：429 优先 `Retry-After`，否则 2s/4s/8s（±30% jitter），最多 3 次且并发永久降为 1；network/timeout/5xx 只重试 1 次；430/challenge/redirect 等终止类别永不重试；20 秒模块与 60 秒扫描等待预算均有确定性单测。
  - fixture 的 `products.json` 使用 decimal major units，`product-ajax-js` 使用 integer minor units；同 product/variant ID 经 ISO currency fraction digits 和字符串整数运算归一化后通过，避免浮点比较。
  - routeRoot 已冻结为 `/` 或一个 canonical locale 段；任意前缀、敏感前缀、双重编码与 dot handle 均由单测拒绝。
  - 自有 `cheerble.com` 低频补充证据：MAIN/Collector 给出 hosted Shopify/theme 信号；匿名 `cart.js` 验证 currency=`USD`；`products.json?page=1&limit=3` 返回公开产品 envelope。两者均未跟随重定向，未进入敏感页面。
  - 执行 `M0_SHOPIFY_ORIGIN=https://cheerble.com M0_MYSHOPIFY_ORIGIN=https://cheerble.myshopify.com npm run test:m0-shopify-live`，2/2 通过。真实样本 `wicked-ball-mini-tail-combo` 的同一 variant ID 在 `products.json` 为 `"34.99"`、在 `.js` 为 `3499`；按 USD 2 位小数归一化后验证相等。
  - 显式以 `cheerble.myshopify.com` 作为测试 origin 请求 `products.json` 返回 200 而非重定向，证明不能假定 myshopify alias 必然跳回 primary。生产扩展仍只信任当前 ScanSession.origin，观察到的 myshopify domain 只作 Evidence，绝不自动跨 origin 重发。
- 结论：PARTIAL（M0 接受）。真实 hosted-theme、cart currency、B/A 价格样本和 myshopify alias 行为已取证；真实 custom storefront、Markets 匿名 country、生产密码/挑战/429/430 不在自有生产店强行制造。冻结降级如下：
  1. `custom-storefront` / `uncertain` 不进入 Ajax 端点链。
  2. 匿名 country/market 未验证时 `priceContextVerified=false`，即使单一价格来源已通过一致性核对也禁用价格 diff。
  3. 密码页进入 `password_protected`；430/挑战页终止该 origin 后续 B 级请求；不规避、不自动重试。
  4. redirect mode 固定 `error`，接受 `network + redirectDetection:"unavailable"` 的粗粒度分类；不启用 `manual` 或 `follow`。

## 4. M0 最终决定

- M0：COMPLETE
- M1：GO
- 已完成：可构建 MV3 骨架、类型化消息协议、ScanSession/路径策略、RequestPolicy、重试决策器、双端口 fixture、B/A 价格一致性门控、staging PoC；显式 action 授权、真实 MAIN/ISOLATED 注入、SW omit fetch 与真实价格样本已在 `cheerble.com` 闭环。
- 自动验证：`npm test` 为 121 passed / 7 opt-in integration tests skipped；`npm run test:m0-network` 为 5/5 passed；`npm run test:m0-shopify-live` 为 2/2 passed；`npm run build` 通过。
- 接受的限制：SPK-8 保留 PARTIAL，但所有缺失真实证据均已有明确禁用/终止分支，不会被默认值伪装成已验证结果。M1 可以在这些冻结边界内开始，不得擅自放宽。
