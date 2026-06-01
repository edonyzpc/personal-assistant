# SDD: 三层 ToolRegistry → CapabilityRegistry 塌缩重构

**Status:** [x] Done
**Phase:** v2.2（可顺延 v2.3，视 v2.2 P0 完成度）

---

## 1. Context

v2.1.2 现有三层 capability 抽象,从注册到执行依次为:

- `ToolRegistry` (`./src/ai-services/chat-tool-registry.ts`)
- `CoreToolProvider` (`./src/ai-services/core-tool-provider.ts`)
- `CapabilityRegistry` (`./src/ai-services/capability-registry.ts`)

v2.1.2 review 阶段做完调研后定性结论:

### 1.1 `CoreToolProvider` 无独立调用方

`./src/ai-services/core-tool-provider.ts` 整文件只在 `ToolRegistry` 构造函数里被实例化一次,把 chat-tool-factories 产出的工具 wrap 成 capability 形态再注入 `CapabilityRegistry`。整个 wrap 步骤没有任何独立 consumer 直接消费 `CoreToolProvider` 的接口,纯粹是中间层胶水。

### 1.2 `ToolRegistry` 与 `CapabilityRegistry` 表面方法 90% 重复

两个类暴露的 `register` / `unregister` / `list` / `get` / `has` 方法语义、形状几乎一致,只差名称。`ToolRegistry` 的存在仅为了在 chat-tools 域内多套一层"工具"语义,而 capability 已经覆盖了完整契约。

### 1.3 必须保留 `CapabilityRegistry` + 三类 kind

虽然中间层冗余,但 `AgentCapabilityKind = "tool" | "context" | "action"` 的三抽象不能删除,这是为 [`project_action_mode_roadmap`] 预留的契约:

- `tool` kind 是当前唯一活跃路径(webSearch、note-structure、canvas-structure、vault-snippets、vault-tags、search_memory)
- `context` kind 暂未使用,保留为读上下文类 capability 的占位
- `action` kind 由 `./src/ai-services/policy-engine.ts:35` 守卫:`kind === "action"` 在当前阶段被自动拒绝(防御 action mode 落地前误用)

塌缩重构只删冗余的中间层胶水,**不动 capability 抽象本身**。

---

## 2. Goals

1. 删 `ToolRegistry` 类(`./src/ai-services/chat-tool-registry.ts` 中的 class 定义)
2. 删 `CoreToolProvider` 类(`./src/ai-services/core-tool-provider.ts` 整文件)
3. 让 `./src/ai-services/chat-tool-factories.ts` 直接生产 `AgentCapability` 实例,跳过中间 wrap
4. 删 `./src/ai-services/capability-adapter.ts` 中已无消费者的冗余转换函数
5. 在 `./src/ai-services/capability-types.ts:20` 上方加注释,显式标记三个 kind 当前的状态:
   ```
   // "context" reserved (0 use) / "action" guarded by policy-engine until action mode lands
   ```
6. 预估代码减少 -500 LOC

## Non-goals

- 不动 `CapabilityRegistry` 类
- 不动 `AgentCapability` 接口
- 不动 `AgentCapabilityKind` 三类型(`"tool" | "context" | "action"`)
- 不动 `./src/ai-services/policy-engine.ts:35` 的 action 防御线
- 不动 PA Agent 控制循环内任何调用方
- 不动现有 capability 元数据形状(`executionMode`、`outputBudgetChars` 等保持原样)

---

## 3. 现有调用图审计

| 调用点 | 当前路径 | 重构后路径 |
|------|------|------|
| `./src/ai-services/chat-tool-factories.ts` 创建 webSearch / note-structure 等工具 | factory → `ToolRegistry.register()` → 内部 wrap 经 `CoreToolProvider` → 注入 `CapabilityRegistry` | factory 直接产出 `AgentCapability` → 注入 `CapabilityRegistry.register()` |
| `./src/ai-services/pa-agent-runtime.ts` 查询可用工具 | 通过 `ToolRegistry.list()` | 通过 `CapabilityRegistry.list({ kind: "tool" })` |
| `./src/ai-services/capability-adapter.ts` 的 `toolToCapability()` / `capabilityToToolDescriptor()` 等转换函数 | 在两层之间 round-trip | 删除 round-trip 函数;保留对外暴露的纯查询型 helper(若有) |
| 测试 fixture 构造 capability | 直接 new `AgentCapability` | 不变 |

**Audit 步骤(实施前必跑)**:

```sh
grep -rn "ToolRegistry\|CoreToolProvider" ./src ./__tests__
grep -rn "from.*capability-adapter" ./src ./__tests__
```

预期命中点:

- `./src/ai-services/pa-agent-runtime.ts`(主消费者,改 `list()` 调用入参)
- `./src/ai-services/chat-tool-factories.ts`(工厂改产 capability)
- `./__tests__/capability-registry.test.ts`(覆盖 register/list 路径)
- `./__tests__/pa-agent-runtime.test.ts`(集成测试)
- 可能还有 chat-tools 单测 fixture

---

## 4. Spec design

### 4.1 重构步骤(4 阶段增量,每阶段独立可 review)

#### Phase A: factory 直产 capability(不删旧路径)

1. 修改 `./src/ai-services/chat-tool-factories.ts` 中所有 factory 函数,让它们直接返回 `AgentCapability` 实例(以 `kind: "tool"` 标注)
2. 此时 `ToolRegistry` 仍在,但其 register 入口接受新形状(向下兼容,内部不再 wrap)
3. 跑 `__tests__/capability-registry.test.ts` + `__tests__/pa-agent-runtime.test.ts` 验证行为不变

