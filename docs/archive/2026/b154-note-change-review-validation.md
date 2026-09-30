# B-154 笔记差异审阅与审计退役验证记录

Document status: Archived
Recorded: 2026-09-30
Work item: B-154

本页保留本地独立验收、审计兼容边界及实际界面的独有证据，不作为当前实现或交付状态权威。
稳定行为见 [Product Spec](../../product/specs/pa-note-change-review-product-spec.md)、
[DEC-046](../../product/decisions/dec-046-note-change-review-and-audit-retirement.md) 与
[Operations Architecture](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers)。
Owner 已授权开发测试、repo-local test 部署和文档收尾；本次记录时所有改动仍未提交，
没有 master 集成、推送、beta/stable 发布或真实用户 vault 部署证据。

## 最终验收与来源

GPT 独立检查最终 diff、真实断言、原始退出结果、输入身份及应用交互，接受 10/10 AC；
12 个实际发现全部修复。稳定 REQ/AC 保留在 Current Spec，必要回归保留在源码测试，
没有未完成开发测试项转入 Backlog。旧 audit 由 Owner 自行管理，不是遗留清理任务。

| AC | 最低充分证据与通过事实 |
| --- | --- |
| B-154/AC-01 | [纯模型回归](../../../__tests__/operations-review-model.test.ts)覆盖同文件首冻结→末候选、跨文件/批次、create/null/空文/净零；真实 Chat 一批 4 操作按 2 篇笔记展示，保留底层顺序 |
| B-154/AC-02 | 模型、formatter 与实际组件回归覆盖中文、Markdown、空白、LF/CRLF、有界完整降级；实际 4,369 字原文可完整核对，新文首/中/尾三处变更、全部上下文及前后笔记导航可达 |
| B-154/AC-03 | [实际 Chat 回归](../../../__tests__/chat-view.test.ts)保护整批共享预算、领先省略提示；Desktop/mobile 从顶部即见省略。真实展开/重复打开只产生一个 tab，关闭后可重开；打开前两篇笔记与 baseline 完全相同 |
| B-154/AC-04 | [controller](../../../__tests__/operations-intent-controller.test.ts)及[共享会话回归](../../../__tests__/operations-review-session.test.ts)覆盖激活、双确认/取消竞态、超时、权限、内容漂移和冲突；实际 tab 整批确认仅执行本批既定 4 项操作 |
| B-154/AC-05 | [真实 View/Router 回归](../../../__tests__/operations-review-view.test.tsx)及 app 源 Chat 关闭、reload：旧页 model=null、产品动作 0、显示不可用；workspace state 仅 opaque reviewId，不能恢复确认能力 |
| B-154/AC-06 | 真实 receipt 决定成功/失败/跳过/partial/Undo，包括仅 receiptId 的过期反馈；app 从 Chat Undo all 后 4 个回执为 undone，2 篇笔记精确恢复，Chat/tab 同步。外部改文后撤销拒绝由原 controller 回归保护 |
| B-154/AC-07 | Desktop 36px、mobile 44px；长行/路径无横向溢出，原生 Tab 焦点为可辨 2px outline，中英文、增删符号和深浅主题可辨。mobile 最后变更与确认/取消均在核心导航栏上方可触达，见下述实测 |
| B-154/AC-08 | 新/旧配置与[持久化回归](../../../__tests__/plugin-settings-persistence.test.ts)保护退休键剥离和其他设置；实际设置页 auditLabels=[]，生产 store/接线/提示删除，不新增替代持久通道 |
| B-154/AC-09 | [审计退役回归](../../../__tests__/operations-audit-retirement.test.ts)分别构造已有和缺失目录：已有含正文 JSON 与未知文件；全生命周期四工具 stage/confirm、Undo、dispose，adapter 的 exists/list/read/mkdir/write/remove 及 getAbstractFileByPath 均记录，audit 范围访问为 []。缺目录同样零探测/创建；没有访问任何真实旧 audit |
| B-154/AC-10 | 完整 349-suite 回归及匹配输入复用覆盖四工具、Chat/fallback/Pagelet、Undo 和会话隔离；当前 CSS/artifact 及最后审计测试补验通过，没有新增工具、模型调用或其他日志系统改动 |

