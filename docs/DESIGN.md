# SS Watcher — 自用 Chrome 扩展设计方案

> 状态：Draft v0.3.2（M0–M2 COMPLETE；M3 尚未开始，实施证据见 `docs/spikes.md`、`docs/m1.md`、`docs/m2.md`）
> 日期：2026-07-20
> 基线：方案 B（本机加载的 Manifest V3 解压扩展）

## 0. 修订记录

- v0.1（2026-07-18）：初稿。
- v0.2（2026-07-18）：按首轮审计修订畅销榜数据源、限流处理、密码保护店铺、评论供应商清单等 6 处。
- v0.3（2026-07-18）：按第二轮审计全面修订，形成 M0 技术验证基线。要点：
  - 采集拆为 ISOLATED world Collector 与 MAIN world Probe 两层，修正"Content Script 直接读 `window.Shopify`"的错误假设（§8.1–8.2）。
  - 明确 activeTab 授权生命周期与 ScanSession 绑定模型，Side Panel 行为经 `setPanelBehavior` 配置（§8.3–8.4）。
  - 架构决策定为 A：Side Panel 作扫描协调器，Service Worker 作无状态请求执行器；补齐 SW 中途终止后的恢复语义（§7.2、§9）。
  - 建立 RequestPolicy：类型化端点构造、`credentials: "omit"`、重定向终点校验、密码页/挑战页/伪装 JSON 识别（§11）；修正 v0.2 中"页面 CSP 拦截 Content Script 同源 fetch"的错误描述。
  - Shopify 端点分为官方文档化（A 级）与经验性（B 级）两档，B 级必须能力探测＋降级＋覆盖率记录；补分页防循环终止条件（§12）。
  - 新增 locale/market/货币上下文模型与快照可比性规则（§13）；429 与 430 分流（§14）。
  - 产品身份改为 Shopify Product ID 优先、handle 回退＋复合匹配；店铺身份用 myshopify domain（§15、§18.1）。
  - IndexedDB staging→原子提交流程、总容量预算、配额与迁移失败处理（§18）。
  - CSV 公式注入防护与导出元数据（§19）。
  - 新增 PPSpy 非销量能力追踪矩阵（§5）；营销 Pixel 检测明确纳入 V1。
  - 修正 Shopify Product Reviews 停服时间为 2024-05-06（v0.2 误写 2022）。
  - 扩展验收标准（§27），里程碑计入 M0 技术验证（§26），未决验证项集中列于 §29。
- v0.3.1（2026-07-18）：采纳外部独立审计的 4 项修正：
  - 消息校验协议：Side Panel 等扩展页面的消息不含 `sender.tab`，v0.3 原文"对每条消息校验 sender.tab.id"不可实现；改为双轨校验＋会话凭证（§8.3、§21）。
  - 注入前敏感路径硬性排除：`credentials: "omit"` 只约束新请求，不阻止 Collector 读取已登录页面 DOM；恢复并强化 v0.2 的非公开路径限制（§8.3）。
  - 市场/币种双口径：区分匿名端点上下文（快照主口径）与页面会话上下文，不一致时标注，DOM 价格证据不并入价格字段（§13）。
  - staging 主键统一：snapshotId 于 ScanRun 创建时生成，产品与模块结果一律以 snapshotId 为主键，消除 §9.2 与 §18.1 的不一致。
- v0.3.2（2026-07-19）：按 v0.3.1 复核结论关闭进入 M1 前的设计缺口：
  - ScanSession 改为“最小授权探针成功后签发”，绑定 panel/window/tab/document/origin，凭证仅存 `chrome.storage.session`；面板加载本身不再被视为授权证据（§7–§8）。
  - 敏感路径采用解码、locale 前缀归一化和多阶段复核；Collector 读取 DOM 前再次自检（§8.3）。
  - 核心请求禁止自动跟随任何重定向；V1 网络信任边界固定为当前 origin，不因观察到 myshopify 域名而扩张（§11、§15.3）。
  - 新增 hosted theme / custom storefront / uncertain 分流；Shopify Ajax API 只用于已确认的 hosted theme（§12）。
  - 匿名价格口径以同一传输上下文的 `/{locale}/cart.js` currency 验证；未验证币种时禁止价格差异结论（§11.1、§13）。
  - 补齐 `moduleResults` 表、App 指纹独立 holdout、PPSpy 本机 source map 证据及 M0 全量门禁（§5、§18、§25、§29）。
- M0 冻结补记（2026-07-20）：SPK-1～7 PASS，SPK-8 以明确降级接受 PARTIAL；授权入口、SW 单一传输、导航吊销、Side Panel UX、`redirect:"error"`、价格单位归一化、匿名 market 门控与 IndexedDB 提交语义均已冻结，M1 转为 GO。完整证据见 `docs/spikes.md`。
- M1/M2 实施补记（2026-07-20）：完成 Shopify 多信号分类、匿名 country/currency 与 B 级价格来源门控、目录分页/降级链、原子快照、公开畅销与 A–D 上新证据、统计、正式产品表和安全导出；完整证据与验收边界见 `docs/m1.md`、`docs/m2.md`。

## 1. 结论

本项目实现一个只供本机使用的 Shopify 店铺分析扩展：用户点击扩展图标后，在 Chrome Side Panel 中扫描当前店铺，展示可由公开页面、公开端点和本地规则推导出的信息。

首版不接入 PPSpy 私有接口，不复制其 UI、品牌、图片或源代码，也不实现销量间谍、流量估算和跨店广告历史。扩展不需要发布到 Chrome Web Store。

核心技术决策：

- Manifest V3 解压扩展，通过 `chrome://extensions` 的"加载已解压的扩展程序"安装。
- 点击扩展图标时由显式 `action.onClicked` 在同一用户手势中调用 `sidePanel.open()`，打开独立 Side Panel；不向店铺页面注入大型 UI。
- 仅在用户主动点击后，使用 `activeTab` 和 `scripting` 临时扫描当前标签页；授权以 ScanSession 显式建模（§8.3）。
- 页面采集分两层：ISOLATED world Collector 读 DOM 证据，MAIN world Probe 按白名单读取 Shopify 公开全局字段（§8.1–8.2）。
- 扫描协调状态放在 Side Panel（架构决策 A，§7.2）；Service Worker 负责临时授权会话、请求执行与注入代理，正确性不依赖其全局内存，授权记录存于 `chrome.storage.session`。
- 所有网络请求经统一 RequestPolicy：类型化端点、`credentials: "omit"`、重定向终点校验、响应分类（§11）。
- 跨域评论供应商请求由受限的 Service Worker 适配器处理，不提供任意 URL 代理；`optional_host_permissions` 仅在用户手势中请求（§17）。
- 设置与规则保存在 `chrome.storage.local`；扫描快照保存在 IndexedDB，写入采用 staging→原子提交（§18）。
- 默认无账号、无云端、无遥测、无定时轮询、无常驻页面脚本。

官方文档依据见 §31。其中与 v0.2 相比的关键事实修正：Content Script 默认运行在 ISOLATED world，读不到页面的 `window.Shopify`；ISOLATED world 内容脚本适用扩展 CSP 而非页面 CSP；activeTab 授权在同源导航中保留、跨源导航时撤销；扩展 Service Worker 空闲 30 秒即可被终止，单事件处理上限 5 分钟，fetch 响应超 30 秒未达也会导致终止。

## 2. 产品目标

### 2.1 要解决的问题

用户浏览一个 Shopify 独立站时，希望在一次点击后快速回答：

- 这是否是 Shopify 店铺？其公开店铺身份和主题信息是什么？
- 店铺公开了哪些产品、变体、价格、Vendor、Tag 和 Collection 信息？
- 哪些产品出现在 best-selling 排序前列？最近可能上新的产品有哪些？
- 页面上能识别出哪些第三方 App、评论组件、社交账号和营销技术（Pixel 等）？
- 当前结果能否保存为本地快照，并导出为 CSV/JSON 供后续分析？
- 与上一次扫描相比，产品、价格、库存信号和 App 指纹发生了什么变化？

### 2.2 成功标准

- 用户无需登录任何第三方服务即可完成核心扫描。
- 除首次安装和版本升级外，日常流程为"打开店铺 → 点击图标 → 查看结果"。
- 扫描数据全部能追溯到具体公开端点、DOM 信号或规则证据。
- 任一模块失败不会使整次扫描失败，面板应展示部分成功结果和明确错误。
- 扩展在用户未通过点击扩展图标授权时，不读取网页、不发起扫描请求。

## 3. 明确不做

以下能力不属于本项目首期范围：

- 销量间谍、订单量估算、实时成交弹窗和基于 PPSpy 后台模型的推算。
- PPSpy 私有 API、账号、订阅、授权、埋点、远程配置或数据库。
- Similarweb 类流量估算、历史访问量数据库和竞品流量排名。
- 跨店铺广告素材历史、广告首次发现时间和由后端持续采集形成的广告库。
- 复制 PPSpy 的 UI、文案、图标、品牌标识、静态素材和代码结构。
- Facebook 页面令牌截取、XHR Hook、Cookie 读取或登录态数据采集。
- 带登录态（Cookie）的扫描模式：核心扫描永远以匿名访客视角进行（§11.2）。
- 自动后台监控、定时扫描和无用户手势的大规模抓取。
- Chrome Web Store 上架、付费体系、多人协作和云同步。

这些能力大多不是"改成本地脚本"就能自然获得；它们依赖长期数据采集、第三方数据授权或私有后端。首版刻意保持为公开信息分析工具。

## 4. 版本范围

### 4.1 V1：核心店铺分析

优先级 P0：

- Shopify 店铺识别与基础信息。
- 主题名称、主题 ID、货币、语言、国家、canonical URL、myshopify domain 等公开元数据。
- 产品目录抓取与分页，解析产品、变体、价格、Vendor、Tag、发布时间和更新时间；记录覆盖率与截断标记。
- best-selling 排序结果：以带 `sort_by=best-selling` 的公开 Collection HTML 为主路径（该参数为 Shopify 官方文档化的集合排序参数）；JSON 端点只用于补充产品字段，不采信其顺序（§12.6）。
- 上新列表：基于公开时间字段与页面信号排序，按 A–D 证据分级标注（§12.7）。
- 产品统计：数量、价格区间、Vendor/Tag 分布、变体数量、折扣信号。
- 社交账号与外链识别。
- App 指纹与营销技术信号检测：同一本地规则引擎覆盖第三方 App 与营销 Pixel（Meta Pixel、GA4、TikTok 等），附带命中证据与置信度（§16）。
- 手动保存本地快照。
- 产品 CSV、完整扫描 JSON 导出（含公式注入防护与导出元数据，§19）。

优先级 P1：

- 同一店铺不同快照间的产品新增、删除、改名、价格变化和 App 指纹变化（身份匹配规则见 §15.2）。
- 可导入、导出和版本化的本地 App 指纹规则。
- 扫描限制、保留数量、超时等设置。

### 4.2 V1.1：评论供应商适配

评论模块独立于核心扫描，首批计划支持：

- Loox
- Judge.me
- Ali Reviews
- Rivyo
- Stamped
- Vitals

Shopify 官方 Product Reviews App 已停服（2023-09-05 起从 App Store 下架，2024-05-06 正式停止服务；依据为 Junip、Ilana Davis、Shopify Community 等多方一致的第三方来源，未在 shopify.com 官方公告页直接核验），无接口可拉，不纳入首批；其遗留代码残留只作为 App 指纹的 legacy 信号处理。

每个供应商使用独立适配器。若供应商接口、页面结构或权限发生变化，只影响对应适配器，不影响店铺核心扫描。权限流程见 §17。

### 4.3 V2 候选能力

- 更完整的历史变化时间线。
- 本地规则编辑器和规则测试工具。
- Facebook Ads Library 的"打开并辅助检索"功能：仅构造公开搜索 URL 并跳转，不声称拥有历史广告数据库。
- 可选的命令行导出/批处理组件；批量扫描必须另行设计速率限制和授权边界。

