# Note Change Review Product Spec

Document status: Current
Updated: 2026-10-05
Work item: B-154
Decision: [DEC-046](../decisions/dec-046-note-change-review-and-audit-retirement.md)
Authority: Owner 已逐项确认的笔记审阅、按钮和 Operations 审计退役范围；实现已完成本地独立验收并获文档收尾授权。Current 表示当前产品契约，不表示 Git 集成或发布。

2026-10-05 scoped successor：[DEC-051](../decisions/dec-051-proportionate-confirmation-and-contract-alignment.md)
取消当前明确修改请求的整批二次确认。以下受影响的 REQ/AC 和流程按新目标修订；
B-154 本地验收仍只证明修订前输入，新入口与结果收口由 [B-161 最终验证](../../archive/2026/b161-contract-alignment-validation.md)
记录，不以本 Spec 的 Current 或旧 PASS 声称新实现已交付。

## Problem And Product Outcome

让用户看清“哪些笔记、哪些文字、最终如何变化”，明确请求可直接完成，预览请求保留选择。小修改留在对话中，
长文按需进入完整审阅；不产生新的文件管理负担。遵循[北极星](../pa-product-north-star.md)。

## Scope

### In Scope

| Requirement | 稳定行为 |
| --- | --- |
| B-154/REQ-01 | 同一 intent 按规范化笔记路径分组，展示本批初始状态到最终状态的差异；不改变底层操作顺序，不跨批次合并 |
| B-154/REQ-02 | 上下增删差异、字词高亮、适量上下文；中文、Markdown 原始标记与实际空白变化可核对。完整变更和上下文可展开，不能因展示限长丢失内容 |
| B-154/REQ-03 | Chat 真实紧凑差异/结果 + 用户主动打开的完整审阅 tab；一批一个审阅页，重复打开复用；两处读同一状态，按实际执行/预览阶段提供可用动作 |
| B-154/REQ-04 | 当前明确修改请求可直接执行；仅讨论/预览不执行，用户从预览主动执行仍须重验本批权限/状态。无逐文件/片段接受；重复工具调用、点击或双界面竞态不能重复写入 |
| B-154/REQ-05 | tab 为当前会话的临时只读视图；关闭 tab 仅收起，原有超时、Chat 会话终止/切换、插件卸载边界继续有效；旧页不得恢复写权限 |
| B-154/REQ-06 | 按实际回执呈现成功、失败、跳过、部分完成及撤销。预计最终结果不得冒充全部已保存；保留现有内存 Undo 与 drift-safe 检查 |
| B-154/REQ-07 | 桌面操作按钮 36px，mobile 约 44px 触摸高度；当前可用主要动作突出，展开弱化；Chat 底部操作，完整 tab 操作区可见，无重叠/不可达；不为明确请求展示强制确认阻断态 |
| B-154/REQ-08 | 停止所有 Operations 会话的审计持久化，移除正文/保留天数设置与审计失败提示；旧设置不能重新启用记录，不新增替代持久审计 |
| B-154/REQ-09 | 新版对任何既有 audit 目录零管理：不探测、扫描、读取、迁移、清理、删除；缺目录也不创建，用户自行管理历史 |
| B-154/REQ-10 | 审阅与审计边界仍限定于 Operations；保留 Chat/Pagelet 会话隔离、必要授权、撤销和来源边界。DEC-051 的执行入口不授予新存储、网络或外部发布权限 |

### Non-goals

- 逐片段/文件接受、直接编辑差异、左右布局切换、自动打开 tab、模型生成变更摘要。
- 通用 diff 平台、任务中心、跨设备/重启待确认恢复、持久 Undo、审计迁移或清理器。
- 重做 Pagelet 交互、Writing、Agent Debug、Chat history、Memory、Ghost 或发布流程。
- 全机型/全主题组合测试、模型效果评测、工作流成本研究。

## User Flow And States

1. Agent 按当前请求准备同一批操作；明确修改可经领域执行入口直接执行，仅讨论/预览
   停在未执行状态。收到 staged 事件本身不自动执行，旧历史提案不自行恢复权限。
2. Chat 展示实际差异与结果；内容较多时明确标出尚未展示的变化与完整审阅入口。
   不要求先打开 tab、滚动到底或再次点击确认才能完成明确请求；不把局部差异标成全部。
