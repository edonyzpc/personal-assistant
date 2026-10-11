# DEC-060 — PA prompt 精简与渐进披露

Decision ID: DEC-060
Status: Accepted
Updated: 2026-10-11
Authority: 用户先确认产品范围，随后授权隔离开发与测试；2026-10-11 明确保留 M3 失败、延期答复缺口并结束开发测试，之后授权 B-171 closeout 与本地 master 提交。推送与发布独立。
Work item: B-171

## Context

简单笔记查询仍携带较多全局领域说明、工具指引和原生声明。PA 已有 Skill 目录、`load_skill` 与精确 reference 加载，不需要另一套指南系统。目标是减少无关输入并改善实际响应效率，保持 Agent 自主选择工具、信息与顺序。

输入与证据边界：

- 设计时源码基线：全局 prompt 包含各领域状态解释；普通工具指引已做适用范围内的精确去重；纯输出声明另有重复序列化。本次交付对后两者的区别保持不变，只移除真实冗余与无关说明。
- Pi 固定源码 `c5f5b3282d5e4203c085e59837ba17aeaf2829b5` 的 [Skill 元数据/正文分离](https://github.com/earendil-works/pi/blob/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/coding-agent/src/core/skills.ts#L358)与[按实际工具组装规则](https://github.com/earendil-works/pi/blob/c5f5b3282d5e4203c085e59837ba17aeaf2829b5/packages/coding-agent/src/core/system-prompt.ts#L128)可借鉴。其可选工具发现不等于默认能力，也不是引入 Codemode 执行库就能获得的功能。
- [既有 prompt 试验 §14–15](../../architecture/pa-agent-harness/pa-agent-harness-optimization-plan-2026-10-04.md#14-主提示与来源指引精简)已保留工具指引去重，主提示候选曾回退。未知操作的矛盾重提建议是具体风险；合理澄清、附加建议或未采用评估者预设路径不是失败依据。
- [B-170 模型样本](../../development/discovery/pi-codemode-obsidian-feasibility.md#v6-最小真实模型对照)并非本方案验证，两臂日期正确性均未通过；不能用耗时差证明 prompt 或 Codemode 提速。
- 实施后同输入 M1 的单次观察：输入 tokens 减少 4.74%；这不证明稳定提速、普遍成功率或原始日期能力问题已解决。完整证据及失败边界见[验证归档](../../archive/2026/b171-agent-prompt-disclosure-validation.md)。

## Options Considered

| 方案 | 取舍 | 结论 |
| --- | --- | --- |
| 仅机械缩短文字 | 低成本，但仍让无关领域细节常驻 | 作为局部手段，不作为完整方案 |
| 核心规则与必要工具语义直接可见，方法按需读取，事实解释随实际上下文提供 | 复用既有边界，常用查询不增加必经轮次；复杂任务可能多一次指南读取 | 采用 |
| 动态隐藏工具并新增 tool_search、路由或 prompt 管理框架 | 可能进一步减少 schema，但引入发现、激活、撤回与额外往返 | 首版不采用 |

## Decision

1. 常驻简短的任务交付、权限/来源、信任关系、引用、执行事实和未知效果恢复原则；最终回答阶段仍保留这些原则。
2. 保留当前实际获准工具的原生 schema 与调用必需语义；缩短重复说明，不合并工具、不隐藏能力、不改变参数或结果契约。
3. Skill 名称和简短适用描述常驻；正文及参考资料复用 `load_skill` 按需读取。Agent 决定是否需要，不增加每次先读指南的前置流程。
4. 当前命令、图片引用/版本、历史编码和领域状态的具体说明，由其真实绑定或已接纳结构化事实触发；Host 不按用户文字推测领域、选择工具或预设任务步骤。
5. 保留来源、Context Used、完整笔记列表、正文按需读取、取消、超时、历史与已发生效果。指南是方法，不是权限；不会改变既有领域前置条件与确认边界。
6. B-171 与 B-170 通用计算方案独立，不增加时间快照、日期口径、Codemode 集成或脚本能力。保持 provider、模型与 thinking 配置，不新增用户模式或设置。

## Delivered Boundary And Closeout

B-171 于 2026-10-11 按用户授权收尾为 Closed。领域解释复用 `currentProtocol`，通用核心只保留一份；历史编码说明由实际投影事实在共用消息构造中选择，发送与估算共同消费，不进行第二次完整上下文投影。纯输出只在已有有效原生声明时去重；工具名称、顺序和参数保持，方法 description 可按本决定精简。Skill 入口/reference 保持完整按需读取，未新增指南框架或工具发现层。

完整工程门禁及 M1/M2 已完成；两次 M3 未知效果答复均为 FAIL，不能声称全部产品 AC 通过。指南澄清未在唯一复验中送达模型，其效果仍未验证；一次批次预检拒绝不据此认定为产品缺陷。用户决定答复缺口在真实使用中遇到时再讨论，保留于 [Backlog B-159](../../backlog.md#已延期的产品与工程工作)。工具接口渐进披露由 B-172 独立讨论，本决定不授权扩围。当前未知效果恢复合同不因收尾而放宽。

## Consequences And Revisit Trigger

保留原生 schema 意味着首版不会消除全部工具声明成本。按需资料把部分开销转移到相关任务；若常见任务因此增加无益往返，优先把必要短说明放回工具入口。没有 token 硬上限、固定缩减比例或提速承诺。

仅当真实证据表明现有分层仍不能满足需求，且需要动态工具发现、改变能力可见性或调整产品/权限边界时，重新讨论范围。既有状态、设置、存储、平台支持与执行系统不迁移。

## Traceability

- [Product Spec](../specs/pa-agent-prompt-disclosure-product-spec.md)
- [实现边界](../../architecture/pa-agent-architecture-plan.md)
- [独有验证与失败证据](../../archive/2026/b171-agent-prompt-disclosure-validation.md)
- [原始答复、轨迹与验证记录](../../archive/2026/b171-agent-prompt-disclosure-evidence.json)
- [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
- 本决定记录新范围，不覆盖 B-170，不重写既有试验结论。
