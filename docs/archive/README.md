# Archive

Document status: Current
Updated: 2026-07-21
Authority: 当前源码或文档仍直接引用的独有历史证据；不承担当前状态、规划或批准。

Archive 是按需保留的 evidence store，不是完成文档的默认落点。

## 保留标准

仅保留以下内容：

- 当前 Product、Architecture、Governance、Backlog、Roadmap 或源码注释直接引用的独有 rationale。
- 无法合理吸收到当前契约的法务、迁移、回滚、事故、发布或最终验证证据。
- 当前 authority 明确需要引用的一份紧凑 closeout/final report。

Feature Home、Plan、SDD、Tracker、逐轮 review/handoff 和重复 research 在稳定结论吸收后默认删除。Archive 不要求完整 package、年度 README 或穷举索引。

## 使用规则

- 从当前文档的链接进入 Archive；不要为例行任务预读本目录。
- 保留文件必须至少有一个当前源码或文档入链；无当前入链即为可清理噪声。
- 历史文件内部可能提及已清理 companion，checker 不沿 Archive 内部链接扩张保留集合。
- Archive 不能提供当前实现或 delivery status authority。
- tracked 当前文档的吸收/删除记录见 [Disposition Log](./disposition-log.md)。Archive 内历史噪声无需逐文件回填。

2026-07-21 瘦身前的完整快照可从 Git commit `22940c94` 恢复，例如：

```bash
git show 22940c94:docs/archive/<path>
```
