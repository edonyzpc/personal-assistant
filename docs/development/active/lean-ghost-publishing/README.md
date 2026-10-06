# Lean Ghost Publishing Development Track

Document status: Current
Updated: 2026-10-06
Work item: B-163
Authority: 本 track 的入口；行为由已批准的 Decision 与 Product Spec 定义。
Decision: [DEC-053](../../../product/decisions/dec-053-lean-ghost-publishing.md)
Product spec: [Ghost Publishing](../../../product/specs/pa-ghost-blog-publishing-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Outcome And Boundary

- 从 Obsidian note 准备 Ghost 草稿/已发布更新候选，人工上线；只读写 GHOST_ID。
- Delivery class: L3（外部写入、来源权限、会话状态和关联格式变化）。
- 不兼容旧关联，不恢复旧操作，不增加内容或媒体限制；不发布生产文章或软件版本。

## Artifacts

- [Tracker：分工、开发顺序、验证与实际证据](./tracker.md)
- [SDD：实现接口与职责](./sdd.md)
- [已批准的完整产品方案](../../ghost-blog-publishing-design.md)

开发顺序和验证安排可容纳于 Tracker，复用完整方案，不另建 plan.md。
