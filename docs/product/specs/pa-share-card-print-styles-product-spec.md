# PA Share Card Print Styles Product Spec

Document status: Approved
Updated: 2026-09-14
Work item: B-137
Decision: [DEC-036 — Share Card 本次导出印刷样式](../decisions/dec-036-share-card-print-styles.md)
Authority: 用户于 2026-09-13 明确确认三档样式、正文作用范围、默认与不记忆行为，以及复印标题强度；本文是 B-137 的当前产品行为与验收权威。

## Problem And Product Outcome

- User problem: Share Card 只有一种固定印刷外观；用户无法在保持内容、品牌和导出可靠性的同时选择更轻或更明显的复印质感。
- Product outcome: 每次打开 Share Card 都可在 `原纸 / 轻印 / 复印` 三档之间即时选择，预览即导出结果。
- North Star fit: 选择安静地停留在当前分享动作里，不产生设置管理负担；效果可见、可撤回且不改变原笔记。

## Scope

### In Scope

- B-137/REQ-01: Modal 提供本地化的 `原纸 / 轻印 / 复印` 三档选择。每个新 Modal 均以 `原纸` 开始，选择只存活于该 Modal，不写入设置、历史或跨设备状态。
- B-137/REQ-02: `原纸` 保持当前生产卡片像素和排版；`轻印` 对 H1–H3 普通文字使用已验证的轻效果，并对其他普通正文使用更收敛的轻效果；`复印` 对 H1–H3 使用用户提供的原始 `scale 4/1` 与 `-3/-3px` 套印偏移，普通正文仍使用收敛轻效果。
- B-137/REQ-03: `code`、`pre`、`kbd`、`samp`、图片、picture、SVG、canvas、视觉占位/视觉块、品牌、来源、页码、装饰和纸张纹理不受文字滤镜影响。强调、链接、列表、引用和表格中的普通文字仍按所在标题/正文档位处理。
- B-137/REQ-04: 样式切换即时更新当前预览；分页、批次字号、当前页 Copy 和整批 Save 使用同一已提交样式。快速切换、失败、close/reopen 或并发 Modal 不产生样式串用、stale preview 或错误导出。
- B-137/REQ-05: 效果完全由卡片内确定性 SVG filter 和现有本地字体实现；不新增网络、外部字体、runtime style element、HTML 注入、设置或 provider 调用。滤镜 ID 对每张卡片唯一且引用可解析，card cleanup 一并移除定义。
- B-137/REQ-06: 选择器在中英文、light/dark Obsidian、桌面和窄屏/移动布局中可发现、可聚焦、可点击，状态可由辅助技术识别；不改变宿主主题或 Obsidian chrome。

### Non-goals

- NG-01: 不提供自定义参数、颜色、纸张、字体、比例、模板或持久默认值。
- NG-02: 不把滤镜用于代码、图片、图表、品牌、页码或整个 Modal/Obsidian 容器。
- NG-03: 不改变 Share Card 四个入口、资源权限、SnapDOM 版本、目录规则、Copy/Save 语义或发布流程。

## User Flow And States

用户从任一现有入口打开 Share Card。标题下方显示 `印刷效果 / Print style` 与三档选择，`原纸` 初始选中。准备完成后，用户点击 `轻印` 或 `复印`，当前页预览更新；多页导航继续使用同一档位。Copy/Save 忙碌期间选择器禁用，完成后恢复。关闭并重新打开时回到 `原纸`。切换失败时保留最后一套预览和导出一致的样式，并显示现有可恢复错误。

## Trust, Data And Authority

- Source evidence: 只处理当前 Share Card 已持有并已按 DEC-026 获准渲染的静态 DOM。
- Data sent / stored: 无新增发送或持久状态；显式 Save 仍只创建 PNG。
- User disclosure / confirmation: 用户于 2026-09-13 明确选择正文也应用适当轻效果、每次默认原纸且不记忆，并指定复印标题使用原始 `scale 4/1` 与 `-3px` 偏移。
- Reversibility / recovery: 当前 Modal 随时切回原纸；关闭即丢弃选择；失败不改源笔记和设置。

## Acceptance Criteria

- B-137/AC-01: 四个入口打开的每个新 Modal 均显示三档本地化选择，只有原纸初始选中；选择、关闭、重开和插件 reload 后仍不产生持久字段。
- B-137/AC-02: 中英文短内容的三档预览与 PNG 对比证明：原纸与变更前基线一致；轻印标题和普通正文产生确定性变化；复印标题比轻印有明显更强位移/毛边且正文保持轻档。
- B-137/AC-03: inline/fenced code、图片、SVG/canvas、视觉占位、品牌、来源、页码和选定区域外的像素差异为 0；强调/链接/列表/引用的普通文字仍有预期变化，无文字丢失、重排或裁切。
- B-137/AC-04: 单页、13+ 页长内容与 14px 候选均 fit、非空、顺序/末句完整；切换后 preview、Copy 和 Save 的 style/font/page contract 一致，重复导出相同 PNG。
- B-137/AC-05: 两个不同样式 Modal 并存时 filter ID 与结果不串用；close/unload 后无 SVG defs、wrapper、离屏 host、listener 或 operation state 泄漏；宿主 theme class、背景变量和网络 hooks 不变。
- B-137/AC-06: focused Share Card tests、TypeScript、lint/build/full Jest、DOM/community source scan 与 whitespace 通过；当前构建部署到 `test/` 后，真实 Obsidian 可见入口、三档点击、Escape/reopen、Save image、dark/light 和 mobile emulation 不出现阻塞或新增插件错误。真实 iOS 不在本轮验收范围，不冒充已验证。

## Open Decisions

无。强度、作用范围、默认和记忆策略均已由用户确认。

## Delivery State

- B-137 已完成实现、focused/full automated gates、生产 PNG 对比及 Obsidian desktop/mobile、light/dark 可见验收。
- Current architecture: [Share Card Architecture](../../architecture/share-card-architecture.md)
- Commit、push、beta/stable packaging 与 release 仍分别遵循仓库授权边界。