#### Phase B: 跳过 `CoreToolProvider`

4. 把 `pa-agent-runtime.ts` 内通过 `ToolRegistry` 注入 `CapabilityRegistry` 的链路改为直接调 `CapabilityRegistry.register()`
5. `CoreToolProvider` 此时无引用,但**不删文件**,跑全量测试确认零回归
6. grep 确认 `CoreToolProvider` import 数为 0

#### Phase C: 删 `CoreToolProvider` + `ToolRegistry`

7. 删 `./src/ai-services/core-tool-provider.ts` 整文件
8. 删 `./src/ai-services/chat-tool-registry.ts` 中的 `ToolRegistry` 类(若文件只剩 class,删整文件并修改 barrel export)
9. 修改对应 barrel exports(`./src/ai-services/index.ts` 等)
10. 跑全量测试

#### Phase D: 清理 `capability-adapter.ts` + 加 kind 注释

11. grep `./src/ai-services/capability-adapter.ts` 中每个 export 的消费者,删除已无人使用的 round-trip 函数
12. 在 `./src/ai-services/capability-types.ts:20`(`AgentCapabilityKind` 类型定义上方)加注释:
    ```typescript
    // "tool" is the only active kind today.
    // "context" reserved (0 use) / "action" guarded by policy-engine until action mode lands.
    // See ./policy-engine.ts:35 and project memory `project_action_mode_roadmap`.
    export type AgentCapabilityKind = "tool" | "context" | "action";
    ```
13. 跑全量测试 + bundle audit

### 4.2 文件改动汇总

**删除:**
- `./src/ai-services/core-tool-provider.ts`(整文件)
- `./src/ai-services/chat-tool-registry.ts` 中的 `ToolRegistry` 类(可能整文件)

**修改:**
- `./src/ai-services/chat-tool-factories.ts`(factory 直产 capability)
- `./src/ai-services/pa-agent-runtime.ts`(注入路径改直连 `CapabilityRegistry`)
- `./src/ai-services/capability-adapter.ts`(删冗余转换函数)
- `./src/ai-services/capability-types.ts`(加 kind 状态注释)
- `./src/ai-services/index.ts`(更新 barrel export)

**不动:**
- `./src/ai-services/capability-registry.ts`
- `./src/ai-services/policy-engine.ts`(尤其 line 35 action 防御线)
- 测试 fixture 中构造 `AgentCapability` 的位置

---

## 5. Acceptance Criteria

- 所有现有 capability(webSearch、note-structure、canvas-structure、vault-snippets、vault-tags、search_memory)在 PA Agent 测试中**行为不变**(同 input → 同 tool selection / 同 output 形状)
- `./__tests__/capability-registry.test.ts` 全过
- `./__tests__/pa-agent-runtime.test.ts` 全过
- `./__tests__/chat-tools.test.ts` 等 chat-tool 相关测试全过
- bundle 不显著膨胀(≤ +5KB,实际预期 -500 LOC 应导致 bundle 缩小)
- `tsc -noEmit -skipLibCheck` 零错
- `npm run build` 成功
- `grep -rn "ToolRegistry\|CoreToolProvider" ./src` 无业务命中(只允许在 deprecated 注释或 release notes 中提及)

---

## 6. Verification

按顺序执行:

1. `tsc -noEmit -skipLibCheck`
2. `npm test -- --testPathPattern=capability-registry`
3. `npm test -- --testPathPattern=pa-agent-runtime`
4. `npm test -- --testPathPattern=chat-tools`
5. `npm test`(全量回归)
6. `npm run build`
7. `npm run audit:bundle`(确认 bundle 未膨胀)
8. 真实 vault smoke test:触发 webSearch / search_memory / current note 各一次,验证工具调用链正常
9. `grep -rn "ToolRegistry\|CoreToolProvider" ./src`(必须 0 业务命中)
10. 确认 `./src/ai-services/policy-engine.ts:35` 的 `kind === "action"` 守卫**未被触动**(diff 检查)

---

## 7. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| 误删 `CoreToolProvider` 中的内联逻辑(如 capability 默认值填充、错误降级) | 高 | Phase B 不删文件先验证零引用;Phase C 才删;实施前 grep 全仓所有使用方;diff review 时逐函数确认逻辑迁移到 factory |
| `chat-tool-factories.ts` 重写后 capability 元数据不全(`executionMode`、`outputBudgetChars`、错误处理回调等) | 高 | Phase A 完成后跑 acceptance 测试,这些字段会在 PA Agent 决策路径里被读到;漏字段会触发既有断言 |
| `capability-adapter.ts` 误删未来要用的转换函数 | 中 | Phase D grep 严格,只删消费者数为 0 的 export;有疑虑的保留并标记 `@deprecated` |
| 三阶段中间态有 capability 注册路径不一致 | 中 | 每阶段独立 commit + 测试;Phase A/B/C 不能并行,必须线性 |
| barrel export 漏改导致下游编译失败 | 低 | `tsc -noEmit` 在每个 phase 后跑 |

---

## 8. 复议触发

如 action mode 推迟超 2027 H2 仍未启动,回看是否合并 `context` + `action` 为单一 `"future"` 字面量类型,把 `policy-engine.ts:35` 的守卫改为 `kind === "future"`。详见 [`project_action_mode_roadmap`]。

本 SDD 范围内**不动**三 kind 设计,仅塌缩冗余中间层。
