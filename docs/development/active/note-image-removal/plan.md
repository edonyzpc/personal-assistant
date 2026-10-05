# Note Image Removal Delivery Plan

Document status: Approved
Updated: 2026-10-05
Work item: B-160
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point；执行状态只由 Tracker 维护。
Product spec: [Product Spec](../../../product/specs/pa-note-image-removal-product-spec.md)
SDD: [Software Design](./sdd.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

按 DEC-050 的已确认范围，在现有 Operations/harness 中交付可审阅的图片联合删除：
共享引用阻止删除、删除前具备恢复资源、一键撤销恢复原附件和原文，部分及未知结果
经 Chat/历史仍保持事实。沿用[北极星](../../../product/pa-product-north-star.md)的安静与可信约束。

沿用 Product Spec 的非目标，不建立另一套调度器、长期备份、完成度账本或附件清理
框架。已有图片管理与 Markdown 工具行为保持。新工具名均为 Proposed，计划不是
已交付能力。Owner 已授权按本方案完成全部开发设计任务；具体执行范围见 Tracker。

## Dependencies And Source Surface

技术基线见 SDD；开工时核对相关路径变化，不重新调查未变的证据。B-158 的公共
框架已在本地 master 中，按当前实现接入，不另建 harness；B-159/F-24 延期问题
不纳入本任务，也不以本功能验收冲销其原证据。

| Surface | Verified source / test entry | Planned responsibility |
| --- | --- | --- |
| 操作声明、输入、准备 | [types](../../../../src/ai-services/operations/types.ts)、[validation](../../../../src/ai-services/operations/input-validation.ts)、[provider](../../../../src/ai-services/operations/operations-tool-provider.ts)、[executor](../../../../src/ai-services/operations/operations-tool-executor.ts) | 最小判别联合、真实 selector、冻结提案；最终阶段才开放新能力 |
| 来源与身份准入 | [read plans](../../../../src/ai-services/task-source-read-plans.ts)、[read guard](../../../../src/ai-services/task-source-read-guard.ts)、[source executor](../../../../src/ai-services/task-source-executor.ts) | 接通 Proposed notePath，现有读计划固定 input.path；不只修改 schema |
| 领域与恢复资源 | [service](../../../../src/ai-services/operations/operations-service.ts)、[controller](../../../../src/ai-services/operations/operations-intent-controller.ts)、[UndoStore](../../../../src/ai-services/operations/operations-undo-store.ts)、[image policy](../../../../src/chat/image-policy.ts) | 当前引用核查、官方删除、私有快照、容量/TTL/执行租约、分效果事实 |
| 确认与可见结果 | [review model](../../../../src/ai-services/operations/operations-review-model.ts)、[review session](../../../../src/ai-services/operations/operations-review-session.ts)、[review UI](../../../../src/chat/operations-review/OperationsReviewView.tsx)、[Chat](../../../../src/chat/chat-view.ts) | 同一预览/确认、冲突、partial/unknown、有效 Undo；附件摘要不伪造文字 diff |
| 事实、历史与模型输入 | [result facts](../../../../src/ai-services/pa-agent-result-facts.ts)、[action history](../../../../src/ai-services/pa-agent-action-history.ts)、[history](../../../../src/ai-services/pa-agent-history.ts)、[ChatService](../../../../src/ai-services/chat-service.ts)、[history store](../../../../src/chat/chat-history-store.ts) | 纠正 unknown→failed 投影，保存原 actionStates；事实收据与撤销能力分开 |
| 实际能力与只读查询 | [Runtime](../../../../src/ai-services/pa-agent-runtime.ts)、[registry](../../../../src/ai-services/capability-registry.ts)、[policy](../../../../src/ai-services/policy-engine.ts)、[image status reference](../../../../src/ai-services/image-status-tool.ts) | Proposed get_operations_status 的注册、权限、原 run/intent、闭合观察与新鲜快照 |

所有涉及决策、准入、状态和副作用的责任分工沿用 SDD 的 owner 表及唯一
[Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)。
开工前检查 `1 Now + 1 Next`，按真实交付证据协调实际活跃工作；不重启 B-159。

## Phases

每个行为切片遵循 implement → focused validation → review → fix → verify。
内部契约与完整可用功能分开交付；附件删除、Undo 与最小结果闭合不能分成会被
用户调用的中间版本。P1 不增加可调用的新工具或新 UI；P2 是唯一新增可见能力的
完整交付阶段，其 broad/model/app gate 不推迟到 P3。

| Phase | Outcome | Scope / dependency | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| P0 | 固定实施输入与职责 | 核对基线、WIP、Approved Spec/SDD、实际 GLM 工具/目标；关闭必修设计项 | 任务读集/allowlist/接收树/部署目标明确；真实 provider 调用与设备验证授权单列 | 可派工，不扩大后续权限 |
| P1 | 内部契约与安全准备 | T-01；先固定最小类型/输入/效果协议，再做真实目标、来源准入、引用覆盖和冻结预览；不注册新能力 | 准备/歧义/共享/不完整核查零写；keep 不读二进制、不走共享删除扫描或 Trash；focused、Local Validation Gate、独立职责/来源 review | 只有内部准备能力，不能删附件；若实际改变共享运行行为，当阶段补 broad gate |
| P2 | 完整可用切片 | T-02 与 T-03 连续交付：可恢复执行 + 分效果事实/持久化 + 查询/Runtime/UI；全部闭合后注册能力 | focused、独立领域及 harness review；冻结输入集中 broad/deploy；获准真实模型与 desktop/mobile 交互门；全部覆盖 AC-01–06 | 可核对的完整候选；缺少必需门保留未验证，不交付半套删除能力 |
| P3 | 独立验收与环境恢复 | T-04；GPT 核实际 diff、断言、原始结果及目标 app；复用 P1/P2 未失效证据 | 全部 REQ/AC 有对应事实，必修 finding 关闭；任务临时状态/资源恢复；Tracker 更新验收结果 | Validated implementation；不自动 closeout、commit、push 或发布 |

### P0 — 派工与回归输入

GPT 使用[任务模板](../../templates/glm-worker-task.md)和
[GPT-6/GLM 工作流](../../workflows/gpt6-glm-delivery-workflow.md)派给一个 GLM writer。
优先复用有效 preflight；只补本任务实际工具/runner/app 目标。新增 worktree 用项目
管理工具创建，显式同步当前未提交契约并核对内容；保留 DESIGN.md、design-samples
和其他无关工作。不以文件存在或模型自述当作接入证明。

这是数据、权限与异步跨模块任务，采用有检查点的 reproduce → implement：先保留
真实“笔记已改、附件未删”的目标回归及测试 diff，再连续实施。现有 97 项基线不是
新功能红/绿证据；导入错误不算目标红灯。不为每个参数或机械变化单独造红灯。

任务单列完整 REQ/AC、负例、允许编辑范围、目标工作树、输出目录、自然退出证据、
部署对象及恢复项。源码/测试由一个 writer 持有，GPT 维护权威文档与 Tracker；
只读 reviewer 可并行。实际 worker 与创建的执行资源只在 Tracker 登记。

### P1 — 目标、引用与准备

1. 保留原 Markdown 操作契约，新增窄的 Proposed remove_note_image 判别分支与
   notePath/imageReference/attachmentAction 输入；同步真实来源读取计划和身份核对。
   最小 note/attachment 效果协议先固定，后续模块消费同一事实。
2. 从实际笔记引用解析唯一附件，生成真实文字变化；保留 callout 无关内容。建立
   引用覆盖矩阵，至少验证 wiki 图片/链接、Markdown 图片/链接及 callout 内引用；
   其他现存形式的可支持性、当前性与完整性据实际 API/语法核定，不能据缓存空结果
   宣称无引用。核查当前笔记拟修改后仍保留的引用；不隐式读取排除来源。
   有限来源范围、reference-style Markdown、Canvas text node、嵌套代码围栏、
   inline HTML 及扫描中库存/版本变化纳入负例；必要候选不获准或证据失效均阻止。
3. keep 只准备当前笔记变化及文字 Undo。delete 才检查共享引用与附件删除准入。
   已有共享、不获准、缺失或不完整检查均阻止原 delete 提案，展示可披露的冲突；
   仅用户明确改选 keep 才准备新提案。
4. 内部准备模型提供笔记 diff、附件影响、冲突与撤销限制；准备/取消零写。新入口、
   UI 呈现和 provider 注册留在 P2，避免 P1 引入未完整验收的可见行为。

### P2 — 执行、撤销与完整接线

按以下依赖顺序在同一 writer 上连续完成；中间检查点用于独立核对高风险不变量，
不是每一步向用户重复申请确认。

1. 先落最小分效果结果、闭合校验与 actionStates 保存/读取，保留 not_started、
   partial、failed、unknown 与恢复检查点。删除可用前修正现有 unknown→failed
   投影；不能等删除执行后再补历史事实。旧 Operations 收据与新 unknown 效果混合
   后，经持久化、重载及压缩仍须保留已有事实；缺少新恢复字段不制造 Undo 能力。
2. 实现共享容量预留、实际二进制快照与 lease：单图沿用 IMAGE_POLICY，独立总额
   的拟实施初值为 64 MiB，由源代码常量拥有；该值不是实测性能承诺。TTL 沿用
   DEFAULT_UNDO_TTL_MS，起点与 receipt 一致。计入预留和保留，不淘汰有效快照；
   任一准备失败或超额在首笔写入前拒绝。快照只归原 Undo owner，不进入公开结果。
3. 确认后重新核对目标、来源/权限/版本与引用；vault.process 修改笔记后立即记录
   其效果，再核对附件条件，调用官方 fileManager.trashFile。首笔前冲突零写；
   首笔后才出现冲突停止附件步骤、保留 partial。不能从异常推定未发生，不盲回滚。
4. 一键 Undo 先核有效期、笔记 after 与附件目标，先恢复或复用一致附件，再原子
   核对笔记并恢复原文。部分恢复保留检查点，重复点击互斥；碰撞不覆盖、已恢复
   附件不重复创建。正常 settle 不释放有效 Undo 快照；expire/dispose 先停止准入，
   执行中的 buffer 等原 Promise settle 后释放，不复活 UI 或权限。
5. 接通原 session/run 的只读 owner 查询、capability/schema、policy、来源/lineage、
   闭合 observation 与新鲜快照；覆盖 Runtime、历史/压缩及最终回答输入。查询零写，
   不确认、重提或续写，不能从 lost receipt 或路径缺失独自推定失败/成功。
6. 接通原紧凑与完整审阅 UI、取消/失效/重复确认、实际 Undo 与可见结果。事实 receipt
   与 undoAvailable 分开，附件摘要不伪造 diff。全部条件和结果链就绪后才注册新能力，
   不增加中间 feature flag 或另一套 capability framework。

P2 的独立 review 分为引用/删除/恢复资源与 harness/历史/查询两个风险面，共享文件
仍只有一个 writer。验证与获派集中门禁由 GLM 执行；缺少 desktop/device 工具的
真实交互由具备能力的执行者补齐。GPT 负责独立判断，不重复所有已有效检查。

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| 选错附件或遗漏共享引用 | 真实引用/身份、覆盖矩阵、当前获准完整检查；keep/delete 分支 | 同名/重复、缓存落后/不完整、剩余引用和权限负例 | 首笔前拒绝；不得改为警告后继续删除 |
| 两项效果或恢复只完成一项 | note/attachment 及恢复检查点先固定，顺序调用保留事实 | 后置冲突、API 拒绝/未知、恢复后笔记漂移 | 停止后续效果并查询原操作；不盲重放/自动删恢复文件 |
| 图片快照提前释放或占用无界 | 首笔前共享预留、TTL 计时清理、执行 lease、dispose | 容量边界、自然 settle、到期无访问、并发与卸载负例 | 拒绝新增删除；保留有效已有快照，失效后释放资源 |
| 禁止来源或二进制泄漏 | 沿既有 Data Boundary，公开结果只有限事实 | history/Debug/模型输入/序列化负例，排除来源的零读断言 | 停止受影响接入；不建立新读取例外或持久恢复目录 |
| 注册/历史把未知伪装成失败或完成 | 完整闭合链后注册；原 run/intent 查询不恢复权限 | 实际 Runtime→fact→history/压缩回归 | 撤下新 capability 与 UI，保留用户文件和已有事实 |
| 平台与权限证据不足 | 公共 API，按原 both 平台规划；真实目标与调用授权单列 | 实际桌面/iOS 删除、恢复、过期/重载及模型语义证据 | 保留未验证；不静默改为 desktop-only 或合成证明 |

代码回滚撤下新接入、恢复既有操作行为；数据回滚只允许有效 Undo，不能清理
回收站、附件、恢复文件或旧历史来制造回滚成功。

## Validation Strategy

REQ/AC → 变化 → 最低充分证据/命令 → 通过条件 → 重跑触发的执行映射在 Tracker。
现有 source 入口已通过 rg 核对，worker 按实际改变范围选择，不因列表存在而全跑：

| Risk surface | Existing focused entry points | New evidence to add only for uncovered behavior |
| --- | --- | --- |
| 解析/准备/来源 | operations-input-transform、operations-service、operations-task-source-read、task-source-read-plans | 实际目标/支持引用/完整性、keep 分支及 notePath 准入 |
| 执行/恢复/确认 | operations-intent-controller、operations-audit-undo-suggestion、operations-review-model、operations-review-session | 删除前快照、每效果状态、原字节/原文、partial/unknown、TTL/lease/dispose |
| harness/历史/查询 | operations-action-state、operations-agent-runtime、pa-agent-action-history、pa-agent-runtime-chat-history、chat-service、chat-history-store | 实际注册/闭合观察、新鲜 owner 状态、历史及最终回答输入，无二进制/权限泄漏 |
| UI 与原行为 | operations-review-view、operations-review-ui、chat-view、chat-image-assets、operations-audit-retirement | 联合确认/冲突/Undo、原正式附件不被其他 cleanup 删除、不恢复旧 audit |

上述入口均位于 __tests__，使用 `npm test -- --runInBand --runTestsByPath <实际 source 路径>`。
新增 suite 名称由具体行为决定，不创建镜像实现或同义词测试。工具脚本改动用
`npm run test:tooling`；artifact-bound 测试先有当前 production build，再用
`npm run test:artifacts`。依 [jest groups](../../../../scripts/lib/jest-test-groups.cjs)
检查实际运行的 suite，不能把错误分组的零匹配当 PASS。

P1/P2 采用 [Local Validation Gate](../../../../AGENTS.md#local-validation-gate)。实际
共享运行行为变动在其阶段执行 lint/build/test:all；P2 最终由单个执行者冻结源码、
测试、fixture、配置、依赖及生成输入，再集中 `make deploy` 到 repo test，复用其
lint/build/full Jest/type-check。另补未包含的 DOM source scan、docs:check 和 diff
检查。符合 current-build 复用条件才用 deploy-current，不把资产身份当测试证据。
只读 review 可继续，任何修复先结束旧 gate 再改；不重复 reviewer 各自的全套检查。

桌面 app 门使用[测试 vault smoke](../../../../.agents/skills/obsidian-test-vault-smoke/SKILL.md)：
部署后 reload，用 Obsidian CLI/deep link 准备公开夹具，再实际走选图/联合预览、
共享冲突、keep、新确认、删除和一次 Undo；再观察 partial/unknown 追问及重载失效。
不重新生成图片。模型/文件 API 合成边界分别记录，UI 观察不能冒充真实模型语义。

移动端沿既有 both 能力规划，按 Owner 2026-10-05 的明确约束，默认使用 Obsidian
CLI mobile simulator 验证删除/Undo/共享冲突与失效交互，复用未变的领域边界证据。
仅出现 iOS 系统特有能力或具体模拟器覆盖缺口时，才另行使用
[iOS smoke](../../../../.agents/skills/obsidian-ios-real-device-smoke/SKILL.md)；iCloud 部署
与真机操作另按实际范围授权。模拟器结果明确记为 mobile simulator，不称真机 PASS。

真实模型门仅在**另获明确调用授权**后，用公开夹具验证自然语言目标选择、共享
冲突、正常 Undo 与部分/未知结果追问，实际 create_image/图片 provider 调用必须为零。
Owner 已于 2026-10-05 明确授权真实文本模型验收，Product Spec 已同步公开夹具与
费用范围；未取得获准的实际模型证据，不能勾选该门或宣称完整
验收；确定性 harness 与真实 app 证据只支持其各自边界。

通过结果记录命令/cwd、scope/count、自然退出、原始日志、相关输入与实际 app/build
目标。输入未变就复用；新改动、失败或具体未解风险才补测，不因 stage/commit/SHA
变化重跑。community/release gate 在对应授权发布阶段执行，不是本次规划动作。

## Approval

- Plan authority: Owner 要求按项目规范制定 SDD 驱动开发计划；产品选择承接 DEC-050。
- Approved on: 2026-10-04；Owner 授权按照 B-160 方案完成全部开发设计任务，技术设计已独立审查。
- Authorized implementation scope: B-160 源码/测试/必要契约与 repo test 本地验证，按阶段连续完成，不逐步重复请示。模型费用、iCloud/device 部署保持各自权限边界；无 Git、发布或 closeout 授权。
