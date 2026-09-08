# Simple Settings Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-09-08
Work item: B-106
Authority: 本 track 的唯一执行状态、任务依赖、finding 与验证证据。
Product spec: [Simple Settings Product Spec](../../../product/specs/pa-simple-settings-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: P1/P2实施与P3验收核对完成，交付为Validated；Desktop UI-01..04和mobile simulator UI-05..06通过，D-18/D-19最终产物复验、独立review及最终文档检查通过。
- Next action: 当前授权实施范围已完成；新的Git提交、整合、closeout或发布按独立授权进行。
- Blocker / decision needed: 无未决产品选择。Owner明确本轮不再要求real-iOS；仅iOS本身强相关的变化才追加真机，未改动的Keychain/软键盘特有行为不重复测。test仍为legacy_threshold，未迁移既有治理数据；合成Memory卡片仅证明宿主UI，不替代治理持久化测试。原qwen3.8-max已恢复，后台保持false；恢复后台此前被自动审批拒绝，未获新增恢复授权，不阻塞源码与本轮验收。
- Last verified behavior: 最终lint/build（含TypeScript）通过，完整测试242 suites / 6376 tests，100.918s自然退出0；`make deploy-current`及test reload通过。加载、dist、安装main.js SHA-256均为 `2f16a6ac541af8375ed0592c8311faf63599004366a523233e3f1beb152830e7`；styles.css SHA-256为 `664a4684d2f274dd8b3e95f5870301ea5aae44c05f22792bff2cd69753b5c8d6`。Desktop中英文、保存失败/重开、Metadata迟到回调、Memory局部动作/确认取消及现场选项通过；simulator 390×844、四组导航/输入/深链/同DOM草稿通过、token被动读取0、无捕获错误。已清理插桩、恢复语言/corePopout和桌面模式；最后load时间2026-09-08T14:39:51.577Z，blocker=null。

## Work

任务状态是本表唯一权威；每个开发项须经过 focused validation→review→fix，
涉及共享文件的并行安排遵守 Plan 的所有权约束。

| ID | Requirement / AC | Slice / owner scope | Depends on | Status | Evidence / completion condition |
| --- | --- | --- | --- | --- | --- |
| T-00 | B-106/REQ-01..08 / B-106/AC-01..07 | P0：源码设计、字段闭集、依赖与验证计划；integrator + read-only reviewers | DEC-033 | [x] | 三路设计 review 无未处理 P0/P1/P2，docs/diff check 通过；见 Validation Log |
| T-01 | B-106/REQ-05 / B-106/REQ-07 / B-106/AC-05 | 五旧键规范化、单一新后台偏好、raw 检测与 save strip；Settings/Plugin integrator | T-00 | [x] | 新旧值等价、幂等、不复活、失败重试、保护有效数据；focused/full及独立review通过，App集成归T-06 |
| T-02 | B-106/REQ-06 / B-106/AC-02 / B-106/AC-05 | automatic/explicit admission、局部暂停/epoch、结果提交与提交后生效setter；Pagelet worker，Plugin 接缝由 integrator | T-01 | [x] | 自动/手动隔离、epoch、写后失败与排队测试通过，独立review缺口已补齐；App集成归T-06 |
| T-03 | B-106/REQ-02 / B-106/AC-02 | Memory bypass 删除、内置指南全链默认；Memory/Skills worker | T-01 | [x] | readiness、catalog/prompt/load_skill及未知ID拒绝测试通过；App集成归T-06 |
| T-04 | B-106/REQ-04 / B-106/REQ-07 / B-106/AC-04 / B-106/AC-05 | 独立 opt-in、旧 extraction consent 对齐与权限保全；integrator | T-01 | [x] | 独立选择、旧启用、paused+raw true与治理数据保护测试通过；UI重组仍归T-08 |
| T-05 | B-106/REQ-01 / B-106/REQ-02 / B-106/REQ-05 / B-106/AC-01 | P1 现有页面最小接线、删旧控件、新后台控制；同步三个 runner；integrator | T-02/T-03/T-04 | [x] | 新控件保存失败/重试和三个runner的source/tooling契约通过；App交互归T-06 |
| T-06 | B-106/AC-01 / B-106/AC-02 / B-106/AC-04 / B-106/AC-05 / B-106/AC-06 | P1 freeze→完整 gate→Desktop smoke→review/fix；一个 gate executor | T-05 | [x] | 完整gate、旧字段迁移/偏好保存、手动发现/Chat、Memory确认、真实回调修复及独立review通过；见Validation Log |
| T-07 | B-106/REQ-01 / B-106/AC-01 / B-106/AC-07 | 四组 registry、原生 details、旧深链/折叠偏好、局部刷新；Settings integrator | T-06 | [x] | 实现/focused/full/review及Desktop四组、精确深链、缺失目标与Pagelet局部刷新通过；移动阶段出口归T-12 |
| T-08 | B-106/REQ-04 / B-106/REQ-07 / B-106/REQ-08 / B-106/AC-04 / B-106/AC-06 / B-106/AC-07 | AI详情、长期学习、数据范围、Memory管理/恢复与保存反馈；integrator | T-07 | [x] | provider草稿、token显式/被动边界、独立权限、来源范围和Memory宿主UI通过；治理持久化复用focused/full，不迁移legacy；移动阶段出口归T-12 |
| T-09 | B-106/REQ-01 / B-106/REQ-03 / B-106/AC-01 / B-106/AC-03 | 使用/保存/Metadata/统计分层；复用Statistics现场tab；integrator | T-08 | [x] | focused/full/review及Desktop Metadata迟到回调保新草稿、统计切换重开、保存说明通过；移动阶段出口归T-12 |
| T-10 | B-106/REQ-03 / B-106/AC-03 / B-106/AC-07 | 图谱选项 Modal/现场入口及测试；graph worker，Plugin注册由integrator | T-07 | [x] | 20 focused tests及Plugin接缝通过；Desktop入口/取消/保存重开、当前leaf apply保缩放尺寸通过，原值已恢复；移动阶段出口归T-12 |
| T-11 | B-106/REQ-03 / B-106/AC-03 / B-106/AC-07 | 题图现场选项、编辑模式与不可变本次参数；featured-image worker，Plugin注册由integrator | T-07 | [x] | 36 focused tests及Plugin接缝通过；Desktop编辑/生成入口同面板、新选项可读、取消零调用通过，原值已恢复；移动阶段出口归T-12 |
| T-12 | B-106/REQ-01 / B-106/REQ-08 / B-106/AC-01 / B-106/AC-03 / B-106/AC-06 / B-106/AC-07 | P2 EN/ZH、a11y/CSS/生命周期→freeze→gate→Desktop/mobile simulator→review/fix；integrator + gate executor | T-09/T-10/T-11 | [x] | 中英文、独立review/fix、最终自动gate及Desktop UI-01..04、simulator UI-05/06通过；无新增iOS特有实现或必须真机风险 |
| T-13 | B-106/REQ-01 / B-106/REQ-02 / B-106/REQ-03 / B-106/REQ-04 / B-106/REQ-05 / B-106/REQ-06 / B-106/REQ-07 / B-106/REQ-08 / B-106/AC-01 / B-106/AC-02 / B-106/AC-03 / B-106/AC-04 / B-106/AC-05 / B-106/AC-06 / B-106/AC-07 | P3 最终契约、源码与证据核对；integrator + independent review | T-12 | [x] | 最终源码/契约独立核对无剩余问题，全部适用AC及产物证据可追溯，docs/diff通过；Validated不代替closeout/release |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

## Evidence Plan

先运行该 slice 最近的 suites；下列为最小风险证据分组，不表示每任务重复整组。
实际命令、自然退出、相关输入与产物身份在 Validation Log 记录；新增测试仅补未
覆盖风险，不为控件文字或字段映射的机械重复造测试。

| REQ/AC or risk | Change | Minimum sufficient evidence / command | Pass condition | Rerun / expansion trigger |
| --- | --- | --- | --- | --- |
| B-106/REQ-05 / B-106/AC-05；raw字段清理 | T-01 | `npm test -- --runInBand __tests__/settings.test.ts __tests__/pagelet-settings.test.ts __tests__/plugin-lifecycle.test.ts`；保护barrier时追加现有Memory migration/compatibility suites | 五旧键输出缺失、新键false保留、被保护sentinel不变；并发/失败不复活 | save/merge/provider事务/治理barrier改变，或fixture暴露冲突 |
| B-106/REQ-06 / B-106/AC-02；自动/手动隔离 | T-02 | `npm test -- --runInBand __tests__/pagelet-agent-quality-cache.test.ts __tests__/pagelet-agent-runtime.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/plugin-lifecycle.test.ts` | 自动pending/active取消；手动active/queued有效；过期epoch不得提交/交付；保存未完成/失败不得提前发布开启值 | scheduler/controller/trigger来源/identity/结果提交/偏好保存变化 |
| B-106/REQ-02 / B-106/AC-02；必要机制 | T-03 | `npm test -- --runInBand __tests__/memory-manager.test.ts __tests__/pa-agent-runtime-memory.test.ts __tests__/skill-context-provider.test.ts __tests__/pa-agent-host-tools.test.ts __tests__/pa-agent-runtime-prompt.test.ts __tests__/chat-view.test.ts` | 无技术bypass；能力/来源拒绝仍有效；catalog和加载一致 | Memory admission、guide registration或Chat投影变化 |
| B-106/REQ-04 / B-106/REQ-07 / B-106/AC-04；独立学习与权限 | T-04/T-08 | `npm test -- --runInBand __tests__/memory-extraction.test.ts __tests__/retrieval-habit-profile.test.ts __tests__/data-boundary.test.ts __tests__/memory-control-center.test.ts __tests__/settings.test.ts`，load迁移追加plugin-lifecycle | 00/10/01/11及停用/旧值保全；无授权零新增收集/写入 | consent、来源范围、治理操作、legacy启用迁移改变 |
| 验证器不依赖已废弃开关 | T-05 | `npm run test:tooling -- --runInBand __tests__/retrieval-smoke-runner.test.ts __tests__/context-continuity-smoke-runner-script.test.ts`；Pagelet runner增加定向现有契约/实际smoke证据；ChatService窄构造接缝补source测试 | fingerprint覆盖新偏好；synthetic模型输入无catalog/load_skill且继续拒绝无关工具；生产默认不变 | runner/执行输入列表/capability隔离/ChatService构造改变 |
| B-106/REQ-01 / B-106/REQ-08 / B-106/AC-01 / B-106/AC-06 / B-106/AC-07；四区和保存 | T-07/T-08 | Settings/Chat/Memory控件现有suite补关键DOM与异步case；Desktop真交互 | 草稿、keychain、pending target、失败重试、关闭late结果全部保持 | group registry、local renderer、token/provider保存或DOM生命周期改变 |
| B-106/REQ-03 / B-106/AC-03；专业能力保全 | T-09/T-10/T-11 | local-graph/statistics/ai-service/settings suites加新Modal行为测试；场景化Desktop验证 | 替代入口全部可达、合法值保留、取消零调用、生成只在显式动作之后 | 现场入口/apply/生成参数或provider兼容性变化 |
| B-106/AC-07；移动布局与交互 | T-12 | 当前产物Obsidian CLI mobile simulator：四组、折叠、文本编辑、精确记忆深链与焦点；通用保存/管理及token显式/被动边界复用Desktop | 移动布局、主要控件、文本与滚动/焦点可用；无状态丢失 | 相关资产/host/输入/布局改变；仅iOS本身强相关变化追加真机，不以simulator证明Keychain/软键盘特有行为 |
| P1/P2 phase gates | T-06/T-12 | 根AGENTS Local Validation Gate；冻结后`make deploy`；最终当前产物Desktop与最小mobile simulator。覆盖后不单跑重复lint/build/full | source/tooling/artifact正确分组；当前产物部署且适用交互通过；fresh错误无新增 | 阶段后任何相关source/test/config/fixture改变或新finding |
| D-18/D-19；真实宿主导航/跨窗口 | snapshot就绪后缺失目标重放；描述节点在Setting.descEl构建 | Settings定向RED→GREEN与独立review；一次最终`make deploy`；真窗口复验焦点rect在viewport、说明/链接可读 | pending加载不早判missing；重复missing最终滚动管理区；无`[object DocumentFragment]`且被动零save | snapshot/导航时序、宿主窗口/DOM描述改变 |

## Remaining Interaction Acceptance

以下六项记录 P2 交互验收；UI-01..04取得真实Desktop证据，UI-05..06取得mobile simulator证据。
Owner于2026-09-08明确调整验收：除iOS本身强相关变化外，默认使用Obsidian CLI
mobile simulator，跨端一致的通用功能不重复测。本轮复用Desktop保存/管理及
token证据，未改动的iOS Keychain/软键盘特有路径不追加真机。执行前复验当前
产物身份；复用P1迁移、后台暂停时手动发现/Chat，以及完整测试中的独立授权、
七个排除数组和并发矩阵。加载身份本身不代替simulator交互结果。

| Case | AC | Required observation | State |
| --- | --- | --- | --- |
| UI-01 Desktop导航/连接 | AC-01/03/07 | 四组、条件展开、中英文/键盘；Custom连接和模型可达；普通界面无技术控件；unknown token被动零读取，显式编辑可操作 | PASS：EN/ZH、Custom、显式token一次读取后取消；被动读取0 |
| UI-02 Desktop保存/草稿 | AC-04/05/07 | 本地习惯学习和一个来源排除代表项等待/失败/重开/重试，另一学习权限不变；Pagelet局部刷新保provider草稿；Metadata迟到保存保新表单 | PASS：权限/范围失败重试、provider同DOM草稿与Metadata旧回调均通过；基线恢复 |
| UI-03 Desktop Memory | AC-06/07 | 精确记录深链展开祖先，目标消失回管理，恢复深链进入system；一个合成记录管理动作局部刷新且保其它草稿；纠正/暂停/遗忘/当前恢复确认可达，昂贵动作可取消 | PASS：真实目标/恢复入口及D-18复验；合成卡片暂停/恢复、纠正取消、真实遗忘确认取消；不代表legacy治理持久化 |
| UI-04 Desktop现场选项 | AC-03/07 | Settings/命令同一图谱与题图Modal；取消不改值、保存重开保留；图谱应用保缩放/尺寸；题图读到新选项后取消零调用；统计切换重开保留 | PASS：图谱/题图/统计本轮实际交互通过，原值恢复 |
| UI-05 Mobile simulator布局/输入 | AC-03/07 | 当前产物身份；CLI mobile simulator四组、连接详情、折叠、文本编辑、滚动及主要按钮可达；token通用行为复用UI-01 | PASS：390×844，is-mobile/is-phone均true；原生四组菜单、折叠、连接输入与来源草稿/按钮可达，无横向溢出；被动token读取0 |
| UI-06 Mobile simulator深链/焦点 | AC-06/07 | simulator精确Memory深链展开定位，局部刷新后焦点/滚动正确；保存失败→重开→重试和草稿保留复用UI-02/03 | PASS：真实既有目标article聚焦、祖先展开、rect292.10..611.30在844视口内；局部刷新保同DOM来源草稿，live/durable范围均[] |

不新增真实图片生成或重复provider案例；若这些交互暴露实际缺陷，按受影响输入
修复、重跑和重新部署，再继续相应验收。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| D-01 | P1 | 现有旧总开关关闭会reset scheduler并取消显式请求 | 新后台偏好不入全局identity，automatic lane定向暂停与epoch | T-02竞态测试及独立review、T-06 App通过 | 已实现并验证 |
| D-02 | P1 | merge先丢旧键会令迁移无法观察需写回；陈旧snapshot可重新写入 | raw存在性pending + 保存前精确strip，不全量merge | T-01 raw/load/save/conflict与barrier、T-06 App通过 | 已实现并验证 |
| D-03 | P2 | 图谱/题图没有完整PA现场配置入口，直接移除会丢能力 | 先新Modal/入口，再删除原行；统计已有tabs直接复用 | Modal与实际Plugin接缝focused/full、Desktop现场入口通过 | 已实现并通过Desktop验证 |
| D-04 | P1 | raw extraction=true可能覆盖显式paused/unconfirmed并重新授权 | 对齐合法legacy启用与显式consent优先级，00/10/01/11独立 | T-04 loader/consent及保护sentinel、T-06 App通过 | 已实现并验证 |
| D-05 | P2 | 普通debouncedSave失败只有日志，Memory动作仍全量display丢其他草稿 | 受影响区域失败反馈/重试，管理局部refresh | T-08异步失败/关闭/草稿focused/full；Desktop失败重试及合成Memory动作保同DOM草稿通过 | 已实现并通过Desktop验证 |
| D-06 | P2 | 三个现有runner依赖废弃字段，continuity probe以Skills开关隔离 | P1同步runner，保持isolated host拒绝行为 | T-05 tooling与完整测试、T-06相关App通过 | 已实现并验证 |
| D-07 | P2 | 仅deny工具不能避免bundled catalog影响continuity输入，ChatService无透传接缝 | 提取私有实例createAgentRuntime；隔离service包装传null，生产不变 | T-05实际离线模型输入、catalog/load_skill与拒绝测试通过 | 已实现并验证隔离契约 |
| D-08 | P2 | 有效保存建议提示和分钟节流的去向不明确 | 明列operationsProactiveSaveSuggestionsEnabled有效入口；cooldown作为内部数值保留 | T-09提示保留focused/full、独立review及Desktop分层检查通过 | 已实现并通过Desktop验证 |
| D-09 | P2 | 图谱apply不能覆盖类型/尺寸，保存失败与应用失败未区分 | 草稿/取消明确；保存后即时apply可用字段，类型/尺寸下次打开 | T-10保存/应用失败/重开focused/full、独立review；Desktop apply保缩放/尺寸与重开通过 | 已实现并通过Desktop验证 |
| D-10 | P2 | 题图多次await重新读全局参数，现有helper不接收快照 | 只读RunOptions贯穿原helper/service，连接revision/currentness复验 | T-11参数/currentness由focused/full及SDK mock验证；Desktop配置/读取新选项/取消零调用通过 | 已实现并验证；未新增真实图片生成 |
| D-11 | P1 | 现有窄保存helper先改live值，保存失败前可能意外开启自动调用 | 专用setter用queued snapshot保存，成功才publish新字段并sync自动lane | T-02延迟/写前与写后失败/多次排队、T-06 App通过 | 已实现并验证 |
| D-12 | P2 | Obsidian Toggle.setValue改变值时同步回调；finally先清saving导致一次点击重复提交并提前解除busy | 还原committed控件值和disabled状态时维持重入保护，随后才清saving；测试stub覆盖真实回调语义 | 定向RED→GREEN、84 tests、独立review、完整gate及重部署单击calls=[false]通过 | 已修复并验证 |
| D-13 | P2 | 权限保存期间hide/display，新控件停留旧值且恢复可点 | 用稳定字段key保留tab级pending和当前binding；提交结束局部同步当前控件，不全量display | deferred/重入回归；Desktop本地习惯pending重开禁用、失败保false、重试true后恢复false，另一学习权限不变 | 已修复并通过Desktop验证 |
| D-14 | P2 | Memory升级/回滚只刷新管理快照，旧自动接受控件与治理模式不一致 | 治理动作完成后仅重建Memory偏好子区域，保留其它草稿 | 升级/回滚有效入口由focused/full及独立review验证；Desktop仅验证管理局部刷新，未为验收迁移legacy | 已修复；保留治理事务与宿主UI证据边界 |
| D-15 | P2 | Metadata添加/删除的旧保存回调会重建重开后或同container局部重绘后的新表单，覆盖草稿 | 捕获generation、container与metadata render revision；Add成功且输入未变才清理，失败同项重试不重复添加 | 重开/同容器RED→GREEN；Desktop真实Add挂起后重开输入新草稿，旧保存完成不替换两个输入DOM或草稿 | 已修复并通过Desktop验证；合成规则未落盘 |
| D-16 | P1 | 全局、Memory及Pagelet排除文本在保存完成前直接修改live；同类Metadata排除扩大自动写范围，审计保留期也提前生效 | 七个排除数组保留文本草稿，通过明确保存提交窄snapshot，成功后发布；保留期走离散窄事务；失败保留原有效范围和重试 | 七数组及保留期由focused/full验证；Desktop代表范围pending/失败/重开草稿/重试通过，基线恢复 | 已修复并通过Desktop代表路径验证 |
| D-17 | 排除 | 检查旧Memory自动接纳setter的fallback曾疑似提前发布 | 实际Settings仅在bootstrap ready且legacy_threshold时显示；该分支原本通过治理事务保存后发布，未就绪fallback不可从当前UI到达 | 核对getMemoryGovernanceUiMode与真实ready分支；撤回不必要fallback改动 | 无当前UI问题；不扩大修复 |
| D-18 | P2 | 缺失Memory记录从关闭的Settings打开后，焦点留管理区但Plugin延迟重放把滚动拉回父组，目标落在viewport之外 | 当前快照成功渲染后可立即判missing；加载/重开/刷新期间继续pending，保留Plugin挂载重放 | 4条RED→GREEN；最终产物Desktop summary top342.875/bottom386.875位于viewport700内，pending=null | 已修复并通过最终Desktop复验 |
| D-19 | P2 | 独立Settings窗口的File Format说明显示`[object DocumentFragment]`；同类Metadata描述/名称存在相同跨realm风险 | 两处富文本直接在Setting.descEl创建p/a；三个纯文本名称用string，不改全局helper | foreign Fragment精确RED→GREEN；最终产物独立窗口两处富文本、Metadata名称及链接实际可读 | 已修复并通过最终Desktop复验 |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-08 | B-106 全范围设计 | 三路只读源码核对：字段/调度、UI/现场入口、权限契约；核对HEAD与工作区 | 设计输入已取得 | 只读事实与Proposed接口明确区分；尚未验证运行时 |
| 2026-09-08 | B-106 全范围设计 | 三路独立设计review及修订复核：运行/保存边界、UI/现场入口、产品契约/任务覆盖 | PASS；无未处理设计P0/P1/P2 | D-01..11均有设计处理及实施验证目标；不代表代码修复或运行时PASS |
| 2026-09-08 | B-106 全范围设计 | `npm run docs:check`；`git diff --check` | PASS；均自然退出0 | 198 Markdown / 1626 local links；4项既有episodic-memory索引/孤立文档提示保持advisory。工作区仅文档改动，未执行runtime测试、build或App/device smoke |
| 2026-09-08 | T-01/T-02/T-04/T-05 | `npm test -- --runInBand __tests__/settings.test.ts __tests__/pagelet-settings.test.ts __tests__/plugin-lifecycle.test.ts` | PASS；3 suites / 361 tests，自然退出0 | 最终补齐写后readback失败、连续setter、关开snapshot、UI保存失败重试；随后仅测试参数类型注解修正，生产输入不变 |
| 2026-09-08 | T-02 | `npm test -- --runInBand __tests__/pagelet-agent-quality-cache.test.ts __tests__/pagelet-agent-runtime.test.ts __tests__/pagelet-orchestrator.test.ts __tests__/pagelet-background-preparation-coordinator.test.ts` | PASS；4 suites / 331 tests，自然退出0 | 自动/手动隔离、cache-hit/fresh commit/交付epoch、已发生调用metrics、旧管线停用；独立review无P0/P1/P2 |
| 2026-09-08 | T-03 | Tracker指定6个Memory/Skills/Chat focused suites | PASS；397 tests | Memory最终54/54、其余5 suites 343/343；两处新增fixture类型已修正，Memory重跑54/54自然退出0；生产输入未变 |
| 2026-09-08 | T-05 | ChatService source + continuity/Pagelet/retrieval tooling | PASS；63 + 18 + 438 tests | 正确source/tooling分组；实际离线模型请求证明catalog/load_skill隔离与正常生产默认，拒绝工具仍有效；各对应最终suite自然退出0 |
| 2026-09-08 | P1 gate | `make deploy`（日志 `/private/tmp/b106-p1-deploy.log`） | Lint/build PASS；全测FAIL，尚未部署 | 240 suites中239 PASS；6274 tests中41失败均在plugin-record-note的旧整模块mock/旧断言。测试报告后异步等待最终自行结束，make自然退出2；未修改生产代码来满足旧checker |
| 2026-09-08 | P1 DOM源约束 | 根AGENTS的`rg`禁用DOM注入扫描；`git diff --check` | PASS；分别自然退出1无匹配 / 0 | 当前冻结source无runtime style/HTML注入；不是Hosted Community或App证据 |
| 2026-09-08 | P1 fixture修复 | `npm test -- --runInBand __tests__/plugin-record-note.test.ts` | PASS；320 tests，自然退出0 | 整模块mock接入真实纯清理函数并更新scheduler stub；旧preload断言改为零调用/零配额，保留前台通知与保存断言；仅测试文件改变 |
| 2026-09-08 | P1完整测试与类型检查 | `npm run test:all -- --runInBand`；`npx tsc -noEmit -skipLibCheck` | PASS；240 suites / 6275 tests；两命令均自然退出0 | 日志 `/private/tmp/b106-p1-all-final.log`；Jest报告后曾提示异步操作未退出，随后自行退出0，未使用forceExit。复用前次lint/build的相同生产输入；未部署或宣称App/device通过 |
| 2026-09-08 | T-06 部署与加载身份 | `make deploy-current`；test plugin disable/enable；`getLoadedPluginBuildIdentity()`；dist/安装main.js SHA-256比对 | PASS；历史P1输入 | Obsidian 1.14.0；该次安装manifest为2.10.0-beta.5，不能以版本号代替源码身份。当次工具输出确认加载/dist/安装hash一致；该历史构建随后由D-12修复产物替换，不引用滚动Current Snapshot作为旧身份 |
| 2026-09-08 | T-06 / B-106/AC-05 | test插件停用后备份data.json，仅加入五个旧关闭字段并删除新后台键，再启用当前产物 | PASS | live与落盘均无五旧键，新后台true；provider/model/token相关字段、Memory策略/consent、本地学习、全局与Memory排除、联网/写入/audit sentinel全部保持原值。备份仅在 `/private/tmp/b106-p1-before-migration.json`，不将内容入库 |
| 2026-09-08 | T-06 / B-106/AC-02 / B-106/AC-07 | 独立Settings窗口真实点击后台开关；限定一次后台开启保存的延迟/拒绝注入；真实重试 | PASS：保存false，等待期间live保持false，失败显示旧值保留/重试，重试成功true，再关回false | 已恢复原saveSettingsData方法；live/durable一致。原生input.disabled属性不足以代表Obsidian Toggle禁用语义，不据此宣称禁用状态已完整验证。窗口显示延迟经关闭调试并重开恢复；随后滚动和控件视觉一致 |
| 2026-09-08 | T-06 / B-106/AC-06 | Chat状态按钮→Update Memory search→查看确认→Cancel | PASS：当前lexical更新状态对应仅本机处理说明，显示134 notes；取消不执行更新 | 该确认明确不修改笔记、不发AI请求、不耗额度；这是当前实际状态证据，不代替远端重建或整个Memory状态矩阵 |
| 2026-09-08 | T-06 手动发现与模型环境 | 背景false时，从真实命令面板执行Discover connections，anchor=`pagelet-smoke-golden.md` | 未完成：现有模型支持限制 | Owner已授权test合成数据经DashScope/qwen3.8-max做必要发现/Chat；调用前后usage均0、无controller run；既有白名单不含qwen3.8。临时模型切换被自动审批拒绝，已明确请求qwen3.6-plus测试并恢复；没有绕过原生工具能力gate |
| 2026-09-08 | T-06 / D-12 | 读取当前宿主Toggle行为；为实例setter记录调用次数后真实单击背景开启 | FAIL：一次点击产生[true,true]两次保存请求 | Obsidian Toggle.setDisabled通过组件disabled和is-disabled类生效，故内部input.disabled=false不是问题；真实缺陷是setValue同步changeCallback重入。计数插桩已恢复，修复由Pagelet worker负责，root统一重跑受影响gate |
| 2026-09-08 | T-06 / D-12 | focused RED→GREEN；Pagelet Settings 84 tests；独立只读review；`make deploy`（`/private/tmp/b106-p1-callback-deploy.log`） | PASS；240 suites / 6277 tests、lint/build，自然退出0 | 该P1产物已reload，loaded/dist/install hash均62228eda7673c41be4275d2e7643f173ae7a671392260a5bdfd9228310bb90b9，load时间2026-09-08T01:23:18.285Z；真实单击后台关闭calls=[false]、live/durable false，五旧键仍缺失；插桩已恢复 |
| 2026-09-08 | T-06 / B-106/AC-02 | Owner授权临时qwen3.6-plus；后台false，真实命令面板Discover connections；新Chat最小算术问答 | PASS：显式发现verified、引用完整、一个结果真实可见；Chat回复Two plus three equals five | run `pagelet-run:mtrzlngw:1:1`，12 model turns / 19 tools，一次cache提交/一份delivery receipt；未点击保存笔记。使用test合成笔记；测试后原qwen3.8-max已成功恢复，后台仍暂停 |
| 2026-09-08 | T-09..11 | 图谱Modal/LocalGraph、题图Modal/AI service、Statistics focused suites | PASS：分别20 / 36 / 11 tests，自然退出0 | 覆盖草稿/保存失败、无leaf无额外副作用、当前图谱局部apply、题图真实SDK mock传输前后身份检查与取消零调用、统计重试/旧结果隔离；各worker输入已冻结 |
| 2026-09-08 | T-08..11接缝 | `npm test -- --runInBand __tests__/plugin-lifecycle.test.ts`；`__tests__/plugin-record-note.test.ts` | PASS：99 / 320 tests，自然退出0 | 新Plugin事务与实际命令接线通过；来源数组扩展后plugin-lifecycle须重跑。Settings UI适配与D-13..16验证尚在进行，未宣称P2整体通过 |
| 2026-09-08 | T-07/T-08/T-09 / D-13..16 | `npm test -- --runInBand __tests__/settings.test.ts`；`__tests__/pagelet-settings.test.ts`；独立方法级复核 | PASS：223 / 93 tests，自然退出0 | 四组与旧深链/折叠、单快照双区域、provider草稿、权限确认/反重入/重开、七字段来源草稿/失败、Metadata迟到保存、治理模式局部刷新均覆盖；D-13额外真实方法probe成功/失败均单次提交，新控件与live一致 |
| 2026-09-08 | T-08 / D-16 | 扩展Plugin来源范围事务集成测试 | PASS：plugin-lifecycle 100 tests，自然退出0 | 七数组等待/失败不放宽、patch调用者修改隔离、执行时快照与并发其它字段保留通过；随后D-17 setter修复追加验证中 |
| 2026-09-08 | P2 current docs | `npm run docs:check`；`npm run test:docs -- --runInBand` | PASS：198 Markdown / 1632 links；2 suites / 58 tests，均自然退出0 | 4项既有episodic文档advisory保持；更新Settings状态入口、Memory/隐私路径及旧Pagelet开关的scoped successor。未以文档状态替代App验收 |
| 2026-09-08 | D-15最终输入 / D-17排除 | Settings 224 tests；同container竞态定向内存RED；核对真实治理UI admission | PASS：正常源码224 GREEN；移除revision保护后目标case精确FAIL | 临时transformer仅在/private/tmp且未改repo配置；D-17 fallback不在当前Settings可达路径，正常ready分支原本保存后发布，撤回额外setter改动 |
| 2026-09-08 | P2独立收束 | Plugin lifecycle最终101 tests；D-15真实方法复验；current docs三处历史边界修正及复核 | PASS；无剩余已确认P1/P2，101 tests自然退出0 | 局部表单first-save确实重绘，second旧回调保留新draft；来源/权限/接缝通过。Memory历史设备证据不外推到B-106，旧generic preload限定历史，schema删除已不存在periodicSummaryScope |
| 2026-09-08 | P2完整gate首轮 | `make deploy`（`/private/tmp/b106-p2-deploy.log`） | lint/build/TypeScript PASS；full 241/242 suites、6370/6371 tests，make自然退出2，未部署 | 唯一失败为Pagelet用量命令旧精确文案断言仍含model turns/tool calls；冻结输入未被并行修改，只有构建生成styles.css。未为旧断言改产品行为 |
| 2026-09-08 | P2最终自动gate | 修正单条用量文案断言；orchestrator focused；`npm run test:all -- --runInBand`（`/private/tmp/b106-p2-all-final.log`） | PASS：focused154；full242 suites / 6371 tests，98.376s，均自然退出0 | 保留getUsage单次调用与旧limiter零调用断言；仅测试字面量与文档改变，复用前次相同source/config/dependencies的lint/build。Jest异步告警后自然退出，未forceExit；最终输入diff hash（除生成styles.css）为f05930783db32b6b6c7631546086d7d6b3e84150cef2c95ef8e7e0297b025800 |
| 2026-09-08 | P2产物与加载 | `make deploy-current`；test plugin reload；await `getLoadedPluginBuildIdentity()`；canonical状态只读核对 | PASS：当次产物已加载，blocker=null；后由D-18/D-19产物替换 | 当次loaded/dist/install main.js SHA-256均e2778b527360d03ee1e2098a8be8692aed4543826d8b6423d47a1a68ba2e8352，load时间2026-09-08T02:14:31.486Z；styles.css SHA-256为664a4684d2f274dd8b3e95f5870301ea5aae44c05f22792bff2cd69753b5c8d6。五旧键无、后台false、原模型恢复、token cache unknown；未读取token正文 |
| 2026-09-08 | T-12真实交互 | CUA连接Obsidian，计划后续Desktop与iOS路径 | BLOCKED：Mac锁定，自动解锁失败；已请求手动解锁 | 没有把CLI加载身份或source测试算作真实UI/触摸证据；尚未进行本轮iCloud部署，P2/AC-07与T-13保持未完成 |
| 2026-09-08 | P3文档准备 | `npm run docs:check`（最终契约输入）；独立相对链接与历史边界复核 | PASS：198 Markdown / 1634 links，自然退出0 | 4项既有episodic提示仍advisory；此后仅Tracker补本次已观察证据，未变更运行契约 |
| 2026-09-08 | 恢复执行前核对 | 读取Feature Home/Tracker与Git；只读调用production build provenance checker，比较dist/安装hash；CUA重新连接Obsidian | 构建复用PASS；真实交互仍BLOCKED | 当前source与生产构建身份一致、blockers=[]，styles/两个manifest辅助资产匹配；main/style安装hash不变。Mac仍锁定且自动解锁失败，未重复部署/build/tests；将剩余交互收束为UI-01..06 |
| 2026-09-08 | D-18/D-19最终自动gate | `make deploy`（`/private/tmp/b106-p2-ui-fixes-deploy.log`）；修正新增fixture字段后build与full Jest | 首轮lint PASS、TypeScript FAIL；仅补fixture的`t: 'string'`后build PASS，full242 suites / 6376 tests，100.918s自然退出0 | 首轮未部署；修正未改变生产源码，复用已通过lint。最终日志为`/private/tmp/b106-p2-ui-fixes-build.log`与`/private/tmp/b106-p2-ui-fixes-all.log`；未放宽类型或生产契约来满足fixture |
| 2026-09-08 | 最终文档与DOM源约束 | `npm run docs:check`（`/private/tmp/b106-p2-ui-fixes-docs.log`）；diff check与禁用DOM注入扫描 | PASS：198 Markdown / 1634 links，4项既有advisory；diff/DOM scan PASS | 此后Tracker仅记录已观察证据与Owner新验收决定；本次文档编辑的最终检查由integrator统一执行 |
| 2026-09-08 | D-18/D-19最终部署身份 | `make deploy-current`（`/private/tmp/b106-p2-ui-fixes-deploy-current.log`）；test reload与loaded/dist/install比对 | PASS：最终产物已加载 | main.js SHA-256为2f16a6ac541af8375ed0592c8311faf63599004366a523233e3f1beb152830e7；load时间2026-09-08T13:57:42.963Z；styles.css SHA-256为664a4684d2f274dd8b3e95f5870301ea5aae44c05f22792bff2cd69753b5c8d6 |
| 2026-09-08 | UI-01 / D-19；AC-01/03/07 | 最终Desktop英文四组/Custom/token显式编辑取消；中文主窗口四标签与Metadata键盘输入；独立窗口富文本/名称检查 | PASS：显式token读取1次、被动读取0；两处富文本、Metadata标签及链接可读 | 未将token正文记录为证据；语言与corePopout恢复。独立窗口不再出现`[object DocumentFragment]` |
| 2026-09-08 | UI-02 / D-13/D-16；AC-04/05/07 | 本地习惯与一个合成来源排除的pending→失败→重开→重试；Pagelet/Memory局部刷新期间保留被拒绝的provider草稿 | PASS：习惯pending重开禁用、失败仍false、重试true后恢复false，extraction始终true；范围草稿保留且重试成功后恢复基线[]；provider草稿与DOM保持 | 不重复七数组/独立授权矩阵，复用focused/full；所有临时保存接缝已恢复 |
| 2026-09-08 | UI-02 / D-15；AC-07 | 真实Metadata Add合成key，限定一次内存save hold；关闭重开输入`b106-new-draft` / `keep after old callback`，再release旧save | PASS：旧回调完成后两个输入sameDOM均true，新草稿实际可见且保留 | 仅验证真实宿主控件/迟到回调，合成规则未写盘；metadata=false、基线规则live/durable均恢复，vault modify=0 |
| 2026-09-08 | UI-03 / D-18；AC-06/07 | 现有17条真实记录中的精确目标深链、恢复route；最终产物缺失目标回管理区 | PASS：精确目标及system恢复入口可达；缺失目标summary top342.875/bottom386.875、viewport700、pending=null | 当前恢复确认与Cancel复用P1实际证据；缺失目标焦点/滚动由最终产物复验，不复用修复前失败结果 |
| 2026-09-08 | UI-03合成宿主卡片；AC-06/07 | 唯一内存卡片真实pause→resume、纠正editor取消；forget调用真实`forgetGovernedMemory`展示永久遗忘确认后Cancel | PASS：calls为[pause_use,resume_use,forget]；Metadata草稿与DOM保留；清理后17条真实item不变 | snapshot副本追加卡片，pause/resume仅改临时内存；`runGovernedMemoryLifecycleAction`的exact-ID guard未触发。未改legacy治理模式/confirmed计数，不证明治理持久化；该层复用focused/full |
| 2026-09-08 | UI-04；AC-03/07 | 实际Settings/命令打开图谱、题图现场面板；取消、保存重开；图谱局部apply；统计切换重开 | PASS：图谱保缩放/尺寸，题图读到新选项后取消零调用，统计选择保留；原值恢复 | 未新增真实图片生成；图谱输入曾发生追加文本，校正输入后验收，不误记为depth反馈循环或调整既有上限 |
| 2026-09-08 | Desktop清理与边界 | 核对临时方法、语言、corePopout、设置基线及笔记修改计数 | PASS：临时方法/语言/corePopout恢复均true，笔记修改0，token被动读取0 | 原模型qwen3.8-max恢复；后台仍false，未擅自恢复先前被自动审批拒绝的开启操作；合成卡片及Metadata规则不留存 |
| 2026-09-08 | Owner移动验收决策 | Owner明确真机成本高：除iOS本身强相关外默认Obsidian CLI mobile simulator，跨端一致功能不重复测 | 决策已确认并替换此前T-12/UI-05/UI-06强制real-iOS门槛；simulator尚待验证 | 本轮最小验证移动布局/折叠/文本/深链焦点；保存与管理复用Desktop。未改变的iOS Keychain/软键盘特有行为不重复测，也不宣称已验证；Spec/SDD/Plan由integrator同步 |
| 2026-09-08 | UI-05/06 simulator产物 | `obsidian vault=test dev:mobile on`；`dev:cdp method=Emulation.setDeviceMetricsOverride`，width390/height844/deviceScaleFactor1/mobile=true；loaded identity | PASS：is-mobile/is-phone均true，viewport390×844，同最终main.js hash，blocker=null | simulator load时间2026-09-08T14:31:11.484Z；不增加iCloud部署，不宣称真实iOS Keychain/原生软键盘/WKWebView行为已验证 |
| 2026-09-08 | UI-05；AC-01/03/07 | CUA原生点击折叠AI组、四组下拉菜单选择高级/隐私；连接模型输入聚焦、来源输入粘贴草稿 | PASS：最终高级导航4/4，summary位于sticky导航下；Custom模型可达，草稿与Save scope按钮实际可见；容器scrollWidth/clientWidth均390 | 未提交合成来源草稿，live/durable excludedFolders均[]；平滑滚动落定后核对位置，没有把中间帧当缺陷；token被动读取0 |
| 2026-09-08 | UI-06；AC-06/07 | `openMemorySettings`精确既有合成来源记录；Memory局部刷新与同目标定位；实际截图、DOM焦点及草稿核对 | PASS：target为user-profile:profile-46322ab7530fa8f206bd050bef0002dc，ARTICLE聚焦，祖先均展开，rect top292.1015625/bottom611.296875；局部刷新保同输入DOM及b106-mobile-draft | 完整重开可更换DOM而草稿保留；局部刷新保持同DOM。通用保存失败/重开/重试复用Desktop，不新增provider调用 |
| 2026-09-08 | simulator清理与错误 | `dev:errors`；恢复token方法、关闭Settings；`Emulation.clearDeviceMetricsOverride`；`dev:mobile off`后只读状态 | PASS：No errors captured；mobile/phone=false，viewport1865×1050，corePopout=true，插桩无残留，来源范围live/durable=[]，metadata=false、background=false | 恢复桌面后仍同最终main.js hash，load时间2026-09-08T14:39:51.577Z；未提交来源草稿随重载清理 |
| 2026-09-08 | T-13独立契约/风险核对 | 只读核对REQ-01..08、AC-01..07、最终源码/SDD及Owner移动验收决定 | PASS：无未满足源码REQ/AC，无新增需真机的iOS特有实现或已确认风险 | AC-01/02/05复用P1迁移/真实Chat与发现和最终回归；AC-03/04/06对应UI-01..04与事务suite；AC-07对应Desktop异步/跨窗口与UI-05/06。最终docs/diff检查另记 |
| 2026-09-08 | T-13最终文档 | `npm run docs:check`；`git diff --check` | PASS：198 Markdown / 1634 links，自然退出0；diff无问题 | 4项既有episodic文档advisory不变；本轮新增验收决定已同步Plan/SDD，Tracker为唯一交付状态。运行源码/测试/依赖在最终自动gate后未改变，无需重复build/full tests |

## Closeout Readiness

- [x] Owning contract 与最终实际行为一致。
- [x] Required source/tooling/full gates、review 与 Desktop/mobile simulator evidence 已记录。
- [x] 无未处理 P0/P1/P2；适用验收项已完成。
- [x] 稳定结果吸收到 current contracts/tests。
- [ ] 在独立 closeout 授权后处置过程文档；不把设计/Validated 当发布。