## 5. PPSpy 非销量能力追踪矩阵

> 说明：「PPSpy 来源」列区分“本机客户端证据”与“行为推断”。2026-07-19 已只读核对本机 `Profile 1/Extensions/lppbajkahdbbadheilijoeegnfndhlab/1.6.7_0/js/shopify.js.map`：其中 `webpack://extension/./src/api/ppspy.ts` 明确引用 `/v1/extension/apps-detect` 等私有后端端点。该证据只证明 PPSpy 客户端包含调用，不证明服务器当前可用、响应语义或算法实现；未直接证实的条目继续标注“推断”。本项目不复制 PPSpy 的代码、规则库、UI 或文案，也不调用这些私有端点。

| # | 能力 | PPSpy 来源（推断） | 本项目处理 | 证据基础 | 已知限制 | 版本 | 验收方法 |
|---|---|---|---|---|---|---|---|
| 1 | 店铺身份与主题 | 本地页面（`window.Shopify`/theme 对象） | 完整实现 | MAIN Probe 白名单字段＋`/meta.json`（经验性） | 主题名可被商家改名或隐藏 | V1 | 检测评分单测＋fixture |
| 2 | 产品目录 | 公开端点（`/products.json` 分页） | 完整实现＋降级链 | B 级端点＋sitemap＋Collection HTML | 端点可被禁用，降级后覆盖率 <100%，如实标注 | V1 | 1,000+ 产品分页、终止条件、覆盖率测试 |
| 3 | 产品统计 | 本地计算 | 完整实现 | 目录数据派生 | 受目录覆盖率制约 | V1 | 统计单测 |
| 4 | best-selling 公开排序 | 公开端点（collection `sort_by`） | 完整实现（带 scope 标注） | 官方文档化排序参数＋HTML 解析 | 只是公开排序，不是销量；`/collections/all` 可被删除 | V1 | 响应 URL/排序参数/scope 验证测试 |
| 5 | 上新候选 | 公开端点＋页面信号 | 降级实现（A–D 证据分级） | `created_at`/`published_at`/集合排序/sitemap | lastmod ≠ 上新；无可靠字段时只是候选 | V1 | 证据分级单测 |
| 6 | 社交账号识别 | 本地页面 | 完整实现 | DOM/JSON-LD `sameAs` | 仅公开链接 | V1 | fixture |
| 7 | App 检测 | 私有后端 `/v1/extension/apps-detect`（本机 source map 已确认客户端调用） | 替代实现：本地加权指纹引擎 | 本地规则＋页面证据 | 私有服务算法/响应未核验；不承诺与 PPSpy 覆盖率 1:1 | V1 | 独立 holdout 误报/漏报指标 |
| 8 | 营销 Pixel/技术信号 | 本地页面＋可能后端增强（推断） | 完整实现（指纹引擎 pixel 类目） | script-host/全局变量规则 | 服务端埋点（如 Conversions API）不可见 | V1 | pixel fixture |
| 9 | 评论检测与导出 | 供应商公开接口＋可能后端（推断） | 降级实现：allowlist 供应商适配器 | 供应商公开 JSON/HTML | 仅首批 6 家；需用户手势授权域名 | V1.1 | 权限拒绝/适配器失效测试 |
| 10 | Facebook Ads Library 辅助入口 | 跳转＋私有广告库 | 辅助入口：仅构造公开搜索 URL | — | 无历史库，不做数据声称 | V2 | 链接构造单测 |
| 11 | 广告历史数据库 | 私有后端长期采集 | 排除 | — | 依赖持续采集基础设施 | — | 验收第 10 条（无未声明域名） |
| 12 | 流量估算 | 第三方/私有数据 | 排除 | — | 无合法本地来源 | — | 同上 |
| 13 | 销量/订单推算 | 私有模型 | 排除 | — | 项目红线 | — | 同上 |
| 14 | 账号/订阅/云同步 | 私有后端 | 排除 | — | 自用无需 | — | 同上 |

### 5.1 App 检测替代实现的量化目标（V1）

- 初始规则包：≥ 40 个高频 Shopify App，其中 ≥ 8 个为营销 Pixel/分析类信号。
- 每个 App ≥ 2 条独立信号规则（单一弱信号不判定）。
- Fixture 分为互不重叠的规则开发集与 holdout 集；同一店铺/同一主题的派生片段不得跨集合，避免把调参样本当验收样本。
- 纳入“稳定支持”统计的每个 App 至少 3 个正样本（来自 ≥ 2 个独立店铺/主题，其中至少 1 个只进入 holdout）；另备 ≥ 30 个负样本页，并包含与目标 App 共用 CDN/类名的 hard negative。样本不足的规则标为 `experimental`，不计入 ≥40 App 的稳定目标。
- 指标目标仅在独立 holdout 上计算并同时报告样本数：页面级误报率 ≤ 5%，正样本漏报率 ≤ 15%；该指标是工程门槛，不外推为全体 Shopify 店铺覆盖率。
- 对外表述统一为"本地规则引擎检测"，不声称达到 PPSpy 的覆盖率。

## 6. 用户流程

### 6.1 首次安装

1. 本地构建扩展。
2. 在 `chrome://extensions` 开启开发者模式。
3. 选择"加载已解压的扩展程序"，指向 `dist/`。
4. 固定扩展图标。

### 6.2 日常扫描

1. 用户打开一个公开店铺页面。
2. 点击扩展图标：Chrome 打开 Side Panel，同时该点击构成本次 `activeTab` 授权的起点（§8.3）。
3. 面板确认当前标签页存在有效 ScanSession 后开始扫描（默认自动开始，可在设置中改为手动）。
4. 扩展识别 Shopify，注入 Collector/Probe 采集页面证据，并经 RequestPolicy 请求同源公开端点。
5. 各模块逐步返回结果，面板展示进度、数据来源与局部错误。
6. 用户可保存快照，或导出 CSV/JSON。

### 6.3 授权失效与重新授权

- 用户切换标签页、跨源导航或关闭标签页后，旧 ScanSession 立即失效（§8.3）。
- 面板检测到当前活动标签页无有效授权时，显示"请点击扩展图标以授权扫描当前标签页"，并禁用扫描按钮；面板内按钮点击不视为新的 activeTab 授权。
- 当前标签页处于账户、结账等敏感路径时（§8.3 黑名单），不建立会话，提示"请切换到店铺公开页面后重新点击扩展图标"。
- 已知平台行为风险：面板打开时再次点击图标可能触发面板开/关切换（SPK-4，§29），UI 文案需在 M0 验证后适配。

### 6.4 非 Shopify 页面

面板显示"未检测到 Shopify"，列出检测过的信号，不继续访问产品目录等端点。用户可选择执行一次"强制尝试"，用于处理高度定制的店铺。

## 7. 系统架构

### 7.1 架构图

```text
用户点击扩展图标（activeTab 授权起点）
        │  action.onClicked → sidePanel.open
        ▼
┌─ Side Panel（扫描协调器，持有会话句柄/进度/检查点）─────┐
│   │ 类型化消息（EndpointRequest / InjectRequest）      │
│   ▼                                                   │
│  Service Worker（授权验证器＋可重启执行器）             │
│   ├── chrome.storage.session → 临时 ScanSession ────────┤
│   ├── RequestPolicy → fetch(店铺 origin, omit) ────────┼──> 同源公开端点
│   ├── chrome.scripting → ISOLATED Collector ───────────┼──> DOM/meta/JSON-LD/script URL
│   └── chrome.scripting → MAIN Probe（白名单只读）──────┼──> Shopify 公开全局字段
│                                                       │
│  Normalize / Analyze（面板侧 core 模块）               │
│   ├──> Side Panel UI                                  │
│   ├──> IndexedDB（staging → 原子提交）                 │
│   └──> CSV / JSON 导出                                 │
└───────────────────────────────────────────────────────┘

V1.1 跨域评论请求：
Side Panel → Service Worker → 固定供应商适配器 → 明确 allowlist 域名（optional_host_permissions）
```

### 7.2 架构决策：Side Panel 协调，SW 持有可恢复的临时授权

在"A. Side Panel 协调 + SW 执行"与"B. SW 协调 + 全量状态持久化"之间，本设计选定 A。这里的“SW 无状态”仅指不在全局变量中保存扫描进度；SW 仍是 ScanSession 的授权权威，并把短期会话保存到 `chrome.storage.session`。理由：

- 扫描只在面板打开时有意义（用户要看进度和结果），面板文档的生命周期天然覆盖整次扫描；SW 则随时可能被终止（空闲 30 秒、单事件 5 分钟上限）。
- A 方案下 SW 每次只处理一条自包含消息（一次 fetch ≤ 12 秒或一次注入），远低于平台限制；SW 被终止后，下一条消息会自动将其唤醒，不丢协调状态。
- 扫描业务状态（ScanRun、检查点、staging 数据）由面板写入 IndexedDB；SW 不依赖任何跨消息的全局内存状态。短期 ScanSession 存入 `chrome.storage.session`，SW 重启后可重新校验，但浏览器重启、扩展重载或会话吊销后自动失效。
- RequestPolicy 的 URL 构造与响应校验集中在 SW，保证面板拿不到任意 URL 请求能力。

选择 A 的代价与语义（明确接受）：

- 面板文档卸载或用户显式取消即等于取消扫描；Side Panel 隐藏/toggle 是否卸载文档由 SPK-4 冻结，不能仅凭视觉关闭假定生命周期已经结束。恢复语义见 §9.2。
- 面板与 SW 均可能中途消失，因此持久化与对账逻辑必须同时覆盖两者（§9.2 的 stale-run 对账不区分死因）。

### 7.3 组件职责

#### Side Panel（协调器）

- 持有 ScanSession 的不透明句柄（runId/sessionToken）与扫描状态机；ScanSession 权威记录由 SW 管理。
- 建立会话时提交本窗口 ID；面板加载或面板内按钮点击本身均不被当作 activeTab 授权证据。
- 发起扫描、取消扫描、保存快照和导出；执行归一化与统计分析。
- 不直接执行任意跨域请求；所有网络请求以类型化 EndpointRequest 发给 SW。
- 不持有第三方 Token、Cookie 或页面登录凭证。

#### Service Worker（授权验证器＋可重启执行器）

- 完成最小授权探针并签发/吊销 ScanSession；会话只存于 `chrome.storage.session`，不写 IndexedDB 或 `storage.local`。
- 按消息来源双轨校验（§8.3）：内容脚本消息验 `sender.tab.id`/`documentId`；面板消息验 `sender.id`/`sender.url`/panelDocumentId＋会话凭证，并复核目标标签页现状。
- 执行 RequestPolicy：构造 URL、发起 fetch、校验响应、分类失败（§11）。
- 按需注入 ISOLATED Collector 与 MAIN Probe。
- V1.1 中执行受限的跨域评论请求。
- 只接受有明确类型和参数 Schema 的消息，不接受任意 URL；不依赖全局内存保存扫描状态或授权状态。

#### Content Collector（ISOLATED world）

- 仅在用户授权的当前标签页中临时运行。
- 读取 DOM、meta、script/link URL、JSON-LD 和页面内嵌 JSON（如 `<script type="application/json">`）。
- 不读取页面 JavaScript 运行时变量（ISOLATED world 读不到，见 §8.1）。
- 返回结构化数据，不在页面显示 UI，不长期驻留。

#### Main-world Probe（MAIN world）

- 白名单只读探针，读取 Shopify 公开全局字段（§8.2）。
- 只返回可序列化数据；失败不阻塞其他模块。

#### Core Analyzers

- 将多种原始响应归一化成稳定领域模型。
- 计算产品统计、best-selling 排名、上新候选和 App/Pixel 指纹置信度。
- 对每个结论保留来源和证据。

#### Storage

