# Complete Note Query Product Spec

Document status: Approved
Updated: 2026-10-24
Work item: B-169
Decision: [DEC-059](../decisions/dec-059-complete-note-query-results.md)
Authority: 用户 2026-10-10 的明确查询工具修正授权；本文件维护当前行为契约，历史交付证据见文末。

## Requirements

- **B-169/REQ-01**：`query_notes` 在许可范围完整评估结构化条件，稳定排序，默认一次返回所有匹配笔记及准确数量；仅当用户明确要求前 N 篇时，Agent 才传入数量限制，并在完整匹配后应用。
- **B-169/REQ-02**：元数据关键词查询默认返回全部匹配笔记；正文关键词搜索每篇一条轻量记录，不默认返回正文片段。保留现有字面匹配、大小写和正文/属性范围语义。
- **B-169/REQ-03**：列表轻量化，正文按需读取；没有要求模型分页、改日期或拆目录补查的默认流程。沿用 Obsidian public API 与现有协作让出机制，无新索引、依赖或执行框架。
- **B-169/REQ-04**：来源许可、取消、来源一致性、旧历史安全投影保持；真实未知或失败不能成为完整/无匹配事实。新完整结果通过现有输出、证据与下一轮模型投影链，不因旧的数量/字节阈值静默裁剪。

## Acceptance

- **B-169/AC-01**：超过 500 候选且命中在旧上限之后仍能找到；超过旧 20/12/10 返回量、6,000 字符和快照预算的轻量列表一次完整返回，排序与总数正确。
- **B-169/AC-02**：正文搜索覆盖旧 80 文件/单篇 100,000 字节界限后的命中；重复出现的关键词不重复列出同一笔记，结果不含正文；混合正文/属性及大小写条件保持。
- **B-169/AC-03**：禁止路径及其数量不泄露，取消与来源变化仍正确处理；缓存未知/实际读取失败不谎报完整；显式数量限制不影响真实匹配总数。
- **B-169/AC-04**：实际 capability 与下一轮 provider 投影保留完整新列表；旧记录仍安全可读。当前构建在 repo-local test vault 的部署运行证明一次调用获得完整列表，实际模型样本与确定性结果分开报告。

## Non-goals And Compatibility

不改变 `read_note` 的正文范围读取、不合并工具或增加搜索 DSL、不修改 Memory、模型思考设置、当前日期提示或渲染实现。保留最低 Obsidian 版本及移动端共用官方 API 路径。不部署到 anthelion，不包含 Git 或 release 交付。

## Implementation Responsibilities

沿用 [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)：

- Agent 选择查询语义、日期口径和按需正文读取；仅在用户明确要求前 N 篇时传入数量限制。工具遍历完整许可范围、执行条件、稳定排序并提供真实清单；内部协作让出不产生模型分页步骤。
- 保留三个查询工具及既有 factory/helper/guard/evidence 分工。元数据关键词沿用匹配算法，不返回任意属性值预览；正文关键词本地字面匹配、按笔记去重，只返回首个命中定位与必要来源版本。`read_note` 提供正文。
- Host 负责来源权限、取消、身份和版本事实。输出准入、V1A snippet、vault observation parser 与重校验接受完整新列表，保留结构、路径、hash 和来源证明；旧记录安全读取，不迁移持久数据。近期结果沿用现有 Context 保护，真实上下文溢出沿现有机制报告。

## Delivery Evidence

B-169 于 2026-10-24 获授权收尾。独有的旧版/新版 601 篇夹具对照、全量首轮失败及定向复验、真实 Chat 样本和环境恢复记录见 [最终验证](../../archive/2026/b169-complete-note-query-validation.md)。它记录历史证据，不承诺 anthelion 性能或当前所有环境均已验证。