## 检查口径与复用边界

| 检查 | 原始结果与适用输入 |
| --- | --- |
| GLM 隔离树 `make bin` | 平台检查、lint、production build 通过；首次 full Jest 因两个插件 fixture 缺口及 sandbox spawn/listen 拒绝失败。失败完整报告后终止 owned Jest；make exit 2，不算自然 Jest PASS。fixture 已修复，后续系统 full gate 替代该失败结果 |
| 最终 JS/配置/依赖的 `npm run test:all -- --runInBand` | 349 suites / 8,495 tests PASS，409.738s，自然 exit 0；`t03-final-full.log/.exit`。瞬时 open-handle 提示后实际自行退出，不使用 forceExit |
| 后续 mobile CSS 修正 | GLM production build（含 type）、diff 自然 exit 0。仅 `src/custom.pcss` 与正常产物变化；直接 CSS 套件 5 suites / 354 tests PASS，11.341s，`t03-r5-css-suites.log/.exit`；fresh artifact 2 suites / 61 tests PASS，73.948s，`t03-r5-artifacts.log/.exit`。匹配输入的 full 业务证据复用，不声称又跑一轮 349 suites |
| 最后审计缺目录补证 | 仅参数化 `operations-audit-retirement.test.ts` 的已有/缺失两场景；1 suite / 2 tests、type、diff 自然 exit 0，`t03-r6-focused/type/diff.log/.exit`。其余 348 suites 及所有生产/app 输入完全相同，复用其证据，无需重建部署 |
| 社区 DOM 源码扫描 | `rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src` 无匹配（exit 1）；没有 runtime style/HTML 注入 |
| 文档收尾 | 删除过程包后 `npm run docs:check` PASS（254 Markdown / 3,017 local links；仅 4 条原有 episodic-memory advisory）；`npm run test:docs -- --runInBand` 2 suites / 58 tests PASS，6.947s，自然 exit 0；`git diff --check` PASS。`docs-closeout.log/.exit`、`docs-closeout-tests.log/.exit` 保留原始结果；最终证据补录后复核 docs/whitespace，不重复 runtime/build/app gate |

本任务最终输入冻结共 940 项；`t03-accepted-freeze.json`、`final-accepted-drift.json`
与 `reception-accepted.json` 记录 worker/root 输入与精确接收，最终差异为 0。
最后审计测试 SHA-256：`5731cf2f8a62f1b7d46ae1ae76578ff5a94acd9437507148690295b73d1fb3ff`。
这些证据只对应当次输入，不能凭 HEAD 相同推定以后未提交改动仍已验证。
文档收尾再次逐项核对 root/worker 的 940 项输入，差异均为 0；部署脚本与样式保持
下列完整 SHA，两个 HEAD 未变、staged paths=0，结果为 `docs-closeout-runtime-protection.json`。

## 部署身份与实际应用

- 接收树基线：`6c34f3b419ef9813e26b50f0df5509a475d59324`，两树 HEAD 未改变，staged paths 为 0。
- 最终 `main.js` SHA-256：`dab2b06898d6610c186f137c56bacc0f10596c836bd09bdf82390ffbf4e67777`。
- 最终 `styles.css` SHA-256：`c24ef833df5a6466f8ea39f27fbaf064b0d6c86921477e84c02f904d20a14c93`。
- manifest 版本仍为 2.9.2，没有版本/发布改动。满足当前检查与构建身份条件后，以 `make deploy-current` 精确部署到实际 `test/.obsidian/plugins/personal-assistant/`；CLI reload 后核对加载的 main 身份及 mobile footer computed bottom=52px。
- 本机 Obsidian CLI 为 1.14.2、installer 1.13.7。Desktop 视口 1330×861、DPR 2；mobile 采用已批准的 `obsidian vault=test dev:mobile on/off`，代表视口 418×808。CLI mobile 会 reload 并使用独立 mobile workspace，不能冒充 iPhone/WKWebView 原生证据。
- 固定合成 Chat 流进入真实 Chat/controller，使用 test vault 的合成笔记；实际键盘、滚轮、展开/确认/取消/Undo 操作与内容对照证明 UI/Operations 接线，不评估真实模型生成质量。验证期间其他 Memory 后台活动不归为 B-154 请求或费用。