- `chrome.storage.local`：设置、轻量规则、最近店铺索引。
- IndexedDB：扫描运行、产品集合、快照和差异结果；staging→原子提交（§18.2）。
- 导出文件是用户可携带的长期备份；数据库升级使用显式 schema version。

## 8. 执行环境与授权模型

### 8.1 双 world 采集

Chrome 官方文档明确：内容脚本默认运行在 ISOLATED world——"私有执行环境，页面和其他扩展不可访问"，其中的 JS 变量与页面互不可见；因此 **Collector 不能直接读取 `window.Shopify`**。ISOLATED world 内容脚本适用扩展自身的 CSP，而非页面 CSP。

采集因此拆为两层：

1. **ISOLATED world Collector**：读取 DOM、meta 标签、JSON-LD、script/link 的 URL、内嵌 JSON 文本。这些都通过 DOM 接口获得，不需要访问页面 JS 上下文。
2. **MAIN world Probe**：通过 `chrome.scripting.executeScript({target, world: "MAIN", func: probeFn})` 注入（ExecutionWorld 自 Chrome 95 起支持）。`func` 会被序列化后注入（丢失闭包），参数必须 JSON 可序列化，返回值按结构化克隆返回，Promise 会被等待。

### 8.2 MAIN world Probe 白名单与约束

Probe 是一个编译进扩展包的具名只读函数，仅读取以下白名单路径（存在性逐级判断，缺失即 `undefined`）：

- `Shopify.routes.root`（官方文档化的 locale 感知根路径，恒以 `/` 结尾）
- `Shopify.shop`
- `Shopify.locale`
- `Shopify.country`
- `Shopify.currency.active` 与 `Shopify.currency.rate`
- `Shopify.theme.name`、`Shopify.theme.id`、`Shopify.theme.schema_name`

硬性约束：

- 只返回上述字段组成的扁平可序列化对象；返回前做类型收窄（string/number），超长字符串截断（单字段 ≤ 256 字符）。
- 返回值在扩展侧再经运行时 Schema 校验，不合法即整体丢弃并记 `schema_invalid`。
- 不接受任意代码字符串，不使用 `eval`/`new Function`，不建立 `postMessage` 桥；`executeScript` 的返回通道即全部通信。
- MAIN world 中运行的代码受页面 CSP 与页面环境影响（页面可能改写全局对象）：Probe 内部 try/catch 包裹，任何异常返回 `null`。
- **Probe 失败（异常、被页面干扰、Schema 不合法）时，DOM/端点模块必须继续运行**；locale 上下文降级为 URL 启发式 + 默认根路径 `/`，并在快照上下文中标注 `routeRootSource: "fallback"`。

### 8.3 activeTab 生命周期与 ScanSession

Chrome 官方文档确认的 activeTab 语义：

- 授权时机：执行 action（点击扩展图标）、上下文菜单、快捷键、omnibox 建议。
- 授权内容：可对该标签页调用 `scripting.executeScript/insertCSS`（配合 `scripting` 权限）、读取该标签页 URL/标题/favicon、用 webRequest 拦截该标签页主框架 origin 的请求。
- 撤销时机：用户离开该页面（跨源导航）或关闭标签页即撤销；**同源导航保留授权**（官方示例：example.com → example.com/foo 仍可访问）。

注意：官方文档未明确 activeTab 是否同时授予扩展进程（SW/扩展页）对该 origin 的 fetch 能力，这是 M0 必验项 SPK-2（§29），回退路径见 §11.1。

每次授权建立一个 ScanSession，绑定：

```ts
type ScanSession = {
  runId: string;             // 本次扫描运行 ID
  sessionToken: string;      // 32 random bytes，base64url；只返回给建立会话的面板
  panelDocumentId: string;   // 建立会话的 Side Panel 文档
  windowId: number;
  tabId: number;
  documentId: string;        // 最小授权探针的 InjectionResult.documentId
  origin: string;            // 授权时的店铺 origin
  authorizedAt: string;
  expiresAt: string;         // 默认 authorizedAt + 30 min，不自动续期
  state: "active" | "expired";
};
```

**会话建立协议（顺序不可交换）**：

1. Side Panel 加载后只发送 `EstablishSession` 候选请求，并携带自身通过 `chrome.windows.getCurrent()` 取得的 windowId；面板加载和面板按钮点击均不构成授权证明。
2. SW 先校验消息来自本扩展的 Side Panel（`sender.id === chrome.runtime.id`、`sender.url` 位于 `chrome.runtime.getURL("sidepanel/")` 下、存在 `sender.documentId`、无 `sender.tab`），再查询该 windowId 的活动标签页并确认 `tab.active === true`、`tab.windowId` 一致。
3. SW 必须能读取并解析 `tab.url`；URL 不可见、scheme 非 `http:`/`https:`、命中敏感路径或不是顶层页面时立即拒绝，且不执行任何脚本。
4. 通过预检后，SW 执行一个编译进扩展的**最小授权探针**：仅返回 `location.href/origin/pathname`，不读取 DOM、全局变量或页面内容。只有 `chrome.scripting.executeScript()` 成功，且 InjectionResult 的 documentId、返回 origin/path 与预检一致，才证明当前 activeTab 能力存在。
5. SW 此时才生成 32 字节随机 `sessionToken`，写入 `chrome.storage.session`（键含 runId；保持默认 `TRUSTED_CONTEXTS`，不得向 content script 暴露），并把不透明句柄交给该面板。不得把凭证写入 IndexedDB、`storage.local`、日志或导出。
6. 授权探针失败、URL 在探针前后发生变化或任何字段不一致 → 不建立会话，面板提示重新点击扩展图标。SPK-1 负责在真实 Chrome 中冻结“图标打开 Side Panel”是否授予该能力。

会话失效规则（任一满足即置 `expired`，不得继续使用）：

- `tabs.onActivated`：用户切到其他标签页（该标签页授权仍在，但面板必须重新确认目标）。
- `tabs.onUpdated`/documentId 变化：发生任意文档导航。同源导航虽保留 activeTab，但 documentId 已变，会话仍按失效处理、需重建（保守策略，避免依赖未验证的边界行为）。
- 跨源导航或标签页关闭：activeTab 本身已被撤销。
- 当前时间达到 `expiresAt`、Side Panel documentId 变化、用户显式取消、已确认面板文档卸载、扩展重载或浏览器重启。不得把未经 SPK-4 验证的“面板视觉关闭”当成唯一吊销机制。
- SW 侧按下述消息校验协议拒绝一切与会话不符的消息。
- 吊销动作 = 从 `chrome.storage.session` 删除记录；SW 重启后从该区重新读取，不依赖全局变量。

**消息校验协议**（平台事实：`runtime.MessageSender.tab` 只在消息来自标签页（含内容脚本）时存在，Side Panel 等扩展页面的消息不含 `sender.tab`，因此不能对"每条消息"统一校验 tabId）：

- 面板 → SW 消息：校验 ①`sender.id === chrome.runtime.id`；②`sender.url` 在 Side Panel 路径下且 `sender.documentId === panelDocumentId`（`sender.origin` 若存在也必须等于扩展 origin，但因该字段可选，不能单独依赖）；③消息的 runId/sessionToken 与 `chrome.storage.session` 中的活动会话精确匹配；④`chrome.tabs.get(tabId)` 仍为同一 window 的活动标签页，URL origin/path 非敏感且未变化。复核失败即吊销。
- Collector → SW 消息：校验 `sender.id`、`sender.tab.id`、`sender.documentId`、`sender.frameId === 0` 和 `sender.url` origin 与 ScanSession 一致；`sender.origin` 若存在也必须一致。MAIN Probe 不发送 runtime 消息，只使用 `executeScript` 的返回通道。
- 每次执行 Collector、MAIN Probe 或 EndpointRequest 前都重复标签页 URL、active/window、documentId 与敏感路径复核；不得只在会话建立时检查一次。
- 任一校验失败：拒绝消息并记录失败，不静默放行。

**注入前敏感路径硬性排除**：`credentials: "omit"`（§11.2）只约束扩展发起的新请求，不能阻止 Collector 读取用户已登录会话渲染的页面 DOM。因此 SW 在建立 ScanSession、执行任何数据采集注入之前，必须读取当前标签页 URL（activeTab 授权下可见），路径命中黑名单即拒绝建立会话，扫描置 `sensitive_path` 状态并提示用户切换到公开页面：

- 拒绝的首个有效路径段：`admin`、`account`、`checkout`、`checkouts`、`orders`、`cart`。匹配前必须去除 query/fragment、逐段安全 percent-decode、合并重复斜杠、转小写，并剥离一个 locale 前缀（如 `fr`、`en-ca`）；因此 `/fr/account`、`/EN-ca/cart/`、`/%61ccount` 均被拒绝，而 `/products/account` 不因第二段产品 handle 误判。
- 该拦截发生在最小授权探针之前；探针返回后、每次注入/请求前再次由 SW 检查。Collector 函数入口还要用同一纯函数对 `location.pathname` 自检，命中即在读取 DOM 前返回 `sensitive_path`。任一阶段发现路径变化或无法安全解码都采取 fail closed 并吊销会话。
- 黑名单随扩展发布，不可被规则包或设置放宽；日志与 Evidence URL 不保存 query/fragment。
- `/password` 不在此列，按 §11.4 的 `password_protected` 流程单独处理。

**Side Panel 内的"扫描"按钮不构成新的 activeTab 授权**——面板内点击不是对 action 的调用。按钮仅在存在有效 ScanSession 时可用；否则提示用户重新点击扩展图标（§6.3）。

### 8.4 Side Panel 行为配置

- Chrome 150 的 M0 实测表明 `openPanelOnActionClick: true` 虽能打开 Side Panel，却未稳定授予最小 `executeScript` 探针所需的 activeTab 能力。因此最终配置关闭自动行为，并显式处理 action：

```ts
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined && tab.windowId !== undefined) {
    void chrome.sidePanel.open({ windowId: tab.windowId });
  }
});
```

- `sidePanel.open()` 自 Chrome 116 起可用并要求用户手势，因此 manifest 的 `minimum_chrome_version` 冻结为 116。
- action handler 必须在事件回合内直接调用 `sidePanel.open()`；不得先等待异步预检。新面板自行发送候选 EstablishSession；已经打开的面板由 action handler 的无凭证通知触发重试。两条路径都**不把面板加载或通知当成点击证明**：只有 §8.3 的最小授权探针成功后才签发会话。
- SPK-1 已冻结该授权入口；SPK-3～4 继续验证导航、标签/窗口切换和面板关闭/刷新生命周期。

## 9. Service Worker 生命周期与恢复

### 9.1 平台约束（官方文档化）

- 空闲 30 秒后终止；收到事件或调用扩展 API 会重置计时。
- 单个请求/事件处理超过 5 分钟会被终止。
- `fetch()` 响应超过 30 秒未到达会被终止（本设计单请求超时 12 秒，留有余量）。
- 全局变量在终止后丢失，官方建议持久化到 storage/IndexedDB。

### 9.2 恢复语义

扫描正确性不依赖 SW 全局内存（架构 A 已保证协调状态在面板）。在此之上定义：

- **持久化 ScanRun/检查点**：面板在每个模块开始/结束时更新 IndexedDB 中的 ScanRun（状态、已完成模块、请求统计），并每 10 秒写一次 `heartbeatAt`。
- **幂等模块写入**：`snapshotId` 在 ScanRun 创建时即生成并记录于 ScanRun；产品分批写入以 `[snapshotId+productKey]` 为主键 put（重复执行覆盖同一行，与 §18.1 表定义一致），模块结果以 `[snapshotId+moduleId]` 为主键；任何步骤重放不产生重复数据。
- **原子快照提交**：快照仅在最终提交事务中置 `committed: true`（§18.2）；读路径只认 committed 快照。
- **stale-run 对账**：面板每次打开时扫描 `scanRuns`，将 `status === "running"` 且 `heartbeatAt` 超过 60 秒的运行修复为 `interrupted`，并清理其 staging 数据。该对账不区分死因（SW 被杀、面板被关、浏览器退出统一处理）。
- **`running → interrupted/failed` 状态修复**：`interrupted` 在 UI 中如实展示为"扫描中断"，用户可一键重扫。**V1 不做断点续扫**：恢复语义承诺的是"不出现半写快照、不出现僵尸 running"，而不是续跑。
- **SW 请求失败恢复**：面板对单条 EndpointRequest 设置消息级超时（请求超时 + 3 秒）；超时或通道断开视为该请求失败，按 §14 重试策略处理，SW 的重启对面板透明。

