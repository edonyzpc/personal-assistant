# Lean Ghost Publishing Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-10-07
Work item: B-163
Authority: 本 track 唯一执行状态、分工和验证记录。
Product spec: [Ghost Publishing](../../../product/specs/pa-ghost-blog-publishing-product-spec.md)
SDD: [Implementation design](./sdd.md)

## Current Snapshot

- Current phase: 实现、独立风险审查、自动化检查、已部署运行路径与真实窗口按钮验收完成，Validated。
- Next action: 本次开发测试无剩余必需任务；后续 Git 交付、closeout 或 release 按单独授权执行，不自动归档。
- Blocker / decision needed: 无。先前窗口证据异常已解决：观察到页面 visibility=hidden；显式前置 test vault 窗口并执行原生 AX Raise 后取得当前画面，完成真实按钮操作。Owner 明确 GLM 周限额，本任务未启动或探测 GLM，全部由 GPT 实现验证。
- Last verified behavior: production build/type-check、lint 通过；全量 376 suites/8915 tests PASS，唯一旧工具失败已定向修复为 1 suite/55 tests PASS。test vault 真实 Host/controller/client 完成新建、覆盖、隔离预览、固定候选确认与清理；实际点击 Ask、首次 Open preview、Edit in Ghost、published preview 和确认按钮通过。快速双击确认只产生一次原 ID PUT；本机合成响应，不声称真实 Ghost/AI 线上验收。
- Authorization: Owner 2026-10-06 要求按 SDD 设计开发测试方案并由 GPT 完成开发验证；不含 commit/push、closeout 或 release。
- Baseline: master 工作区已有本对话的 10 个方案文档改动，无运行代码改动；保留所有已有内容。

## Ownership And Sequence

1. GPT root 建立 SDD；三名 GPT writer 在互斥文件范围实施，共享树不互相覆盖。
2. 内容 writer：binding/properties、fields/snapshot、wiki-links、resources/exporter/source-loader/types 与直接测试；保留未受影响转换能力。
3. 领域 writer：service/action-context、state-schema/state-store、client/markers 与领域、workflow 测试。
4. UI writer：controller/card/preview、Ghost locale/CSS 与 controller/preview 测试。
5. Root：host-integration、Agent tool/types/source executor/receipt、Chat/plugin 接线及其测试；文档/Tracker 唯一 writer。
6. Writers 只跑分配的 focused suites；root 在输入冻结后统一运行昂贵 lint/build/full gate 和部署。全仓检查不在并行写入期间重复运行。
7. 数据/权限/外部写入属于需要独立审查的风险；writer 完成后由其他 GPT 只读交叉审查，root 根据实际 diff 和原始证据验收。

## Work And Validation Mapping

| ID | Requirement / AC | Slice / evidence needed | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-163/REQ-01、B-163/REQ-02、B-163/REQ-12；B-163/AC-01、B-163/AC-09 | 选源/单 GHOST_ID；无字段与精确不存在新建、查询失败停止、非法字段不新建、旧字段忽略、成功回写/失败保留 | [x] | binding/host/service focused 与全量覆盖；部署运行新建回写 PASS |
| T-02 | B-163/REQ-04、B-163/REQ-05；B-163/AC-02、B-163/AC-08 | 当前内容完整覆盖、缺失清空与自动字段、运营字段保留；普通双链按真实 published 查询；复用综合转换夹具 | [x] | metadata/snapshot/resources/export/wiki-links focused 与全量覆盖 |
| T-03 | B-163/REQ-03、B-163/REQ-08、B-163/REQ-09；B-163/AC-03、B-163/AC-06 | 草稿直接保存；published 独立预览/固定候选/原 ID 确认/清理；仅资源指针持久化；未知写入不重放 | [x] | service/action-context/workflow focused、全量覆盖与部署运行 PASS |
| T-04 | B-163/REQ-07、B-163/REQ-10；B-163/AC-05、B-163/AC-07 | 精确来源权限与 Host 准入；无关变更不失效；真实远端成功不被本地失败覆盖；未知与明确失败分开 | [x] | task-source/prepare-tool/result-facts/host focused 与全量覆盖；B-157 适配后离线 55 tests PASS |
| T-05 | B-163/REQ-06、B-163/REQ-11；B-163/AC-04 | 直接 tab preview/admin URL；精简卡片；取消 probe、ticket、恢复和重复确认 | [x] | controller/preview PASS；首次真实预览按钮打开 UUID tab，后台按钮定位正式 ID；卡片与可见页面验收 PASS |
| T-06 | B-163/REQ-01、B-163/REQ-03、B-163/REQ-05、B-163/REQ-07；B-163/AC-01、B-163/AC-03、B-163/AC-05、B-163/AC-08 | 独立风险审查、整体验证与测试 vault smoke；不使用 anthelion/生产 Ghost 文章作测试 | [x] | 独立审查、自动化、部署运行、真实按钮及快速双击确认全部完成；外部限制明示 |

