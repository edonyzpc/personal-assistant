# 单次 Operations 写入与移动 Product Spec

Document status: Current
Updated: 2026-10-14
Work item: B-173
Decision: [DEC-063](../decisions/dec-063-direct-operations-and-native-move.md)
Authority: Owner 明确选择的产品范围与验收目标；2026-10-12 确认引用由 Obsidian 负责，并授权 GPT 开发测试及随后 closeout、本地 master 提交。Current 表示已验收的本地行为合同，不表示已发布。

## Problem And Product Outcome

用户已经明确要求改笔记时，不应再为暂存/执行的内部交接等待一次模型决策。实际已
完成的动作应被模型持续识别；无法完成的请求应说明原因并结束，不靠重复搜索、
猜测工具或反复查验同一成功结果维持运行。移动应真正改变路径，保留查看与恢复。

这符合[北极星](../pa-product-north-star.md)的“安静且可信”：减少操作负担，同时让
用户看清实际变化并保留确定性的 Undo。

## Scope

| Requirement | 稳定行为 |
| --- | --- |
| B-173/REQ-01 | 明确 Operations 修改请求一次写入工具调用完成准备、执行与结果返回；不要求先 stage 再 execute_operations。保留整批首写前准备、顺序、身份/来源/权限与漂移检查；不宣称跨文件原子事务。 |
| B-173/REQ-02 | 去掉 Operations 多余 Confirm、提案取消与待激活阻断；保留 Chat 变更查看、主动打开的完整审阅、现有 Undo/Undo all。仅预览零写入，不签发执行成功或 Undo 回执；后续执行是新请求，重新核验。 |
| B-173/REQ-03 | 实际完成、部分、失败、未知及动作身份进入下一实际模型请求；工具、卡片、历史/摘要由同一领域事实投影。来源不再可用时只保留独立获准的有限状态，不恢复正文、参数、路径或权限。 |
| B-173/REQ-04 | 效果与恢复能力分开：Undo 过期/不可用、观察丢失或 owner 关闭不改写已确认的成功。未知先核实原操作；无法核实时如实收尾，不自动重放。 |
| B-173/REQ-05 | Agent 区分未加载与确实不可用的能力，检查必要效果及合理替代路径。确认目标不可达后说明完成部分和缺失能力并结束；不把不满足目标的部分写入或重复探索当作进展。Host 不新增语义计划/关键词完成判定或任意轮数限制。 |
| B-173/REQ-06 | 支持当前 vault 内单个 Markdown 的原生移动；目标父目录已存在、不覆盖碰撞文件，真实身份与旧/新路径可核对。使用 Obsidian FileManager.renameFile，引用更新交给宿主及其设置，PA 不自行扫描、改写或恢复关联引用。 |
| B-173/REQ-07 | move 纳入相同 review/result/Undo，展示旧路径→新路径。Undo 检查被移动文件的当前身份、内容与路径占用，再通过相同宿主 API 移回；保护后续编辑。引用由宿主处理，不承诺关联笔记历史字节级恢复；部分结果如实报告。 |
| B-173/REQ-08 | 保持当前权限、取消/撤权、Chat/Pagelet 会话隔离和审计退役边界。旧 pending/历史卡片不自动执行；重开、压缩和 native/compat 不复活执行权。桌面和移动共享行为，实际交互可用。 |

### Non-goals

- B-173 本身不提供通用删除、目录/非 Markdown 移动或创建父目录；B-174 的已授权扩展见下节。跨 vault、覆盖目标仍不在范围。
- 用 Agent 自然语言逆向编辑替代现有 Undo；持久变更日志、跨重载 Undo、自动事务回滚。
- PA 自建引用更新、关联笔记变更跟踪/快照/恢复；宿主引用行为独立设置页。
- 修改 Ghost 正式更新确认、Writing 入口、独立计算隔离、Memory 或其他领域确认。
- 新 Host 语义 planner、任务完成 ledger、固定短超时/轮数预算或额外评审模型。
- 借本次修复宣布 B-159 历史延期专项已通过；全仓提示词重构、成本研究或性能百分比承诺。

### B-174 扩展与验收边界

