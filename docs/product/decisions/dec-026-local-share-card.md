# DEC-026 — Share Card 采用本地、显式导出的完整渲染卡片

Decision ID: DEC-026
Status: Accepted
Updated: 2026-08-07
Authority: 用户于 2026-08-04 授权审查、设计、开发与测试，于 2026-08-05 明确选择内容/媒体方案 C（完整渲染保真）及 capture runtime 方案 A（SnapDOM 窄例外），于 2026-08-06 修订 Action Ring 入口、来源优先级、品牌、字体、标签、布局与分页字号，并于 2026-08-07 明确以当前 `master` 行为作为最终规则
Work item: B-124

> [!note] Owner decision 2026-08-05
> 用户选择完整渲染保真：尽量保留 Obsidian 实际渲染结果，包括远程图片、Vault Embed
> 与图表，并接受由显式内容引用触发的网络、额外读取和失败恢复边界。用户随后选择
> capture runtime 方案 A：精确锁定 SnapDOM 2.23.2，批准仅限离屏图片文档的 runtime
> style/已审计 dependency 模式；PA 必须预本地化显式资源，不启用 proxy，并以实际
> community/release gate 约束发布。F-15/F-16 均已关闭。

> [!note] Owner amendment 2026-08-06
> 用户把 Pagelet Action Ring 的第四项定为 Share，并要求该入口优先分享当前编辑器的
> 非空选区，否则分享当前 Markdown 笔记；同时锁定 selection/note 投影、图形 logo、
> `Personal Assistant` 品牌文字、Action Ring 可见中英本地化标签、仅以本地 data URL 加载的
> Source Han Serif、端侧 Ring 几何及 `16 → 15 → 14px` 的整批字号规则。本修订是当前
> 产品权威；2026-08-05 的三入口验证不能替代本修订的实现与验证。

> [!note] Owner amendment 2026-08-07
> 用户明确选择以当前 `master` 为准：单页短内容可在 `18 / 20 / 22px` 中选择仍保持
> 单页的最大字号；多页内容继续从 `16px` 出发，仅在减少页数时接受 `15 / 14px`，
> 且同一 batch 的 preview、copy 与 save 始终使用同一字号。保存目录在每次 Modal 内
> 可选、不持久化，默认使用有效的 Vault attachment folder，否则回退 `PA-Cards`；
> Desktop/iPad Ring 优先内向弧，标签空间不足时整组降级为紧凑横排或竖排。

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

1. Share Card 由四个显式入口触发：已完成的 PA assistant Chat 回复、Pagelet Panel
   当前可分享 findings、编辑器非空选区命令，以及 Pagelet Action Ring 的第四项
   `Share`。前三个入口的既有 eligibility 不变；用户消息、生成中回复、空内容、Prepared
   read-only Panel 与隐藏/已 dismiss 的 Pagelet finding 不获得分享动作。Ring Share
   在触发时读取当前 active Markdown editor：trim 后非空的 selection 优先，payload 保留
   selection 原始字符、换行、空白与 Markdown，且不显示文件名或 Vault path；否则读取
   当前 Markdown note，只在 Obsidian 能识别 frontmatter 且其 YAML 语法有效时剥离该段，
   其余正文原样进入卡片，并显示 `file.basename`（不含目录与 `.md`）。无 active Markdown
   note 或剥离后正文为空时不打开 Modal，只给出可恢复的本地化提示。
2. v1 使用固定 `540×720` CSS card 和 2× raster density，输出 `1080×1440` PNG。卡片
   在打开时锁定当前 light/dark 主题；预览可按可用宽度缩放，但导出必须来自独立、
   未缩放的固定尺寸 DOM。品牌区固定为 PA 图形 logo + `Personal Assistant`，不加入营销
   CTA。Chat/Pagelet 保留稳定产品来源文案；Ring note 显示 basename，Ring selection
   不显示文件名或路径。卡片非代码文字以 Source Han Serif 为主字体；字体只能从插件随包本地
   字节生成的 `data:` URL 加载，不允许外部 font URL、font CDN 或字体网络请求。字体未
   就绪不得冒充完整成功。固定子集以外的 Unicode 只允许同字号设备本地 glyph fallback；
   它不允许外部字体发现/请求，也不能掩盖主字体加载失败。
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
   导出并提示缩短内容，不能截去尾部。分页先以 `16px` 建立有效 baseline；多页内容仅当
   完整重分页能减少总页数时才依次考虑 `15px`、`14px`，并选择第一个也就是最大的有效
   较小字号。若结果为单页，则依次评估 `18px`、`20px`、`22px`，选择仍能保持单页的
   最大字号。所有候选都须满足同一套 no-loss、overflow 与 24-page 安全门；候选失败保留
   最近的有效结果。一次 batch 的所有页面、预览、复制和保存必须使用同一选定字号。
