# DEC-036 — Share Card 本次导出印刷样式

Decision ID: DEC-036
Status: Accepted
Updated: 2026-10-06
Authority: 用户于 2026-10-06 明确要求增强 Xerox 文字效果、取消 Original/Light 选项并直接显示 Xerox；取代旧三档选择和默认原纸约定。本决定不授予 commit、push 或 release 权限。
Work item: B-137

> [!note] Owner amendment 2026-10-06
> 用户明确要求增强 Xerox 文字效果，取消 Original、Light 选项，打开 Share Card
> 直接显示 Xerox。此修订取代下述旧三档选择、默认原纸与切换要求；不增加持久设置。
> 标题保留原始复印强度，正文增强可见起伏和淡复影，受保护内容保持原样。
> 用户同时要求增大卡片字号、增加移动端笔记右上菜单入口；入口与字号约定由
> Share Card Product Spec 承接。旧 Export image 入口已确认由独立插件注册，用户
> 后续选择暂不处理并保持该插件启用。

## Context

DEC-026 已固定 Share Card 的内容、尺寸、字体、品牌、分页、资源本地化和显式
Copy/Save 边界。已验证原型证明，本地 SVG 位移滤镜可在不加载 webfont 或图片的
前提下产生轻印和旧复印质感；原型也暴露过修改宿主 theme class 会令 Obsidian
chrome 透明的越界，因此生产方案需要明确限定效果范围和状态所有权。

## Options Considered

| 选择 | 收益与代价 | 结论 |
| --- | --- | --- |
| 只处理 H1–H3 | 正文最稳，但整张卡片的印刷质感不连续 | 用户未选择 |
| 标题分档，正文统一轻效果 | 标题有明确层次，正文可读性和整体质感兼顾 | 用户已选择 |
| 对全文使用复印原始强度 | 质感最强，但小字号正文更易模糊或裁切 | 不采用 |
| 记忆上次选择 | 重开更快，但增加持久设置和管理负担 | 用户明确不记忆 |

## Decision

1. 每次 Share Card Modal 直接应用 Xerox，取消 Original、Light 和样式选择器；
   不增加设置、历史或其他持久状态。
2. H1–H3 保留原始 `scale 4/1` 和 `-3/-3px` 套印偏移，并加一层淡的原位套印残影；
   正文增强起伏和淡复影，仍弱于标题。无标题卡片在常规预览和 PNG 中也须有可辨认
   的复印质感，且正文保持可读。
3. 代码、图片、图表、视觉占位、品牌、来源、页码、装饰和纸纹保持原样。效果只在
   Share Card 内容 DOM 内实现，不修改 Obsidian theme class、CSS variables 或设置。
4. 分页、预览、Copy 和 Save 共享 Xerox；失败、关闭、重开及并发 Modal 不得产生
   stale preview、错误导出或跨卡片滤镜串用。
5. 效果完全本地、确定且自包含，不增加网络、外部字体、provider 调用、资源权限或
   SnapDOM 例外。

## Consequences

- 用户打开卡片即可分享复印外观；只提升文字印迹，不扩大到纸张或装饰。
- SnapDOM 的 SVG `foreignObject` 转成 PNG 时不解析卡片内 `url(#id)` 文字滤镜。
  导出时把相同的本地 SVG 定义改用自包含 `data:image/svg+xml` 引用，完成后恢复
  card-local 引用；不能静默导出看似原纸的图片。
- renderer 需要 card-local SVG defs、受保护文字遍历和导出引用生命周期。
- Share Card 入口和字号按本次用户修订由 Product Spec 承接；数据边界、目录、主题、
  字体、尺寸与资源语义保持不变。
- 真实 Obsidian 验收覆盖直接显示 Xerox、导出一致性和宿主透明回归。

## Revisit Trigger

若真实小字号正文可读性不足、原始复印位移发生裁切、不同渲染引擎结果不可接受，
或用户提出持久默认/自定义参数需求，则重新决定正文强度、滤镜边界或配置范围。

## Traceability

- Prior decision: [DEC-026](./dec-026-local-share-card.md)
- Product Spec: [PA Share Card Print Styles](../specs/pa-share-card-print-styles-product-spec.md)
- Architecture: [Share Card Architecture](../../architecture/share-card-architecture.md)
