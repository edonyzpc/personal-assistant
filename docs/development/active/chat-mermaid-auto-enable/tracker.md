# Chat Mermaid Auto Enable Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-10-24
Work item: B-188
Authority: B-188 唯一执行状态、证据与验收记录。
Product spec: [Product Spec](../../../product/specs/pa-chat-mermaid-auto-enable-product-spec.md)
SDD: [Implementation Design](./sdd.md)

## Current Snapshot

- Authorization: Owner 明确要求根据 review 精简方案并完成开发、测试和实机验证；2026-10-24 追加授权仅将本次 Mermaid 代码和文档提交到本地 master，排除其他任务修改。不含 push、发布或 closeout。
- Current phase: 实现、独立审查、源码门禁、部署后真实图内交互和恢复已完成；保留 B-187 全部改动。
- Next action: 本轮交付范围为本地 master 的 B-188 独立签名提交，验证状态保持 Validated；后续 push、发布或 closeout 仍需各自授权。
- Blocker / decision needed: 无未解决阻断或产品待决策。
- WIP: B-188 已完成本轮开发测试，不再占 Now；不改变其他 track 的状态或排期。
- Review: 三路设计审查无 P0/P1/P2；已去掉 AC-03 的“禁止读取”，只限制写入/事件；存储异常沿用现有 fallback/error，不扩大 scanner 修复。
- Last verified behavior: 2026-10-24 已部署生产接线：关闭→自动开启、2图/0 Allow；选择、节点链接、Modal开关和再次关闭后重开均通过。

## Work And Minimum Evidence

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-188/REQ-01 / B-188/REQ-02 / B-188/AC-01 / B-188/AC-02 | 共享入口前检查/开启；首次、重复、关闭后再开 | [x] | 状态顺序回归及生产实机关闭→出图→再关闭→出图通过 |
| T-02 | B-188/REQ-03 / B-188/AC-03 | 局部 fence 判定、普通示例与已降级 text 无副作用 | [x] | 10 局部用例与既有流式旅程；实现前 6 fail / 4 pass，最终 focused 453 PASS |
| T-03 | B-188/REQ-04 / B-188/REQ-05 / B-188/AC-04 / B-188/AC-05 | 原生调用链/异常/范围审查，集中部署与真实图内交互 | [x] | 独立审查、集中门禁及实际选择/链接/Modal通过；恢复完成 |

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。

一个实施切片，不另建 Plan 或测试报告。GLM 负责限定实现、自查及 focused；GPT 维护
契约与 Tracker，独立验收并统一昂贵门禁/应用验证。单写入者，worker 不碰他人 diff。

- Focused：`npm test -- --runInBand __tests__/chat-view.test.ts`；若新增局部 Mermaid
  测试则并入同次命令。仅补开关状态、结构反例、流式→终态→Modal 接线及一个存储异常。
  复用原文/sourcePath、多图、owner、失败断言，不重建 bridge 生命周期测试。
- 收束后一个执行者执行 `make deploy`，复用其中 lint、build/TypeScript、完整 Jest；
  若相同输入已有通过证据和当前 build，则使用 `make deploy-current`。补 docs/diff 与
  项目 DOM/style 扫描；不把 build 身份当成测试通过，不重复完整门禁。
- 实机：可见、解锁的 repo-local test vault，记录/恢复 debug 和 mobile 状态。关闭
  Mermaid→打开含双图会话→生产代码自动开启并出图→文字选择、图内链接、放大/关闭→
  再关闭设置并重开原生消息→再次出图；零 provider 请求，清理自有 fixture 并恢复原值。
- 移动验收条件触发：仅在平台分支变化、发现 mobile storage/入口差异或用户明确要求
  时补一条官方 simulator 短旅程；不新增真机、图种、模型、版本或性能矩阵。
- 重跑只因相关 source/tests/fixture/config/build/宿主变化、真实失败或新风险；共享树
  输入未冻结/门禁未完成时不宣称通过。日志保存于 `/private/tmp/pa-b188-20261024-0ldaIx/`。

## Validation Log