### 9.3 取消语义

- `AbortController` 只负责中止当前 SW 实例内的 in-flight fetch 与当前面板实例内的循环，**不是持久化取消机制**。
- 持久化取消 = 面板将 ScanRun 置为 `cancelled` 并写库；协调循环在每个调度点检查该状态。面板崩溃后残留的 running 由 stale-run 对账兜底。

## 10. 权限设计

V1 建议的最小权限：

```json
{
  "manifest_version": 3,
  "minimum_chrome_version": "114",
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "sidePanel"
  ],
  "optional_host_permissions": [],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "action": {
    "default_title": "Inspect Shopify store"
  },
  "side_panel": {
    "default_path": "sidepanel/index.html"
  }
}
```

设计约束：

- V1 不申请 `<all_urls>`，也不注册永久运行的 `content_scripts`。
- 不申请 `cookies`、`webRequest`、`history`、`downloads`、`unlimitedStorage` 或广泛的 `tabs` 权限。
- 通过用户点击产生的 `activeTab` 临时权限访问当前站点。
- V1.1 发布时把评论供应商域名写入 `optional_host_permissions`，首次启用对应供应商时经用户手势请求（Chrome 官方要求 `permissions.request()` 必须在用户手势内调用，§17）。
- 若某供应商需要过宽权限或不稳定的登录态接口，则不纳入支持范围。
- `optional_host_permissions` 只服务预先声明的评论供应商，不作为任意当前店铺 origin 的回退权限。SPK-2 已证明 activeTab 下 SW 可对授权 origin 执行核心 fetch，因此不引入 `<all_urls>`、`https://*/*` 或 Collector 网络代理。

## 11. 请求安全策略（RequestPolicy）

所有网络请求（核心扫描与评论适配器）必须经过统一 RequestPolicy，实现于 SW 侧。

### 11.1 端点构造与传输通道

- 只允许批准的 `http:`/`https:` origin：**V1 核心扫描严格等于 ScanSession.origin**；观察到的 primary/myshopify 域名只作身份 Evidence，不扩张网络 allowlist（§15.3）。评论仅允许预先声明且已由用户批准的供应商域名。开发模式可单独允许 localhost。
- 同源 Shopify 路径由固定端点类型构造，SW 不接受完整任意 URL：

```ts
type EndpointRequest =
  | { kind: "meta" }                                            // B 级 /meta.json
  | { kind: "products-page"; page: number; limit: number }      // B 级 /products.json
  | { kind: "collection-products-json"; handle: string; page: number } // B 级，仅补字段
  | { kind: "cart-context" }                                    // A 级 {routeRoot}cart.js，仅提取 currency
  | { kind: "product-ajax-js"; handle: string }                 // A 级 {routeRoot}products/{handle}.js
  | { kind: "collection-html"; handle: string; sortBy: "best-selling" | "created-descending"; page?: number } // A 级排序参数
  | { kind: "sitemap"; index?: number; from?: string; to?: string } // 降级来源；from/to 仅为根 sitemap 解析出的十进制 ID 边界
  | { kind: "page-html"; target: "route-root" | "password" }    // SW 由 routeRoot 或固定 /password 构造
```

  URL 一律 `new URL(builtPath, approvedOrigin)` 构造，参数经 Schema 校验与编码，拒绝 origin 漂移与路径穿越。
- **传输通道已冻结为 SW 统一 fetch**。修正 v0.2 的错误描述：ISOLATED world 内容脚本适用扩展 CSP，页面 CSP 并不拦截其同源 fetch；集中到 SW 的理由是策略收口（校验、重试、日志、取消在一处），而非绕开页面 CSP。SPK-2 已在真实 `cheerble.com` 验证 activeTab 下的 SW omit fetch 可用。
- M1 扫描为每次运行生成独立 `scanId`；Side Panel 的显式取消消息仍须通过同一 panel/session 凭证校验，SW 仅中止匹配 `runId + scanId` 的 `AbortController`。导航、标签切换、窗口失焦和会话吊销同步中止对应在途请求，不能只在面板侧丢弃迟到响应。
- **Collector fetch 回退不启用**：不在页面上下文增加网络代理面；若未来平台行为回归，必须重新打开 SPK-2 并修订设计，不得静默切换通道或申请任意 host permissions。
- `cart-context` 与产品请求必须使用同一传输通道、同一 ScanSession.origin、同一 routeRoot 和 `credentials: "omit"`。只提取并校验 `currency` 字段；购物车 items/token/note/attributes、原始响应与 `Set-Cookie` 一律不保存。
- B 级 `/products.json` 与 collection JSON 的价格币种语义未被官方文档保证。每次扫描若要把其价格用于比较，必须抽取同一 product/variant ID 的样本并与同口径 `product-ajax-js` 金额一致性核对。M0 在 `cheerble.com` 实测前者为 decimal major-unit string（如 `"34.99"`），后者为 integer minor units（如 `3499`）；比较必须按 `cart-context` currency 的 ISO fraction digits 用字符串/整数运算归一化，禁止直接字符串比较或浮点换算。核对失败或无法核对时，B 级价格只作 `unverified` Evidence，不进入标准化价格或差异计算。目录身份/标题等非价格字段仍可使用。

### 11.2 凭据模式

- 所有核心扫描请求 `credentials: "omit"`：只分析匿名公开访客可见内容，不携带用户浏览器中的店铺 Cookie（避免把用户的登录态/购物车状态混入分析）。
- 快照上下文记录 `credentialMode: "omit"`（§13）。
- 若未来需要"带 Cookie 视角"模式，必须作为独立显式功能另行设计（默认关闭、UI 明示、单独验收），本版不实现（§3 已列为不做）。
- 回退通道（Collector 同源 fetch）同样显式传 `credentials: "omit"`。

### 11.3 重定向处理

- **安全不变量：核心扫描绝不自动跟随重定向。** 默认 fetch 使用 `redirect: "error"`；任何 3xx（同源、primary ↔ myshopify 或站外）都不得产生第二跳请求。
- Fetch 在 `redirect: "error"` 下可能把重定向表现为不透明网络失败，M0 SPK-8 必须记录 Chrome 实际可观测行为。只有当 `redirect: "manual"` 在本机验证为“返回 `opaqueredirect` 且零第二跳”时，才可用它改善 `redirect_blocked` 分类；**任何情况下不得回退到 `follow`**。
- 被阻断的重定向记 `redirect_blocked`（若平台无法区分则记 `network` 并带 `redirectDetection: "unavailable"`），对应端点触发降级链。不能仅凭 Location、`meta.json` 或 MAIN Probe 提供的域名自动重发跨 origin 请求。
- 密码保护优先由当前页面 DOM/URL 与未重定向的 200 响应识别（§11.4）。若端点只通过重定向暴露 `/password`，在 SPK-8 中记录为 `redirect_blocked`，不得为提高识别率而跟随。

### 11.4 响应校验与特殊页面识别

每个响应依次校验：

1. HTTP 状态 → 按 §14 分类。
2. Content-Type 与期望匹配：期望 JSON 却返回 `text/html` → `not_json`（HTML 冒充 JSON，常见于挑战页/密码页/自定义 404）。Shopify 历史 Ajax `.js` 端点（仅 `cart-context`、`product-ajax-js`）实测可能以 `text/javascript` 返回 JSON；该 MIME 只在这两个类型化端点的窄 allowlist 中接受，随后仍必须通过 JSON 解析与端点 Schema 校验。`products.json` 等端点不得继承此例外。
3. 响应体积上限：JSON 默认 10 MB、HTML 默认 5 MB、sitemap 默认 10 MB，超限中断读取并记 `too_large`。
4. 运行时 Schema 校验：不合法记 `schema_invalid`，原始响应不入库。
5. 特殊页面识别（可返回 200 的假成功）：
   - 密码页：当前页面 URL/成功响应 URL 含 `/password`，或 HTML 含 storefront 密码表单特征 → 店铺级 `password_protected` 终态，停止后续模块请求，UI 如实展示。
   - 机器人挑战页：Cloudflare/Turnstile/hCaptcha/"Checking your browser" 等特征 → `challenge_page`，按终止性错误处理（同 430：停止对该 origin 的后续请求，提示稍后人工访问），不做任何绕过。

### 11.5 日志与脱敏

- 每次请求记录：端点类型、经批准的请求 URL origin/path、成功响应 URL（存在时）、HTTP 状态、失败类别、响应大小、耗时、重试次数、传输通道和 redirect mode。
- 不记录 Cookie、Authorization、Set-Cookie、完整响应体或其他敏感请求/响应头。
- 失败类别汇入模块错误与"复制诊断摘要"（§22）。

## 12. Shopify 端点分级与数据来源

### 12.1 Shopify 识别

采用多信号评分，而不是依赖单一变量：

- MAIN Probe 白名单字段（`Shopify.shop` 等，§8.2）。
- `/cdn/shop/`、Shopify CDN 或已知 storefront asset URL（Collector 从 DOM 收集）。
- `meta.json` 返回的店铺元数据（B 级端点）。
- HTML、JSON-LD、canonical、generator 和 script/link 特征。
- `myshopify.com` 域名或 `myshopify_domain` 信号。

建议阈值：强信号一项或弱信号两项即可判定；面板保留命中列表。

**Shopify 检测不等于 Shopify-hosted theme。** 检测成立后必须单独输出 `storefrontKind`：

```ts
type StorefrontKind = "hosted-theme" | "custom-storefront" | "uncertain";
```

- `hosted-theme`：存在一致的 `Shopify.routes.root`/theme runtime、Shopify 托管 theme asset 证据，且最小 `cart-context` Schema probe 成功；证据必须记录，不能只凭一个可被页面改写的全局变量。
- `custom-storefront`：有 Shopify commerce/checkout/CDN 等证据，但页面运行时、路由与端点形态明确属于自建前端，或 hosted-theme 探测明确不成立。
- `uncertain`：证据不足或互相冲突。只允许在已有至少两个独立 Shopify/theme 信号后执行一次受限 `cart-context` 分类 probe；该 probe 与 §11 使用相同 origin/omit/Schema/redirect 约束。只有 probe 成功且其他信号一致时才提升为 `hosted-theme`；否则不得调用其他 Ajax Product/Cart API，只继续 DOM/JSON-LD/sitemap 采集。
- 只有 `hosted-theme` 可以使用 §12.2 的 Ajax API。`custom-storefront` 只走 DOM、JSON-LD、canonical、公开 sitemap 等通用来源；覆盖率必须标为 partial/unknown，不宣称完整目录、presentment currency 或主题信息。

密码保护店铺（storefront password）单独处理：此类站点仍会被识别为 Shopify，但所有公开端点均返回密码页。命中 §11.4 的密码页识别后，扫描进入独立的 `password_protected` 终态并如实展示，不再逐模块请求并产生一堆解析错误。

### 12.2 A 级：Shopify 官方文档化能力