只对已改变输入、真实失败或未覆盖风险补测。内容媒体复用已有有效覆盖；不做模型反复采样、跨设备或中断恢复验证。

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-10-06 | B-163/REQ-12；B-163/AC-09 | 设计前源码核对 | PASS | binding-properties 旧版四字段，需显式替换；旧兼容不是当前产品约束 |
| 2026-10-06 | B-163/REQ-01、B-163/REQ-04、B-163/REQ-05、B-163/REQ-12 | 内容 writer focused | PASS | binding/export/resources/snapshot/metadata/wiki-links：6 suites/78 tests；ID 大小写改动后受影响 binding/wiki 2 suites/14 tests PASS |
| 2026-10-06 | B-163/REQ-06、B-163/REQ-11 | UI writer focused | PASS | controller/preview：2 suites/15 tests；范围内 diff/DOM scan clean，不作为应用证据 |
| 2026-10-06 | B-163/REQ-07、B-163/REQ-10 | Root Host focused | PASS | task-source-constraint/b153-tool/host-integration/runtime-prompt：4 suites/71 tests；`/tmp/pa-b163-root-focused.log` |
| 2026-10-06 | B-163/REQ-03、B-163/REQ-10 | Root Chat/领域真实接线 | PASS | domain-action-state/b157-continuity：2 suites/25 tests；首次丢响应保留 operationId+unknown，原文不变，无重复 POST；`/tmp/pa-b163-domain-facts.log` |
| 2026-10-06 | B-163/REQ-01、B-163/REQ-06、B-163/REQ-10 | 新 ID 导航集成 | PASS | b157-continuity 加新文回写后 preview/editor 回归：3 tests PASS；真实 Host/controller/action-context/service，受控远端；`/tmp/pa-b163-real-controller.log` |
| 2026-10-06 | B-163/REQ-08 | preview store focused | PASS | workflow 7 tests；指针严格三字段、实际事务提交/回滚、旧 DB 不读不改、无旧操作续接 |
| 2026-10-06 | B-163/REQ-02、B-163/REQ-03、B-163/REQ-07、B-163/REQ-10 | 域 writer focused | PASS | service/action-context/client：3 suites/86 tests；`/private/tmp/b163-ghost-domain-focused.log`。首次 client 本地监听 EPERM 是沙箱限制，同一合成 loopback 范围获准重跑后通过 |
| 2026-10-06 | B-163/REQ-01 至 B-163/REQ-12 | 独立风险审查 | PASS | 两名 GPT 只读交叉审查；复核 F-01..F-07 修复与实际定向夹具，未重复跑测试，无剩余 must-fix |
| 2026-10-06 | B-163/REQ-07、B-163/REQ-11 | lint / production build | PASS | full lint 仅 unused type import，删除后该文件 eslint PASS；build 首轮发现测试 mock 类型不完整，修正签名/加强 preview ID 断言后 build PASS；`/tmp/pa-b163-lint.log`、`/tmp/pa-b163-lint-fix.log`、`/tmp/pa-b163-build.log` |
| 2026-10-06 | B-163/REQ-06、B-163/REQ-11 | 社区 DOM 源码扫描 | PASS | root 全 src 扫描无 createElement(style)/innerHTML/outerHTML，exit 1；`/tmp/pa-b163-community-scan.log`。不是 hosted scan |
| 2026-10-06 | B-163/REQ-01 至 B-163/REQ-12 | 全量验证首轮 | 376 PASS / 1 FAIL | 377 suites、8969 tests：376 suites/8915 tests PASS；唯一 B-157 工具 beforeAll bundle 引用旧 GhostOperationStore 导致 54 tests FAIL。自然退出 exit 1，未使用 forceExit；`/tmp/pa-b163-full.log` |
| 2026-10-06 | B-163/REQ-03、B-163/REQ-08、B-163/REQ-10 | B-157 工具适配及独立复核 | PASS | 只改 scripts/b157-context-eval-entry.mjs 和直接测试；当前会话 prepare/confirm/未知事实，保留其他三域、预算、合成数据边界。离线 1 suite/55 tests PASS、自然退出 exit 0；`/private/tmp/b163-b157-context-focused.log`。另一 GPT 只读复核无 must-fix；生产输入未变，复用首轮其余 376 suites，不伪称全量单轮全绿 |
| 2026-10-06 | B-163/REQ-01、B-163/REQ-03、B-163/REQ-06、B-163/REQ-07 | 当前构建部署与运行验证 | PASS（运行路径） | make deploy-current 核对构建身份并部署 test vault，重载 PA 2.10.3 / Obsidian 1.14.4。真实 Host/controller/service/client、Vault 与 loopback 合成响应：新建并回写 GHOST_ID、同 ID draft PUT、published 独立 preview 不改原文、编辑源后确认仍用固定候选、exact preview DELETE；errors=[]。预览与 admin URL 完成异步加载后正确；`/tmp/pa-b163-deploy.log`、`/tmp/pa-b163-app-runtime.json` |
| 2026-10-06 | B-163/REQ-06、B-163/REQ-11；B-163/AC-04 | 原生窗口按钮 / 可见 UI | BLOCKED | 旧 AX 索引点击无可靠效果、坐标动作报 noWindowsAvailable；新窗口标题/DOM 已为合成 Draft，CUA 与 CLI 截图仍为旧 Dog。停止基于旧画面操作，test vault 重载后仍无可靠 AX。`/tmp/pa-b163-runtime-window.png` 仅是异常证据，不是目标 UI PASS；未将 CLI session.run 当作真实按钮点击 |
| 2026-10-06 | 测试环境 | 恢复与范围核对 | PASS | 临时配置/metadata/Chat stream 已恢复；viewer false、debug false、mobile false，与初始状态一致；smokeActive=false、ownedServers=0，插件已加载。旧控件误导下测试按键曾在 Dog 插入空格+换行，已按精确前缀只撤销这两字符；停止旧 AX 操作。合成夹具保留于 test/B163-smoke-20261006；未操作 anthelion 或真实 Ghost/AI 服务 |
| 2026-10-06 | 文档与交付范围 | docs / whitespace | PASS | docs:check：266 Markdown / 3491 local links；文档合同 2 suites/58 tests PASS；git diff --check PASS。`/tmp/pa-b163-docs.log`、`/tmp/pa-b163-doc-contracts.log`；未提交、推送或发版 |
| 2026-10-06 | B-163/REQ-06、B-163/REQ-11；B-163/AC-04 | 可见窗口补验 | PASS | 窗口置前与原生 AX Raise 恢复可靠画面。独立 New Chat 后真实 Ask 保存合成新草稿，首次 Open preview 直接打开 uuid URL；Edit in Ghost 定位新正式 ID；两个导航之后请求仍仅一次 POST。published 实际 Ask/预览显示隔离 draft，原文章仍 published、内容未变。卡片两按钮、文案、布局与 tab 均可见，无 Check preview 门禁；`/tmp/pa-b163-ui-preview.png`、`/tmp/pa-b163-ui-evidence.json` |
| 2026-10-06 | B-163/REQ-03、B-163/REQ-07、B-163/REQ-09；B-163/AC-03、B-163/AC-05 | 真实确认 / 快速重复点击 | PASS | 准备后编辑合成 note，再用 CUA 对确认按钮 clickCount=2；原 ID PUT 仅一次，保持 published，正文仍是本次固定候选，准确 preview 已 DELETE，新文仍 draft。第二击在完成后进入同位置后台入口，无重复提交；可见 Article updated 与正确原 ID 后台 URL。errors=[]；`/tmp/pa-b163-ui-updated.png`、`/tmp/pa-b163-ui-evidence.json` |
| 2026-10-07 | 测试环境 | UI 补验恢复 | PASS | 真实 Chat/卡片/Host/client，Chat stream 与 metadata 使用本地确定性替身，Ghost 仅 loopback 合成服务；未调用真实 AI/Ghost。恢复原配置、stream、metadata；临时网页 tab 已关闭；最终 viewer=false、debug=false、mobile=false、smokeActive=false、ownedServers=[]，与基线一致。合成笔记/独立测试 Chat 保留；`/tmp/pa-b163-ui-cleanup.json` |
| 2026-10-07 | B-163/REQ-01 至 B-163/REQ-12；B-163/AC-01 至 B-163/AC-09 | 完成性核对 | PASS | 独立 GPT 逐组核对当前 Spec/SDD、实际测试与原始日志；唯一剩余可见按钮项已由 root 补验。生产输入未变，复用既有构建和自动化；不增加已排除的跨设备、恢复或线上发布范围 |

