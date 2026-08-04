# DEC-026 — Share Card 采用本地、显式导出的文本卡片

Decision ID: DEC-026
Status: Accepted
Updated: 2026-08-04
Authority: 用户于 2026-08-04 明确要求审查 Share Card 方案，并按项目规范完成设计、开发与测试
Work item: B-124

## Context

PA 的 Chat 回复与 Pagelet 洞察已经可以复制或保存回 Vault，但当用户希望把一段
有价值的内容带到 Obsidian 之外时，仍需手工排版或依赖通用截图工具。已有
`share-card-implementation-spec.md` 提出了固定尺寸品牌卡、Chat / Pagelet / 编辑器
选区三个入口和 DOM-to-image 导出，但其中的字符数分页、失败后自动写入 Vault、多页
复用同一 DOM、固定宽度移动端预览及同名文件处理都不能直接作为实现契约。

该能力不应成为新的内容队列、自动推广或外部发布通道。它只在用户主动触发时，把
当前可见或明确选中的文本内容整理为本地图片。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| A. 本地文本卡片；固定视觉、实测分页、显式复制/保存 | 与 PA 内容复用场景一致；无 provider 或外部发布；输出可预测 | 需要 DOM 测量、移动端预览缩放及导出生命周期 | Accepted；保留原方案的产品意图，同时关闭数据丢失、意外写入和移动端风险 |
| B. 直接截图当前 Chat / Panel / 编辑器 DOM | 实现较少 | 会把 UI chrome、私密路径和主题差异带入图片；与通用截图插件重叠 | Rejected |
| C. 直接接入系统分享、上传或社媒发布 | 操作步数少 | 引入外部状态、账号、隐私和失败恢复边界 | Rejected；不在本工作项授权范围 |

## Decision

选择 Option A，并规定：

1. Share Card 仅由三个显式入口触发：已完成的 PA assistant Chat 回复、Pagelet Panel
   当前可分享 findings、编辑器非空选区。用户消息、生成中回复、空内容、Prepared
   read-only Panel 与隐藏/已 dismiss 的 Pagelet finding 不获得分享动作。
2. v1 使用固定 `540×720` CSS card 和 2× raster density，输出 `1080×1440` PNG。卡片
   在打开时锁定当前 light/dark 主题；预览可按可用宽度缩放，但导出必须来自独立、
   未缩放的固定尺寸 DOM。品牌只保留底部 `PA · Personal Assistant`，不加入营销 CTA。
3. 内容以文本型 Markdown 为主。标题、段落、强调、列表、引用、链接文字与代码可
   保留；远程图片、Vault embed、iframe、音视频、canvas 与运行型 diagram 不进入
   导出资源抓取。不得为卡片请求 CORS proxy 或扩大笔记读取范围。
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
7. Share Card 不调用 AI provider、不上传、不新增设置或持久状态。唯一 durable effect
   是用户明确点击保存后创建 PNG；复制与预览不修改 Vault。

## Consequences

- Product behavior: PA 多一个低打扰的内容复用出口；Chat 动作保持完成后出现，Pagelet
  只分享当前可见且非 Prepared read-only 的 findings，编辑器选区入口仍由用户主动控制。
- Architecture / data / safety: 新增共享 card renderer/paginator/exporter；导出使用插件自有、
  无运行时 `<style>` / HTML 字符串注入的 SVG `foreignObject` + Canvas capture adapter，只消费
  已净化的本地卡片 DOM，不引入网络代理或第三方 capture runtime。
- Compatibility / migration: 无 setting 或 persisted-state migration；桌面和移动端共享
  数据契约，移动端 clipboard 不可用时仍可显式保存。
- Work created or removed: B-124 进入 L3 Active Package；原 1,159 行实现草稿在结论
  吸收到本决定、Product Spec 与 Approved SDD 后删除，避免重复权威。

## Revisit Trigger

- 真实使用证明 `1080×1440` 不适合主要分享目的，需要新的比例/模板选择。
- 用户需要自定义品牌、颜色、字体、保存目录或无品牌导出。
- 远程图片、Mermaid、Canvas 或 Vault embed 成为高频核心内容，且可在不扩大隐私和
  移动端兼容风险的前提下可靠捕获。
- 用户明确要求系统 share sheet 或外部发布，并接受对应账号、权限与失败恢复设计。

## Traceability

- Product Spec: [B-124 Share Card Product Spec](../specs/pa-share-card-product-spec.md)
- Active Package: [Share Card Development Track](../../development/active/share-card/README.md)
- Architecture / SDD: [Share Card SDD](../../development/active/share-card/sdd.md)
- Source request: User request 2026-08-04
- Supersedes / superseded by: supersedes the design assumptions in the removed original implementation draft; none otherwise
