# Note Image Removal Software Design

Document status: Approved
Updated: 2026-10-05
Work item: B-160
Authority: Owner 已授权按 B-160 方案完成开发设计任务；经独立审查的实施契约，区分设计与实际交付证据。
Product spec: [Product Spec](../../../product/specs/pa-note-image-removal-product-spec.md)
Plan: [Delivery Plan](./plan.md)
Tracker: [Development Tracker](./tracker.md)

## Current Source Baseline

实施起点为本地 master `22cf028e`：

- [Operations types](../../../../src/ai-services/operations/types.ts)：四种 Markdown 写入，PreparedOperation 为单路径文字快照；需要判别联合，不能为附件伪造文字 diff。
- [staging executor](../../../../src/ai-services/operations/operations-tool-executor.ts)、[service](../../../../src/ai-services/operations/operations-service.ts)：同一 tool phase 一个 intent；分轮暂存不自动合并。
- [controller](../../../../src/ai-services/operations/operations-intent-controller.ts)：原子核对笔记后 vault.process，逐项执行且可 partial；不是跨文件事务。
- [review model](../../../../src/ai-services/operations/operations-review-model.ts)、[review session](../../../../src/ai-services/operations/operations-review-session.ts)：共享不可变预览与确认能力；目前将 receipt 与可 Undo 状态关联，需区分事实收据与恢复能力。
- [UndoStore](../../../../src/ai-services/operations/operations-undo-store.ts)：有 TTL 的内存文字回执，只在访问时清理；[IMAGE_POLICY](../../../../src/chat/image-policy.ts)已有单图大小边界。
- [result facts](../../../../src/ai-services/pa-agent-result-facts.ts)：Operations validator 不接受 unknown 子步骤，执行投影将非 succeeded/skipped 映射 failed；需保真扩展。
- [ChatService](../../../../src/ai-services/chat-service.ts)自动刷新原 Operations 状态；[image status tool](../../../../src/ai-services/image-status-tool.ts)可供只读 owner 查询的实际注册、lineage 和快照新鲜性接线参考。

官方 SDK 的 FileManager.trashFile 自 1.6.6 提供，返回 Promise<void>，满足当前最低
Obsidian 版本；没有公开回收站恢复接口。当前 Mac Obsidian 1.12.4 安装包静态读取
确认该方法对 system/local/none 分别走系统回收站、本地回收站、永久删除。
[公开 API 注释](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)
仍只列两个回收站选项；这项安装实现证据不外推所有版本/平台，也不成为调用私有
getConfig 或重复原生分支的理由。采用官方方法，文案仅承诺遵循设置与临时 Undo。

## Interfaces And Ownership

引用唯一 [Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)：

| Decision / effect | Owner | Factual basis / output |
| --- | --- | --- |
| 图片目标、删引用或联合删除、必要澄清 | 主 Agent | 当前请求与获准来源；结构化选择不是确认 |
| 能力、权限、源/文件身份、确认寿命 | Host / 原 Operations 接入 | 实际 schema、动态权限、真实文件及有效 UI 确认 |
| 引用解析、共享检查、快照、删除和恢复阶段 | Operations domain | 原文件/原文、实际核查及原生 API 结果；分别返回效果 |
| 整个请求是否覆盖 | Agent | 两项效果及实际恢复事实；Host 不从词面判断完成 |

Proposed `remove_note_image` 接受 notePath、实际 imageReference selector 与
attachmentAction（keep/delete）。不接受 confirmed、权限位、回收站目的地或系统路径。
delete 产生一个联合预览，原领域内部拥有笔记与附件两个效果；keep 只产生笔记
预览与效果，保留附件。不要求模型同一轮恰好
调用两个工具，不新增跨轮可变草稿或通用依赖图。拟新增名称不是已存在能力。

复用原 intent/run/tool attempt 身份。类型使用明确的 Markdown/复合操作判别联合；
对笔记保留真实 diff，对附件显示独立摘要。附件影响、冲突和 Undo 限制在紧凑与完整
预览中均可见，不因文字预算隐藏。现有其他工具语义与旧回执读取保持兼容。

