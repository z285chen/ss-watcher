# Design Intelligence Preview

> 分支：`codex/design-intelligence-preview`
>
> 状态：Gate 4 真实取证与隔离盲复刻通过；Gate 5 泛化验证待完成
>
> 更新：2026-08-25

## 目标

SS Watcher 在不复制目标网站源码、不取得广域 host 权限、也不代替用户操作页面的前提下，将获准公开页面整理成可供编码 Agent 使用的 `.ssw-design` UI/UX 证据包。

当前 TourBox 试点覆盖默认页面、桌面 mega menu、平板和手机导航抽屉。隔离盲复刻在 1440、768、390 CSS px 下通过结构覆盖与约 85–90% 视觉目标带验收。这个结果只证明 Gate 4 试点，不代表任意网站都能达到同样还原度。

## 当前能力

- 固定 1440×900、768×900、390×844 CSS px，2× DPR 的有界全页截图。
- 颜色、字体、间距、圆角、阴影、安全 CSS 变量和断点聚合。
- 脱敏组件树、主要布局关系、几何、语义角色与动态区域 mask。
- 默认状态加最多五个用户确认状态；交互记录为 `user-confirmed` / `not-automated`。
- 严格 `.ssw-design` ZIP：文件摘要、确定性投影、截图尺寸、连续覆盖、状态/转移引用和隐私字段均会验证。
- 页面 Design 会话独立存储七天，可恢复、显式删除；失败不回滚原有产品与技术分析。

SS Watcher 不代表用户点击、悬停、聚焦、输入、提交或导航。页面文本、输入值、class、id、CSS selector、Cookie 和网络正文不会进入证据合同；跨源图片和视频只保存去 query 的公开引用，不下载资产正文。

## 安全边界

- 只在用户点击扩展并成功签发的临时 ScanSession 中运行。
- 目标固定为该 session 的 tab、document、origin 和规范化 pathname。
- account、cart、checkout、orders、admin 等敏感路径在读取 DOM 前拒绝。
- `debugger` 仅用于绑定目标标签的 viewport 模拟与截图；不向 UI 暴露通用 CDP 命令。
- 截图过程只执行滚动、等待和截图，并受高度、屏数、频率与 60 秒总时限约束。
- 成功、失败、取消、导航、标签关闭或会话吊销都会触发模拟状态清理与 debugger detach。
- 动态区域在持久化前遮罩；遮罩或尺寸验证失败时拒绝导出。
- Design Intelligence 失败只记录自己的模块结果，不改变原有扫描结论。

## 同事试用

```bash
git clone --branch codex/design-intelligence-preview https://github.com/z285chen/ss-watcher.git
cd ss-watcher
npm ci
npm test
npm run build
```

在 Chrome 扩展管理页加载 `dist/`，然后只在获准测试的公开页面点击扩展图标：

1. 捕获默认状态的 desktop、tablet、mobile 三档证据。
2. 如需交互状态，由用户先在准备好的固定 viewport 中亲自完成一次动作，再在控制器中确认当前状态。
3. 桌面 mega menu 与平板/手机抽屉应建模为不同 transition，不虚构跨 breakpoint 行为。
4. 每个状态完成声明范围内的截图后导出 `.ssw-design`。
5. 将证据包交给隔离的编码 Agent；复刻只能声称包内证据支持的结构、视觉和进入动作。

不要在包含私人信息的页面试用。真实站点证据包与复刻输出默认位于 `validation/.artifacts/`，该目录被 Git 忽略；公开仓库提供生成与验证能力，不分发 TourBox 页面截图或复刻产物。

## 当前证据与限制

- Gate 4 的详细合同见 [`design-intelligence-gate4.md`](design-intelligence-gate4.md)。
- 逐项实测、失败样本和修复记录见 [`design-intelligence-v2-progress.md`](design-intelligence-v2-progress.md)。
- 真实 TourBox 包通过 ZIP/schema/digest、截图尺寸、连续覆盖、隐私字段、transition scope 与确定性投影验证。
- 隔离复刻实现了桌面 mega menu 以及平板/手机抽屉的证据支持进入动作，没有页面级外部请求路径。
- 没有证据支持的退出、reset、focus trap、动画时序、hover persistence、导航目的地和业务逻辑均不作声称。

## 合入 main 前的 Gate 5

需要选择结构显著不同、包含 modal、tabs、accordion 或 carousel 的第二个公开站点，采集默认状态及两个关键交互，并验证同一合同能够泛化。之后再复核 `debugger` 权限、隐私、兼容性、迁移、代码范围和正式发布形态。

Gate 5 通过前，本分支只称为 Design Intelligence Preview，不声称对任意参考网站具有稳定的 85–90% 复刻能力。