| Date | Check | Result / boundary |
| --- | --- | --- |
| 2026-10-23 | 临时原生验证：Obsidian 1.14.4 / PA 3.0.1 / test；loaded main SHA `edc606276f7772adcb9e7bc5e6c35f25ae59080a5a53b4e96ceda4b0d582f19f` | 关闭时2 Allow/0图；临时检查两次只写/通知各1次；旧Chat仍2 Allow，重开2图/0 Allow；真实Modal与笔记链接通过；恢复trust/原会话/leaf/debug/mobile。仅路线可行性，非生产接线验收 |
| 2026-10-23 | 草案 docs:check、test:docs、diff check | PASS，2 suites / 57 tests；仅文档检查 |
| 2026-10-24 | 三路设计审查 | 无 P0/P1/P2；可选只读约束精简已接收；不重复应用调查 |
| 2026-10-24 | GLM 派发 | `pa-glm` / ZAI / `glm-5.3`；复用同宿主认证、真实工具与自然退出预检。工作树 `/Users/eddie/.codex/worktrees/mermaid-auto-enable/personal-assistant` 基于 `d48bc8a2`；仅 helper 与对应测试，禁止部署/Git/共享树写入 |
| 2026-10-24 | docs:check（实施阶段） | 仅并行 WIP 上限 finding：B-187 与 B-188 均 Now；保留真实状态，最终验收后复查，不修改 checker 或他人状态 |
| 2026-10-24 | GLM R1 / 隔离源码验证 | 2 suites / 453 tests PASS；TS、diff check、DOM/style scan PASS；自然退出均已核对。`report.md`、`events.jsonl` 与 focused/tsc 日志在本轮目录；中间 fixture/类型适配错误已修正，不作为产品红灯 |
| 2026-10-24 | GPT 独立实际 diff 审查 | 无 P0/P1/P2；冻结差异限于 3 个授权文件，生产新增 25 行。10 个局部用例加既有旅程增量适度；原始自然退出和最终输入已复核。仍缺集中门禁与生产实机 |
| 2026-10-24 | 主树整合与统一源码门禁 | 平台 guard、完整 lint、production build 自然 exit 0。复用 B-187 已证实的默认 ESLint 栈限制诊断，同配置以 `node --stack-size=8192` 执行；不改变配置/源码以绕过检查。日志 `platform-guards`、`lint`、`build` 及对应 `.exit` |
| 2026-10-24 | 完整 Jest 与单套环境复验 | 完整运行自然 exit 1：409 suites PASS / 1 suite FAIL，9849 PASS / 45 FAIL，共9894；唯一失败是 Ghost client 本机监听 `EPERM 127.0.0.1`。获准在沙箱外仅重跑该套，53 tests全过且自然 exit 0。复用其余结果，410套/9894项的要求已覆盖；不把原完整运行改记为 exit 0。`full-tests.*`、`ghost-client-environment-retry.*` |
| 2026-10-24 | DOM/style 与部署身份 | src 扫描 exit 1 / 零匹配为 PASS；diff check exit 0。`make deploy-current` 验证当前生产身份并复制成功，随后 plugin:reload；部署 main SHA256 `3ca17552493742e0435b9a22bf17c0f47f379f19ac23b910ef80d0521b12c84d`。构建身份不代替前列测试证据 |
| 2026-10-24 | Obsidian 1.14.4 / PA 3.0.1 / test 的生产接线 | 本地双图历史会话，关闭设置后生产 helper 自动开启，实际2 SVG / 0 Allow；双击图中文字选中 `Mermaid`；点击放大看到原生图，Escape关闭；点击节点复用已有 `2026-05-01.md` 标签；再清除设置（读回null）并重开，同样2 SVG / 0 Allow。没有注入开启 helper、没有主动发送 provider 请求。`smoke-*.log`、`auto-enabled-selection.png`、`modal.png` |
| 2026-10-24 | Fresh capture / 清理 | dev:errors为空；console仅本轮命令及正常 API lifecycle。自建会话/leaf已删除，原active conversation与trust=true恢复；初次reveal未激活侧栏，随后显式setActiveLeaf恢复原`b7678fe7a865243a`。debug=false、mobile=false、临时探针清除均核实；未修改笔记、未触发移动/模型矩阵 |
| 2026-10-24 | 文档与临时工作树 | docs:check PASS（348 Markdown / 4427 local links），diff check PASS；两套既有 docs contract 测试复用本次完整运行的 PASS，不重复运行。隔离工作树已通过应用工具归档，主树保留已接收改动；`result.json` 汇总本轮运行证据，原始失败与成功日志均保留 |

临时原始证据：`/private/tmp/pa-mermaid-runtime-20261023/result.json` 与同目录
`disabled.png`、`enabled.png`。旧证据仅证明技术路线；本轮已补生产自动接线与文字选择。
Discovery 内容已分别迁入 DEC-074/Spec/SDD/本 Tracker，删除重复草案。

## Closeout Readiness

- [x] 实现、独立审查、门禁与部署后交互全部通过；完整运行的环境失败及定向复验如实保留。
- [x] 临时状态与资源恢复，必要证据仍可用。
- 2026-10-24 另获本地 master 提交授权，仅暂存 B-188 白名单及共享测试中的 Mermaid 片段；不推送、发布或归档。