| 能力 | 依据 |
|---|---|
| `Shopify.routes.root` 全局值，locale 感知 URL 前缀，恒以 `/` 结尾 | Ajax API 官方文档 |
| Ajax Cart API：`GET {routeRoot}cart.js`；其 `currency` 字段用于核对顾客 presentment currency | Ajax API / Product API 官方文档 |
| Ajax Product API：`GET {routeRoot}products/{handle}.js`，返回产品 JSON（变体上限 250） | Ajax API Product 参考 |
| Collection 排序参数 `?sort_by=best-selling`（8 个文档化取值之一），作用于集合页面 URL | Liquid `sort_by` 过滤器文档 |
| Ajax API 无硬性速率限制，但受 Shopify 反滥用措施约束；不可读取客户/订单数据 | Ajax API 官方文档 |

A 级能力只可作为**已确认 `hosted-theme`** 的设计前提。Shopify 官方明确 Ajax API 不能用于 custom storefront；即使是 hosted theme，仍需处理主题定制、密码保护和挑战页。

### 12.3 B 级：经验性公开端点

`/products.json`、`/meta.json`、`/products/{handle}.json`、`/collections/{handle}/products.json` 均**未见于官方 storefront 文档**（官方 Product 参考只记载 `.js` 端点），属于经验性端点。约束：

- 使用前必须做 capability probe：先请求首页/小样本（如 `limit=1`），校验状态、Content-Type 与 Schema，通过后才启用该端点。
- probe 失败或中途失效 → 对 `hosted-theme` 按降级链继续：`/products.json` → sitemap 产品清单 → Collection HTML → 逐产品 `{handle}.js`（A 级，限量补充）；`custom-storefront` 不进入 Ajax 端点链，只使用通用公开来源。
- 不假定端点永久存在；每次扫描独立探测。
- **不作为"完整产品目录"的无条件承诺**：快照必须记录实际来源组合与覆盖率（§12.5），降级来源只能声称"已发现的产品"。
- 每次请求记录响应类型、请求 URL 与成功响应 URL（存在时，§11.5）。

### 12.4 分页与防循环终止条件

`products-page` 与 `collection-products-json` 分页抓取必须满足全部防护：

- 页码单调递增，上限 = ⌈产品上限 / limit⌉ + 2。
- 终止条件（任一满足即停）：
  1. 空页（产品数组为空）。
  2. 返回数量少于 `limit`（末页）。
  3. 页面签名重复：当前页产品 ID 列表的哈希与任一已见页相同。
  4. 无进展：本页未产生任何新产品 ID/handle。
  5. 达到用户设置的产品上限（默认 1,000）→ 置 `truncated: true`。
- 分页过程中维护去重集合（按产品 ID，缺 ID 用 handle），重复项不重复入库。

### 12.5 覆盖率记录

快照携带 CoverageInfo：

```ts
type CoverageInfo = {
  productsFetched: number;
  estimatedTotal?: number;        // 来自 sitemap 计数等，可缺省
  truncated: boolean;             // 达上限截断
  sources: Array<"products-json" | "sitemap" | "collection-html" | "product-ajax-js" | "canonical" | "dom" | "json-ld">;
  capabilityProbes: Record<string, "ok" | "unavailable" | "challenge" | "not_json">;
};
```

UI 与导出必须展示覆盖率与截断标记，不得把部分目录呈现为全量。

当前页面的通用公开信号必须先在 Collector 内完成裁剪：只返回同源 canonical 产品 URL、同源 DOM 产品链接及 JSON-LD `Product` 的公开标题/图片；不得把原始 JSON-LD、offers/价格或任意页面对象跨边界传回。generic catalog 即使合并了这些信号与 sitemap，仍固定为 partial/unknown。

### 12.6 畅销排序

- 主路径：`collection-html`（A 级排序参数），默认 handle `all`，即 `/collections/all?sort_by=best-selling`。
- 响应必须验证：
  1. 成功响应 URL 必须与请求保持同 origin、同集合路径并保留 `sort_by=best-selling`；任何重定向已由 §11.3 阻断。
  2. 页面为集合页结构且能解析出有序产品列表。
  3. 实际 Collection scope：从成功响应 URL/页面确认实际集合 handle。
- `/collections/all` 不存在（商家已删除）时：降级到其他公开 Collection（按 sitemap/导航发现），结果只能标注为"**该 Collection 内的公开畅销排序**"，不得称为全店畅销。
- Collection HTML 只有在页面出现同源、同 handle、页码严格 `n+1` 的公开分页链接时才继续；每个 Collection 最多 20 页，重复页签名、空页、无新产品或产品上限均立即终止。`all` 无产品时最多尝试 10 个从当前导航/HTML 发现的公开 Collection handle。
- `/collections/{handle}/products.json` 不响应 `sort_by`，只返回集合默认排序——顺序一律不采信，仅按 handle 补充产品字段。
- 保留声明：best-selling 是店铺公开排序，**不等于真实销量**；UI 与导出均携带该声明和实际 scope。

### 12.7 上新候选与证据分级

上新列表按证据等级标注，UI 与导出必须携带等级：

| 等级 | 依据 | 语义 |
|---|---|---|
| A | 公开 `created_at`（B 级端点字段） | 创建时间明确 |
| B | 公开 `published_at` | 发布时间明确（可因重新发布偏新） |
| C | Collection `sort_by=created-descending` 的顺序（A 级排序参数） | 相对新旧次序，无绝对时间 |
| D | sitemap `lastmod` | 仅表示内容修改时间，**不等于上新日期**，只能作候选信号 |

缺少 A/B 级证据时，上新列表整体标注为"候选排序"。

## 13. locale、market 与货币上下文

- 通过 MAIN Probe 获取页面会话看到的 `Shopify.routes.root`、`Shopify.locale`、`Shopify.country`、`Shopify.currency.active`；这些值可能受页面会话或页面脚本影响，先进入 `page` 口径，不直接证明匿名价格币种。
- `hosted-theme` 的所有 Ajax URL（`cart-context`、`product-ajax-js` 等）使用同一个 locale-aware routeRoot。Probe 失败时可从当前 URL 做保守 locale 启发式，否则回退 `/`；来源必须记录。
- 产品 Ajax API 的金额是顾客 presentment currency；主价格口径只能由同一匿名传输上下文下 `cart-context` 的 `currency` 字段验证。`meta.json` 的货币字段只能作辅助 Evidence，不能把 `priceContextVerified` 置真。
- StoreSnapshot 必须记录扫描上下文：

```ts
type ScanContext = {
  // 主上下文：实际用于匿名端点请求的口径
  routeRoot: string;
  routeRootSource: "probe" | "url-heuristic" | "fallback";
  locale?: string;
  localeSource: "route-root" | "endpoint" | "unknown";
  country?: string;             // 仅在同一匿名传输口径有 market/country 证据时填写
  countrySource: "anonymous-page" | "endpoint" | "unknown";
  currency?: string;            // presentment currency；未验证时缺省
  currencySource: "cart-js" | "unknown";
  priceSourceStatus: Partial<Record<
    "product-ajax-js" | "products-json" | "collection-products-json" | "dom",
    "verified" | "unverified" | "not-used"
  >>;
  priceContextVerified: boolean; // currency、market 与实际价格来源均通过下述门控才为 true
  credentialMode: "omit";
  transport: "service-worker" | "collector";
  storefrontKind: StorefrontKind;
  // 页面会话口径：Probe/DOM 读到的值，可能受用户 geo/币种 Cookie 或页面改写影响
  page?: { routeRoot?: string; locale?: string; country?: string; currency?: string };
  contextMismatch?: boolean; // 两口径可比字段不一致时置真
};
```

- **双口径规则**：Probe/DOM 读到的 routeRoot/locale/country/currency 全部记入 `page`；选定的 routeRoot 可以用于构造匿名请求，但必须保留其 page-derived 来源。`cart-context` 返回的 currency 才进入主口径。country/market 只在同 transport/origin/routeRoot 的匿名 `page-html(target: "route-root")` 或经验证端点给出明确证据时进入主口径；否则 `countrySource = "unknown"`。两口径可比字段不一致时置 `contextMismatch: true`：DOM 派生的价格不得并入产品价格字段，只能作带“页面会话口径”标注的 Evidence；UI 上下文条显示警示。
- `priceContextVerified = true` 必须同时满足：① storefrontKind 为 `hosted-theme`；② `cart-context` currency 成功；③匿名 market/country 已验证；④transport/origin/routeRoot 一致；⑤实际采用的每一种价格来源在 `priceSourceStatus` 中均为 `verified`。其中官方 `product-ajax-js` 在 ①～④满足时可标 verified；B 级价格还必须通过 §11.1 的同 variant 样本核对；DOM 价格永远属于页面口径，不能让主口径置真。
- 任一条件失败时，产品仍可展示带来源的原始公开价格 Evidence，但币种/market 标为“未完整验证”，不得生成价格涨跌、换算或跨快照价格结论。
- **快照可比性规则**：价格比较仅允许两个快照都满足 `priceContextVerified === true`，并且主上下文的 `origin、routeRoot、locale、country、currency、credentialMode、transport、storefrontKind` 全部一致。上下文不一致或任一未验证时：
  - 差异视图显示"上下文不同，价格不可直接比较"，价格涨跌维度禁用，不生成任何价格结论。
  - 产品新增/删除等结构差异仍可计算，但带上下文差异警示标注。

## 14. 状态码与重试策略

| 状态/情形 | 分类 | 处理 |
|---|---|---|
| 429 | `rate_limited` | 优先按 `Retry-After` 等待；无该头则指数退避（2s/4s/8s，±30% jitter），最多重试 3 次；首次命中即把本次扫描并发降为 1，不再回升 |
| 430（Shopify Security Rejection，经验性：见于社区与第三方文档，storefront 官方文档未记载） | `security_rejected` | **终止性错误，不自动重试**；停止对该 origin 的后续 B 级端点请求，模块置 failed，提示用户稍后再试；不更换 UA/IP 等规避手段 |
| 401 / 403 | `forbidden` | 标记 unavailable/forbidden，不重试、不绕过 |
| 404 | `not_found` | 标记端点/资源不可用，触发降级链（§12.3） |
| 408 / 网络错误 / 超时 | `network`/`timeout` | 最多重试 1 次（2s 退避） |
| 5xx | `http_5xx` | 最多重试 1 次（2s 退避） |
| 3xx / redirect fetch failure | `redirect_blocked`（不可区分时为 `network`＋标志） | 按 §11.3 阻断且零第二跳；触发端点降级，不用 `follow` 重试 |
| 200 但密码页/挑战页/伪装 JSON/Schema 不符 | 见 §11.4 | 按对应类别处理，不重试（挑战页与 430 同级终止） |

重试预算（硬上限，超出即模块转 partial/failed）：

- 单请求超时：12 秒。
- 单模块重试等待预算：20 秒（不含正文下载时间）。
- 整次扫描重试等待总预算：60 秒。
- 默认并发 4；限流后降为 1（见上表）。
- 快照与 catalog 模块结果记录有界 `runtimeDiagnostics.retry`：实际重试次数、累计等待毫秒、最终并发、降并发次数及每次重试的 endpoint/category/delay。不得保存响应正文或任意请求头作为诊断。

## 15. 领域模型

### 15.1 概念接口

```ts
type Evidence = {
  source: "dom" | "meta" | "endpoint" | "script" | "rule" | "probe";
  url?: string;
  key?: string;
  excerpt?: string;
  confidence: number;
};

type StoreSnapshot = {
  schemaVersion: number;
  snapshotId: string;
  storeKey: string;          // V1 为规范化 origin 身份（§15.3）
  origin: string;            // 本次访问入口
  storefrontKind: StorefrontKind;
  storefrontKindEvidence: Evidence[];
  scannedAt: string;
  context: ScanContext;      // §13
  coverage: CoverageInfo;    // §12.5
  store: StoreIdentity;
  theme?: ThemeInfo;
  rankings: ProductRanking[];   // 携带 collection scope 与"非销量"声明
  newness: NewnessCandidate[];  // 携带 A–D 证据等级
  apps: AppDetection[];
  reviews?: ReviewSummary[];
  socials: SocialLink[];
  errors: ModuleError[];
  committed: boolean;        // §18.2 原子提交标志
};

type Product = {
  id?: string;               // Shopify Product ID，主要稳定身份
  handle: string;            // 显示字段；缺 id 时的回退身份
  title: string;
  url: string;
  vendor?: string;
  productType?: string;
  tags: string[];
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  variants: Variant[];       // 含 variant id
  images: string[];
  evidence: Evidence[];
};

type AppDetection = {
  appId: string;
  name: string;
  category: "app" | "pixel";
  confidence: number;
  matchedRuleIds: string[];
  evidence: Evidence[];
};
```