## Reference Admission And Execution

1. 解析实际引用到本地 TFile，冻结唯一目标、原文、拟修改文本及附件身份。
   歧义不猜；缺少旧 Chat asset registry 不等于无法选择实际笔记附件。
2. keep 仅核对当前笔记的选中引用与文字修改，沿用文字快照及普通文字 Undo；
   不进入跨笔记共享删除核查、二进制快照/额度或附件删除流程。
   以下第 3–7 步仅用于 delete。
3. 对必要引用关系进行当前、完整且获准的核查，复用 Obsidian metadata/link
   resolution 与现有来源边界；不能用 asset.owners 或未同步的缓存宣称无其他引用。
   支持的本地引用形式及缓存新鲜性须由 focused 负例和实际 app 证据核实。
   不获准或不可完整核查时零写入阻止，不扩大 Data Boundary。
4. 共享冲突阻止整个原提案，列出可披露的引用信息。用户明确改选 keep 才重新
   暂存“仅移除当前引用”；不在确认时私自改变原提案的效果集合。
   完整获准核查的冲突冻结在 prepared operation 的 block 中，复用原 pending intent；
   整组执行入口在状态转换及任何写入前硬阻，引用随后消失也不解锁旧提案。
   冲突列表只进入 Host 审阅，不进入模型回执；不完整核查不保留累计冲突路径或数量。
5. 用户确认后重新核对全部边界；先预留恢复容量，读取实际附件字节、核对 hash/
   文件版本并保留笔记快照。读失败、超额、漂移或共享冲突均发生在首笔写入之前。
6. 在 vault.process 内核对笔记基线并移除选中引用，立刻保留笔记效果事实和恢复
   资源；再次核对引用、附件身份与权限，之后调用 fileManager.trashFile。
7. 正常返回与目标核查共同支持附件已从 vault 移除的事实；不把结果笼统标为
   trashed。拒绝或后置收据失败无法证明未发生时保留 unknown，停止后续写入。

来源准入接线必须覆盖 notePath 的实际 read plan；delete 声明真实的 scoped vault
核查，keep 不进入该分支。现有 note identity 只接受 md/canvas，不能伪造附件 noteId
或放宽笔记身份类型。原 Host/Operations 提供窄的笔记引用所指实际附件读取/身份
端口，独立核附件路径 Data Boundary、版本、来源与寿命，仅用于本地恢复快照。
候选引用域不能使用已过滤、截断或 existing-items-only 的 inspect/backlink 结果
冒充完整；逐源先核权限，再读取当前原文。禁止源的 metadata/body 零读，阻止删除。
有限 allowedPaths 之外仍有必要候选时，核查不完整；不得扩大读取权限，也不得
披露禁止来源的路径或数量。delete 在生成提案前即核实际附件路径权限；keep
只保留文字效果准入，附件单独替换或权限变化不使文字操作失效。

引用核查覆盖 Markdown reference-style 图片/链接及 Canvas text/file 节点；使用
现有解析器核实块引用/callout 内代码围栏与 inline code 的真实范围。未支持的
本地 HTML 图片或其他无法判定的形式标为不完整，不能当作无引用。逐源读取前后
核对身份/版本，扫描结束及 retained 准入核对候选库存；扫描中新增、替换或修改
来源使该证据失效。确认前和笔记写入后的复核都消费当前证据，不能重用失效扫描。

原 run 的 TaskSourceReadGuard 仅在准备阶段使用，不进入 retained intent。确认和
Undo 私有保留 captureSourceValidity 的来源收据及冻结的真实身份，并由当前有效
ReviewSession 和动态权限重新准入；不序列化 guard、不复活旧 run，也不去掉后续校验。

