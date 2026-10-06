# PA Share Card Print Styles Product Spec

Document status: Approved
Updated: 2026-10-06
Work item: B-137
Decision: [DEC-036 — Share Card 本次导出印刷样式](../decisions/dec-036-share-card-print-styles.md)
Authority: 用户于 2026-10-06 明确要求增强 Xerox 文字效果、取消 Original/Light 选项并直接显示 Xerox；取代 2026-09 的三档选择和默认原纸约定。

## Problem And Product Outcome

- User problem: Xerox 正文质感偏弱，缩小预览后更难辨认；每次还需要从原纸切换。
- Product outcome: 打开 Share Card 即显示清晰可辨认的 Xerox 文字效果，预览与 PNG 一致。
- North Star fit: 分享动作直接、安静，不增加配置和持久状态，不修改源笔记。

## Scope

### In Scope

- B-137/REQ-01: 每个新 Modal 直接显示 Xerox，不提供 Original、Light 或印刷样式选择器，不写入设置、历史或跨设备状态。
- B-137/REQ-02: H1–H3 保留原始 `scale 4/1`、`-3/-3px` 套印偏移和淡的原位残影；普通正文使用增强的起伏与淡复影，仍弱于标题。没有 H1–H3 的卡片也需在常规预览和 PNG 中显现复印质感并保持可读。
- B-137/REQ-03: `code`、`pre`、`kbd`、`samp`、图片、picture、SVG、canvas、视觉占位/视觉块、品牌、来源、页码、装饰和纸张纹理不受文字滤镜影响。强调、链接、列表、引用和表格中的普通文字仍按所在标题/正文档位处理。
- B-137/REQ-04: 分页、批次字号、预览、当前页 Copy 和整批 Save 使用同一 Xerox 效果。失败、关闭/重开或并发 Modal 不产生 stale preview、错误导出或滤镜串用。
- B-137/REQ-05: 效果完全由卡片内确定性 SVG filter 和现有本地字体实现；不新增网络、外部字体、runtime style element、HTML 注入、设置或 provider 调用。滤镜 ID 对每张卡片唯一，cleanup 一并移除定义。导出时将同一卡片滤镜定义编码为本地 `data:image/svg+xml` 引用，通过 SnapDOM 的 `foreignObject` 栅格化；PNG 完成或失败后恢复原引用，解析失败不得静默输出无滤镜图片。
- B-137/REQ-06: 中英文、light/dark、桌面和移动布局均直接显示卡片，保持导航、放大预览、Copy/Save 和关闭可操作，不改变宿主主题或 Obsidian chrome。

### Non-goals

- 不提供自定义参数、颜色、纸张、字体、比例、模板或持久默认值。
- 不把滤镜用于代码、图片、图表、品牌、页码或整个 Modal/Obsidian 容器。
- 字号与笔记菜单入口由 [Share Card Product Spec](./pa-share-card-product-spec.md) 承接；资源权限、SnapDOM、目录和显式导出语义保持现有约定。

## User Flow And States

从任一获准入口打开卡片，准备完成后直接查看 Xerox 预览。多页导航沿用整批字号与效果；Copy 当前页或 Save 全部页只在用户点击时执行。关闭取消后不回写 UI，不修改源笔记；重开仍显示 Xerox。

## Acceptance Criteria

- B-137/AC-01: 新 Modal 与重开均直接显示 Xerox，无三档选择器，无持久字段。
- B-137/AC-02: 中英文标题、无标题正文的预览和 PNG 均有可辨认的复印质感，正文保持可读。复印与同字号无滤镜对照有确定性文字差异。
- B-137/AC-03: 代码、视觉内容、品牌/来源/页码和装饰不受文字滤镜影响；普通文字无丢失、重排或裁切。
- B-137/AC-04: 单页和多页完整、非空、顺序/末句正确，preview/Copy/Save 共享字号、页面和 Xerox 效果，重复导出确定。
- B-137/AC-05: 并发卡片滤镜 ID 唯一；capture 引用可解析且成功/失败后恢复；close/unload 释放 defs、wrapper、离屏 host、listener 和 operation state；宿主与网络边界不变。
- B-137/AC-06: 受影响 focused tests 与本地部署门通过；当前构建部署到 `test/` 后观察桌面和移动模拟器的默认效果、放大、关闭/重开与 Save。移动模拟器证据不等于 iPhone 实机证据。

## Evidence Boundary

旧三档样式的历史验收不证明本次增强。2026-09-17 曾观察到原纸/复印正文 PNG 像素相同，因此本次需独立核对实际 PNG 效果。当前技术契约见 [Share Card Architecture](../../architecture/share-card-architecture.md)；commit、push 和 release 仍为独立授权。