**持久化封套**：IndexedDB 中每条记录以 `{ schemaVersion, ...entity }` 形式落库；StoreRecord、ScanRun、Snapshot、ProductRecord、ModuleResultRecord、DiffRecord、FingerprintRulePack 全部携带 `schemaVersion`（修正 v0.2 中"所有持久化对象都带 schemaVersion"与接口定义不一致的问题——现在这是对每张表的硬性要求，而不只是 StoreSnapshot 一处）。缺少字段时保留 `undefined`，不以猜测值填充。

### 15.2 产品身份与差异匹配

- 主要稳定身份：Shopify Product ID（B 级端点与 `{handle}.js` 均提供数值 id）。
- `handle` 只作显示字段和缺少 ID 时的回退身份。
- 差异计算的匹配次序：
  1. 双方有 ID：按 ID 匹配。同 ID 不同 handle = **改名事件**（rename），不是删除加新增。
  2. 缺 ID：复合匹配并输出置信度——previous handle（1.0）→ canonical URL（0.95）→ variant ID 集合重叠（0.9）→ title+vendor（0.7）。
  3. 综合置信度 ≥ 0.8 判定为"疑似改名/同品"，差异记录携带 `matchType` 与 `confidence`；低于阈值才落为删除+新增，并附说明。

### 15.3 店铺身份

- V1 的安全与数据完整性基线是 `storeKey = normalize(origin)`（scheme + punycode/lowercase hostname + effective port；不含 path/query/fragment）。同一 origin 的快照稳定归组，不自动跨域合并。
- `Shopify.shop`、`myshopify_domain`、shop id 等页面/端点信号分别保存为 `observedMyshopifyDomain` / `observedShopId` Evidence，并标记来源与置信度；它们可被页面改写，**不得扩张 RequestPolicy allowlist，也不得直接替换 storeKey**。
- primary ↔ myshopify 的跨 origin 归并不属于 V1。未来如实现，必须采用独立 `StoreAlias` 记录、强证据验证、冲突检测、可撤销合并与数据迁移；手动合并也只能影响本地展示，不能自动授予网络权限。

## 16. App 指纹与技术信号系统

App 与营销 Pixel 检测共用本地、数据驱动的加权规则引擎：

```ts
type FingerprintRule = {
  id: string;
  appId: string;
  category: "app" | "pixel";
  signal:
    | { type: "script-host"; pattern: string }
    | { type: "asset-path"; pattern: string }
    | { type: "dom-selector"; selector: string }
    | { type: "global-variable"; path: string }   // 经 MAIN Probe 白名单扩展位读取，V1 仅限少量知名变量
    | { type: "html-pattern"; pattern: string };
  weight: number;
};
```

规则原则：

- 单个弱信号通常不足以确认 App；多个独立信号累计评分。
- 每个检测结果必须显示命中证据，允许用户判断误报。
- 规则文件只有数据，不能包含远程 JavaScript 或可执行表达式。
- V1 规则随扩展发布；不静默从服务器更新。
- 用户可导入/导出规则包，导入前校验 Schema 和大小。
- `global-variable` 信号的读取同样走 MAIN Probe 的白名单机制（编译期把规则涉及的变量路径并入白名单，运行期不接受动态路径）。
- 本引擎是 PPSpy 客户端已引用的私有后端检测（仅确认调用存在，服务算法/响应未核验，§5）的**替代实现**，量化目标见 §5.1，不声称 1:1 覆盖。
- 服务端埋点（如 Meta Conversions API）在页面上不可见，属于已知盲区，文档与 UI 均如实说明。

## 17. 评论适配器与可选权限

V1.1 使用统一接口隔离供应商差异：

```ts
interface ReviewAdapter {
  id: string;
  detect(context: DetectionContext): Promise<DetectionResult>;   // 只用核心扫描已有证据，不发跨域请求
  fetch(input: ReviewFetchInput): Promise<ReviewPage>;
  normalize(raw: unknown): ReviewRecord[];
}
```

权限与流程约束：

- 供应商域名声明在 `optional_host_permissions`，安装时不授予。
- **检测先行**：核心扫描用指纹证据判断店铺使用了哪家供应商，此步骤零跨域请求。
- UI 对检测到的供应商显示"启用 {供应商} 评论抓取"按钮；`chrome.permissions.request()` 只能在该按钮的点击处理器中调用（Chrome 官方要求权限请求必须发生在用户手势内）。
- **自动扫描过程中不得弹出权限请求**；未启用的供应商仅显示检测状态。
- 用户拒绝权限后：评论模块置 `skipped`，核心扫描继续工作，按钮保持可再次点击。
- 只能请求代码中声明的供应商 host allowlist；请求 path 和查询参数由适配器构造，Side Panel 不能传入完整 URL。
- 响应必须通过运行时 Schema 校验后才能进入数据库。
- 供应商失效时返回 `unsupported` 或明确错误；不绕过供应商认证、反爬或访问控制。
- 导出的评论保留供应商、商品标识、抓取时间和来源 URL。

## 18. 本地存储

### 18.1 表结构

| 表 | 主键 | 内容 |
|---|---|---|
| `stores` | `storeKey`（§15.3） | 按规范化 origin 的店铺索引、观察到的身份 Evidence、最后扫描时间、快照数量 |
| `scanRuns` | `runId` | 状态（running/interrupted/failed/cancelled/completed）、heartbeatAt、检查点、模块错误、请求统计、staging 标志 |
| `snapshots` | `snapshotId` | 快照头信息（含 context/coverage/committed），外键 storeKey |
| `products` | `[snapshotId+productKey]` | `productKey = id ?? "handle:" + handle`；快照下的产品与变体 |
| `moduleResults` | `[snapshotId+moduleId]` | 模块状态、结构化结果摘要、Evidence/错误引用；按 snapshotId 建索引以便提交检查和级联清理 |
| `diffs` | `diffId` | 两个快照间的差异结果（含可比性标志与 matchType） |
| `fingerprintRules` | `ruleId` | 用户导入或覆盖的规则 |

`snapshots` 与 `products`/`moduleResults` 的关系：一对多，子记录只属于唯一 snapshotId；快照删除必须级联删除其 products、moduleResults 与相关 diffs。所有表的记录都带 `schemaVersion`（§15.1）。ScanSession 不属于该数据库，只存在于 `chrome.storage.session`（§8.3）。

### 18.2 staging → 原子提交流程

1. 创建 ScanRun：`{status: "running", staging: true, heartbeatAt, snapshotId}`（snapshotId 此刻生成，后续所有 staging 写入以它为主键前缀，§9.2）。
2. 分批写入产品（每批 ≤ 100 条一个事务，主键幂等 put）。
3. 各模块完成后写入模块结果与快照草稿（`committed: false`）。
4. 提交前校验 ScanRun 的 write manifest：所有计划模块均有终态 moduleResult，产品写入计数与去重计数/检查点一致，快照草稿 Schema 合法；不满足即失败清理，不得发布不完整快照。随后在**单个事务**内完成 `snapshots.committed = true` 与 `scanRuns.status = "completed", staging = false`——要么都生效，要么都不生效。
5. 失败或取消：按 ScanRun 记录的 snapshotId 删除其 products、快照草稿与模块结果，ScanRun 置 `failed/cancelled`。
6. 孤儿清理：面板启动时的 stale-run 对账（§9.2）负责清理中断残留；另提供"清理未提交数据"的手动入口。

读路径（UI、差异、导出）只消费 `committed: true` 的快照。

### 18.3 容量与配额

- 总容量预算：`min(500 MB, navigator.storage.estimate().quota × 10%)`，用量按 `estimate().usage` 估算；预算与用量显示在设置页。
- 达预算 80% 时警告并建议导出/清理；达 100% 时拒绝开始新扫描（提示先清理）。
- 扫描中途配额不足（写入抛 QuotaExceededError）：中止 staging 写入并按失败清理（§18.2 第 5 步），ScanRun 置 `failed(quota_exceeded)`；已 committed 的历史快照不受影响。
- 保留策略：每店最多 20 个非固定快照，超限自动删除最早的非固定快照；用户可固定、手动删除、导出全部数据；清空数据必须二次确认并列出范围。
- 尝试 `navigator.storage.persist()` 申请持久化（结果不保证，记录返回值）；明示：浏览器在存储压力下可能回收非持久化站点数据，**导出文件才是长期备份**；UI 对大型快照提供一键导出备份。
- V1 不申请 `unlimitedStorage`：自用规模（≤500 MB 预算）远低于常规配额，且预算机制已兜底；只有当"常态化超预算"有实证时才重新评估（记录必要性后再加）。

### 18.4 迁移与恢复

- IndexedDB 升级事务失败会自动回滚并保持旧版本，数据不半迁移。
- 迁移原则：尽量做附加式变更（新表/新字段），避免重写既有数据；破坏性迁移必须先引导用户导出备份。
- 迁移前在 `chrome.storage.local` 记录 `pendingMigration` 标志；迁移失败时 UI 提示"导出数据 / 重置数据库"两条出路，不静默丢数据。

## 19. 导出（CSV/JSON）

- CSV 遵循 RFC 4180 引号与换行转义。
- **公式注入防护**：字段以 `=`、`+`、`-`、`@`、Tab（0x09）或回车（0x0D）开头时，前置单引号 `'`（默认开启）。防护只作用于 CSV；**JSON 导出保留原始值无损**。
- 导出元数据：JSON 导出内嵌 `meta` 段；CSV 导出附带同名 `.meta.json` sidecar。均包含：`schemaVersion`、扫描上下文（§13）、覆盖率与截断标记（§12.5）、行数、生成时间、CSV 清洗策略标志（`fieldsSanitized`）。
- 导出时提示目标文件与记录数量。
- 测试必须覆盖：以 `= + - @` 开头的恶意标题/Vendor/Tag、内嵌换行与引号、超长字段（≥ 32 KB）、CSV↔JSON 往返后的字段完整性。

## 20. 最小 UI

UI 不模仿 PPSpy，只保留执行任务所需结构：

- 顶栏：当前域名、**授权状态徽标**（已授权 / 需重新点击扩展图标）、扫描状态、最后扫描时间。
- 上下文条：storefrontKind / locale / country / currency / priceContextVerified / credentialMode / transport（§12–§13）；页面会话口径与匿名口径不一致或币种未验证时显示警示；另显示存储用量与预算。
- 主操作："扫描""取消""保存快照""导出"。
- 页面：Overview、Products、Apps、Reviews、History。
- Products：搜索、排序、筛选和 CSV 导出；覆盖率与截断标记常驻显示。
- Apps：名称、类目（app/pixel）、置信度和命中证据。
- Reviews：供应商检测状态、"启用 {供应商}"按钮（§17）、适配器错误。
- History：快照列表与差异摘要；上下文不一致的快照对显示"不可直接比较"。
- 畅销榜携带 scope 与"公开排序 ≠ 销量"声明；上新列表携带 A–D 证据等级徽标。
- 错误以模块为单位展示（含失败类别），不使用笼统的"扫描失败"。

建议技术栈：TypeScript + Vite + Vue 3。Vue 仅用于 Side Panel；采集器和核心解析器保持为无框架 TypeScript，便于测试和复用。

## 21. 安全与隐私边界