来源授权与观察新鲜性分开负责：首次写入前完整核验原来源收据；已确认的自身
笔记写入后，Operations 使用真实身份、已发生效果及新的完整引用核查建立写后
证据。原全库观察 epoch 会被这次写入推进，不能把它单独当作来源授权撤销。
后续删除与 Undo 仍核验原祖先来源身份、当前权限和冻结的来源约束；已失效的
来源或权限仍阻止写入。这是已证自身写入场景的阶段接线，不扩大来源读取范围。

PA 可协调自身对这些目标的重复操作与 Undo，不能锁住同步、用户编辑或其他插件。
首笔前冲突零写入；首笔后才出现的冲突停止附件删除并报告 partial。不存在全 vault
事务保证，不能以“联合操作”承诺严格原子性，也不盲目自动回滚未知效果。

## Undo And Resource Lifecycle

delete 的 Proposed 私有图片快照附着原 Operations Undo owner；不进入公开 intent、模型输出、
Chat history/Debug 或序列化状态。快照来自本次实际附件，不用历史 Chat 原图替代。

- 在共享 OperationsService 的恢复资源 owner 统一核算预留与保留字节，使用独立
  明确的源代码常量，不借用媒体缓存上限。单图沿用已有图片大小限制。
  超额拒绝新删除，不淘汰仍有效快照，不静默降级为不可撤销。
- 保留现有 Undo TTL/会话能力边界；加入必要的到期释放，不能仅依赖下一次访问。
  正在执行的删除或恢复持有私有资源租约，过期阻止新 Undo，不中途释放使用中的
  buffer。正常 settle 只归还执行租约和未使用的临时预留；已发生效果所需的快照
  转由 Undo owner 保留，直到完整撤销成功、TTL 到期或能力失效。部分恢复继续
  保留尚需的快照与检查点。expire/dispose 先停止新准入；执行中资源待原 Promise
  settle 后再释放，最终归还保留额度、buffer 引用及计时器。
- 一键 Undo 先检查笔记仍等于冻结 after、操作有效、附件目标可安全恢复。
  原附件已在原路径且字节一致时复用；存在冲突时不覆盖。
- 先 createBinary 恢复附件并核对结果，再在 vault.process 内再次核对笔记 after
  并恢复原文。附件未可靠恢复时不恢复图片引用。
- 附件恢复成功而笔记随后漂移时记录部分恢复检查点；有效期内后续处理只处理
  尚未恢复步骤，不重复 createBinary。不自动删除已恢复附件或回收站副本。
- 恢复写入结果未知时核实原操作，不将异常等同未写入或盲重试。只对完整已恢复
  或领域证明原本未发生的效果报告 Undo 完成；重复按钮不能并发消费同一快照。
- 能力失效后停止进一步准入，已开始的不可取消 API 仍可能完成。保留必要资源到
  原 Promise settle 后释放，不重新激活卡片、收据或执行权限。

不承诺跨重载撤销；原有历史事实保留，快照和执行能力不落盘。过期后是否能手动
恢复取决于 Obsidian 原删除设置，不提供永久删除后的回收站保证。

## Result Facts And Read-only Recovery

在原 Operations 结果、actions 和闭合协议内表达 note/attachment 两个稳定效果
以及恢复检查点。至少区分 not_started、applied/removed、failed、unknown 和 restored；
按真实阶段投影整体 pending/completed/partial/failed/unknown。不得清空已发生事实。
执行事实 receipt 与 undoAvailable 分开，防止“有回执”被 UI 误作“可完整撤销”。
controller 的有限 context 投影、原 actionStates 保存/读取及 owner 后续状态更新
保留这些效果；按原 owner 身份和单调新鲜性接受更新，旧快照不能降级已发生事实。
blocked 暂存沿用现有 operations-staged/pending，增加有限 operationsBlockedReason；
等待处理冲突不代表可确认。取消、过期或 owner 丢失仍沿用原终态，不复活权限。
UI 优先显示已知分效果；Undo 未返回新效果时保留已有事实，并附本次失败或过期说明。
P1 内部类型扩展不把新名称提前加入 CORE_WRITE_TOOL_NAMES/provider 出口；P2 完整
链路就绪后同步所有闭合名单、实际注册和 UI。只读查询不加入写工具名单。