mobile 最初截图发现核心浮动导航遮住确认/取消，不能把“DOM 在视口内”当作按钮可用。
GLM 仅复用 `--mobile-toolbar-height` 修正 footer offset 和正文尾部 padding，父布局的
safe-area 不重复添加。最终真实滚轮滚到 scrollTop=4705.5：footer top=653、bottom=722，
核心 navbar top=724、bottom=776，无重叠；确认/取消高 44px，两个中心 hit-test 均命中。
最后新增行 top≈493、bottom≈516，位于 actions top=653 以上；从底部真实取消后两篇
笔记仍与 baseline 完全相同。原始证据为 `r5-mobile-result.out`、`r5-mobile-final.png`
和 `r5-cancel-result.out`。

Desktop 已实际核对重复展开、关/重开、完整上下文、跨笔记导航、tab 确认、Chat Undo
及小批取消；native Tab 的 focus-visible 与深浅主题截图已观察。源 Chat 关闭后旧审阅
页无动作、无模型；mobile 切回 Desktop 后旧 workspace 页也不可用。
本改动没有新增 iOS 原生依赖，按批准计划未设真机 gate；模拟证据不证明真机键盘、
触摸事件或 BRAT 安装。

## GPT 与 GLM 执行及资源边界

GPT 负责产品/设计、任务修订、接收保护和独立验收；GLM 为唯一 runtime/test writer，
使用独立 Codex CLI 0.157.1、Node 22.22.1、npm 10.9.4 的连续 session
`01a0f13b-c6bb-7f02-a224-762a680ebb97`。已验证的配置目的地为 ZAI
`https://open.bigmodel.cn/api/v1`，请求模型 `glm-5.3`、reasoning `max`；服务端实际型号
未知。首次正式派发被自动审批拒绝后，Owner 明确授权必要仓库源码/测试/设计发送至
此目的地，worker 写入仅限隔离树；没有发送私人 vault、读取凭据或开放主树写入。
GPT 只补 GLM sandbox 无法完成的系统 full gate 与真实 app 观察，不以其他模型替代 GLM。

- 原始 tasks/events/result、退出文件、full/focused/build/deploy 日志、冻结/接收记录、修复前后截图保留在本机 `/tmp/pa-b154-12d246a7`。它是临时本地证据位置，未承诺 Git 保存原始日志或跨设备可用。
- 隔离树 `/home/admin/.codex/worktrees/b154-note-change-review/personal-assistant` 保留 dirty 源码、测试、契约副本与安装依赖；root 的 `node_modules` 链接仍使用该安装。主树已精确接收交付，但没有 Git/dirty worktree 归档授权，不 force-remove，不修改 lockfile 或稳定 GLM 配置。
- 两组合成笔记均已实际撤销/取消后删除，owned Chat/review/note leaf、mobile/语言/主题/临时开关和窗口状态恢复；原有 Chat 和笔记保留。`app-final-restoration.out` 记录 mobile=false、reviewTabs=0、两组 fixture 目录均不存在、ops=false。
- owned `scratch/probe.cjs` 与空 scratch 目录已删除；required raw evidence、共享依赖和未提交成果保留。没有扫删其他任务资源，也未读取、探测或删除任何旧 audit 目录。

## 文档处置

Owner 已明确授权“继续文档收尾”。稳定范围、工程职责及测试保护已吸收；Feature Home、
Plan、SDD、Tracker 默认 delete-after-absorption，Active Registry 入口删除，
[Disposition Log](../disposition-log.md)记录去向。只保留本紧凑验证文档，不归档完整包、
逐轮 review 或重复 checklist。过程包本轮未提交，不声称能从已有 Git 历史恢复；
原始任务证据与 dirty worker 的保留原因见上文。文档收尾不代替 Git 集成或发布。
