# Legacy Surface Cleanup Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-10-25
Work item: B-189
Authority: 本 track 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [Bounded Cleanup Product Spec](../../../product/specs/pa-bounded-code-cleanup-product-spec.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Second batch: DEC-075 第二批、REQ/AC-07–14 已完成实现、独立审查、必要自动检查与
  部署后桌面验收；下方记录完整命令与补验的证据边界。
- Baseline: 第一批已签名本地提交 `315212f8`，未推送。其他任务的两个开发索引修改及
  obsidian-code-interface-consistency 目录保持原样。Owner 后续已授权仅将第二批相关文件
  签名提交到 master；不推送。
- Ownership: GPT 主控负责 plugin 接线、locale、文档与统一检查；三个 GPT writer 分别
  负责 Pagelet、外围设置/管理、旧 append/StatsStore/事件链，文件所有权互不重叠。
- Evidence: 一次全量 Jest 暴露一个已退役成员的测试断言，删除该过时断言后补验通过；
  最后 Quick Review 闭包改动完成受影响补验。最终 lint/build、docs、DOM 与 diff 检查通过。
  当前构建已部署至 test vault；保存/撤销与 Agent 能力使用确定性回归证据，未重复真实模型采样。
- App result: Quick Capture 打开/取消、Records Preview、统计、Pet 打开阅读、当前发现气泡
  的布局与关闭/焦点返回均已观察。相同临时气泡样本在清理前后的尺寸、位置、字号、按钮
  文本一致，161 条当前 Pet/Bubble 共用 CSS 规则未变。临时样本不代表真实生成/保存成功。
- Evidence boundary: 测试库原有 Pagelet 阅读状态为内容暂不可检查，清理前后相同；未在
  本次桌面验证中观察到已有发现的完整阅读/保存，相关保留能力由回归测试与调用链核查支持。
- App restoration: 返回 `0.unsorted/Dog.md`，已有 Chat leaf/会话及空草稿保留；启用插件
  列表一致，临时气泡已关闭，debugAttached=false、mobile=false，未写入或删除笔记。
- Open decisions: 无。发现有效共享消费者则保留原语义，不按旧名称整块删除。

### 第一批交付记录

- Current phase: Validated；批准的六项清理、独立审查、自动检查和部署后桌面交互已完成。
- Next action: 本轮交付工作区改动；未执行 Git 提交、推送、发布或文档 closeout。
- Blocker / decision needed: 无；本批范围不扩大。
- Last verified behavior: 当前构建已部署到仓库测试库；命令面板无七个退役 ID，设置无两个
  无效控制，维护页面可进入且无每周设置跳转。打开 Pagelet 不发起新的模型请求。
- Execution ownership: Owner 在本轮明确停用 GPT + GLM 流程，设计、实现、测试与验收
  全部由 GPT 接续。GLM 已停止并确认不再运行，仅留下 6 个文件共 91 行删除；GPT 已
  独立核对并完成后续工作，先前预检或未完成输出不作为交付证据。最终验证与独立验收
  由 GPT 主控执行。
- App baseline: Obsidian 1.15.0，仓库 `test/` vault，debugAttached=false、mobile=false，
  活动笔记 `0.unsorted/Dog.md`，设置已关闭；验证保留已有 Chat，不主动重置会话。
- App restoration: 验证后已关闭新开的维护页面、返回原活动笔记、关闭设置，debugAttached
  恢复 false，mobile 保持 false；已有 Chat 会话与空草稿保留，未执行笔记写入。

## Work

### Second Batch

| Requirement / AC | Slice / risk | Evidence / rerun trigger | Status |
| --- | --- | --- | --- |
| B-189/REQ-07 / B-189/AC-07 | 旧生成/专用UI退役，provider身份/保存保留 | Pagelet focused、provider-context、插件整合及app；共享语义变更时补验 | [x] |
| B-189/REQ-08 / B-189/AC-08 | 双Ctrl退役，发现/Pet保留 | coordinator/lifecycle与实际Pet；键盘或入口变化时补验 | [x] |
| B-189/REQ-09 / B-189/AC-09 | 匿名事件退出，实际执行保留 | registry/Operations回归与配置迁移；注册/权限变化时补验 | [x] |
| B-189/REQ-10 / B-189/AC-10 | 外围入口退役，Capture/Records保留 | plugin注册与实际Records/Capture；入口/配置变化时补验 | [x] |
| B-189/REQ-11 / B-189/AC-11 | weekly开关精确清退，历史保留 | settings/persistence保留数据断言；持久化变化时补验 | [x] |
| B-189/REQ-12 / B-189/AC-12 | 旧append退出，共享检查保留 | Operations追加/Undo、QuickCapture/confinement；执行语义变化时补验 | [x] |
| B-189/REQ-13 / B-189/AC-13 | StatsStore旧类退出 | StatsRepository/Manager/import/helpers与实际统计；数据路径变化时补验 | [x] |
| B-189/REQ-14 / B-189/AC-14 | 旧bubble/preload退出，现行显示保留 | bubble/current reading保存回归、独立review、实际界面；显示变化时补验 | [x] |

以上勾选表示批准范围已完成；自动检查、桌面观察及其证据边界见 Current Snapshot 与验证日志。

### First Batch

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-189/REQ-01 / B-189/AC-01 | 两个旧回顾控制退役、兼容读取保留 | [x] | 设置/归一化回归及实际展开设置检查通过 |
| T-02 | B-189/REQ-02 / B-189/AC-02 | 七个命令退役、保留发现与零调用打开 | [x] | commands/tooling 回归、实际命令面板和打开 Pagelet 通过 |
| T-03 | B-189/REQ-03 / B-189/AC-03 | 移除每周扫描设置跳转 | [x] | Maintenance 回归；实际进入并展示 2 条维护建议，无假跳转 |
| T-04 | B-189/REQ-04 / B-189/AC-04 | 旧 Operations 设置链清理 | [x] | 迁移、失败重试、陈旧保存和 live 权限边界回归通过 |
| T-05 | B-189/REQ-05 / B-189/AC-05 | Pagelet 专用关联链清理 | [x] | 专用链删除；handoff 取消、重复点击与来源失效回归通过 |
| T-06 | B-189/REQ-06 / B-189/AC-06 | 共享/历史边界与紧密相关契约 | [x] | 独立 diff 审查、完整测试覆盖、构建与文档契约通过 |

### First-Batch Inherited Boundaries

以下映射继承 B-136；不表示重新实施或重跑其全部历史检查。

| Requirement / AC | 本次适用边界 |
| --- | --- |
| B-136/REQ-01 / B-136/AC-01 | 专用删除必须有调用与消费者依据；本批产品退役另由 DEC-075 批准 |
| B-136/REQ-02 / B-136/AC-02 | 不复活旧范围控制，不改变已有范围退役 |
| B-136/REQ-03 / B-136/AC-03 | 仅七个命令的保留约定被接续；anchor、跨笔记证据、来源与 open-panel 零调用仍保留 |
| B-136/REQ-04 / B-136/AC-04 | 外围管理、Statistics、Share Card、Records 不在本批范围 |
| B-136/REQ-05 / B-136/AC-05 | 共享来源、正常保存、权限、恢复、历史读取继续保留；仅 Pagelet 专用关联流程退役 |
| B-136/REQ-06 / B-136/AC-06 | 专用接线/文案/样式随链清理，不新增通用框架或改变共享语义 |

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | Product compatibility | 七个旧 ID 删除将使其快捷键失效 | Owner 已知并同意重绑；DEC-075 明确接续旧保留契约 | 自动注册断言与实际命令面板确认；保留入口可打开 | Verified |
| F-02 | Preservation boundary | discuss handoff 共用 action token / AbortController | 状态收窄为 handoff，保留共用有效性与取消机制 | Pagelet 2 suites / 198 tests PASS；另一 GPT 独立审查无问题 | Verified |
| F-03 | Data compatibility | deprecated projection 单独触发一次规范化保存 | 仅剔除退役 Operations key，保留其他设置与历史 | Operations/settings 10 suites / 1045 tests PASS，含 standalone true/false、失败重试与陈旧保存 | Verified |

## Validation Log

### Second Batch

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-25 | B-189/AC-07–14 | 定向回归与失败修复 | PASS | compat 10 suites / 285 tests；settings/persistence 2 / 235；Pagelet 初次 244 PASS、一个旧 Recall 导航 fixture 失败，改用当前 section 后定向通过；BubbleView 14 PASS。插件入口/生命周期过时 fixture 修正后 2 / 440 PASS；其余插件整合/get-vss-files 初次通过 |
| 2026-10-25 | B-189/AC-07–14 | GPT 独立 diff 审查 | PASS after fix | 非原 writer 核查 Pagelet 共享显示/provider身份/保存、plugin接线、设置投影、Agent追加/撤销与统计边界；发现一个已删除的 telemetryEnabled 参数并修正。原 provider 身份算法及历史数据类型保留，无未解决 actionable finding |
| 2026-10-25 | B-189/AC-07–14 | 全范围 lint、生产构建 | PASS | 同范围 lint 使用既有 Node stack-size=8192，未改规则；初次构建暴露删除成员的旧 fixture/清理赋值并修正。最终生产 build 包含 TypeScript、Tailwind 和 bundle；最后修改范围另补 lint，均 exit 0 |
| 2026-10-25 | B-189/AC-07–14 | `npm run test:all -- --runInBand` | 397/398 suites PASS; targeted correction PASS | 初次全量 9614/9615 tests PASS；唯一失败为 lifecycle 对已删 retrievalHabitProfileStore 的清理断言。删除该专用断言，当前 stores 断言保留，lifecycle 119/119 PASS。最后移除无生产消费者的 Quick Review 分支及专用测试，受影响 3 suites / 126 tests PASS。不宣称单次最终全量命令全绿，未无故重跑全量 |
| 2026-10-25 | B-189/AC-07–14 | `make deploy-current` | PASS | 最终生产资产身份验证并复制到 test vault；此命令不运行测试，复用上述全量及受影响补验 |
| 2026-10-25 | B-189/AC-08–10、13–14 | 部署后实际桌面入口与布局 | PASS within scope | 命令面板与注册表中退役入口消失；发现/Pet/Quick Capture/Records/统计保留。实际打开并取消 Capture，Records 展示已有内容，统计页面挂载。设置中仅保留统计同步控制，无能力使用分享开关。Pet 打开当前笔记阅读页，原有内容不可检查状态未变 |
| 2026-10-25 | B-189/AC-07、14 | 当前发现气泡前后对照 | PASS for display | 同一临时内存样本经真实 builder/renderer 显示，前后 x=421.5、y=605、380×232.15625、15px 及按钮文本完全一致；来源链接、说明、按钮布局正常，实际关闭后焦点返回 Pet。161 条保留共用样式一致；未生成/保存此样本，不替代真实发现验收 |
| 2026-10-25 | B-189/AC-07–14 | app 错误捕获及恢复 | PASS | 新捕获 error 与 error console 均为空；Chat leaf `b7678fe7a865243a`、空草稿和启用插件列表保持，活动笔记恢复；debug/mobile 均恢复/保持 false |
| 2026-10-25 | B-189/AC-07–14 | 文档、社区源码与 diff 检查 | PASS | docs:check、git diff --check 通过；禁止 DOM 注入扫描 exit 1 / 无匹配为 PASS。只更新本 Tracker 的最终证据后复查文档/diff，不重复冻结代码检查 |

第二批证据位于本机 `/private/tmp/pa-cleanup-batch2-20261025/`：`compat-focused.log`、
`peripheral-focused.log`、`pagelet-focused.log`、`detail-navigation-focused.log`、
`bubble-view-focused.log`、`quick-review-closure-focused.log`、`lifecycle-final.log`、
`full-tests.log`、`lint.log`、`lint-final.log`、`build-final.log`、`deploy-current.log`、
`docs-check.log`。桌面记录为 `commands-after.json`、`records-preview.png`、`statistics.png`、
`pagelet-reading-after.png`、`bubble-before.png` / `bubble-after.png` 及对应尺寸 JSON、
`app-errors.log`、`app-console-errors.log`、`app-restored.json`。这些不是 CI、发布、
真实模型生成或移动端验收证据。

### First Batch

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-25 | B-189/REQ-01–06 / B-189/AC-01–06 | 当前源代码与生产消费者只读核查 | Baseline only | `058dd3dd`；不是实现后测试或 app 验收 |
| 2026-10-25 | B-189/AC-01–05 | 定向 source 回归 | PASS | UI/commands 3 suites / 201 tests；Pagelet 2 / 198；settings/Operations 10 / 1045；plugin integration 2 / 360。主控复核实际 diff 和原始日志，未重复运行已通过输入 |
| 2026-10-25 | B-189/AC-02、04、06 | 离线 tooling 回归 | PASS | Pagelet smoke runner 1 suite / 20 tests；Operations host scripts 3 / 74；未调用 live provider |
| 2026-10-25 | B-189/AC-04–06 | GPT 独立审查及社区源码扫描 | PASS | 非原 writer 审查 plugin 接线、Pagelet handoff 和 settings/persistence；无 actionable findings。社区 DOM 扫描 exit 1 / 无匹配，按规则为 PASS |
| 2026-10-25 | B-189/AC-06 | `make deploy` 初次统一入口 | Tooling failure | platform guards PASS；默认 lint 在未改动 share-card-paper-data.ts 栈溢出。沿已有做法对同范围增大 Node 栈重跑，不改规则/忽略项；后续复用通过 gate 并 deploy-current |
| 2026-10-25 | B-189/AC-06 | 同范围 lint 增大 Node 栈；`npm run build` | PASS | `node --stack-size=8192 node_modules/eslint/bin/eslint.js 'src/**/*.{ts,tsx}' '__mocks__/**/*.ts'` exit 0；生产构建含类型检查与 Tailwind，exit 0。未改 lint 规则或忽略项 |
| 2026-10-25 | B-189/AC-01–06 | `npm run test:all -- --runInBand` 及唯一环境失败补验 | PASS with environment retry | 全量 408/409 suites 通过；仅 ghost-publishing-client 的 45 tests 因 `listen EPERM 127.0.0.1` 失败。在允许本机监听的执行环境仅重跑该 suite，53/53 tests PASS。相同冻结源/测试输入合计 409 suites / 9878 tests 均获通过证据，不宣称单次完整命令全绿 |
| 2026-10-25 | B-189/AC-01–06 | `make deploy-current` | PASS | 当前生产资产身份验证并复制到仓库 test vault；复用上述 lint/build/full 测试与补验结果，此命令本身不运行测试 |
| 2026-10-25 | B-189/AC-01–03 / B-189/AC-05 | 部署后桌面设置、命令、维护和实际打开面板 | PASS within scope | 真实命令面板、展开 Pagelet 设置、执行维护入口并展示 2 条建议、实际打开面板均已观察；无每周 CTA。打开面板显示当前发现内容不可检查，既有只读 controller 返回 `not-initialized`；不宣称本次观察到已有发现阅读或 handoff 成功，这些保留边界使用确定性回归证据。未新增 provider 请求、实际写入或移动验证；错误捕获与 error console 均为空 |
| 2026-10-25 | B-189/AC-06 | `npm run docs:check`、`git diff --check` | PASS | 文档链接/契约与 diff 空白检查通过；最终只更新本 Tracker 记录并复查，不重复冻结代码测试 |

执行证据位于本机 `/private/tmp/pa-cleanup-20261025/`：`lint-stack.log`、`build.log`、
`full-tests.log`、`ghost-client-retry.log`、`deploy-current.log` 及各 focused/tooling 日志。
桌面证据为 `commands.png`、`pagelet-settings.png`、`open-panel.png`、`maintenance.png`；
基线为 `app-baseline.json`。这些是本地验证留档，不是 CI、发布或移动端证据。

## Closeout Readiness

- [x] Owning contract 与实际行为一致。
- [x] Required review 与相关自动检查、app 交互证据已记录。
- [x] 未完成项已明确处理；批准范围无未解决阻塞，app 阅读状态证据边界已说明。
- [x] 稳定结论已吸收到 current contract/tests。
- [ ] 过程文档处置已按另行授权处理；本轮不得宣称 closeout。
