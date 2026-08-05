# DEC-026 — Share Card 采用本地、显式导出的完整渲染卡片

Decision ID: DEC-026
Status: Accepted
Updated: 2026-08-05
Authority: 用户于 2026-08-04 授权审查、设计、开发与测试，并于 2026-08-05 明确选择内容/媒体方案 C（完整渲染保真）及 capture runtime 方案 A（SnapDOM 窄例外）
Work item: B-124

> [!note] Owner decision 2026-08-05
> 用户选择完整渲染保真：尽量保留 Obsidian 实际渲染结果，包括远程图片、Vault Embed
> 与图表，并接受由显式内容引用触发的网络、额外读取和失败恢复边界。用户随后选择
> capture runtime 方案 A：精确锁定 SnapDOM 2.23.2，批准仅限离屏图片文档的 runtime
> style/已审计 dependency 模式；PA 必须预本地化显式资源，不启用 proxy，并以实际
> community/release gate 约束发布。F-15/F-16 均已关闭。

## Context

PA 的 Chat 回复与 Pagelet 洞察已经可以复制或保存回 Vault，但当用户希望把一段
有价值的内容带到 Obsidian 之外时，仍需手工排版或依赖通用截图工具。已有
`share-card-implementation-spec.md` 提出了固定尺寸品牌卡、Chat / Pagelet / 编辑器
选区三个入口和 DOM-to-image 导出，但其中的字符数分页、失败后自动写入 Vault、多页
复用同一 DOM、固定宽度移动端预览及同名文件处理都不能直接作为实现契约。

该能力不应成为新的内容队列、自动推广或外部发布通道。它只在用户主动触发时，把
当前可见或明确选中的渲染内容整理为图片。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| Text-first：移除图片、Embed 与运行型内容 | 输出可预测、无资源加载 | 丢失原始视觉内容；把 Agent 推导变成产品缩窄 | Rejected by user, 2026-08-05 |
| Full-fidelity（对话确认的内容/媒体方案 C）：尽量保留明确内容的实际渲染结果 | 符合原始视觉分享意图；图片、Embed、图表可进入卡片 | 允许相关资源请求/读取；需要明确失败、隐私和兼容性边界 | Selected by user, 2026-08-05 |
| Current-DOM screenshot：直接截图当前 Chat / Panel / 编辑器 DOM | 实现较少 | 会把 UI chrome、私密路径和主题差异带入图片；与通用截图插件重叠 | Rejected |
| External sharing：直接接入系统分享、上传或社媒发布 | 操作步数少 | 引入外部状态、账号、隐私和失败恢复边界 | Rejected；不在本工作项授权范围 |

### Capture Runtime

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 精确锁定 `@zumer/snapdom@2.23.2`，资源由 PA 预本地化 | 完整 CSS/伪元素/SVG/Canvas capture；恢复原 spec 选型 | dependency 内含已审计 runtime style/HTML/fetch；需窄例外、完整性报告与真实全端 gate | Selected by user, 2026-08-05 |
| B. 继续扩展 plugin-owned capture engine | 可完全控制源码模式 | 相当于长期维护 DOM-to-image engine，完整保真/WebKit/CORS 成本高 | Rejected by user, 2026-08-05 |

## Decision

选择 Full-fidelity（对话确认的内容/媒体方案 C），并规定：

1. Share Card 仅由三个显式入口触发：已完成的 PA assistant Chat 回复、Pagelet Panel
   当前可分享 findings、编辑器非空选区。用户消息、生成中回复、空内容、Prepared
   read-only Panel 与隐藏/已 dismiss 的 Pagelet finding 不获得分享动作。
2. v1 使用固定 `540×720` CSS card 和 2× raster density，输出 `1080×1440` PNG。卡片
   在打开时锁定当前 light/dark 主题；预览可按可用宽度缩放，但导出必须来自独立、
   未缩放的固定尺寸 DOM。品牌只保留底部 `PA · Personal Assistant`，不加入营销 CTA。
