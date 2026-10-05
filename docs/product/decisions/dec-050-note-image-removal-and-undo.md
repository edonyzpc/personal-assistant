# DEC-050 — 笔记图片联合删除与一键撤销

Decision ID: DEC-050
Status: Accepted
Updated: 2026-10-05
Authority: Owner 于 2026-10-04 确认其他笔记引用时阻止删除并展示冲突，以及支持一键撤销；承接本会话修复方案讨论，不授予运行代码实施、Git 或发布权限。
Work item: B-160

## 2026-10-05 Confirmation Successor

[DEC-051](./dec-051-proportionate-confirmation-and-contract-alignment.md) 局部接续整批确认：
当前明确联合删除请求可直接执行，不要求再次点击。共享引用保护、写前完整恢复快照、
实际逐效果结果和一键撤销保持；不可将引用移除成功当作附件删除成功。实施见B-161。

## Context

Chat 移除 Featured Image callout 中的图片引用后，实际附件仍保留。
本地 master `22cf028e` 的 Operations 只有 Markdown 写入工具，现有图片清理入口
也不允许删除已成为正式附件的图片。现有 harness 可复用确认、权限及结果事实链。

依据[北极星](../pa-product-north-star.md)，用户应能核对一次操作的完整影响，
同时保护共享引用、原文件和真实执行事实。

## Options Considered

| Option | Benefits | Costs / disposition |
| --- | --- | --- |
| 仅移除笔记引用 | 保留附件与其他引用 | 不满足用户明确要求同时删除附件的目标 |
| 共享图片仍直接删除 | 当前请求可继续 | 破坏其他笔记；Owner 选择阻止并提示冲突 |
| 附件仅靠回收站手动恢复 | 无图片快照 | Owner 最终明确选择支持一键撤销，不采用为本次 Undo 契约 |
| 沿现有内存 Undo 保存临时图片快照 | 一键恢复原字节与笔记，不增加持久目录 | 需要真实恢复资源与有效期管理；自设容量硬拒绝约定已于 2026-10-05 撤销 |
| 持久化备份与跨重载恢复 | 可跨会话撤销 | 新存储、隐私与清理契约；不在本次范围 |

## Decision

1. 本次明确选择的笔记图片引用与本地附件作为一个可审阅的联合操作；按 DEC-051，
   当前明确联合删除请求可直接执行，不强制整批第二次确认。仅讨论、准备预览或取消
   均不执行删除；实际超授权或目标/范围歧义仍须确认或澄清。
2. 首个写入前发现其他笔记仍引用附件时，整个联合操作不执行，展示获准的冲突信息
   并提示用户。改为仅移除当前引用必须形成明确的新选择，不能静默降级。
   同一笔记中未被本次移除的引用同样不能因附件删除而断链。
3. 支持一键撤销，恢复本次实际附件字节和笔记原文。沿现有 Undo 的会话、有效期
   与失效边界，快照仅在内存中保留，不新增持久备份、审计或跨设备恢复。
   本次完整恢复快照实际准备成功后才允许首个写入；不能静默执行不可撤销删除。
   2026-10-05 Owner 撤销自设容量额度作为业务准入条件；真实读取/分配失败仍须
   如实报告。后续 [B-161](../../archive/2026/b161-contract-alignment-validation.md)
   已完成任意额度拒绝的源码移除与本地验收；原 B-160 验收仍按当时范围保留。
4. 优先复用官方 `FileManager.trashFile`，尊重 Obsidian 删除设置。确认文案与结果
   不保证一定进入回收站；PA 的临时 Undo 不依赖回收站恢复接口。
5. 联合操作仍是顺序效果，不承诺跨文件事务。分别保存笔记、附件及撤销的真实结果；
   部分或未知效果保留原操作身份，核实后处理剩余项，不盲重放。

## Authority And Compatibility

沿用 [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
与 Data Boundary；不新增 Host 意图分类器、编排器、长期恢复库、孤儿附件清理或
背景删除。必要引用核查不完整或不获准时阻止删除，不隐式读取排除来源。
删除聊天、清缓存及原图片管理入口仍不自动删除正式附件。

本决定承载已确认产品选择。拟新增接口和具体设计由 SDD 拥有；规划完成
不由批准状态推断实施；原 B-160 实际部署与验收见
[最终证据](../../archive/2026/b160-note-image-removal-validation.md)，后续约定见 B-161。

## Revisit Trigger

需要跨重载撤销、永久快照、新的引用核查权限，或真实证据要求改变平台支持、
删除设置或内存恢复边界时，另行提交具体选择。

## Traceability

- [Product Spec](../specs/pa-note-image-removal-product-spec.md)
- [B-160 最终验证](../../archive/2026/b160-note-image-removal-validation.md)
- [B-160 Architecture](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers)
- [DEC-046](./dec-046-note-change-review-and-audit-retirement.md)
- [DEC-049](./dec-049-command-agent-host-tool-contract.md)
