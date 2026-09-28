# Unified Chat Image Creation Development Tracker

Document status: Current
Delivery status: Planned
Updated: 2026-09-28
Work item: B-152
Authority: 唯一执行状态、GPT/GLM 任务、验收证据与接收记录。
Product spec: [Product Spec](../../../product/specs/pa-unified-chat-image-creation-product-spec.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: 设计文档已落地并通过文档检查；运行时代码未改，未启动 GLM。
- Next action: 实施获准后，核对当前输入/GLM 本机预检，复核与 SDD 的源码漂移并按下方任务派工。
- Blocker / decision needed: 无未决产品选择；当前授权止于文档，实施、付费验证、Git/发布分别处理。
- Last verified behavior: 源码确认显式入口先提交原问题，同操作后续复用；Featured command 有独立专用提示词调用。本次未重新生图。
- Delivery tree: 当前仓库设计文件；后续默认隔离工作树，master 为集成权威，派工时填写真实路径/基线。
- App target: 后续默认 repo-local `test/`；不部署/改写 anthelion，不传其私人笔记给 worker/provider。
- Owned temporary resources: 无；本次只有仓库设计文档。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-152/REQ-02 / B-152/AC-02；B-152/REQ-03 / B-152/AC-03；B-152/REQ-04 / B-152/AC-04；B-152/REQ-07 / B-152/AC-07 | 源快照、专用准备与唯一提交；固定原问题误提交/取消目标回归 | [ ] | R-01 / R-02 |
| T-02 | B-152/REQ-01 / B-152/AC-01；B-152/REQ-05 / B-152/AC-05；B-152/REQ-06 / B-152/AC-06 | 来源 UI、command、选项/保存、再生成与历史兼容 | [ ] | R-02 |
| T-03 | B-152/REQ-08 / B-152/AC-08；上述全部 REQ/AC | 冻结输入、一次完整部署门禁、真实入口/少量模型证据、GPT 独立验收 | [ ] | Validation Plan |

默认一个 GLM writer、一个连续实施上下文。唯一前置检查点用于异步/付费边界的核心
负例；不对每个模块另开 understand 或独立 red-test 会话。

## GPT / GLM Dispatch

按 [工作流](../../workflows/gpt6-glm-delivery-workflow.md) 与 [模板](../../templates/glm-worker-task.md)。
本节是任务事实源，执行时生成临时完整任务输入，不另建长期 handoff/状态文件。

### R-01 — 目标回归检查点

- Mode: reproduce；实施授权后派发，GLM 检查依赖并保留同一上下文。
- Goal: 原请求与预期实际描述不同；延迟 Agent/准备完成时 provider 必须零调用；
  放行后只提交准备结果；取消后无新增调用。原代码必须因前置提交触发目标失败。
- Allowed: 现有 chat-view / image-generation source tests 与最小 fixture；不改生产源码。
  先用现有 host binding/streamLLM 边界证明提前提交，新 Proposed 接口不能成为唯一失败原因。
  新接口的具体保护在 R-02 补齐；导入/fixture 接线错误不是有效目标红灯。
- Return: 最小测试 diff、目标断言失败/自然退出和准确输入身份。GPT 核对后继续同一
  worker 的 R-02；不重复根因研究，不造第二份测试计划。

### R-02 — 连续实施与自查

- Role / stop: GLM 实施 T-01/T-02 和获派验证，提交待验收报告；GPT 独立接受。
- REQ/AC: Product Spec 全部 B-152/REQ-01–08、B-152/AC-01–08；原专用提示词/独立
  准备、明确来源、唯一任务、旧有效选项、每次显式保存为不可变约束。
- Read set: AGENTS.md、Feature Home + Tracker、Spec、SDD 与直接相关源文件。
  已读未变内容复用；不要求重读 Archive/机器 Memory，不假定继承主会话事实。
- Allowed edits: `src/chat/{chat-view.ts,composer-draft.ts,ChatHost.ts,plugin-integration.ts,image-generation-service.ts,image-generation-types.ts,image-save-to-note.ts}`；
  `src/ai-services/{service.ts,featured-image-options.ts,chat-tool-types.ts,chat-tool-factories.ts}`；
  SDD 标注的窄提示词/准备模块；`src/plugin/ai-actions.ts`、`src/plugin.ts` 接线；
  `src/settings/featured-image-options-modal.ts`、`src/settings.ts` 直接相关设置接线；
  plugin EN/ZH locales、`src/custom.pcss`/构建输出、直接对应测试。
  其他来源适配若需窄接线，由 GPT 核实 owner 后扩展清单，不整片重构 runtime。
- Authority: GLM 不改 Decision/Spec/Tracker/验收标准；GPT 接收代码后同步 Architecture。
- Non-goals: 无第二入口/任务系统/通用 registry、合并模型调用优化、全库取材、自动插图或额外择优。
- Tree / baseline: GPT 派工前填写绝对工作树、base commit、dirty 归属和接收树；隔离树
  不会自动包含这些未提交设计文档，须明确提供并比对当前版本后启动。
- Model / preflight: 记录实际 pa-glm profile/provider/model/catalog、工具和适用预检。
  不假定跨设备有效，不重复未失效的接入实验；核对必要项目材料外发的适用授权。
  只传必要源码/测试/契约，凭据用户操作；CLI 不继承桌面 CUA，不用其他模型冒充 GLM。
- Dependencies: 核对本机 runner、Node/npm 和 lockfile，存在即可用；不例行重装或改模型配置。
- Target / gates: 指定一名执行者对冻结输入做最终门禁。隔离树 make 的 test 可能不是
  用户打开的 test；核对实际 vault 路径与已加载插件，接收输入到授权目标树后再部署，
  或明确已验证的目标接线，不把 worker build 当作目标 app 已更新。
- Resources: 记录独有 run dir、worktree、进程/fixture；验收前保留原始证据。GPT 接收后
  只清理本任务可丢弃资源，保留用户状态、共享依赖、源码和仍被引用的唯一证据。
- Report: 变更及目的、逐项 AC/断言/原始结果、命令/cwd/自然退出、验证输入和实际部署
  身份、失败/未运行/未验证、临时资源。不得 stage/commit/push/发布或自动推进下一任务。

## Validation Plan

| REQ/AC or risk | Change | Minimum evidence / command | Pass condition | Rerun / expansion trigger |
| --- | --- | --- | --- | --- |
| AC-02/03/04 原问题误提交/串源 | 绑定与准备顺序 | R-01 红灯；R-02 deferred sentinel + A/B 笔记，捕获真实 adapter 请求体 | 原代码因提前提交失败；新代码准备前零 POST，之后只发 sentinel；选区外标记不入准备 | 编排/来源/准备入参/序列化改变 |
| AC-04/07 重复费用/取消 | 去重、receipt/signal | 既有 image-generation-service / chat-view 定向案例 | 同操作准备/提交各一次；取消/撤销/连接变化后迟到零 POST | 身份/生命周期/恢复改变 |
| AC-01/05/06 UI/兼容 | 草稿、command、codec/选项/保存 | `npm test -- --runInBand __tests__/composer-draft.test.ts __tests__/chat-view.test.ts __tests__/plugin-ai-actions.test.ts __tests__/image-generation-service.test.ts __tests__/chat-image-generation-store.test.ts`；按实际变更追加 prompt/options/save suite | 空补充、真实描述、旧非默认设置、旧任务读取、再生成和显式保存均有行为断言 | 相关输入变化，不因覆盖率数字扩大 |
| AC-03 专用能力 | 提取模板并使用 | 请求组装测试 + GPT 核对原提示词提取 diff；两段合成材料真实文字调用 | 原指导实际入请求，主题相关/视觉具体/遵守用户约束 | 模板/接入变化或明确语义失败 |
| 共享 Chat/插件回归 | 整体变更 | 冻结后指定 GLM 一次 `make deploy`；另跑 `npm run docs:check`、`git diff --check` 和 AGENTS DOM/style 源扫描 | 自然通过 lint/build/full Jest，目标插件与构建一致，无新增违规 | source/tests/config/依赖改变、失败或部署身份不符 |
| AC-01/02/06/08 真实入口 | @ / command / 控件 | GPT Desktop：选区 → @ → 预览/切换/移除；command 预填；非空草稿保护；详情与一次选目标保存 | 每个改动入口实际操作，焦点不丢来源，保存前不写笔记 | 入口/UI/焦点/保存接线变化 |
| AC-03/04/08 真实生成 | 完整链 | 有适用数据/费用授权后，采用其中一次合成提炼结果生成一张 Wan 图；核对来源、准备结果、真实 POST、卡片 | 提交为准备结果，图可用且符合关键主题/限制；助手自述不算证据 | 真实失败/provider 接入变化；不因随机美感后台重抽 |
| AC-08 移动新控件 | 来源/选项/发送 | CLI mobile simulator 最小一次新增交互；复用已有结果无需重复付费 | 窄屏可达，入口/焦点/IME 无已发现阻碍 | 原生依赖或模拟器不能代表的具体风险才补真机 |

make deploy 已覆盖 lint/build/full Jest，不再重复 type-check/full test；deploy-current
仅在 AGENTS 当前输入证据条件满足时复用。source tests 不需先构建，artifact 由完整门禁
按正确顺序覆盖。保留原 reference/edit/多图/未知受理案例，不建来源 × 模型 × 平台 ×
错误全矩阵，不设置覆盖率目标、额外性能研究或大规模视觉评测。缺真实证据标未验证，
不能以更多 mock 替代。付费调用未授权时先完成其余工作，不调用私人笔记或生产 vault。

## GPT Independent Acceptance

1. 读实际 diff/关键断言：原提示词保留且实际使用；前置 submit 已移除；所有付费路径
   共用去重/guard；command 无旧执行链；新字段经过 codec，旧记录可读。
2. 核对 GLM 原始结果、自然退出、验证输入/部署身份；复用有效证据，不重跑已覆盖门禁。
3. 实际操作两个 Desktop 入口及 mobile 新控件；检查两份文字提炼和一次真实 Wan
   payload/结果。按 SDD 三项语义标准判断，不要求固定图像或措辞。
4. 发现问题给出 AC/触发条件/最小修复复测范围，GLM 同上下文修复；只有 GPT 更新
   验收状态。必要证据齐全才 Validated，Git/合并/发布/closeout 另行授权。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | 显式入口先登记原问题，后续构思不改变任务 | T-01 去前置提交 | 待 R-01/R-02 | Open |
| F-02 | P2 | 仅调整顺序没有沿用 Featured 专用指导 | 原模板 + 独立准备为必需步骤 | 待 AC-03 | Open |

两项为已确认的待实现目标，不是未决产品选择。

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-28 | 全部目标范围 | 源码、旧契约和已确认讨论核对 | Design baseline established | 本次只落文档，不声称运行时或模型效果已验证 |
| 2026-09-28 | 文档交付 | `npm run docs:check`；当前仓库 | PASS，exit 0 | 245 Markdown / 2913 本地链接；4 条既有 episodic-memory 索引/可达性告警，未扩大豁免 |
| 2026-09-28 | 文档交付 | `git diff --check`；当前仓库 | PASS，exit 0 | 仅文档变更；未运行 runtime tests/build/deploy，未发起付费调用 |

## Closeout Readiness

- [ ] 全部目标行为与代码一致，GPT 独立验收完成。
- [ ] 必需 source/full/app/真实模型证据及未测范围记录完成。
- [ ] Architecture 与 DEC-038/B-133 接续说明符合交付事实。
- [ ] 任务资源清理完成或说明保留原因。
- [ ] 获得 closeout 授权后吸收稳定结果，默认删除过程文件，仅保留独有证据。