5. 复制只复制当前预览页。复制不可用或失败时只给出可恢复提示，不自动改为写 Vault。
   保存由用户单独点击触发：单页保存当前页，多页一次保存全部页。Modal 每次打开时，
   保存目录默认采用 Vault 中有效的 attachment folder；不可用、为空或为以 `.` 开头的
   相对路径配置时回退 `PA-Cards`。用户可在本次 Modal 内选择已有目录、输入新目录或选择
   Vault 根目录，该选择不写入插件设置。文件名必须避让已有文件，不能覆盖；部分写入
   失败时明确报告已保存数量、实际目录与可重试状态。
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
9. Action Ring 保持独立瞬时命令面。顺序固定为 `Capture / Review / Discover / Share`，
   前三项 callback、route 与 provider/data/write 边界不变。Desktop 与 iPad 优先从 Pet
   朝内容区形成内向弧；完整标签无法在可用空间内无重叠容纳时，整组降级为紧凑横排或
   竖排，不允许部分混排。iPhone 在可用宽度能完整容纳四项时横向排列，否则整组切换为
   纵向排列。四项均为至少 `44×44px` 的真实 button，并在当前 UI locale 显示文字标签：
   英文 `Capture / Review / Discover / Share as card`，中文 `随手记下 / 审阅 / 发现关联 /
   分享为卡片`。视觉方向不得改变逻辑、键盘或焦点顺序。

## Consequences

- Product behavior: PA 多一个低打扰的内容复用出口；Chat 动作保持完成后出现，Pagelet
  只分享当前可见且非 Prepared read-only 的 findings，编辑器选区入口仍由用户主动控制；
  Action Ring 增加第四项 Share，并以 selection-first、current-note fallback 保持一步可达。
- Architecture / data / safety: 新增共享 card renderer/paginator/exporter；PA-owned resolver
  限定显式资源并在 capture 前本地化，SnapDOM 只负责稳定 DOM → 固定像素 PNG。依赖的
  窄例外、固定版本和真实 community/mobile gate 由当前 Architecture、tests 与验证清单约束。
- Compatibility / migration: 无 setting 或 persisted-state migration；Modal 内目录选择不持久化；桌面和移动端共享
  数据契约，移动端 clipboard 不可用时仍可显式保存。Source Han Serif 随插件本地提供，
  不新增外部字体依赖或网络权限。
- Work created or removed: B-124 已完成实现、验证与显式 closeout；稳定行为吸收到本决定、
  Product Spec、Current Architecture、focused tests 与验证清单，Active Package 过程文档删除。

## Revisit Trigger

- 真实使用证明 `1080×1440` 不适合主要分享目的，需要新的比例/模板选择。
- 用户需要持久保存目录偏好，或自定义品牌、颜色、字体、来源标签或无品牌导出。
- 第三方插件视图、交互组件或嵌套资源无法以可接受的失败语义捕获。
- 用户明确要求系统 share sheet 或外部发布，并接受对应账号、权限与失败恢复设计。

## Traceability

- Product Spec: [B-124 Share Card Product Spec](../specs/pa-share-card-product-spec.md)
- Current Architecture: [Share Card Architecture](../../architecture/share-card-architecture.md)
- Validation evidence: [Pagelet and Share Card smoke checklist](../../development/validation/pagelet-smoke-checklist.md)
- Source request: User request 2026-08-04；content/media option C and capture runtime option A selected 2026-08-05；Action Ring/source/visual/font/layout/pagination amendment approved 2026-08-06；current `master` behavior selected as final authority 2026-08-07
- Supersedes / superseded by: supersedes the design assumptions in the removed original implementation draft; none otherwise
