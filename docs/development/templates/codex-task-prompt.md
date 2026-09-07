# Codex 任务启动 Prompt 模板

选用一个模板，替换 `{{...}}` 即可。任务入口可以是已有 Feature Home，也可以是
明确的目标与范围；无需先替 Agent 选择 lane、文档目录或测试命令。

## 启动任务

```text
请完成 {{TASK_OR_FEATURE_HOME}}，并完成本次授权范围内的必要验证。

按 AGENTS.md 和 docs/development/documentation-workflow.md 解析任务范围与授权。
已有 Feature Home 时先读它和 Tracker，再按需读取 owning contract、相关代码和测试；
没有入口时从我说明的目标与范围开始，使用当前生命周期要求的最轻 lane。
窄修复沿用既有契约；完整 feature 先明确当前产品契约或 Governance Contract，
跨会话执行建立最小 Feature Home + Tracker，Plan/SDD 只在当前复杂度需要时补齐。

最小修改应完整满足已确认需求并控制影响范围，保留清晰命名、控制流和必要的中间步骤。
按 AGENTS.md 及当前 owning contract 选择验证，复用其允许的现有证据；
需要部署、设备或阶段收口验证时完成对应门禁，不把所有任务套进全量流程。
有 Tracker 时简记需求/风险、最低充分证据、通过与扩测条件；按 AGENTS.md 处理
证据失效和测试异常，无新信息时调整诊断，不靠重复全量或放宽断言取得通过。
把未定产品取舍和实质偏差交给我决定；常规细节与仍适用的已授权工作连续完成。

结束时报告改动、验证结果与缺口；有 Tracker 时只在那里更新执行状态。
本任务不自动授权 closeout、commit、push、merge、tag、publish 或 release。
```

## 只执行指定步骤

```text
请从 {{FEATURE_HOME_OR_TASK_SCOPE}} 开始，只执行 {{TARGET_STEP}}。
已有 track 时先读 Feature Home + Tracker；按 AGENTS.md、当前文档生命周期与
owning contract 完成本步骤的修改、必要验证和状态更新，随后停在下一步骤之前。
沿用适用的已授权决定；未定产品取舍或实质偏差仍需明确批准。
不提前实施后续步骤，不因步骤名称而自动新增 SDD、全量部署或独立交接文档。
closeout、Git 和发布操作继续遵守各自授权边界。
```

## 续做已有任务

```text
请继续 {{FEATURE_HOME_OR_TASK_SCOPE}} 中尚未完成且已获授权的工作。
已有 track 时从 Feature Home + Tracker 的 Current Snapshot 恢复；没有 track 时
沿用本会话的目标、范围和停止点。先核实当前工作树与相关输入是否变化，
按需补读 owning contract 或变更，不重新遍历全部历史。
按 AGENTS.md 与当前文档生命周期判断已有验证能否复用，完成剩余必要验证。
保持原授权终点；若原任务只授权一个步骤，完成该步骤后停止，不自动进入下一步。
常规细节自主处理；产品取舍、实质偏差、closeout、Git 与发布遵守各自授权边界。
```

## 使用边界

- 当前规则见 [AGENTS.md](../../../AGENTS.md) 和
  [Documentation Workflow](../documentation-workflow.md)；模板不另设验证门禁。
- 仅分析、仅 review 或显式只读时零写入；按完整请求与已有授权选择模式，模板不升级权限。
- 模板、历史 Proposal 或 Agent 写出的 Approved/Accepted 状态不能证明用户批准；
  明确的技术选型与产品、数据、媒体边界仍按当前 authority 执行。
- 发布仍需要当前 turn 的明确授权。不要把“完成任务”解释为自动发布。
