# Ghost Blog Publishing Development Track

Document status: Current
Updated: 2026-09-29
Work item: B-153
Authority: Ghost 发布功能的简短入口与 owning contract 路由。
Decision: [DEC-045](../../../product/decisions/dec-045-ghost-blog-publishing.md)
Product spec: [Product Spec](../../../product/specs/pa-ghost-blog-publishing-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- 将现有 Obsidian 笔记准备成 Ghost 草稿，原生 Preview 检查后明确确认。
- 每次操作同桌面完成；完成记录同步后，其他桌面可对同一文章发起新更新。
- Delivery class: L3，涉及来源权限、外部写入、本机持久化与完成记录；不建设通用 CMS、任务交接或同步平台。

## Artifacts

- [Tracker](./tracker.md)：唯一执行状态、任务接续、验收与资源记录。
- [开发测试方案](./plan.md)：GPT/GLM 任务卡、最低充分测试和实际操作步骤。
- [实施设计](../../ghost-blog-publishing-design.md)：复用既有技术设计，不复制第二份 SDD。
