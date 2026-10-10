# DEC-059 — 条件查询一次返回完整笔记列表

Decision ID: DEC-059
Status: Accepted
Updated: 2026-10-10
Authority: 用户于 2026-10-10 明确要求修正相关查询工具，复用 Obsidian 官方 API，一次返回完整匹配笔记列表，正文按需读取，不让模型拆目录或分页补查，不做过度设计。
Work item: B-169

## Context

`query_notes` 在日期等条件前截断 500 个候选；正文搜索还存在候选、文件数和字节上限。结果不完整后让模型缩小范围，会把一次查询展开成多轮补查。元数据关键词搜索只保留少量排名结果，也不能表达完整清单。

## Decision

1. 在许可范围内完整执行日期、标签、属性和关键词条件，一次返回全部匹配笔记的轻量列表。只有用户明确要求前 N 篇时，Agent 才传入数量限制；默认不限数量。
2. 正文关键词匹配在本地完成，每篇笔记只返回一条记录；正文由 `read_note` 按需提供。内部协作切片不成为模型分页或拆目录工作。
3. 复用 Vault 文件列表、TFile 元数据、MetadataCache 与 Vault 读取，不引入索引、查询 DSL、CLI 依赖、结果存储服务或新框架。
4. 保留来源范围、权限、取消和来源一致性；真实缓存未知、读取失败和模型上下文容量不足如实报告。不得把人为截断或失败伪装成完整结果或零匹配。

本决定局部接续 [DEC-037](./dec-037-pa-agent-essential-capabilities.md) 中列表查询的分页语义，不改变正文范围读取、Memory、Pagelet 取材范围、写入或发布授权。

## Consequences

保留已有工具名和旧历史的安全读取；新查询不再提供结果游标或任意候选截断。相关输出准入、来源证据和重校验必须接受完整列表。不会据此承诺解决模型思考、网络或渲染的全部延迟。

## Revisit Trigger

真实资源或模型上下文失败阻止完整结果交付时，依据实际规模另行设计交付方式，不能恢复未经批准的固定候选截断。

## Traceability

- [Product Spec](../specs/pa-complete-note-query-product-spec.md)
- [Feature Home](../../development/active/complete-note-query/README.md)
