# DEC-036 — Share Card 本次导出印刷样式

Decision ID: DEC-036
Status: Accepted
Updated: 2026-09-17
Authority: 用户于 2026-09-13 明确确认三档样式、正文作用范围、默认与不记忆行为，以及复印标题的原始强度；2026-09-17 要求增强复印与原纸在分享图片中的可见差异。本决定不授予 commit、push 或 release 权限。
Work item: B-137

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

1. 每次 Share Card Modal 显示 `原纸 / 轻印 / 复印` 三档本次导出样式；每次打开
   默认原纸，选择不进入设置、历史或其他持久状态。
2. 原纸保持当前生产外观。轻印对 H1–H3 使用已验证轻强度，并以更收敛强度处理
   普通正文。复印对 H1–H3 保留原始 `scale 4/1` 和 `-3/-3px` 套印偏移，并加一层
   淡的原位套印残影；正文使用独立、仍弱于标题的轻度起伏和淡复影，使无标题卡片也
   能与原纸区分。14px 正文仍需可读。
3. 代码、图片、图表、视觉占位、品牌、来源、页码、装饰和纸纹保持原样。效果只在
   Share Card 内容 DOM 内实现，不修改 Obsidian theme class、CSS variables 或设置。
4. 分页、预览、Copy 和 Save 共享同一已提交样式；快速切换、失败、关闭、重开及并发
   Modal 不得产生 stale preview、错误导出或跨卡片滤镜串用。
5. 效果完全本地、确定且自包含，不增加网络、外部字体、provider 调用、资源权限或
   SnapDOM 例外。

## Consequences

- 用户可在一次分享动作中撤回或切换印刷质感，关闭后自然回到原纸。
- 复印正文不再与轻印正文共用同一滤镜；只提升文字印迹，不扩大到纸张或装饰。
- SnapDOM 的 SVG `foreignObject` 转成 PNG 时不解析卡片内 `url(#id)` 文字滤镜。
  导出时把相同的本地 SVG 定义改用自包含 `data:image/svg+xml` 引用，完成后恢复
  card-local 引用；不能静默导出看似原纸的图片。
- renderer 需要 card-local SVG defs、受保护文字遍历和 appearance 生命周期接线。
- 既有 Share Card 入口、数据边界、目录、主题、字体、尺寸与资源语义保持不变。
- 真实 Obsidian 验收必须覆盖选择器、导出一致性和宿主透明回归。

## Revisit Trigger

若真实小字号正文可读性不足、原始复印位移发生裁切、不同渲染引擎结果不可接受，
或用户提出持久默认/自定义参数需求，则重新决定正文强度、滤镜边界或配置范围。

## Traceability

- Prior decision: [DEC-026](./dec-026-local-share-card.md)
- Product Spec: [PA Share Card Print Styles](../specs/pa-share-card-print-styles-product-spec.md)
- Architecture: [Share Card Architecture](../../architecture/share-card-architecture.md)