3. 点击展开后打开/聚焦本批审阅 tab，按笔记顺序展示变化，可展开上下文、定位前后修改。
   文件名为主要标识，完整路径可辨；同名笔记不混淆。原始 Markdown 可见，不执行其中 HTML。
4. 同批状态为 pending → executing → completed / partial / failed / unknown；
   pending 也可以 cancelled / expired / discarded。执行中不接受重复执行；取消只阻止
   后续尚未发生的效果，已经完成或未知的效果必须保留原操作事实，不自动重放。
5. 关闭审阅页不取消本批，也不延长其有效期；有效会话内可从卡片重新打开。
   会话结束或内容句柄失效后，旧页仅说明不可用，不能重新 stage、读新正文替换旧候选或写入。
6. 顺序执行遇到失败可能已有部分写入。显示实际结果、未完成范围和现有可用撤销，
   不承诺自动全部回滚。对同文件多次修改的 Undo 仍保留原始操作回执与顺序语义。
7. 移动端使用相同纵向审阅；常规布局、滚动、按钮与 tab 导航可由 Obsidian CLI mobile 验证。

## Trust, Data And Authority

- 差异来自 Host 已冻结的 expectedBefore/expectedAfter，不由 LLM 摘要替代。
- 打开/关闭/展开审阅不得写笔记或发送额外 provider 请求；workspace state 不保存正文/差异快照。
- 执行继续经过 Operations controller、真实请求绑定、来源/权限、原子内容校验和创建冲突检查；模型参数不能制造授权。
- 审计移除覆盖 plugin-owned 与 fallback Operations、Chat 与 Pagelet；不改变其他独立持久化系统。
- 保留旧 audit 的磁盘占用是用户明确选择；不将它记成待完成的产品清理任务。

## Acceptance Criteria

| Acceptance | 可观察的通过条件 |
| --- | --- |
| B-154/AC-01 | 同文件连续修改只展示初始→最终差异；不同文件/批次不混合；create 与已存在空文件能区分，抵消的文本修改如实显示无净文本变化 |
| B-154/AC-02 | 长文、首尾多处修改、纯增加/删除、中文词语、Markdown 链接/空白变化均可核对；超过旧 1,600 字限制时仍能查看所有新旧变更，无 Before 挤掉 After |
| B-154/AC-03 | 明确修改不因二次确认而阻断；差异有省略时可进入完整 tab；同批重复打开不增加 tab，两处共享实际状态，打开操作零笔记写入 |
| B-154/AC-04 | 仅预览、已取消、超时或失效不可发起写入；重复工具调用/双界面操作最多执行一次；人工变更、目标冲突、撤权继续保护，unknown 不重放 |
| B-154/AC-05 | 关 tab 再打开有效批次可继续；切换/关闭源 Chat、reload/unload 后旧页不可确认，资源订阅释放；workspace 序列化不含正文且重载不恢复待确认能力 |
| B-154/AC-06 | 部分成功与失败/跳过范围在两处一致；真实 receipt 决定 Undo，撤销后同步反馈，外部改文后撤销拒绝保护用户内容 |
| B-154/AC-07 | Desktop/mobile 代表视口下尺寸、弱化层级、长路径、滚动和固定操作区可用；键盘可达/焦点可辨，颜色之外有增删标记；中英文标签完整 |
| B-154/AC-08 | 新装与带旧审计开关的配置均不生成审计；相关设置/提示消失，未新增替代文件或持久化通道，其他设置保持 |
| B-154/AC-09 | 合成 adapter 中存在旧 JSON、正文与未知文件时，从服务创建、操作、Undo 到销毁都不访问旧 audit 路径；不存在时也不探测或创建；无迁移清理任务 |
| B-154/AC-10 | Operations 与 Pagelet 的必要授权、Undo 和会话隔离保持；不恢复持久审计或影响独立日志/历史系统；新增执行入口验收由 B-161 承接 |

## Open Decisions

无未定产品选择。行级 diff 算法、组件职责和 mobile 操作区约束见当前架构；
遇到实质偏离本契约才回到用户决定。

## Implementation And Evidence

- [Operations 架构](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers)承载当前模块、状态与兼容边界。
- [B-154 验证记录](../../archive/2026/b154-note-change-review-validation.md)保留 10 项 AC 的本地证据、测试复用口径和部署身份；历史记录不作为当前交付状态权威。
- 开发验收仅部署 repo-local test vault；Git 集成与推送以实际提交、远程引用为准，发布和真实用户 vault 修改分别需要授权。
