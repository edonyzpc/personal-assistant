# Plugin Shell Refactor Delivery Plan

Document status: Approved
Updated: 2026-09-20
Work item: B-143
Authority: 本 track 的交付顺序、任务依赖、风险、验证策略与 stop point；执行状态只在 Tracker。
Product spec: [Product Spec](../../../product/specs/pa-plugin-shell-refactor-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

逐片迁移完整职责，保持全部正常功能，并独立完成 LC-01..03。范围和验收沿用
Product Spec，不追求启动提速、行数目标或额外生命周期整顿。

## Dependencies And Source Surface

设计核查基线为 `a49b7a0175d3e5b8e9514ffa7364dda2aa01bceb`（B-142 closeout）。
相对 `9be557b1` 无 runtime/config/dependency 变化，四个测试文件的最终删项与
保留断言已核查。B-142 不再是待完成依赖；实施前核对实际接收树的新变化，不能
把这次设计核查当作未来输入的验证。源码、现有接口和测试证据见 [SDD](./sdd.md)。

原则是单个 GLM writer 串行修改共享的 plugin.ts/harness。只读审查可并行，禁止
多个 writer 同时接手该文件或同一测试。任务编号表示验收单元，不要求每项新建
进程/工作树/提交；低风险相邻项可复用同一 worker 上下文，但仍分别记录结果。

## Phases

| Phase | Outcome | Tasks | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| P0 基线 | 确认入口、状态、消费者和行为保护完整 | T-00 | 基线/测试 owner/工具安全门/实际目标明确，LC 触发设计完整 | 不开始不明归属的迁移 |
| P1 小边界 | 校验迁移方式，完成 metadata/Callout 修复与独立集成 | T-01..07 | 每片 focused、独立 review；修复应用证明及阶段桌面/mobile simulator gate，受影响入口前后对照 | P1 未完成不进入 P2 |
| P2 流程边界 | 完成 Pagelet 局部修复，迁出来源、Pagelet/Chat 流程 | T-08..14 | 各流程来源/预算/取消/恢复成立；桌面与 mobile simulator gate | 不带新 P0/P1/P2 回归进入 P3 |
| P3 事务边界 | 设置、连接、Memory 治理/提取有单一 owner | T-15..19 | 失败补偿、排空、marker/恢复、脚本保护和阶段桌面/mobile simulator通过 | 队列/身份不清不得整体搬迁 |
| P4 收敛 | 壳层与消费者一致，完整功能验收 | T-20..22 | 当前完整 coverage、独立 review、跨功能桌面/mobile simulator、文档通过 | Validated；不自动 closeout/Git/release |

## Development Tasks

以下为任务设计，不是完成记录。源方法和 Proposed 模块边界在 SDD 中对应。
每行同时限定生产改动所有权；相关测试和必要 harness 可以随行变动，但不能扩大
到整仓测试重写。T-01 的纯函数/注册提取只处理边界已清晰的部分，其余跟随 owner。

| Task | 依赖 | 交付物 / 允许变动范围 | 最低验收与停止条件 |
| --- | --- | --- | --- |
| T-00 基线与保护 | 实施前提就绪 | 只读 plugin.ts、src 消费者、scripts、现有 tests/config；在 Tracker 记入口→owner→保留证据及原状态/环境；不新造完整盘点报告 | 每项现有入口和状态有去向；LC 三项可复现方案；工具安全门纳入；确切树/变动输入/部署 vault 已知 |
| T-01 类型、纯函数与平台注册 | T-00 | plugin.ts 的无状态类型/helper 和命令/视图/菜单注册定义；Proposed plugin adapter；相关消费端 import | 参数/this/ID/默认快捷键/注册时点和错误语义不变；保留布局就绪前注册测试；不移动后台阶段 |
| T-02 Records 与 Capture | T-01 | createNewNote、目录/路径、记录/Preview、QuickCapture Host/后处理；既有 quick-capture/preview/view 的窄接口 | 根目录/已有文件/模板/排除/保存错误、Capture 后续行为、真实命令及 Preview 恢复；不重写 Capture 服务 |
| T-03 LC-02 修复 | T-01 | 旧结构中的 metadata 开关/file-open/debounce/清理；targeted 回归 | 目标红灯→修复绿灯；重复开关、排入后停用/卸载、旧清理与新任务、已提交写入及排除；真实命令 smoke |
| T-04 Metadata 迁移 | T-03 | 将修复后的 metadata 状态/监听/定时器作为整体移入 Proposed metadata owner | 复用 T-03 行为断言，新增真实构造/壳层接线证据；不再改变启停语义 |
| T-05 LC-03 修复 | T-01 | 旧结构 initializeCalloutManager/waitForEnabledPluginInstance 与自有等待资源；不改第三方依赖 | 卸载取消并 settle；API 迟到丢弃；正常/未启用/超时 fallback；真实启停 smoke |
| T-06 Callout 迁移 | T-05 | 修复后的 Callout 等待/结果状态进入 Proposed integration；src/callout.ts 只调整窄依赖 | 复用 T-05 断言；公开 getApi 用法、默认 callout 输出和引用语义不变 |
| T-07 Statistics 与外围集成 | T-02, T-04, T-06 | Stats/Editor Host、状态栏/observer、graph、插件/主题 updater、AI summary/featured-image 和 Share Card 的 shell 接线；各现有服务不重写 | 每个实际迁出 owner 独立小 diff；统计 flush、管理设置保存、菜单/导出入口保留；完成 P1 gate |
| T-08 LC-01 修复 | P1 | 旧结构 PageletHost.registerEvent、orchestrator 订阅和 destroy/迟到回调；scope 同时绑定 root 同步卸载 | 旧订阅实际释放；挂起 Memory drain 时根卸载已解绑，旧回调不能重建 UI，多次开关仅新实例有效；真实启停/切笔记；不改变 provider 调度 |
| T-09 共享来源与 Vault bridge | T-08 | 来源规则/正文校验和 vault/workspace 事件桥；只在已有消费者需要处抽取；Pagelet/Memory 附加准入分别保留 | 同步失效先于异步消费，rename/delete/replay/self-write、撤权后拒绝与正常读取；不把规则合并成更宽权限 |
| T-10 Quiet Recall | T-09 | Quiet Recall 适配/评估/预算预约状态与 limiter/coordinator 接线；复用现有业务，保留当前命令转向 Deep Discover、旧 evaluator 无生产调用的兼容状态 | 相同候选/context/预算，reserve/commit/rollback、取消/来源变动三类竞态独立；共享 admission 与自有 limiter 均为同一实例；不重新接入旧入口 |
| T-11 Scope Recap | T-10 | 迁移当前仍保留的 Recap 数据适配、本地 overview、provider preparation、来源/currentness、预算与成本接线；复用现有 scope-recap domain | 正常/空/失败/预算/来源漂移保持；当前命令别名和无 Scope Recap producer 状态不变，不恢复 B-136 已删除的 scheduler/cache/nudge/UI |
| T-12 Deep Discover | T-11 | 控制器组装、来源 snapshot、policy epoch、配额/诊断投影及重置 | 显式/自动触发、迟到丢弃、取消、预算与结果来源；旧 Panel 打开仍零 provider；实际 Discover 入口 |
| T-13 Pagelet foreground 与 Operations | T-12 | 迁移保留的 foreground review adapter、队列/insight/maintenance 接线及生产可达的 Operations 会话/自写入边界；当前 Review 命令继续转向 Deep Discover | adapter 的来源/预算竞态、生产 Operations 确认/Undo/取消、写入重入保护和 LC-01 分别复验；不重新接入旧 Review 执行链，不新建巨型 Pagelet 总管 |
| T-14 Chat 集成 | T-13 | createChatHost/服务组装、writing/history/image 恢复和生命周期委派；只移动 shell 职责 | Chat/Agent/tools/context 与同设备历史、写作/图片恢复、保存/取消/失败；根关闭 interleave 保持；完成 P2 gate |
| T-15 Settings 持久化 | P2 | load/migrate/save、唯一 settings write queue/required-transaction drain、专用提交策略，保留临时 shell facade | load/reload 可替换当前 settings，稳定后消费者读取同一实时实例；copy-if-absent、barrier process/readback、并发保存/补偿/卸载固定点排空保持；不能合并 AI/治理队列或把专用保存压成通用 patch |
| T-16 AI 连接事务 | T-15 | AIProviderConfigurationPatch/SettingsPermissionPatch 类型接缝、AI 配置 queue、凭据/readiness/补偿；图片专用 secret-first 保留独立协议，既有 AI service/provider 不改 | save-first provider、Chat secret-first、图片连接三种顺序及 revision/currentness 保持；仅现有有 guard 的入口在卸载后拒绝，卸载前已接纳事务必须完成；真实设置/Chat readiness |
| T-17 Memory 治理存储与 bootstrap | T-16 | device repositories/store/cache/subscription、legacy barrier 与 bootstrap storage prepare/commit/fail；同步兼容 probe 改为版本化只读判定 | 旧/新状态、future schema、unknown/failed、初始化/引用/失败恢复；D6 对 missing/malformed/durable/unknown/failed 全部阻止真实数据写入，只允许显式隔离 fixture；不复活隐式 legacy fallback |
| T-18 Memory 治理动作与投影 | T-17 | lifecycle mutation queue、admission、finalization/rollback、candidate/audit、retry/GC/profile projection；通过 T-17 current handle 复用 repository/coordinator | 同意/纠正/撤销/forget、来源撤销、失败重试和事务顺序；主业务继续归 MemoryManager/VSS，不复制 settings queue 或 storage current state |
| T-19 Memory 与 extraction 集成 | T-18 | MemoryHost、VSS/MemoryManager 根接线、A/C scheduler 和上下文投影/legacy profile context 适配；D-11采用早期同步关闭准入、后段释放资源 | DEC-028、extraction stop→Memory stop→idle→settings drain→VSS dispose、Chat资源后再释放Profile store；提取开关/取消/恢复；不强制取消已发网络请求，无额外provider/后台写入；完成P3 gate |
| T-20 消费者与兼容 facade 收敛 | P3 | settings/views/AI/Stats/updater 等活跃生产消费者逐个改窄接口；scripts 诊断/D6、类型 re-export、公共 prototype harness 同步收敛 | 不以零 PluginManager 引用为目标；有活跃消费者的 facade 保留委派；diagnostics 同实例、加载时身份缓存、D6 fail-closed 和真实 owner harness 均有保护 |
| T-21 壳层与架构复核 | T-20 | 对照最终接收树逐项确认 root 保留理由与 owner，检查循环/万能 Host/双状态/生命周期；只做必要漏项修复并更新现有 architecture overview | root 仅保留 Obsidian身份、全局编排、装配/注册、真实兼容 facade 和诊断身份；无新 God object/循环/重复状态，不追求行数或开启新一轮全面拆分 |
| T-22 最终验收 | T-21 | P1..P3 阶段 gate 与 T-20/T-21 验收已完成后冻结最终输入，执行 P4 full coverage/tooling/artifact/review/跨功能桌面与 mobile simulator gate；仅对实际 iOS 专属变化补真机；Tracker 更新 | Spec 全 AC 有当前证据，完整发现范围/coverage生产文件清单/部署身份有效，所有新 P0/P1/P2 已处理；只停在 Validated，不替代 P1..P3 阶段 gate或授权Git/closeout/release |

T-07 必须按实际依赖拆小执行，不能因同一行而一次搬走所有外围模块。P2/P3 内部
顺序若需调整，先在 Tracker 说明接缝和证据，再更新任务设计；不得扩大范围或
将阶段实机推迟到最终。涉及共享来源/持久化能力暂留 shell 的窄委派，迁移 owner
时只切换实现，不增第二份状态；不用依赖大范围前置重构来扩大当前切片。

## Worker Dispatch Contract

使用现有 [GLM task template](../../templates/glm-worker-task.md)，派工前将下列值
填入具体任务，不将本 Plan 全文当成宽泛实施授权：

- 任务 ID/修订、完整 REQ/AC、正反例、不变量、上表限定源区域和测试文件。
- 确切工作树/基线/相关 dirty 输入所有者；接收树、实际部署目标和停止点。
- 相关 Spec/SDD 小节和既有 Host/服务；必选技术点、不允许替换的边界。
- 已核实的主机/CLI/profile/provider/model/tools 及本任务外传权限；不沿用其他任务授权。
- `风险 → 改动 → 命令/环境 → 通过条件 → 失效触发`；由 worker 执行的 focused/
  broad/build/deploy 与 GPT 补充的真实 app/device 观察分清。
- 临时资源、证据留存、上轮已接受修正；不得改 Spec/SDD/Tracker 或自行 Git/发布。

普通切片默认连续 deliver（调查、必要回归、实现、自查、验证），不机械拆出多轮
预检。LC 三项因需确认真实旧缺陷，在同一上下文保留明确检查点：旧结构目标失败
证据 → 最小修复验收 → 对应迁移。不能将导入/构造失败当红灯，也不能复现不出仍
实现假定修复；无法复现时返回 GPT 复核触发，独立任务可继续。

## Risks And Rollback

| Risk | Prevention / detection | Rollback / fallback |
| --- | --- | --- |
| 设置/队列双所有者 | 每片写明字段/队列唯一 owner，检查对象引用和 pending/drain 测试 | 回退该片代码与构建，不清理用户数据 |
| 重排 startup/unload 或把 async drain 放进 Component | 根协调保留并显式 await；测试关键偏序和失败路径 | 恢复原调用位置，LC 局部取消独立保留/回退 |
| 测试迁移漏保护 | 旧断言→新 owner/入口证据可追溯，实测 Jest 发现和 coverage | 修复接线或测试归属，不降正确预期/门槛 |
| 工具误判 durable 或加载版本 | 状态迁移同片验证 probe 拒绝与加载身份缓存 | 保留兼容 facade/字段到安全迁移完成 |
| 未证实的全局卸载/恢复窗口 | 保留现有 admission/disposed/generation，定向证据区分旧风险与新回归 | 超出三项修复的变化先讨论，不预防性重排 |
| 跨平台或真实模型行为无法证明 | 定义确定性行为对照、真实桌面与 mobile simulator 动作；iOS 专属变化再做真机，缺证据明确标未验证 | 不宣称阶段完成，不替换为 mock PASS |

## Validation Strategy

执行矩阵和最小充分命令见 SDD；每片实际选择先写 Tracker。focused PASS 后独立
审查/修复；每个运行时阶段冻结输入，安排一次 broad/build/deploy，并在该阶段
完成受影响桌面和 Obsidian CLI mobile simulator 交互。B-143 当前没有 iOS 专属
能力变化，不默认执行 iCloud 部署或真机；只有后续 diff 实际触及 iOS 专属代码，
或出现模拟器无法覆盖的平台行为时才增加对应真机 gate。已包含的检查复用，
不为单行任务重复全量。
LC 修复在迁移前保留必要应用证明，可与其他已完成无关小片的 gate 合并，不能
先迁移再倒推修复有效。

实施审计发现 T-03/T-04 与 T-05/T-06 已在同一 worker slice 中连续完成源码修复
和 owner 迁移，未在中间保留应用证明。按 Tracker D-14 使用基线隔离 worktree
重建“仅修复、未迁移”的临时构建并做真实 app smoke；该 patch 不进入交付树，
不能用迁移后结果代替。T-08 则在进入 T-09 前通过单独 fix-only build/deploy 与
app gate，随后 T-13 才迁移并复验，避免重复该缺口。

最终覆盖完整功能入口；低层矩阵不从所有 UI 逐项重跑。完整 coverage 必须基于
最终源码/测试/config/依赖和当前 build，B-142 的历史 PASS 只作基线。Community
源码扫描随 DOM/运行时改动执行；外部社区扫描/发布不由本设计自动触发。

## Approval

- Scope authority: DEC-039 和 Product Spec；既定范围不重复确认。
- Technical design: Owner 于 2026-09-20 批准按本 Plan/SDD 完成 B-143 全部开发、测试和验收任务。
- Authorized implementation scope: implement-approved-spec；允许向 GLM 发送执行所需源码、测试和契约。Git/closeout/release 分开授权。