- 消息协议采用判别联合类型，并对所有外部输入做运行时校验；SW 按 §8.3 双轨校验消息来源（内容脚本消息验 sender.id/tab/document/frame/URL，面板消息验 sender.id/URL/panelDocumentId 与会话凭证，并复核标签页现状）。
- 只支持 `http:`/`https:`；开发模式可单独允许 localhost。
- 同源端点通过 `new URL(fixedPath, approvedOrigin)` 构造，拒绝 origin 漂移；不实现 `fetch(url)` 这类任意 URL 消息接口，避免扩展变成跨域代理。
- MAIN world Probe 白名单只读、可序列化返回、Schema 校验（§8.2）；无 `eval`、无代码字符串注入、无 postMessage 桥。
- 所有请求 `credentials: "omit"`，不携带、不采集 Cookie、密码、支付信息、账户页内容或 Facebook Token。
- 渲染远程文本使用 `textContent`；需要解析 HTML 时使用脱离页面的 `DOMParser`，不执行脚本。
- 不加载远程代码；规则更新只能是经过校验的纯数据。
- 默认没有遥测。若以后增加诊断日志，必须是本地日志并由用户主动导出。
- 日志脱敏清单见 §11.5。
- 导出文件可能包含店铺公开信息，仍在导出时提示目标路径和记录数量。

## 22. 错误模型与可观测性

一次扫描由多个独立模块组成：

```text
session → probe → detection → metadata → products → rankings → newness → socials → fingerprints → reviews
```

每个模块状态为：`pending | running | success | partial | failed | skipped`。

失败类别（贯穿请求日志、模块错误与 UI）：

`network | timeout | http_5xx | rate_limited | security_rejected | forbidden | not_found | redirect_blocked | password_page | challenge_page | not_json | schema_invalid | too_large | aborted | quota_exceeded | sensitive_path | unsupported_storefront | internal`

本地扫描日志记录：

- runId、storeKey、origin、开始/结束时间、心跳。
- 各模块耗时和状态；请求的端点类型、获批请求 URL origin/path、成功响应 URL（存在时）、HTTP 状态、失败类别、响应大小、重试次数、传输通道与 redirect mode。
- 解析器版本、规则包版本和数据 schema version。
- 不记录 Cookie、Authorization、完整页面 HTML 或敏感请求头。

面板提供"复制诊断摘要"，方便定位某个店铺的兼容问题。

## 23. 性能预算

- Content Collector 目标：压缩后不超过 50 KB；MAIN Probe 单次注入往返目标 < 200 ms。
- 面板按需加载图表、历史比较和导出模块。
- 默认最多 4 个并发网络请求（限流后 1，§14）。
- 1,000 产品店铺的核心扫描目标：正常网络、无限流时 30 秒内给出可用结果；基础信息应先行显示。触发限流退避时允许超出，UI 显示等待原因。
- 面板启动时的 stale-run 对账目标 < 100 ms（索引扫描，不全表读）。
- 产品列表使用虚拟滚动或分页，避免一次渲染全部记录。
- 归一化和统计在面板侧完成，不在页面主线程做大规模聚合。
- 每次扫描结束后释放采集器引用和取消控制器。

## 24. 项目目录

```text
ss-watcher/
├── docs/
│   ├── DESIGN.md
│   └── spikes.md                  # M0 技术验证记录（SPK-1…）
├── src/
│   ├── manifest.ts
│   ├── service-worker/
│   │   ├── index.ts
│   │   ├── request-executor.ts    # 可重启的单请求执行器
│   │   └── inject.ts              # Collector/Probe 注入代理
│   ├── content/
│   │   ├── collector.ts           # ISOLATED world
│   │   ├── probe.ts               # MAIN world 白名单探针
│   │   └── page-signals.ts
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── coordinator/           # 扫描状态机、ScanSession、检查点、心跳
│   │   └── views/
│   ├── core/
│   │   ├── request-policy/        # endpoints.ts / response-validation.ts / retry.ts
│   │   ├── shopify/
│   │   ├── fingerprints/
│   │   ├── reviews/
│   │   ├── normalize/
│   │   └── diff/                  # 身份匹配与可比性规则
│   ├── storage/                   # staging 提交、对账、配额
│   ├── export/
│   └── shared/                    # 消息协议与 Schema
├── tests/
│   ├── fixtures/
│   ├── unit/
│   ├── integration/
│   └── spikes/                    # M0 验证脚手架
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 25. 测试策略

### 25.1 单元测试

- Shopify 检测评分；产品、变体、价格和日期归一化。
- ScanSession：授权探针前后 URL 竞态、sessionToken 存取/过期/吊销、panel/tab/document/window 绑定和消息 sender 双轨校验。
- 敏感路径归一化：locale 前缀、大小写、percent-encoding、重复斜杠、危险路径与 `/products/account` 等非危险对照。
- RequestPolicy：端点构造、origin 固定、重定向零第二跳、状态码分类、退避计算（含 jitter 边界）。
- storefrontKind 分类与分流；cart-context Schema、匿名 market 来源、B 级价格样本核对和价格可比性门控。
- 产品身份匹配：ID 匹配、改名事件、复合匹配置信度与阈值。
- App/Pixel 指纹加权与阈值；上新证据分级。
- 快照差异算法与可比性门控（上下文不同 → 价格维度禁用）。
- CSV/JSON 导出转义、公式注入防护与 meta 完整性。
- 分页终止条件（空页/短页/重复签名/无进展/上限）。

### 25.2 Fixture 测试

保存去敏后的公开响应样本：

- 标准 Shopify hosted theme；高度定制主题（`window.Shopify` 缺失/被改写）；至少两个 custom/headless storefront 与一个证据冲突的 `uncertain` 样本。
- `/products.json` 禁用或字段缺失；产品超过 250 个的分页店铺。
- 开启密码保护（storefront password）的店铺（含返回 200 的密码页）。
- 机器人挑战页（Cloudflare/Turnstile，含返回 200 的变体）。
- HTML 冒充 JSON 的响应；同源、primary ↔ myshopify 与站外重定向链，验证客户端均为零第二跳。
- 触发限流（429 含/不含 Retry-After）与 430 的响应序列。
- 多币种、无价格、售罄、多变体产品；`cart.js` currency 与页面/meta 币种一致和冲突、匿名 country 可得/不可得、B 级价格与 `.js` 一致/冲突的样本；handle 改名前后的快照对。
- 不同 locale/currency/transport/priceContextVerified 上下文的同店快照对。
- 多个 App 信号冲突的页面；§5.1 要求且开发集/holdout 按店铺隔离的 App/Pixel 正负样本集。
- 各评论供应商的代表性响应。
- 含 `= + - @`、换行、引号、超长字段的恶意产品文本。

Fixture 只保存完成测试所需的最小片段，不把第三方插件包当作项目运行依赖。

### 25.3 浏览器集成测试

- 未点击扩展时不注入内容脚本、不产生扫描网络请求；直接加载/刷新 Side Panel 时，最小授权探针失败且不签发会话。
- MAIN/ISOLATED 数据边界：Collector 读不到页面变量、Probe 只返回白名单字段。
- 最小授权探针成功后才签发凭证；SW 强制终止并重启后能从 `chrome.storage.session` 复核，扩展重载/浏览器重启后旧凭证不可用。
- 在 `/account`、`/fr/account`、`/EN-ca/cart/`、`/%61ccount`、`/checkout` 等敏感路径上点击扩展：不建立会话、零数据采集注入、零扫描请求，UI 明示原因；在授权与采集之间切入敏感路径时也 fail closed。
- 伪造/过期 runId 或 sessionToken、错误 panelDocumentId/windowId 的面板消息，以及 tabId/documentId/frameId/URL 不符的内容脚本消息均被 SW 拒绝。
- 点击后核心扫描只访问当前店铺 origin；V1.1 仅额外访问已批准的评论供应商域名。网络日志证明同源与跨源重定向均未产生第二跳。
- hosted theme 可进入 Ajax 端点链；custom storefront 不发 Ajax Product/Cart 请求且显示 partial/unknown coverage；uncertain 仅执行获准的最小分类 probe。
- 通过 DevTools/`chrome://serviceworker-internals` 强制终止 SW：扫描按 §9.2 恢复语义收敛（无半写快照、无僵尸 running）。
- 标签页切换、同源导航、跨源导航的竞争场景：旧 ScanSession 全部失效，无越权请求。
- activeTab 未授权/失效时扫描按钮禁用并提示重新点击图标。
- optional permission 拒绝后核心扫描完整可用。
- 扫描中途取消：staging 清理干净；IndexedDB 配额不足（小配额模拟）时干净失败。
- 数据库迁移失败路径：提示导出/重置，不静默丢数据。
- 扩展重启后 committed 快照仍可读取；大型店铺扫描可取消，不留 running 残留。

## 26. 里程碑与工作量

| 里程碑 | 交付内容 | 预计时间 |
|---|---|---:|
| M0 技术验证与骨架 | SPK-1～8 全部出结论并记录于 docs/spikes.md；MV3 骨架、Side Panel、类型化消息协议、RequestPolicy 骨架、staging 存储 PoC、测试框架 | 3–5 天 |
| M1 核心扫描 | Shopify 检测、双层采集、元数据、产品分页与降级链、错误模型 | 4–6 天 |
| M2 分析与导出 | 畅销/上新（证据分级）、统计、产品表、CSV/JSON（防注入＋meta） | 4–6 天 |
| M3 App/Pixel 指纹 | 规则 Schema、匹配引擎、证据 UI、初始规则包（§5.1 目标） | 4–6 天 |
| M4 本地历史 | IndexedDB 提交协议、快照、身份匹配差异、保留与配额策略 | 3–5 天 |
| M5 评论适配 | 首批供应商适配器和 optional permission 流程 | 3–5 天 |
| M6 加固 | Fixture 全集、集成测试、性能、安全审查、打包说明 | 4–6 天 |

- 合计约 25–39 个工作日：单人自用版本预计 **5–7 周**达到稳定可用。
- 若只做到 M0–M3，约 3–4 周形成第一版——**该估算以 SPK-1～8 全部形成可接受结论并冻结回退为前提**；任一项不符合预期，先按其回退方案修订设计再继续，工期相应顺延。
- 时间不包含销量、流量或广告历史数据库，因为这些属于另一类后端数据产品。
- M0 已于 2026-07-20 完成；实际冻结结论与接受的 SPK-8 降级见 `docs/spikes.md`。
- M1、M2 已于 2026-07-20 完成；产品分析范围的验收证据见 `docs/m1.md`、`docs/m2.md`。M3–M6 与完整 V1 验收仍未完成。

## 27. V1 验收标准

必须全部满足。

基础与授权：

1. 扩展以解压方式安装并在 Chrome 116+ 正常启动；初始化时关闭 `openPanelOnActionClick`，并由显式 `action.onClicked → sidePanel.open()` 打开面板。
2. 点击图标可打开 Side Panel，并扫描当前公开 Shopify 店铺。
3. 未经点击授权不会注入内容采集器，也不会发起扫描请求。
4. MAIN/ISOLATED 边界测试通过：Collector 读不到页面 JS 变量，Probe 只返回白名单字段且经 Schema 校验。
5. 只有最小授权探针成功后才签发 ScanSession；activeTab 未授权或已失效、面板直接加载/刷新时，扫描按钮禁用并提示重新点击图标，面板"扫描"按钮从不自行取得新授权。
6. 标签页切换、同源导航、跨源导航后旧 ScanSession 失效，无任何针对旧 origin 的后续请求。

扫描与网络策略：