3. 卡片追求明确分享内容的完整渲染保真。除文字、Markdown 结构和 CSS 外，远程图片、
   Vault 图片与 Markdown note embed、Mermaid/Canvas/SVG 图表及浏览器可捕获的静态视觉
   结果均应尽量保留。Markdown note embed 支持整篇、heading 与 block anchor，只沿嵌入
   内容中的显式 embed 有界递归，并以去重缓存、resource/byte/time/depth budget、cycle
   guard、32 MiB localized-output budget 与取消信号限制读取。只解析输入明确引用的资源，
   不扫描无关 Vault 内容；资源
   失败不得被静默删除或冒充完整成功。是否使用 CORS proxy 不在本决定中授权。
4. 分页以与最终卡片相同 CSS 和宽度进行实际 DOM 高度测量，优先在语义块边界分页；
   超高单块再按保持 Markdown 有效的行/词边界拆分。不得依赖固定字符数估算，不得
   静默截断，也不得把 YAML/thematic break 误判后删除。超出明确安全上限时应拒绝
   导出并提示缩短内容，不能截去尾部。
5. 复制只复制当前预览页。复制不可用或失败时只给出可恢复提示，不自动改为写 Vault。
   保存由用户单独点击触发：单页保存当前页，多页一次保存全部页到 `PA-Cards/`；文件
   名必须避让已有文件，不能覆盖。部分写入失败时明确报告已保存数量与可重试状态。
6. 导出期间按钮进入 busy/disabled 状态并阻止并发操作；关闭 Modal、切页和异步
   Markdown 渲染不得产生 stale DOM 写入。所有 render `Component`、离屏节点、事件与
   异步 owner 在关闭后清理。
7. Share Card 不调用 AI provider、不上传、不新增设置或持久状态。渲染明确引用的远程
   资源可以产生直接网络请求，Vault Embed 可以读取其引用内容，但不得扩展为无关 Vault
   搜索。唯一 durable effect 是用户明确点击保存后创建 PNG；复制与预览不修改 Vault。
8. Capture 使用精确锁定的 `@zumer/snapdom@2.23.2`，固定 `scale:2`、`dpr:1`、
   `type:"png"`、`useProxy:""`、`embedFonts:false`、`reconcile:false`、
   `outerShadows:false`、`resolvePicturePlaceholders:false`、`cache:"disabled"`。PA 在
   capture 前用 Obsidian/Vault API 将获准的显式资源转换为本地 data URL，并单独报告
   资源完整性；SnapDOM 只接收离屏 card DOM。其内部 cache 禁用不影响 PA 每 Modal 的
   显式资源去重缓存。用户批准其离屏图片生成所必需的 runtime style 与已审计 dependency
   模式，但未批准向 Obsidian live UI 注入 style、直接扫描无关资源或绕过后续
   community/release gate。

## Consequences

- Product behavior: PA 多一个低打扰的内容复用出口；Chat 动作保持完成后出现，Pagelet
  只分享当前可见且非 Prepared read-only 的 findings，编辑器选区入口仍由用户主动控制。
- Architecture / data / safety: 新增共享 card renderer/paginator/exporter；PA-owned resolver
  限定显式资源并在 capture 前本地化，SnapDOM 只负责稳定 DOM → 固定像素 PNG。依赖的
  窄例外、固定版本和真实 community/mobile gate 由 B-124 Tracker 持续验证。
- Compatibility / migration: 无 setting 或 persisted-state migration；桌面和移动端共享
  数据契约，移动端 clipboard 不可用时仍可显式保存。
- Work created or removed: B-124 进入 L3 Active Package；原 1,159 行实现草稿在结论
  吸收到本决定、Product Spec 与 Approved SDD 后删除，避免重复权威。

## Revisit Trigger

- 真实使用证明 `1080×1440` 不适合主要分享目的，需要新的比例/模板选择。
- 用户需要自定义品牌、颜色、字体、保存目录或无品牌导出。
- 第三方插件视图、交互组件或嵌套资源无法以可接受的失败语义捕获。
- 用户明确要求系统 share sheet 或外部发布，并接受对应账号、权限与失败恢复设计。

## Traceability

- Product Spec: [B-124 Share Card Product Spec](../specs/pa-share-card-product-spec.md)
- Active Package: [Share Card Development Track](../../development/active/share-card/README.md)
- Architecture / SDD: [Share Card SDD](../../development/active/share-card/sdd.md)
- Source request: User request 2026-08-04；content/media option C and capture runtime option A selected 2026-08-05
- Supersedes / superseded by: supersedes the design assumptions in the removed original implementation draft; none otherwise