Proposed `get_operations_status({intentId})` 绑定当前会话可见的原操作及原 run，
复用 session.getContextResult；仅返回有限 owner 事实与恢复可用性，不确认、不续写、
不重建丢失 intent。接通真实 capability 注册、来源/lineage、闭合 observation 和
不复用旧查询快照规则。历史 lost 不证明原操作失败，当前路径缺失不单独证明删除。
同一会话、intent、原 run/turn 的多个工具回执绑定同一 owner；真正冲突的来源绑定
仍拒绝查询。blocked owner 返回有限 shared_reference 原因与 undoAvailable:false，
不返回冲突路径，也不因查询或引用变化解锁原提案。
旧事实继续可读；新效果在能力不可用或旧版本不能理解时如实降级为未知，不恢复权限。

## Delivery, Validation And Rollback

实施前批准 source-verified SDD；交付依赖与阶段退出见 Plan。先固定最小分效果及
闭合协议，再做内部解析/核查/预览；删除与 Undo、事实/query/UI 接通为完整可用切片，
全部闭合后才注册能力，不先开放删除再补结果事实。
单一 writer 管交叉源码，独立 reviewer 核数据、权限和部分/未知结果。每个 slice
按 Tracker 风险映射完成 focused，不由各 reviewer 重跑完整门禁。

| Requirement / AC | Minimum evidence | App / failure condition |
| --- | --- | --- |
| B-160/REQ-01 / B-160/AC-01 | 实际引用/同名/重复/混合 callout→联合预览 | 公开 Featured Image callout，笔记 diff 与实际附件同时可见 |
| B-160/REQ-02 / B-160/AC-02 | 共享、缓存未同步/不完整、核查权限与中途变化；keep 分支 | delete 共享冲突首笔零写、中途停止与 partial；keep 保留附件且不受删除专用核查/额度阻挡 |
| B-160/REQ-03 / B-160/AC-03 | 真实 policy/controller确认、失效/替换/重复 | 准备/取消零删除，确认一次执行，保持其他工具 |
| B-160/REQ-04 / B-160/AC-04 | note成功+附件failed/unknown→history/runtime；原ID查询 | Chat追问如实反馈，query零写、不重提 |
| B-160/REQ-05 / B-160/AC-05 | 实际字节与原文恢复、碰撞/部分恢复/未知 | 实际确认后一次Undo；漂移不覆盖，不重建已恢复附件 |
| B-160/REQ-06 / B-160/AC-06 | 容量预留/TTL/in-flight lease/dispose与泄漏扫描 | 重载失效不恢复能力；验证所支持平台的公共API/交互 |

最终集中 gate 及 test vault 实际 Chat 见 Tracker；真实模型门须另获明确调用授权，
并符合 Product Spec 的费用边界，仅测自然语言选图、共享冲突、正常撤销与部分
结果追问，不执行新的图片生成调用。无实际模型证据则保留未验证。桌面/mobile能力不由
类型声明或一次桌面样例推定；mobile 交互按 Owner 2026-10-05 约束使用 Obsidian
CLI mobile simulator；仅有 iOS 系统特有能力或具体模拟器覆盖缺口才要求真机。
回滚撤下新能力及对应 UI，保留已有用户文件和历史事实；不清理回收站、原图或旧审计。

## Approval

- Product choices: Owner 已确认共享引用阻止删除，以及支持一键撤销。
- Design: Approved on 2026-10-04；来源/附件身份/生命周期及结果接线已独立核实。
- Authorized implementation scope: Owner 当前目标授权完成 B-160 全部开发设计任务及相关本地验证；repo test 为本地 app 目标。2026-10-05 另授权公开夹具的真实文本模型验收，并明确默认使用 CLI mobile simulator。iCloud/device 部署保持各自边界；无 Git、发布或 closeout 授权。