7. 非 Shopify 页面不会继续尝试产品目录抓取。
8. 产品分页能处理至少 1,000 个产品，可取消，且五类分页终止条件均有测试覆盖；超上限时正确标注 truncated 与覆盖率。
9. 429 触发退避与降并发并可恢复完成；430 立即终止相关请求且不自动重试（两者分流有测试）。
10. 所有核心请求以 `redirect: "error"`（或经 SPK-8 证明零第二跳的 `manual`）执行；同源、别名与站外重定向均不跟进，网络测试证明零第二跳并记 `redirect_blocked`/降级状态。
11. 返回 200 的密码页与挑战页被正确分类为 `password_protected` / `challenge_page`，不产生伪数据。
12. 核心扫描所有请求 `credentials: "omit"`（网络日志抽查验证）。
13. hosted theme / custom storefront / uncertain 分类和 Evidence 可见；只有 hosted theme 进入 Ajax 端点链。B 级端点全部先 capability probe，任一端点失效时降级链可用并如实标注覆盖率。

数据与存储：

14. Overview、Products、Apps 三个核心页面能在部分模块失败时继续展示结果。
15. 手动快照在浏览器重启后仍存在；读路径只出现 committed 快照。
16. 扫描中途强制终止 SW（或关闭面板）后：无半写快照、无僵尸 running，stale-run 对账将其修复为 interrupted 并清理 staging。
17. 产品 handle 改名（同 ID）在差异中呈现为改名事件而非删除+新增；缺 ID 时复合匹配按置信度阈值工作。
18. 只有两个快照的匿名 currency、market/country 与实际价格来源均通过 §13 门控，且全部可比字段一致时才生成价格差异；任一未验证或上下文不同均显示"不可直接比较"。
19. IndexedDB 配额不足时干净失败且历史数据完好；迁移失败路径给出导出/重置出路。
20. 两个快照可生成确定性的差异结果。

指纹与评论：

21. App 检测显示规则命中证据与类目，不只给出名称；独立 holdout 上页面级误报 ≤ 5%、正样本漏报 ≤ 15%，并报告样本数（§5.1）。
22. 营销 Pixel 检测随 V1 交付且有独立 fixture。
23. 评论供应商权限只在用户点击"启用"时请求；自动扫描不弹权限；拒绝后核心扫描不受影响（V1.1 项，随该版本验收）。

导出与边界：

24. 产品 CSV 和完整 JSON 可导出，并通过重新导入测试验证字段完整性；CSV 公式注入防护生效，JSON 保留原值；导出含 schemaVersion、扫描上下文与覆盖率。
25. 畅销榜展示实际 Collection scope 与"公开排序 ≠ 销量"声明；上新列表携带 A–D 证据等级。
26. 扩展网络日志中不存在 PPSpy、其分析服务、Google Analytics 或其他未声明遥测域名。
27. V1 所有核心网络目的地严格等于当前扫描 origin；V1.1 只额外允许显式批准的评论供应商域名。观察到的 myshopify/primary 别名从不自动扩张网络权限。
28. 不读取 Cookie、Facebook Token、账户页或支付页内容。

授权与消息校验（v0.3.1 引入、v0.3.2 闭环）：

29. 在账户、结账等敏感路径（含 locale 前缀、大小写/编码变体，§8.3）上点击扩展图标：不建立会话、不做数据采集注入、不扫描，UI 明示原因；授权后路径竞态也 fail closed。
30. ScanSession 包含 panelDocumentId/windowId/tabId/documentId/origin/expiry，并只存 `chrome.storage.session`；扩展重载、浏览器重启、过期或任一绑定变化后旧凭证失效。
31. 携带伪造或已吊销凭证、错误 panelDocumentId/windowId 的面板消息，以及 tabId/documentId/frameId/URL 不符的内容脚本消息均被 SW 拒绝。
32. moduleResults 以 `[snapshotId+moduleId]` 幂等写入；提交前 write manifest 校验通过，失败/取消/孤儿清理均能按 snapshotId 完整级联删除。

## 28. 已冻结决策与默认值

本方案按以下默认值进入实现，不因非关键问题暂停：

- 工作名：`SS Watcher`；本机 MV3 解压扩展；Chrome Side Panel + Vue 3 最小 UI。
- 架构：A——Side Panel 协调扫描，SW 管理 `chrome.storage.session` 临时授权并作可重启执行器（§7.2）；V1 不做断点续扫。
- 采集：ISOLATED Collector + MAIN Probe 白名单；传输主通道 SW fetch，回退通道由 SPK-2 冻结。
- 凭据：一律 `credentials: "omit"`；带 Cookie 模式列为不做。
- 授权与消息：最小授权探针成功后才签发凭证；敏感路径做解码/locale 归一化并多阶段 fail closed；消息按 panel 与 tab context 双轨校验（§8.3）。
- 端点：A/B 分级；Ajax API 只用于 hosted theme，B 级必须 capability probe；核心请求零重定向第二跳；畅销主路径 = Collection HTML `sort_by=best-selling`。
- 上下文：presentment currency 由同一匿名传输口径的 `cart.js` 验证，market/country 与实际价格来源也必须通过门控；任一未验证时禁用价格差异（§13）。
- 身份：产品以 ID 为主、handle 回退，复合匹配阈值 0.8；V1 店铺 storeKey 固定为规范化 origin，观察到的 myshopify domain 只作 Evidence。
- 限流：429 退避重试 ≤ 3 次并发降 1；430/挑战页终止不重试。
- 默认值：并发 4；单请求超时 12 s；产品上限 1,000；每店 20 个非固定快照；总容量预算 min(500 MB, 配额 10%)；CSV 防注入默认开。
- 规则包 V1 目标：≥ 40 个有独立 holdout 的稳定 App（含 ≥ 8 Pixel），holdout 页面级误报 ≤ 5%、正样本漏报 ≤ 15%；样本不足规则标 experimental。
- 无服务器、无账号、无遥测、无自动扫描；不使用 PPSpy 私有 API，不复制 PPSpy UI 和代码。

## 29. 未决技术验证项（M0 spike 清单）

以下清单是 M0 的验证基线，逐项证据、结果和冻结分支记录在 `docs/spikes.md`。2026-07-20 门禁已关闭：SPK-1～7 PASS；SPK-8 因不在生产店强行制造 Markets、密码/挑战和限流状态而保留 PARTIAL，但对应降级均已实现或冻结，属于可接受结论。M1 不得把这些 PARTIAL 项默认提升为已验证能力。

| # | 验证内容 | 若不符合预期的回退 |
|---|---|---|
| SPK-1 | `openPanelOnActionClick: true` 时点击图标是否授予 activeTab；最小授权探针、`action.onClicked` 与面板直接加载/刷新分别如何表现 | 若自动开面板不能稳定授予探针能力，优先改为显式 `action.onClicked` 中同步调用 `sidePanel.open()`；仍不可靠时再用 context menu/快捷键授权入口。任何分支都以探针成功为签发条件，不以 panel load 猜测 |
| SPK-2 | activeTab 授权下，SW/扩展页对店铺 origin 的 fetch 是否放行（文档只确认 scripting/URL/webRequest） | 只切换到 Collector 页面内同源 fetch 通道（§11.1）；不得为任意店铺申请动态 `optional_host_permissions` |
| SPK-3 | 同源导航、SPA pushState、跨源导航、标签/窗口切换对 activeTab、documentId 与 URL 事件的实际影响；路径竞态是否被多阶段检查捕获 | 收紧为任何 URL/document/active/window 变化即吊销，并在 Collector 函数入口继续 fail closed（当前设计已采用该保守基线） |
| SPK-4 | 面板打开时再次点击图标是否 toggle 关闭、隐藏时文档/消息 Port 是否仍存活（影响取消语义与重新授权 UX） | 以显式取消＋TTL 保证正确性；UI 文案改为“切换标签页后重新授权”，必要时改用右键菜单授权，不依赖视觉关闭自动吊销 |
| SPK-5 | 强制终止 SW 后消息通道行为、`chrome.storage.session` 会话读取与自动唤醒；恢复语义 §9.2 在真实浏览器中的表现 | 若消息丢失不可检测，为每条消息加应答超时+序号重发；若 session 恢复不可靠则醒来后一律要求重新授权 |
| SPK-6 | MAIN Probe 在真实主题（含改写 `window.Shopify` 的店铺）上的可得性与稳定性 | 强化 URL/DOM 启发式，locale 上下文降级路径已在 §8.2 |
| SPK-7 | products/moduleResults/snapshot 的 staging→write manifest→原子发布，在 IndexedDB 中的事务边界、级联清理与小配额模拟 | 改为“快照头最后写入”两阶段方案；发布前仍必须校验 write manifest |
| SPK-8 | 在自有 dev store 上核验 hosted/custom 分类、`cart.js` currency、匿名 market/country 可得性、B 级价格与 `.js` 一致性、密码保护、primary↔myshopify/站外重定向的零第二跳、429/430 形态；比较 `redirect: error` 与 `manual` 的可观测性，不对第三方店铺做压力测试 | 冻结 storefront 分流、价格上下文门控与 redirect mode；market 或价格来源无法验证时保留展示但禁用价格差异；任一 redirect mode 无法证明零第二跳则坚持 `error` 并接受粗粒度错误分类，调整降级链 |

PPSpy `/v1/extension/apps-detect` 的本机客户端 source map 证据已在 v0.3.2 完成核对（§5），不再属于 M0 待办；服务器行为与算法仍不在本项目核验或调用范围内。

## 30. 下一步

1. 进入 M3：实现 App/Pixel 指纹规则 Schema、证据 UI、独立 holdout 与误报/漏报报告；不得把单一脚本命中直接宣称为已安装 App。
2. 继续复用 M0–M2 已冻结的 SessionManager、RequestPolicy、retry policy、价格上下文门控、staging 原子提交和双端口 fixture；任何放宽 origin、credential、redirect 或敏感路径边界的改动必须重新打开对应 spike。
3. M2 之后仍不推断销量；公开 `best-selling` 只保留实际 Collection scope 与“公开排序不等于真实销量”声明。

## 31. 参考资料（本次修订核验过的来源）

Chrome 扩展官方文档：

- Content scripts（ISOLATED/MAIN world、CSP）：https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- chrome.scripting（ExecutionWorld 自 Chrome 95、func 序列化与返回值）：https://developer.chrome.com/docs/extensions/reference/api/scripting
- Side Panel API（Chrome 114+、setPanelBehavior、open() 需手势且 116+）：https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- activeTab（授权时机、能力、同源保留/跨源撤销）：https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- runtime MessageSender（tab/origin/url/documentId 均按来源上下文与 optional 语义校验）：https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender
- `chrome.storage.session`（内存存储、浏览器/扩展重启清除、默认不暴露给 content scripts）：https://developer.chrome.com/docs/extensions/reference/api/storage#property-session
- Service worker 生命周期（30 s 空闲、5 min 单事件、30 s fetch 响应）：https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- 跨域网络请求（host permissions、内容脚本同源策略）：https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Permissions（请求必须在用户手势内、optional_host_permissions）：https://developer.chrome.com/docs/extensions/reference/api/permissions

Shopify 官方文档：

- Ajax API（仅适用于 Shopify-hosted themes、`Shopify.routes.root`、locale-aware URL、不可读客户/订单数据）：https://shopify.dev/docs/api/ajax
- Ajax Product API（`{routeRoot}products/{handle}.js`；价格为 presentment currency，并以 `cart.js.currency` 核对）：https://shopify.dev/docs/api/ajax/reference/product
- Liquid `sort_by`（含 `best-selling` 的 8 个取值、URL 参数用法）：https://shopify.dev/docs/api/liquid/filters/sort_by

Web 平台标准：

- Fetch Standard redirect mode（`follow` 会跟进、`error` 返回网络错误、`manual` 为 opaque redirect）：https://fetch.spec.whatwg.org/#concept-request-redirect-mode

第三方/社区（标注为经验性依据）：

- Shopify Product Reviews 停服时间线（2023-09-05 下架、2024-05-06 停服）：junip.co、ilanadavis.com、community.shopify.com 等多方一致。
- HTTP 430 Shopify Security Rejection（429=限流、430=安全拒绝）：http.dev/430、Shopify Community、errcodes.dev。