最终 broad gate 由 root 执行一次：lint、production build、test:all、diff/docs 检查和社区 DOM 源码扫描。
已通过 lint/build/full gate 时以 deploy-current 部署，否则用 make deploy 包办，避免重复。
应用验证使用 repo-local test vault、合成笔记/受控测试 Ghost 响应，实际点击预览/编辑/确认；
真实 Ghost 服务或凭据不可用时单独标明接口验证限制，不把本地响应模拟称为线上验收。
当前会话候选的来源编辑、取消、权限撤销、同目标重复调用已有定向回归；来源编辑后的固定候选确认与快速重复点击另有已部署真实窗口证据。

测试脚本的两次诊断不是产品失败：首次初始化调用不存在的 core plugin manager 方法，已精确关闭本次本地服务、重载插件恢复配置并使用实际插件 enable/disable 接口；首次运行断言未兼容 YAML 为纯数字形式的 ID 自动加引号，改正断言后继续，未重复 POST。所有服务均为 loopback 合成响应，不代表真实 Ghost 主题、后台鉴权或线上发布验收。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | prepare 已记录未知状态但抛出，controller 丢失初次 op，误报 not_started | 域返回已建立操作的失败事实 | 真实 controller/service 首次丢响应回归 PASS | Fixed |
| F-02 | P1 | 确认的 fresh context 只按路径不能识别同路径新文件 | 会话保存独立 TFile 身份校验，与新权限相交 | 原 scope 结束不失效、同路径替换拒绝回归 PASS；独立复核通过 | Fixed |
| F-03 | P1 | 固定候选 embed 新增 #no-ai 时，仅 path 校验漏掉内容权限撤销 | 确认逐 Markdown 依赖复查当前内容权限，不重导出 | 普通编辑通过，#no-ai 撤销拒绝，metadata 仍只生成一次；独立复核通过 | Fixed |
| F-04 | P1 | 新文回写 ID 后，fresh 导航误比准备前 ID | 仅接受本次已确认保存的正式 draft ID 或未完成回写的原关联 | 真实 Host/controller 新建后两按钮回归 PASS | Fixed |
| F-05 | P2 | 关闭 Chat 把已保存 preview 改写 failed | 只撤销当前确认权与身份校验引用，保留保存事实 | 保存事实保留、旧确认拒绝回归 PASS；独立复核通过 | Fixed |
| F-06 | P1 | 同会话草稿被人工 Publish 后，正式 ID 被误用为临时预览 | 只从 published 流程复用与正式 ID 不同的准确 preview | draft→人工 Publish→新隔离 preview 回归 PASS；独立复核通过 | Fixed |
| F-07 | P2 | binding 失败后的新 GET 失败遮蔽已保存 ID，第三次触发可能重复 POST | 同会话保留最近可信 draft ID，真正回写成功后结束临时复用 | bindfail→GETfail→再次同步同 ID、POST 仅一次回归 PASS；独立复核通过 | Fixed |

## Closeout Readiness

- [x] 实现与 Spec/SDD 一致，必需检查和独立审查完成。
- [x] 部署运行与可见 UI smoke 通过，真实外部服务限制已记录。
- [x] 当前契约与实际实现一致；本 Tracker 保存失败首轮、修复及最终验收证据。
- [x] 已到 Validated；未授权 closeout/commit/release，未提交、推送或发版，不自动归档。
