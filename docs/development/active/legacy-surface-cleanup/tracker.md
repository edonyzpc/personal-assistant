# Legacy Surface Cleanup Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-10-25
Work item: B-189
Authority: 本 track 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [Bounded Cleanup Product Spec](../../../product/specs/pa-bounded-code-cleanup-product-spec.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

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

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-189/REQ-01 / B-189/AC-01 | 两个旧回顾控制退役、兼容读取保留 | [x] | 设置/归一化回归及实际展开设置检查通过 |
| T-02 | B-189/REQ-02 / B-189/AC-02 | 七个命令退役、保留发现与零调用打开 | [x] | commands/tooling 回归、实际命令面板和打开 Pagelet 通过 |
| T-03 | B-189/REQ-03 / B-189/AC-03 | 移除每周扫描设置跳转 | [x] | Maintenance 回归；实际进入并展示 2 条维护建议，无假跳转 |
| T-04 | B-189/REQ-04 / B-189/AC-04 | 旧 Operations 设置链清理 | [x] | 迁移、失败重试、陈旧保存和 live 权限边界回归通过 |
| T-05 | B-189/REQ-05 / B-189/AC-05 | Pagelet 专用关联链清理 | [x] | 专用链删除；handoff 取消、重复点击与来源失效回归通过 |
| T-06 | B-189/REQ-06 / B-189/AC-06 | 共享/历史边界与紧密相关契约 | [x] | 独立 diff 审查、完整测试覆盖、构建与文档契约通过 |

### Inherited Boundaries

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