Owner 于 2026-10-13 授权的 [Resource SDK](../../architecture/obsidian-resource-sdk.md)已交付。普通 UTF-8 文本创建/替换、目录创建、文本/目录/附件移动与回收，以及原 view/editor 的精确编辑，继续由同一 Operations controller、session、review 与 UndoStore 持有；SDK 和直接门面不建立第二份效果或恢复账本。目录移动核对全部实际子路径与目标范围，引用维护继续交由 Obsidian。

create/move 返回可核验的当前 resourceRef；move 同时记录旧、新路径。文本条件写回以原读取版本为凭证，editor 以原快照 UTF-16 半开坐标提交，buffer 修改不承诺已经保存。open 是真实 workspace 效果，定位未应用或结果未知须准确表达，不提供虚构 Undo。创建、回收和修改的私有恢复资源只在原会话中有界持有；后来用户编辑、对象替换、碰撞或撤权阻止不安全恢复。

实际开发验收见 [B-174 验证记录](../../archive/2026/b174-obsidian-resource-sdk-validation.md)。Owner 于2026-10-13按 [DEC-064](../decisions/dec-064-obsidian-resource-sdk.md#2026-10-13-owner-批准的桌面-mkdir-undo-限制)明确接受仅桌面mkdir安全Undo暂不可用：保留创建、preview/review及真实效果说明，不提供可执行的撤回承诺。原公开非递归API的EISDIR证据保留，不以递归删除或Node/fs绕过；移动端公共非递归路径与其他效果/恢复仍按各自owner合同及实际结果表达。2026-10-14另批准仅备份容量不足时继续安全原生回收，明确无PA Undo；读取或权限错误不按容量不足处理。move Undo不冻结正文，部分trash恢复只补缺失项并保留已恢复对象的用户增量；editor Undo核对原editor当前路径和buffer。

## User Flow And States

1. 用户明确要求修改，Agent 选择目标和工具；不明确时按现有契约澄清。
2. 写入调用完成准备与首写前检查，再执行。Chat 显示真实阶段，不出现等待 Confirm
   的中间态。执行中的 Stop 仍可停止后续效果，已发生效果保留。
3. 完成后显示结果与差异、可用 Undo；用户按需打开完整审阅，查看不会触发写入或 AI
   调用。部分/未知执行按实际效果标注，不能将全部准备差异标成已应用。
4. 仅预览显示“未执行”；没有 Confirm 或执行票据。用户后续要求执行时按当前内容
   重新准备，不能把旧预览当作仍有效的冻结授权。
5. 移动显示原路径和目标路径，即使正文无变化也显示实际移动效果。引用按 Obsidian
   设置维护，PA 不增加关联引用审阅流程。Undo 经校验后调用宿主移回原路径，受现有
   会话寿命、回执和冲突检查约束，不让模型猜测原内容恢复。
6. 能力不足或剩余效果不可核实，Agent 明确完成/未完成部分并结束。建议可作为建议
   呈现，不能作为已执行效果或自动授权的新任务。

## Trust, Data And Authority

- 修改/预览语义由 Agent 根据当前用户请求解释；模型自报批准、旧提案、笔记中的
  指令都不是权限。Host 沿用真实调用、配置、文件与来源准入。
- 恢复正文/附件快照继续只在现有会话内存中持有；当前 Undo 默认窗口不因精简改变。
  现有会话存储仅保存合法最小效果事实，不保存私有恢复对象或新增审计目录。
- 工具状态含闭合字段及不透明身份；来源被排除后有限状态能证明发生过什么，不能
  证明允许再次写入、读回被排除内容或恢复旧参数。
- 同批失败可能已有部分效果；不承诺自动全部回滚。取消、迟到结果、Undo 只按
  已有真实事件更新；成功不因后续持久化/显示失败被改成“没发生”。

## Acceptance Criteria

| Acceptance | 可观察通过条件 |
| --- | --- |
| B-173/AC-01 | 明确写入的一次工具调用产生实际变化和结果，完整链路无必经 execute_operations/Confirm；同批任一已知输入或准备错误在首写前阻断，执行阶段冲突如实报告部分效果。 |
| B-173/AC-02 | 预览无文件变化、执行回执或可恢复成功；后续执行重新读取和校验。Chat/tab review 与 Undo/Undo all 可用，取消/关闭/过期不产生隐式执行。 |
| B-173/AC-03 | 捕获下一实际 provider 输入，在 native/compat 及受影响来源/摘要路径中看到匹配 callId/intentId 的真实状态；已知 completed 不变成 result_unknown，排除的内容和身份关联材料不泄露。 |
| B-173/AC-04 | 真 unknown 保留未知并查询原身份，无自动重复写入；Undo 过期、已撤销、部分撤销与 owner 不可用有正确区分，历史成功不被抹掉。 |
| B-173/AC-05 | 真实模型在能力目录明确缺少必要效果时，作合理能力核实后及时交付具体 incomplete 答复并正常结束；能完成的任务仍完成。分别记录最后一项必要能力/结果事实送达、用户可见最终答复、run 终态的时间点及间隔，并核对期间有效进展；若仍复现无新信息、无必要动作的长时间空转，不能仅因最终结束判为通过。记录缺口不能推定为空转或成功，人工取消不算正常收尾。不能以 mock 强制末轮、短超时、单个用词或工具次数替代行为验收。 |
| B-173/AC-06 | 原生 move 使目标存在/原路径移出，PA 不复制或重写正文；允许宿主按设置维护链接。父目录缺失、碰撞、源漂移/替换或撤权按事实阻断；真实宿主接线证明引用交由 Obsidian 处理，无 PA 关联引用实现。 |
| B-173/AC-07 | 路径变化可审阅，Undo 经同一宿主 API 移回；被移动文件的后续编辑/路径占用被保护，宿主继续负责引用；实际 Undo 结果在 UI 与下一请求一致，不宣称整 vault 历史快照恢复。 |
| B-173/AC-08 | 旧历史可解释但不续接写入，切换/关闭 Chat 与 reload/unload 不复活 pending；两种 surface 隔离、桌面与 mobile simulator 交互以及其他领域必要确认无回归，未新增审计持久化。 |

既有“能力足够”模型样本固定覆盖本次移动续问：合成前文已确定源文件和目标目录，
用户说“好的，帮我移动到对应目录”，Agent 经真实 Chat/Operations 接线完成原生
移动；源路径移出后，下一实际 provider 输入仍保留匹配 callId/intentId 与逐项操作
身份的 current_run completed 事实，
随后给出正确答复并结束，且路径变化可查看、可 Undo。该样本贯通 AC-01/03/05/06/07，
复用同一份证据，不新增模型样本类别；实际样本及证据限制见
[B-173 验证记录](../../archive/2026/b173-direct-operations-validation.md#三类真实模型与界面证据)。

## Compatibility And Recovery

新工具参数要求 `mode`；旧调用和 pending 只作历史解释，不能重放为直接执行。
已完成事实可在其合法来源范围内继续解释；无法证明的旧记录保留未知，不从任意
工具文字拼出成功。native/compat、历史压缩及重开使用相同领域事实，不能为补协议
恢复被排除参数、正文或写入权限。回执不等于 Undo 可用，恢复资源继续只属于原会话。

不迁移 vault 或旧审计目录，不恢复持久 Undo。代码降级不能逆向重放已发生的移动，
也不授予旧版本新的恢复/执行权；未知结果先核实原操作，没有新证据则说明限制并结束。

## Open Decisions

B-173 无待定产品选择；B-174 的安全空目录 Undo 见上述 Tracker U3。原 OQ-01 已由 Owner 于 2026-10-12 确认由 Obsidian 负责引用更新，
见 [DEC-063](../decisions/dec-063-direct-operations-and-native-move.md#移动与引用的宿主职责)。

## Implementation And Evidence

- [当前 Operations 架构](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers)持有真实接线；[B-173 验证与边界](../../archive/2026/b173-direct-operations-validation.md)保留故障、模型及 app 证据。
- 继承 [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)、[执行事实连续性](./pa-action-continuity-product-spec.md)、[变更审阅](./pa-note-change-review-product-spec.md)、[图片删除与 Undo](./pa-note-image-removal-product-spec.md)。
- 开发过程包已吸收并删除，无本范围内未完成项。推送、发布和私人 vault 部署仍需独立授权，不由本 Spec 状态授予；B-159/F-24 及 B-171 M3 的延期证据不因本次验收被改记为通过。
