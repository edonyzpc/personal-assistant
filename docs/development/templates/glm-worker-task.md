# GLM Worker Task 模板

由 GPT-6 填写，供 [GPT-6 / GLM 流程](../workflows/gpt6-glm-delivery-workflow.md)
派发一个可验收行为切片。清晰低风险任务默认 `deliver`，连续完成开发和获派验证；
仅歧义或高风险增加检查点。有 Tracker 时沿用其任务小节，窄任务可用任务消息。
删去不适用字段；进程输入只用临时副本，不创建额外状态文件。

## 简短派工单

```text
任务：{{ID / REVISION / TITLE}}；模式：{{deliver 默认 | understand | reproduce | implement | fix}}
角色：你是 GLM worker，GPT-6 负责需求、设计和独立验收；本轮终点是待验收报告。
授权与目标：{{USER_SCOPE_AND_CONCRETE_BEHAVIOR}}
验收标准及负例：{{REQ_AC_OR_CONTRACT -> EXPECTED_SUCCESS_FAILURE_BEHAVIOR}}
不可变约束/非目标：{{TECHNOLOGY_PRODUCT_DATA_PERMISSION_COMPATIBILITY_BOUNDARIES}}
必要读集与已核实事实：{{PATHS_SECTIONS_AND_FINDINGS_WITH_SOURCES；本上下文已有且未变的内容复用}}
设计边界：{{REQUIRED_INTERFACES_STATE_INVARIANTS_OR_EXISTING_COMPONENT_TO_REUSE}}
允许编辑/生成：{{FILES_OR_NARROW_DIRECTORY_AND_BUILD_OUTPUTS}}
工作树与基线：{{ABSOLUTE_CWD_BASE_AND_RELEVANT_DIRTY_INPUTS_OWNERSHIP}}
接收目标与终点：{{TARGET_TREE_AND_REQUIRED_DELIVERY_STOP_POINT}}
本次临时资源/保留项：{{OWNED_RUN_DIR_WORKTREE_PROCESSES_FIXTURES_RESTORE_STATE_AND_DELIVERABLES_OR_NONE}}
模型/预检：{{VERIFIED_HOST_CLI_PROFILE_PROVIDER_MODEL_REASONING_AND_EVIDENCE_REFERENCE}}
本轮校正（返工/新上下文时）：{{ACCEPTED_CORRECTIONS_REJECTED_PATHS_PREVIOUS_WRITER_STOPPED_REMAINING_WORK}}

你执行的验证（每个必要风险一行）：
{{AC_OR_RISK -> CHANGE -> COMMAND_AND_CWD -> PASS_CONDITION -> RERUN_TRIGGER}}
依赖准备：{{RUNNER_AND_KEY_PACKAGE_CHECKS_INSTALL_AUTHORITY_IF_NEEDED}}
回归：{{CONTINUOUS_RED_GREEN | SEPARATE_REPRODUCE_CHECKPOINT | EXISTING_EVIDENCE | NOT_APPLICABLE_REASON}}
完整 gate/部署（适用时）：{{EXECUTOR_COMMANDS_FROZEN_INPUTS_ACTUAL_TARGET_VAULT}}
剩余 app/device 验收（适用时）：{{受影响动作_CLI准备路径_真实交互_执行者_构建身份_OR_NONE}}

执行纪律：
- 遵守 AGENTS.md；产品工作获得 North Star 与当前契约。当前上下文已读且未变的
  内容直接复用，只补读变化、缺失、反证或先前截断的段落，不假定继承主会话记忆。
- deliver：简述理解后连续调查、补回归、实现、自查和验证，无需例行等待批准。
  按回归字段保留实现前目标失败日志、测试 diff 和输入身份；复用/不适用时说明依据，
  不制造假红灯，导入/依赖错误不算目标红灯。
- understand：只读调查后返回；reproduce：只写/跑指定测试，保留生产实现后返回。
  implement/fix：按已确认范围实施与验证。所有模式完成后停止，不推进下一任务。
- 兼容的局部实现和新 mock/fixture 接线错误可自行修正；不改变正确行为预期。
  不改 authority、验收标准或 Tracker，不删除/弱化断言，不用 skip/forceExit 造通过。
- 命令执行前限定读取范围和输出上限。大型基线由程序比较，只返回变化路径；
  生成/压缩 CSS 只提取目标规则，不 cat 整份清单或打印压缩整行，head 限行不够。
  原始日志留在本地，返回结果、数量、退出码和必要片段；截断不能冒充完整核查。
  每次重跑应有相关输入变化或具体风险；同因失败第二次无新信息，停该项重试并报告。
- 若获派 UI：样式任务优先 CLI 准备状态，再做受影响的真实交互；菜单/入口本身
  有改动必须实际操作该入口。工具状态刷新一次后同因再失败，切换支持的等价方法；
  无法覆盖必需动作就报告未验证，不以 CLI 成功代替。
- 范围冲突、实质偏差或必需工具/权限缺失时报告证据，继续独立授权工作；不绕过 sandbox。
- 不读取凭据或完整用户配置，不修改模型配置，不启动嵌套 agent。
  不 stage/commit/push/merge/tag/publish；本地部署仅执行任务单明确授权的目标。
- 随创建记录本次临时资源/恢复项；验收前保留证据和现场，不自行清空运行目录。
  正常结束自建临时进程并恢复已完成验证的临时状态；最终资源删除由 GPT-6 验收后协调。
```

