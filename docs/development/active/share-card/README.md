# Share Card Development Track

Document status: Current
Updated: 2026-08-06
Work item: B-124
Authority: 本 track 的简短入口与 owning contract 路由。
Decision: [DEC-026 — Share Card 采用本地、显式导出的完整渲染卡片](../../../product/decisions/dec-026-local-share-card.md)
Product spec: [PA Share Card Product Spec](../../../product/specs/pa-share-card-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- Outcome: 把完成的 PA Chat 回复、Pagelet 当前可见 findings、editor selection，以及
  Action Ring Share 的 selection-first/current-note fallback 变为可预览、实测分页、本地
  复制/保存的固定品牌图片。
- Delivery class: L3
- Explicit non-goals: 模板设置、Prepared read-only 内容、系统 share sheet、上传/发布、
  历史卡片库，以及扫描输入未明确引用的 Vault 内容。远程媒体、Vault 图片、支持整篇
  与 heading/block anchor 的有界递归 Markdown note embed，以及图表属于 v1 完整渲染
  保真范围。
- Capture authority: 精确锁定 `@zumer/snapdom@2.23.2`；PA 先本地化显式资源并报告
  完整性，SnapDOM 只捕获离屏 card DOM，并使用固定选项及 `cache:"disabled"`。用户批准
  artifact-only runtime style 窄例外，不批准 live UI style 注入、proxy 或跳过
  community/mobile gate。
- 2026-08-06 owner amendment: Ring 顺序为 `Capture / Review / Discover / Share`；note
  fallback 只剥离有效 YAML frontmatter 并显示 basename，selection 原样且无文件名/路径。
  卡片显示图形 logo 与 `Personal Assistant`，Ring 四项显示中英本地化文字标签；Source Han Serif 只从本地
  data URL 加载；Desktop/iPad 为内向弧，iPhone 可容纳时横排、否则整组竖排；正文只在能减页时
  按 `16 → 15 → 14px` 选择最大有效字号，整批一致。

## Artifacts

- Tracker: [Development Tracker](./tracker.md)
- Plan: [Delivery Plan](./plan.md)
- SDD: [Software Design Document](./sdd.md)
- Current Product contract: [PA Share Card Product Spec](../../../product/specs/pa-share-card-product-spec.md)
- Decision review input: [SnapDOM deviation discussion](./codex-snapdom-discussion.md)（非权威输入；其中技术断言需按当前源码重新核验）

执行状态、下一步、finding 与验证证据只写 Tracker，不在本页镜像。
