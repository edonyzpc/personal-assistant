# Codex 任务启动 Prompt 模板

> 使用方式：复制下方模板，替换 `{{...}}` 占位符后发送给 Codex。

---

## 模板

```
我是这个项目的独立开发者和唯一决策者。你的角色是 implementation advisor — 负责设计 SDD、实现代码、通过 make deploy 验证、在真实 vault 上 dogfood。

请先按顺序阅读以下文档：
1. {{HANDOFF_DOC}} — 你的任务定义和完成标准
2. {{DECISION_DOC}} — 权威决策记录（所有设计选择已确定，不需要重新讨论）
3. {{PROPOSAL_DOCS}} — 方向文档

读完后从 {{START_STEP}} 开始，先写 SDD 再实现。

约束：
- 方向已确认，不需要评判该不该做
- 不需要添加治理流程，过程是 SDD → 实现 → make deploy → dogfood
- 设计选择有疑问时参考决策记录中的已决策列表
- 技术问题需要澄清可以提，方向问题 escalate 给我
```

---

## 占位符说明

| 占位符 | 含义 | 示例 |
|--------|------|------|
| `{{HANDOFF_DOC}}` | 任务交接文档路径 | `docs/development/proposals/implementation-handoff.md` |
| `{{DECISION_DOC}}` | 决策记录文档路径 | `docs/development/proposals/proposal-review-response-2026-07-28.md` |
| `{{PROPOSAL_DOCS}}` | 相关方向文档（可多个） | 见下方示例 |
| `{{START_STEP}}` | 从哪个 Step 开始 | `Step 1（Pagelet Agent Deep Discover）` |

---

## 当前任务的完整示例

```
我是这个项目的独立开发者和唯一决策者。你的角色是 implementation advisor — 负责设计 SDD、实现代码、通过 make deploy 验证、在真实 vault 上 dogfood。

请先按顺序阅读以下文档：
1. `docs/development/proposals/implementation-handoff.md` — 你的任务定义和完成标准
2. `docs/development/proposals/proposal-review-response-2026-07-28.md` — 权威决策记录（所有设计选择已确定，不需要重新讨论）
3. `docs/development/proposals/pagelet-agent/pagelet-agent-proposal.md` — Pagelet Agent 方向
4. `docs/development/proposals/operations-agent/agent-operations-capability.md` — Operations 方向

读完后从 Step 1（Pagelet Agent Deep Discover）开始，先写 SDD 再实现。

约束：
- 方向已确认，不需要评判该不该做
- 不需要添加治理流程，过程是 SDD → 实现 → make deploy → dogfood
- 设计选择有疑问时参考 review-response §6 的已决策列表
- 技术问题需要澄清可以提，方向问题 escalate 给我
```

---

## 变体：只做某个 Step

```
我是这个项目的独立开发者和唯一决策者。你的角色是 implementation advisor。

请阅读 `docs/development/proposals/implementation-handoff.md`，然后只做 {{TARGET_STEP}}。
完成标准和技术要求在 handoff 文档中已列明。

约束：
- 方向已确认，不评判
- 过程：SDD → 实现 → make deploy → dogfood
- 不扩展 scope，只做指定 Step
```

---

## 变体：续做（上次中断后继续）

```
上次你在做 {{LAST_STEP}}，进度到了 {{PROGRESS}}。请继续。

参考文档不变：
- `docs/development/proposals/implementation-handoff.md`
- `docs/development/proposals/proposal-review-response-2026-07-28.md`

从 {{RESUME_POINT}} 继续，不需要重新读全部文档。
```

---

## 使用原则

1. **每次新任务都给完整模板** — Codex 可能没有上次的记忆
2. **不给开放式指令** — "分析一下"会让它进入审批模式
3. **明确起点和边界** — 告诉它从哪开始、做到哪停
4. **方向问题 escalate** — 技术问题它自己解决，产品方向回来问你
