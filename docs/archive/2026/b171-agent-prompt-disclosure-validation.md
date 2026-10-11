# B-171 Prompt Disclosure 验证与延期证据

Document status: Archived
Recorded: 2026-10-11
Work item: B-171

本页只保存独有验证、失败与用户收口依据，不作为当前实现或执行状态权威。
当前范围由 [DEC-060](../../product/decisions/dec-060-agent-prompt-progressive-disclosure.md)、
[Product Spec](../../product/specs/pa-agent-prompt-disclosure-product-spec.md) 与
[Agent architecture](../../architecture/pa-agent-architecture-plan.md) 持有。
[证据记录](./b171-agent-prompt-disclosure-evidence.json) 保留原始最终答复、关键工具轨迹、构建/输入哈希与验证记录。

## 授权与处置

用户先授权隔离 worktree 开发测试，随后明确保持本次精简范围、保留失败并延期未知效果答复缺口；
之后授权 B-171 closeout 与本地 master 提交。B-171 按该决定收尾为 Closed，**不表示全部 AC 通过**。
未解决答复问题在真实使用中遇到时再讨论，由 [B-159](../../backlog.md#已延期的产品与工程工作) 承接；
工具接口渐进披露 B-172 与 B-170 通用计算方案均独立，不在本次扩围。

最终行为已进入当前契约与源码；Feature Home、SDD、Tracker 及其 Active Registry 入口吸收后删除，
不归档完整过程包。原始设计曾提交，本轮最终执行 Tracker 增量未单独提交，不能声称旧 Git 保存了完整执行过程。
Git 提交、推送与发布结果不由本报告推定。

## 输入、构建与门禁

实施基线 `69b4f9aee48c7ea6e35c84651aa3eaed3cb0dac7`；独立执行树与 repo-local test 验证，
不触碰私人 vault。模型样本使用合成资料及已配置 qwen / deepseek-v4-pro / thinking=true。
初始插件 artifact SHA-256 为 `29011532c03165ee247587c457d9897f7e0dab97d30e79f5b2777e5503fb658c`；
R3 最终 artifact 为 `c1b1e96324de9bd7ca9af4ed246f9e0b5f72ff676234802c727a4574a8217f35`。
各样本自身构建身份与原始文件哈希以同目录证据记录为准。

| 检查 | 结果与边界 |
| --- | --- |
| 冻结共享 runtime 门禁 | lint、production build、`test:all` 全部自然 exit 0；385 suites / 9320 tests PASS，无 skip/forceExit。源码/测试/资源差量身份前后一致 |
| R2 独立审查 | 修复通用规则重复与第二次完整投影；最终发送/估算复用有效说明，无新增框架。受影响回归及最终实际请求核对通过 |
| R3 指南澄清 | 仅 Ghost guide 一条兼容澄清；源码/测试差量身份不变，复用冻结门禁。既有指南 suite 24 tests、重新构建和产物 61 tests PASS；这不是文案效果通过 |
| 实际 Chat | M1 通过真实输入框提交；完整六篇列表与 Thinking → Context Used 来源已可见，包含 query_notes 与 Not a Memory reference，保留[原始观察截图](./b171-prompt-disclosure-m1-context-used.png)。M2/M3 为独立 service 样本，不冒充 App 交互 |
| 临时环境恢复 | 两轮模型均自然结束；观察器/service、临时凭据、探针、复制设置与合成资料清理；笔记文本 hash 核对后删除。合成 Chat 清理，debug/mobile 恢复 false，隔离窗口关闭，四份插件资产恢复初始 hash；主测试库插件与凭据保留 |
| Closeout 文档门禁 | 主 checkout 接回 15 个已验证实现/测试/架构文件且字节一致；`docs:check` 为 292 Markdown / 3812 links，文档合约 2 suites / 57 tests PASS，diff 检查通过。仅暂存本任务及延期记录，B-170 修改保留在工作区 |

## 唯一同题对照与方法样本

M1 使用同一明确的 frontmatter `date` 日历区间 `2026-09-27 ≤ date < 2026-10-11`，
八篇合成笔记中正确完整返回六篇，日期升序。两臂配置和用户输入一致，均为三次物理模型调用，
`query_notes` 一次及六次 properties 读取，无正文或效果调用。26 个工具名称、顺序及参数相同，
仅 `load_skill` description 增加 71 字符；实际查询参数仅候选省略冗余 date-exists 条件。

| M1 指标 | 基线 | 候选 |
| --- | ---: | ---: |
| 首 SDK 请求字符 | 48,946 | 45,984 |
| system 正文字符 | 28,907 | 26,037 |
| 工具声明字符 | 17,469 | 17,540 |
| 整任务输入 tokens | 36,266 | 34,546 |
| 输出 tokens（含 reasoning） | 1,525 | 1,469 |
| reasoning tokens | 577 | 562 |
| ChatService 总耗时 | 27.615 s | 27.313 s |

输入 tokens 减少 **4.74%**。每臂只有一条逻辑任务；耗时与首答案回调并非屏幕绘制时间，
不证明稳定提速或普遍成功率，也不解决 B-170 原始自然语言日期问题。

M2 为自然 DataviewJS 方法请求：日期半开范围、升序链接/日期、按文件分组的未完成任务普通表格，
不给笔记写入效果。入口与 exact reference 各读取一次，方法答复语义通过；指南结果为 `skill-guide`、
`statusOnly=true`、`citationEligible=false`，没有冒充笔记来源。四次请求，66.052 s，
input/output/reasoning/total 为 51,729 / 3,840 / 2,382 / 55,569 tokens。
未在 Dataview 中运行答复代码，没有同题基线或净耗时结论。

## M3 两次失败与证据边界

合成原操作 ID 为 `b171-ghost-unknown-01`，owner 为 `ghost`、phase 为 `unknown`，可能已有效果，动作工具撤下。
两次各四个实际请求均保留通用恢复原则、Ghost 解释与 owner 事实，未发现 B-171 拼装遗漏。

| 样本 | 结果 | 成本观察 |
| --- | --- | --- |
| 原 M3 | **FAIL**：将未找到草稿解释为未保存，并条件邀请重新提交 | 32.382 s；input/output/reasoning/total 37,044 / 1,466 / 850 / 38,510 tokens |
| R3 唯一复验 | **FAIL**：仍建议在新会话重提，并将可能有效果升格为 Ghost 确实收到请求 | 40.484 s；input/output/reasoning/total 35,645 / 1,945 / 1,362 / 37,590 tokens |

R3 只澄清旧指南，不改变真正新任务的权限。复验中唯一 `load_skill` 被 Host 批次预检以
`source_read_plan_unavailable` 拒绝，四次请求都未携带新旧指南正文；因此修订的行为效果**未验证**，
不能由该失败推断文案有效、无效或因果，也不能把一次批次拒绝直接认定为产品缺陷或所有工具不可用。
两次均无实际 Ghost/image/writing 效果，撤下效果工具后的回答不证明执行防重放。

用户选择保留两次 FAIL 与指南送达限制，结束本轮，不修改正确的验收合同、不继续采样。
这些样本支持具体答复缺口记录，不支持实际同步故障、B-171 回归或一般成功率的结论。
