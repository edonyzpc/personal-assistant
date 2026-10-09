# Agent Debug Explorer Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-10-09
Work item: B-167
Authority: 本 track 唯一执行状态、派工、finding 与验证证据记录。
Product spec: [Agent Debug Explorer](../../../product/specs/pa-agent-debug-explorer-product-spec.md)
SDD: [Implementation design](./sdd.md)

## Current Snapshot

- Current phase: 按 Owner 接受的 agent team 审查建议完成方案与开发测试任务修订，定向复核和文档检查通过；产品代码尚未实施。
- Next action: 收到开发指令后复核源码差异，按下述实际依赖推进数据与双端界面，最终合并验收。
- Blocker / decision needed: 无待确认的产品选择；开发执行未在本轮授权内。SDD Draft 是实施前技术基线，不撤回已接受的交互选择。
- Last verified behavior: 当前源码读取已核对；桌面/移动 HTML 预览已由 Owner 接受。这是设计输入，不是 PA 新 UI 的部署/交互验证。
- Authorization: Owner 2026-10-09 接受“聚焦展开＋节点定位搜索”，要求方案及开发测试任务，并进一步授权按本轮审查结论收窄范围、减少过度约束和测试；不含运行代码、commit/push、release 或 closeout。
- Baseline: `1ff0c648`；首次编制前工作区干净。本轮在前次未提交的 B-167 文档上修订，无新依赖、模型调用、运行部署或私人 vault 操作。
- WIP: 新增本 track 作为 Planned；现有 Lean Ghost Publishing 为 Validated，保持其状态和内容，不代其 closeout。

## Ownership And Sequence

GPT-6 维护产品/设计、派工和独立验收，默认 GLM writer 实施与测试；需要的接入细节复用 [现有配置流程](../../workflows/gpt6-glm-delivery-workflow.md)，不在本任务复制流程清单。以下顺序按本次设计的真实依赖安排：

- T-01/T-02 明确共享节点字段、完整读取与失效语义后，T-03 和双端 UI 即可推进；不等待所有观察用例完成，不以前置全面采集审计阻塞界面。
- T-04/T-05 作为一个连续的双端实现切片，共用树、详情、状态与样式；保留两个编号便于对应需求，不设置两轮交付关卡。单 writer 写共享文件即可，不为加速而强行并行。
- T-06 是贯穿上述实现的整合检查清单；T-07 汇总有效证据、独立检查和实际交互验收，不要求每个编号分别部署、审查或重复测试。
- 已确认漏事件、重复阶段等具体缺陷保留目标回归；新增接口、字段和交互直接按需求验证，不一律要求先构造失败版本。多个写入者确有必要时分开文件责任，统一检查只在相关输入稳定后由一个执行者完成。

派工时补齐实际工作树、未提交文档与修改归属、允许编辑范围和指定验证即可；不假定隔离树自动带入本方案。共用边界为只观察、不改变执行，保留本地数据、清理、预算与旧历史，不新建平台或重做 Host。源码/测试传递沿用已有授权，不包含私人 vault、秘密和无关数据；Git/release 仍单独授权。

## Work And Validation Mapping

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-00 | 全部 B-167 产品范围 | 正式决定、Spec、SDD、开发测试映射及审查修订 | [x] | 最新审查建议已纳入，定向只读复核一致；docs:check、2 suites/57 tests与差异格式检查PASS |
| T-01 | B-167/REQ-01、B-167/REQ-02、B-167/REQ-08；B-167/AC-01、B-167/AC-02、B-167/AC-03、B-167/AC-08 | 真实覆盖、种类/边界、重复 phase、内容来源与计时元数据 | [ ] | 尚未执行 |
| T-02 | B-167/REQ-01、B-167/REQ-08、B-167/REQ-09；B-167/AC-01、B-167/AC-08、B-167/AC-09 | 固定高水位分页、overlay、详情安全读取、失效与旧记录 | [ ] | 尚未执行 |
| T-03 | B-167/REQ-02、B-167/REQ-04、B-167/REQ-05、B-167/REQ-07；B-167/AC-02、B-167/AC-03、B-167/AC-05、B-167/AC-07 | 纯轨迹模型、统一时间轴、聚焦/搜索/跟随状态 | [ ] | 尚未执行 |
| T-04 | B-167/REQ-03、B-167/REQ-04、B-167/REQ-05、B-167/REQ-08；B-167/AC-04、B-167/AC-05、B-167/AC-08 | 桌面树行/分隔/右侧详情/历史入口 | [ ] | 尚未执行 |
| T-05 | B-167/REQ-06、B-167/REQ-07；B-167/AC-06、B-167/AC-07 | 窄容器/移动页、返回、导航弹层、触控/跟随 | [ ] | 尚未执行 |
| T-06 | B-167/REQ-09、B-167/REQ-10；B-167/AC-09、B-167/AC-10 | 随实现完成生命周期、清理竞争、长任务和轻量三态对照 | [ ] | 尚未执行 |
| T-07 | B-167/REQ-01、B-167/REQ-02、B-167/REQ-03、B-167/REQ-04、B-167/REQ-05、B-167/REQ-06、B-167/REQ-07、B-167/REQ-08、B-167/REQ-09、B-167/REQ-10；B-167/AC-01、B-167/AC-02、B-167/AC-03、B-167/AC-04、B-167/AC-05、B-167/AC-06、B-167/AC-07、B-167/AC-08、B-167/AC-09、B-167/AC-10 | 独立审查、统一 gate、已部署桌面/移动交互、契约对齐 | [ ] | 尚未执行 |