配置详情沿用 GPT-6 已核对的非秘密记录：主机、CLI、profile、provider/端点/协议、
请求模型/推理参数、catalog 身份、覆盖项、鉴权方式名称及预检证据。服务端型号
无证据填未知；不输出或散列密钥。任务单只传必要配置和可访问的证据引用；worker
无法访问的主会话事实需附简短摘录，不要求它重查含凭据文件或重做已通过的预检。

## GLM 一次交付报告

```text
任务 / 修订 / 模式：
结论：待验收 / 调查完成 / 回归待核对 / 阻塞（不能自报已验收）
实际变更及目的：含新增、删除、生成文件与当前工作树。
逐项 AC -> 行为、断言与原始证据：
实际命令 -> cwd -> suite/test 数量或范围 -> 自然退出码 -> 日志位置：
验证输入：相关代码/测试/fixture/config/依赖；适用时含构建、部署及真实观察身份。
自查结果与未完成项：失败、未运行、未验证分别说明，列出需 GPT-6 判断的具体问题。
已达交付终点及剩余接收/部署/app gate：
本次临时目录/进程/合成数据/状态：已恢复项、待清理项、须保留的交付物与证据路径。
```

日常无需额外采集用量、扫描会话或编写效率报告；执行器已有用量/计时可附路径，
不估算费用或重跑命令补统计。中途仅在出现阻塞、
决策冲突或重大新风险时主动上报；正常阶段进展简短即可，不逐条请求 GPT-6 批准。

## GPT-6 集中验收卡

写入现有 Tracker；窄任务直接记在任务记录。先独立读契约、真实 diff 和关键断言，
再核对报告与原始日志，必要时独立执行关键回归/反例，不默认重复全部检查。

```text
任务/修订；基线、完整变更范围、模型配置与复用预检是否相符：
逐项 AC、范围/不变量/负例：通过 / 未通过 / 未验证，附真实证据。
关键回归：预期来源、目标失败原因和修复后结果；无红灯时的理由。
证据复用：实际命令/自然退出及相关输入一致性；补验项与原因。
交付目标：接收树、构建/部署/实际 app 观察一致；尚缺 gate 不标完成。
决定：通过 / 返工 / 阻塞；finding 的触发条件、严重度、文件行号、修复与复测范围。
下一步：同任务返工由 GLM 执行，GPT-6 更新唯一状态；未定用户决策单列。
验收后环境清理：完成 / 部分完成；已清理资源、保留项及原因，交付物和必要证据仍可访问。
```

仅用户明确要求的流程试点/复盘才在已有记录简记 GPT-6 实质干预、各模型用量及
阶段耗时；日常保留质量与返工证据即可。一次性接入和用户等待单列，缺失填未知，
无可比基线不报节省比例。
