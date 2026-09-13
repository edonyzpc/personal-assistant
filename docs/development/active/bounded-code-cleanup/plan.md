# 有界代码清理方案

Document status: Approved
Updated: 2026-09-13
Work item: B-136
Authority: 清理清单、执行顺序、证据门、风险和停止边界；产品取舍见 DEC-035。
Product spec: [Bounded Cleanup Product Spec](../../../product/specs/pa-bounded-code-cleanup-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## 目标与尺度

此次做两件事：清除已证明没有生产作用的代码及其专用依赖；完成已确认的旧
Pagelet 范围控件退役。其余有效行为保持不变。完成标准是清理闭环和保留功能可信，
不以删除量、bundle 降幅或“大文件变小”为指标。

分析基线为 `ec22499c`、生产代码无未提交变化，排除 `test/` vault。
此前消融是内存中的 source 改写与构建实验，没有修改仓库；不等于 Jest 或真实
Obsidian 验收。实施时只复核发生变化或证据缺失的部分，不重新做全库调查。

## 必做清单

下表是有限清单。普通死代码候选在当前输入上复核生产入口与保留契约，发现活消费者
则保留并说明原因。**C-06 是例外：旧控件本身生产可达，按 DEC-035 的明确产品授权
退役；其下游只删除专用依赖，仍有其他保留消费者的部分继续保留。**相关测试不是
排除范围：可以适配退役契约，但不能删掉保留行为的断言来让检查变绿。

| ID / 阶段 | 清理目标与源码入口 | 完整删除边界 | 必须保留 |
| --- | --- | --- | --- |
| C-01 / P1 | `src/ai-services/append-tool-provider.ts`、`selection-tool-provider.ts` | 无生产注册的旧 provider 及独占 import/type/export | 当前 Operations 工具和权限控制，不按 append/selection 名称清退其它实现 |
| C-02 / P1 | `src/ai.ts` 的 `AssistantRobot` → `src/ai-services/service.ts` 的 `generateTags/getTagsPrompt`；`src/utils.ts` 的 `TEST_TOKEN` | 这条不可达类/方法/常量闭包及专用引用 | `src/ai.ts` 中仍用的 summarize/featured-image 等实现，不整文件删除 |
| C-03 / P1 | `chat-tool-registry.ts` 的 `cloneInputSchema`；`memory-search-tool.ts` 的私有 `rerankCandidates`；`vss/vss-core.ts` 的 `computeFileHash` | 已核对无调用的具体函数与独占 import | `capability-adapter.ts` 的活跃 clone、当前 reranker/hybrid 检索与 hash/索引写入路径 |
| C-04 / P1 | `src/chat/image-macos-converter.ts`；`src/ai-services/source-store.ts` 的未使用 `SourceStore` 类 | 旧转换器；仅类、类专用复制/标签 helper/type | 当前图片原字节、缓存/恢复/格式行为；`normalizeSourceRecord`、`sanitizeWebSourceUrl`、`createSourceDedupKey` 继续服务 Web 来源 |
| C-05 / P1 | `src/pagelet/ui/mascot/` 四个旧模块及 barrel；`pet/PetAnimations.css`；`src/custom.pcss` 旧 mascot 规则 | 退役模块、只为其服务的 export、选择器/动画；检查 Tailwind content 扫描结果再删重复 CSS 文件 | 当前 `PetView/PetSvg`、Bubble、Action Ring，尤其同一 media block 内仍用的 reduced-motion 规则 |
| C-06 / P2 | `pagelet/panel/PanelView.ts` → `AnalysisSessionManager.ts` → `orchestrator.ts` 的旧范围选择链 | current/yesterday/last3/last7、逐笔记勾选、Review selected 语义、专用 callback/state/type、为该控件进行的扫描、独占 CSS/i18n；沿用现有显式 Deep Discover 动作，不新建选择器 | `open-panel` 仅打开；实际 Deep Discover、旧命令 ID/名称/别名、全局排除、来源/上下文展示、Panel/Tab、正常 Review 保存 |
| C-07 / P2 | `orchestrator.ts` 的 `runLegacyQuietRecall`、`runLegacyScopeRecap`、`reviewSelectedScopeLegacy`、`analyzeCurrentNote`、`discoverLegacyConnections`、`scheduleQuietRecallAfterLeafChange`；`BackgroundPreparationCoordinator.ts` | 六个已不可达入口和仅被它们触达的旧准备/发现私有方法；孤立后台 coordinator 及确证专用的接线 | 通用 Quiet Recall/Scope Recap 服务不能整条删；`ScopeResolver`、前台 `PreloadBudget`、provider admission、合法本地解释/重试/恢复继续保留 |
| C-08 / P2 | `plugin.ts` 的 `cacheVectors/isVssCached`、`acquireQuietRecallRoundAdmission`；`PetView.startQuickCaptureHold` | 具体无生产调用的成员及独占赋值/import；检查 app probe/生命周期是否依赖 | 当前 VSS 操作队列、`reserveQuietRecallProviderCall` 及其共享时间/队列状态、当前长按 Capture/Action Ring 行为 |

普通死代码闭包必须从真实入口向内证明，不能任意删父方法再声称子方法无用。
C-06 则以已授权的活入口退役为起点，证明其依赖没有其它保留消费者后随删。
相互递归而没有根的准备链也应纳入核对；活跃公共服务不随私有旧入口一起移除。
局部文件/类型仍有保留消费者时继续保留，避免空壳或追删到相邻功能。

## 有证据才顺带做的有限清单

这些项目可随最近的阶段处理，不开第三轮扫库。满足右栏才执行，否则记录保留原因。

| ID / 阶段 | 候选 | 准入条件与停止点 |
| --- | --- | --- |
| S-01 / P1 | `modal.ts` / `batch-modal.ts` 仅 push 的 enabled/disabled 数组；Updater 只增不读计数；`plugin.ts` 重复 repository 字段；`RecordList` 未使用 props | 逐个核对无读取、反射、生命周期或副作用；只删写入和声明，不改实际插件列表、更新流程或 repository 工厂 |
| S-02 / P1 | Chat history manager/store 与 PA Agent history 的 `cloneSourceRecord` | 三处复制语义确实相同则复用一个普通 helper；保留 metadata 的原有复制深度。不得合并整套 trace/context clone，不改变带 `memoryClaimId` 时的来源隐私裁剪 |
| S-03 / P1 | `extraction-scheduler.ts` 的 `typeCWritePath` 死分支；`maintenanceReview.weeklyScanEnabled` 无效传递 | 构造点/配置输入仍证明分支不可达或参数无效，且不影响旧数据读取时，只移除无效接线。保留 Type C 内存洞察、viewer、Type A 治理和 Maintenance proposal 生成；不批量清理持久化字段 |
| S-04 / P1 | `package.json` 的直接 `@langchain/textsplitters` 依赖 | 分别查 source、Worker、scripts、Jest、工具/打包入口；全部不用才删除，若仅测试需要则评估是否移至 dev。lockfile/notice 只做对应变更，不升级其他依赖 |
| S-05 / P2 | 仅供退役范围/旧准备链使用的 PreloadEngine/cache/change-detector 实例；ReviewNoteSaveFlow 的 pending summary 分支 | 证明无生产写入/触发及历史恢复消费者后删除专用部分；正常 findings 保存继续有效。不能因为 pending 当前为 null 就跳过恢复/反射入口核查 |

这里不承诺删除所有 optional 参数、导出 API 或 TypeScript unused 报告中的条目。
若小复用需要新的跨模块生命周期、格式迁移或行为设计，退出此次范围。

## 明确保留与延期

| 保留/延期项 | 本次边界与重启条件 |
| --- | --- |
| 插件/主题管理、批量开关、LocalGraph、Callout | 保留功能；可删除其内部已证明无效的局部变量，不删除命令或能力 |
| Statistics | 保留展示、相关依赖及现有采集行为；历史清理/compaction 仍归 B-110，需实际增长证据与独立授权 |
| Share Card | 保留当前导出、`source-han-serif-sc-subset.woff2`、字体注册/嵌入与许可证/相关资源。字体实际参与导出，不是死资产 |
| Records Preview 与旧录记/日期笔记命令 | 暂不统一；RecordList embed 路径解析复用也另做，需要重名、相对链接等明确行为验证 |
| VSS 公共旧接口和 fallback 参数；weeklyReview 持久化兼容字段 | 此次不以 source 零调用或总传 false 直接删除。需要单独证明公开调用、脚本及历史兼容；Weekly Review 延期边界继续见 B-116 |
| SuggestionCard → ResearchManager / draft 链 | 尚缺完整 producer、历史结果和消费者证据，暂留；不能由旧 provider 入口消失直接推导整个功能可删 |
| plugin/settings/chat/VSS 大类拆分 | 归 B-105，基于具体维护问题独立切片；本次不搬家、不建新的通用框架 |
| 历史 reader、迁移、恢复、权限/预算和异步队列 | 保留；“legacy”不等于无用。SQLite Worker 独立入口仍须单独检查 |

上述现有延期事项见 [Backlog](../../../backlog.md)。这张表限定此次清理，
不替已有 backlog 增加实施授权，也不重开已关闭工作。

## 两阶段执行

| 阶段 | 交付 | 最小验收出口 | 停止点 |
| --- | --- | --- | --- |
| P1 — 普通代码与资源清理 | C-01～C-05；符合证据门的 S-01～S-04；对使用中的控制流不做改写 | 聚焦回归、独立 diff review、冻结输入后的 lint/build/full Jest 与部署；受影响 Chat/来源/当前 Pet 样式做对应 app smoke | P2/P1/P0 finding 修复或明确延期，P1 验收证据齐全后进入 P2 |
| P2 — Pagelet 旧交互与专用旧链退役 | C-06～C-08；符合证据门的 S-05；同步类型、CSS/i18n、测试及当前文档 | 旧命令/范围撤除/来源边界回归；独立 review；当前构建部署后真实 Panel、Deep Discover 入口和移动呈现验证 | 满足全部 AC 后停止；提交、合并、发布和 closeout 按另外授权执行 |

阶段内部按 `dev → focused test → review → fix → app smoke → fix` 完成。

2026-09-13 执行调度修订：P1 源码已通过完整 gate 和独立 review，但共享 Obsidian
窗口暂被另一任务占用。保留 P1 冻结源码/build，在独立 P2 树先执行已批准的代码工作；
app 验收及阶段完成仍严格按 P1 → P2 顺序，不跳过或合并各阶段 gate。若 P1 app
发现问题，将修复同步至 P2 并重跑受影响证据。此修订仅调整资源等待期间的实现调度，
不改变清理范围、产品行为、AC、发布权限或任一阶段的完成条件。
GPT-6 固定边界、任务和独立验收；实施获授权后由一个已预检的 GLM CLI writer
连续交付，使用 [任务模板](../../templates/glm-worker-task.md)。review 子任务只读，
不同角色不重复全量检查。无需新 SDD：此次不设计新协议或架构；出现此类需求时
应先保留相关候选并重新评估范围，而不是临时扩成大重构。

## 验证策略与复用

每个切片在 [Tracker](./tracker.md#validation-plan) 记录
`REQ/AC 或风险 → 变化 → 最低充分证据/命令 → 通过条件 → 重跑触发`。

1. **删除证明**：普通死代码检查生产根、命令/回调注册、Obsidian 生命周期、Worker、
   动态导入、build/scripts 与必要兼容；C-06 核对授权退役边界及保留消费者。
   删除前后虚拟 type/build 消融用于诊断；
   正式 diff 上再验证，不能把 bundle 一致当作无行为风险证明。
2. **自动化**：先跑实际改动对应的 source suite。工具 suite 使用 `test:tooling`；
   `test:artifacts` 先确认生产构建。退休内部方法专用测试可删除/改写，保留行为的
   验收必须保留或迁移；不以弱化断言消除失败。
3. **阶段出口**：冻结 source/tests/fixtures/config/dependencies 后统一 `make deploy`，
   复用其 lint、build/TypeScript、full Jest；补 `git diff --check`、`npm run docs:check`
   和 [Local Validation Gate](../../../../AGENTS.md#local-validation-gate) 的 DOM 源码扫描。
   若同一输入已通过完整 gate 且 build 当前，可用 `make deploy-current`；不重复跑
   一套 standalone 全量门。依赖变更另做 `npm ci --dry-run`。
4. **真实应用**：目标只限 repo `test/` vault；先核对 Obsidian CLI 与实际 vault path，
   部署后 reload，使用 `obsidian vault=test ...` 准备状态，再真实操作受影响入口。
   未改变的外围 surface 标为 SKIP，不为证明保留功能重跑全产品人工矩阵。
5. **P2 必须覆盖的负例**：打开 Panel 不调用 provider；A 为 anchor 且获准 B 仍可返回；
   A/B 被排除时不能越权；无活动 Markdown、未配置 provider、失败/取消/过期仍诚实
   处理；来源查看、详情及本次改动触及的正常保存/恢复路径继续可用。
   用受控自动化证明调用次数/输入边界，用真实入口交互证明 UI 和路由可用；
   实际 provider smoke 仅使用测试 fixture，记录 provider/model/路径，不做质量或性能实验。
6. **移动与 CSS**：P1 核对生成样式及当前 Pet/Bubble 的 reduced-motion；P2 覆盖窄屏、
   键盘/焦点和移动呈现，不保留空白选择区域。真机需求按实际平台/触控/生命周期
   变更和适用 smoke 契约判断，不借其它 track 的 waiver 宣告通过，也不默认跑所有方向。
7. **文档阶段**：仅修改方案/契约时，执行 docs checker、受影响 docs contract suites
   和 diff check；不执行 plugin build/deploy，不声称完成运行时验收。

## 风险与回滚

| 风险 | 预防与发现 | 回滚/停止边界 |
| --- | --- | --- |
| tree-shaking 掩盖类型/Worker/动态消费者 | 分离入口；消融负对照已证明 bundle 不变也可有类型错误 | 保留仍用模块，只删专用部分 |
| 清除错误的 scope 或共享 cooldown | 对照 C-06～C-08 保留项与来源/预算测试 | 恢复该切片，不更改权限、预算以求通过 |
| CSS/barrel/翻译残留或过删 | 对生成 CSS 做目标规则比较，真实当前 Pet/Panel 交互 | 恢复受影响规则；不清空共享 media block |
| helper 复用改变 metadata 或隐私裁剪 | 比较各调用方输入输出及保留的回归断言 | 保留原 helper；复用不是硬性行数目标 |
| 老测试/旧文档被误当成现行功能或反之 | 按 DEC-035 的窄修订区分退役契约与有效保护 | 只改退役部分，兼容或产品歧义项延期 |
| 任务扩大或共享树被并发修改 | 有限清单、分阶段冻结、仅一个 writer | 停止受影响 gate，记录输入变化并补必要证据 |

按完整切片回退本次代码/样式/依赖变更；不清空缓存数据库、不重置设置、不清理用户
笔记作为回滚手段。Git 中保留的历史足以恢复旧实现，不继续留无入口 rollback-only 代码。

## Approval

- Product authority: [DEC-035](../../../product/decisions/dec-035-bounded-cleanup-and-pagelet-scope-retirement.md)，Owner 于 2026-09-13 确认。
- Plan authority: Owner 于 2026-09-13 明确要求“启动 GPT + GLM workflow 完成上面的方案清理”。
- Authorized implementation scope: 按本方案完成两阶段实现、测试、审查和 repo test vault 部署/app 验收；停在 Validated、未提交状态。提交、合并、发布及 closeout 仍需另外授权。