任务中的测试文件是相关证据落点，不表示每到一个编号都重跑一遍。验证统一归入 [SDD 的三组场景](./sdd.md#test-matrix)：完整历史浏览、实时双端阅读、清理与旧历史兼容；按实际改变的边界补断言，不增加逐业务用途或设备/provider组合矩阵。

### T-01 — 必要观察接线与身份（GLM）

- 目标：核对本次确认的关键阶段和实际修改的观察接线，复用已有事件；补 nodeKind/边界/相对时间，区分 phase occurrence 和实际工具结果/模型观察文本。针对已指出的生命周期镜像链路核对并修正，不扩大为所有业务分支采集审计。
- 必要读集：SDD §1、Command Architecture Contract、现有 agent-debug-port/observation、pa-agent-debug、runtime/loop、obsidian-fetch、ai-utils，以及下列测试。
- 允许编辑：上述观察接口/适配点、`src/agent-debug/types.ts`、`service.ts` 的元数据写入及直接测试；Chat 早期入口仅在确认漏点时补观察，不改执行/调度/业务决策。
- 负例：同名 phase 两次/并发不误合并；lifecycle 不镜像成假阶段；调用失败没有 dispatch 不造 attempt；actual result 与 promptText 不混作唯一原始结果；中途开启无伪造起点，晚 payload 不覆盖 terminal；关 Debug 不构造正文。
- 最低充分验证：`npm test -- --runInBand __tests__/pa-agent-debug-observation.test.ts __tests__/pa-agent-debug.test.ts __tests__/agent-debug-service.test.ts`；按实际改动选择其中相关 suites，复用已有有效结果；runtime/loop/transport 接线改变才补对应现有 suite。用代表性的多轮、并行工具与重试数据证明身份/边界/数量正确，沿用既有 observer 异常隔离测试。具体缺陷的回归须命中原问题；新字段和接口直接按需求验证，不预设失败版本。
- 交付终点：本次改动接入点及对应回归证据；发现妨碍关键阶段展示的具体漏点在原入口补齐。数据契约明确后即可推进界面，不等待无差别分支扫描或额外覆盖报告。

### T-02 — 完整读取与详情接线（GLM；与 T-01 协调共享字段）

- 目标：实现 Proposed getTracePage 及固定 H 读取，overlay 不推进持久游标；详情复用 getContents 安全入口。按节点引用做主键查询是优先局部选择，非交付前提，成本低可随接线完成，有具体卡顿再处理。
- 允许编辑：`src/agent-debug/{types,store,service,plugin-integration}.ts`、`view.tsx` 的 host 接口，以及 store/service/integration 直接测试。共享字段、分页与失效语义明确后，T-03/UI 可开始，不要求先完成 T-01/T-02 全部测试。
- 负例：早期事件未落盘且已离开 live 500 尾窗；跨页/合并 contentIds；元数据 H 与事件页读取竞争；terminal 在末页；稀疏seq；快速切 Run、清理、过期、卸载与迟到结果；不可用存储不冒充完整。
- 最低充分验证：`npm test -- --runInBand __tests__/agent-debug-store.test.ts __tests__/agent-debug-service.test.ts __tests__/agent-debug-plugin-integration.test.ts`，复用未失效结果。fake IndexedDB 事务与受控延迟 writer 证明所有持久事件读到、引用不丢/不重复、安全失效覆盖新读取。详情以节点内容正确、长内容可读、切换可操作、清理不复活为通过条件，不硬性断言底层只读取指定主键；旧数据无需清库。
- 交付终点：接口、跨页/删除竞争回归及实际原始结果；不引入单独数据库、后台索引或新清理协议。

### T-03 — 轨迹模型与稳定交互状态（GLM）

- 目标：从全 Run 元数据构建 Proposed trace-model；稳定身份/父子/异常汇总、时间轴、focus/manual overrides、搜索祖先闭包和 follow。只读取元数据。
- 允许编辑：新 `src/agent-debug/trace-model.ts`、必要局部 hook、Panel 的状态接线和对应 tests；不修改安全 projection.ts 的职责。
- 负例：重试失败被成功覆盖、父节点晚到/缺失/环、重复累计 usage、墙钟/单调混算、缺边界反推假区间或隐藏 owner 已提供的有效耗时；搜索晚期节点漏掉、搜索清空丢折叠、更新抢历史选择。
- 最低充分验证：`npm test -- --runInBand __tests__/agent-debug-trace-model.test.ts __tests__/agent-debug-view.test.tsx`（前者 Proposed 新 suite）。通过条件为显式图/时钟夹具的节点数、顺序、时间、搜索/follow 状态符合 AC；不按代码内部结构镜像测试。
- 交付终点：可供双端共用的纯模型与局部视图状态。展开全部覆盖索引，不预读正文；替换旧 tail-page 导航断言，保留其“用户选择不被刷新破坏”的有效要求。

### T-04 — 桌面查看与节点详情（GLM；与 T-05 连续实现）

- 目标：将卡片/上下布局替换为树行、统一时间轴、可调整分隔和右侧详情；整合搜索、历史选择、真实节点内容与中英文本。
- 允许编辑：`src/agent-debug/components/`、必要 viewer 接线、`src/custom.pcss` 中局部 `pa-agent-debug-*`、`src/locales/plugin/{en,zh}.json` 中 Debug keys、view tests。
- 负例：点击节点导致整页上下跳、详情滚动推动树、分隔挤没控件、全窗口宽但窄 leaf 仍双栏、同节点更新丢正文展开、原始字段绕过过滤。
- 最低充分验证：`npm test -- --runInBand __tests__/agent-debug-view.test.tsx`；与 T-05 共用状态夹具和有效结果，验证真实交互状态与按需展示。DOM 断言不代替实际几何验证，双端完成后合并观察，不单独部署每个样式调整。
- 交付终点：桌面组件与测试，无原型模拟按钮/示例数据；不得为了形式拆出多余共享框架。

### T-05 — 移动与窄容器（GLM；与 T-04 共用一个双端切片）

- 目标：轨迹/详情双页、轮次/历史弹层、当前可见序列前后导航、返回锚点、手动触摸/滚轮/键盘暂停跟随、安全区。
- 允许编辑：同 T-04 组件/CSS/locales、必要局部状态及 view tests，不新增手机独立数据管线。
- 负例：折叠同时进入详情、直接返回丢搜索位置、隐藏节点进入前后序列、新事件插入导航、清搜索跨节点仍保留旧序列、底栏遮末项、弹层背景误操作、touch 不停跟随。
- 最低充分验证：同 view suite，只补移动导航/清理的缺口；与桌面共用一次部署，由 T-07 移动模拟器观察44px命中、末项可达及弹层滚动。容器断点为实现参数，不以原型720px代替实际适配。
- 交付终点：双端共用模型可工作；列表/详情各一条底部导航，无原型未来状态。

### T-06 — 随实现收束的整合检查（GLM；非独立开发关卡）

- 目标：核对查询、投影、详情和导航的 invalidation，并把长任务、长正文与轻量三态对照并入实时双端阅读场景；不另建性能研究任务。
- 允许编辑：上述已授权模块的必要修正、focused tests/合成 fixtures；不得改已有预算来掩盖慢查询、清除旧数据或引入未经确认的依赖。
- 最低充分验证：复用 T-01 至 T-05 的 observation/service/store/integration/view 有效结果，只在对应 suite 补整合缺口；不重新执行一套同义测试。使用完整历史场景的长Run与详情场景的长正文检查阅读；若本次新增视窗渲染，再验证其目标定位和键盘可达。原始事件量与可见节点量分别看待。
- 同设备、同受控输入完成 Debug 关闭、后台采集、实时查看的轻量行为对照；复用已有关闭采集/observer异常隔离断言，本次改变的采集或调度边界才补基线对比。硬条件是请求/效果/最终结果/取消语义一致，无无界积压或卸载泄漏，UI可操作。明显卡顿才定向测量，不设CPU/延迟阈值、全业务故障矩阵或接近容量上限的常规压力专项。
- 若全展开产生已证实 DOM 瓶颈，按 SDD 增加局部视窗渲染并测目标定位/键盘可达；若非瓶颈，不预先引库。性能不能以仅展示尾部或省略必要内容换取。
- 完成条件：三组场景所需整合证据已齐备并在 T-07 一并核对，无额外报告或单独阶段验收；harness 结果和真实 Obsidian 操作分别记录。

### T-07 — 独立验收、统一检查与部署交互（GPT 负责接受）

1. 实现者之外的只读 reviewer 检查实际 diff、source/authority、旧数据/清理/异步风险及关键断言；实现者修复确认 finding，只补失效验证。GPT 不能用 writer 自查替代独立审查。
2. 按最终实际 diff 确定统一检查范围，相关输入稳定后由一个 executor 收口：`npm run lint`、`npm run build`、`npm run docs:check`、`git diff --check` 和下方社区源码扫描；若仍跨观察/存储/UI 的共享行为，则一次 `npm run test:all -- --runInBand` 有必要，若实际仅局部改动且 focused 已覆盖，则不因七个任务编号强制全量。生产 build 包含类型检查，不再重复全仓 tsc；已覆盖检查直接复用。
3. 完成本次必要检查且有当前生产构建后，使用满足条件的 `make deploy-current`；若选择由 `make deploy` 包办检查与部署，则复用其结果，不前后叠加。部署范围不反向增加测试矩阵；只使用经核实隔离的 repo-local test vault/实例，重载后确认实际加载构建。未隔离的用户 Obsidian/vault 不用作开发默认目标。
4. 真实桌面操作：Chat→Debug入口、历史会话/结果筛选、宽leaf/窄分栏、最早/末Turn、折叠/搜索/分隔、详情独立滚动/长内容、失败attempt定位、实时旧节点阅读、清理/开关/reload。宽/窄及主题检查共用同一部署。
5. Obsidian CLI mobile simulator：至少覆盖约320px窄容器、常用手机宽度及宽窄切换；实测44px命中、折叠与选择、搜索→详情→返回、前后首尾、清搜索跳转、touch暂停follow、弹层关闭与焦点返回、底栏/安全区末项可达。一般布局不设 iPhone 真机门槛；只有明确真机请求或已证实 iOS 特性风险才增加对应 gate。
6. 用确定性 Agent/transport 驱动真实 viewer，观察原生 tab、编辑、保存、Stop 与 Debug 导航；不以 CLI 创建DOM/截图存在替代实际操作。受控服务不是线上模型证据，本功能未改模型语义，不预设真实模型评测。
7. GPT 逐项核对 AC 和原始结果，记录命令自然退出、相关输入/构建/目标、通过范围与未验证项。具备证据后更新当前 Debug Architecture/受影响指南为实际行为，标记任务；到 Validated 不自动 commit/push/closeout/release。

社区扫描（exit 1 且无输出表示无匹配；有匹配须人工核对）：

```bash
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src
```

### Evidence Reuse And Rerun

遵循 [GOV-001](../../governance/gov-001-agent-managed-project-lifecycle.md#validation-planning-and-reuse)。各切片的命令、断言、自然退出和相关源码/fixture/config 输入留在本表/日志；阶段变化、文档修改或新增 reviewer 本身不触发重跑。

| Changed input / risk | Minimum rerun |
| --- | --- |
| 元数据字段或阶段/工具观察接线 | T-01 直接 suites，受影响 trace-model/view；若改变执行行为则先纠正范围 |
| 高水位、事务、generation、清理、内容定位 | T-02 store/service/integration 及 view 的迟到读取竞争 |
| 投影/搜索/导航/跟随状态 | trace-model/view 受影响场景；实际入口/滚动变化补对应 app 动作 |
| CSS/容器/分隔/底栏 | 相关 view 行为与目标宽度 app 几何；不重复未变的数据夹具 |
| 跨模块共享输入或 gate 期间源文件变化 | 冻结后重跑受影响 enclosing gate；不把旧构建身份当当前测试通过 |
| docs-only | docs:check、test:docs、diff check；无 build、模型、部署或 app smoke |

失败从真实命令/断言定位产品、验收、工具或环境原因，有新信息才重试；不弱化正确断言或 `--forceExit`。临时服务、fixtures、worktree 按各次派工精确路径管理，接受前保留原始证据；完成后仅清理本任务资源，保留用户改动和仍被引用证据。

## Findings

初版审查未发现实现可行性阻塞；后续 Owner 要求按已确认体验和必要工作量重新审查，确认一项范围表述需收紧，并接受查询方式、任务组织与耗时展示的调整。以下记录设计处理，不表示产品代码已修复或通过验收。

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P2（范围） | “每条执行分支”审计配合固定七步串行，可能将UI改造扩大成全面采集整治 | 仅核对已确认关键阶段与实际修改接线，具体漏点再补；共享数据契约明确即可推进界面，T-04/T-05连续实现、T-06随实现整合 | Spec、SDD与本Tracker同步修订；本轮文档核对见下表 | Resolved in design |

同时采纳的非缺陷简化：正文主键读取作为优先局部选择，按体验结果验收；新能力无需预设失败版本；已有有效耗时不因缺边界而隐藏。验证合并为三组场景，统一检查按最终diff决定，不新增机制、报告或业务组合矩阵。

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-09 | T-00 / 全部范围 | 源码与既有 authority 核对 | PASS（只读） | 基线1ff0c648；200窗口、500尾窗、collector合并、内容来源/时钟与清理包装已核对；非运行测试 |
| 2026-10-09 | T-00 / 双端设计 | Owner 接受预览与默认组合 | 已确认 | 本会话桌面/移动HTML预览及最后明确选择；静态/模拟原型不是PA部署证据 |
| 2026-10-09 | T-00 / 设计与任务 | 独立只读设计审查 | PASS | 两名非作者 GPT 分别核对数据架构/源码与双端UX/验收；固定H、overlay、清理、内容来源、返回/导航、全部REQ/AC映射无must-fix；未跑运行测试 |
| 2026-10-09 | T-00 / 文档门禁 | `npm run docs:check` | PASS，exit 0 | 281 Markdown、3684 local links；只验证文档结构/引用/状态与映射 |
| 2026-10-09 | T-00 / 文档门禁 | `npm run test:docs -- --runInBand` | PASS，exit 0 | 2 suites / 57 tests；7.381s，自然退出；source/tests/config未修改，最终记录更新复用此结果 |
| 2026-10-09 | T-00 / 文档门禁 | `git diff --check` | PASS，exit 0 | 只改docs；无build、模型、部署、app/mobile或Git交付 |
| 2026-10-09 | T-00 / 范围复核 | Owner要求抛开流程/skill的agent team审查 | 完成 | 三名只读reviewer分别核对产品交互、技术必要性、测试范围；确认F-01，另给出查询/执行组织与耗时澄清建议；不把初版PASS作为本轮正确性依据 |
| 2026-10-09 | T-00 / 设计修订 | Owner要求按审查建议优化方案 | 已纳入 | 只改Spec、SDD、Tracker；保留完整Run、双端交互、聚焦＋搜索、必要读取/身份/清理机制，收窄全面审计和流程前置 |
| 2026-10-09 | T-00 / 修订复核 | 原范围reviewer定向只读核对 | PASS | 未发现本轮建议的交叉残留；三组场景仍覆盖全部10项REQ和10项AC；非运行验证 |
| 2026-10-09 | T-00 / 修订文档检查 | `npm run docs:check`、`npm run test:docs -- --runInBand` | PASS，exit 0 | 281 Markdown、3684 local links；2 suites/57 tests，7.817s，自然退出；最终仅更新本记录，复用测试结果 |
| 2026-10-09 | T-00 / 修订格式检查 | `git diff --check`；未跟踪的三份修订文档另用no-index检查 | PASS | 无空白错误；no-index与空文件比较的exit 1表示有内容差异，无诊断输出；无产品代码、构建、部署或Git交付 |

## Closeout Readiness

- [ ] T-01 至 T-07 已完成，实际行为符合 Spec/SDD。
- [ ] 必需独立审查、自动化与部署后的双端交互证据可核对。
- [ ] 未完成项明确处理，不以文档或原型通过冒充运行验证。
- [ ] 稳定实现事实吸收到当前 Architecture/指南；本包采用 delete-after-absorption，独有验证证据才归档。
- [ ] closeout / Git / release 按另行授权执行。
