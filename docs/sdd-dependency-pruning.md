# SDD: 依赖与构建清理（v2.1.2 review P0 #5 + #6 + #7 + H-1 合并）

**Status:** [D] Drafting
**Phase:** v2.2（批 2，独立 PR；H-1 子项推迟到 2026-06-12 之后）

---

## 1. Context

v2.1.2 review 收敛出 4 项依赖与构建配置层面的清理，性质相近（都是删冗余、不改运行时语义），合并为单一 SDD/PR 处理。

### 1.1 P0 #5 — `patches/` 目录残留

`patch-package` 历史用法的残留目录。当前状态（2026-06-01 重新审计）：

- 仓库根目录 **不存在 `patches/`** 实体目录（已被前序提交清理掉）
- `package.json` 无 `patch-package` 依赖、无 `postinstall: "patch-package"` 脚本

→ 本项 SDD 范围：**确认无须清理代码，仅在 PR 中文档化"已无残留"**。如果合入前发现 `patches/` 又被人重新引入，则按原计划 `git rm -r patches/`。

### 1.2 P0 #6 — `obsidian-callout-manager@1.0.2-alpha1`

review 标注"停更 3 年，无消费者"。**重新 grep（2026-06-01）发现 review 信息过期**，实际仍有以下消费者：

| 文件 | 用法 |
|------|------|
| `src/callout.ts:4` | `import type { Callout, CalloutID } from 'obsidian-callout-manager'` |
| `src/plugin.ts:4` | `import { type CalloutManager, getApi } from "obsidian-callout-manager"` |
| `src/types/obsidian-callout-manager.d.ts:1` | `declare module "obsidian-callout-manager"` 类型声明 |
| `__tests__/plugin-record-note.test.ts:50` | `jest.mock('obsidian-callout-manager', () => ({ getApi: jest.fn() }))` |
| `__tests__/callout.test.ts:4` | `import type { Callout } from 'obsidian-callout-manager'` |

→ 本项不再是"删依赖"，而是**先决策保留/移除运行时调用，再决定 package.json 是否变更**。本 SDD §3 Goals 调整反映此点。

### 1.3 P0 #7 — Jest 默认 coverage

`jest.config.js:20` `collectCoverage: true` 让本地 `npm test` 默认收集 v8 coverage 写入 `dist/coverage`，开销显著。`coverageProvider: "v8"`（line 34）和 `coverageDirectory: "dist/coverage"`（line 26）协同工作。

期望：默认关闭 coverage；显式 `npm test -- --coverage` 仍可触发。

### 1.4 H-1 — 4 个 `@deprecated` 类型清理

`src/ai-services/pa-agent-required-capability-policy.ts` 现存 4 个标注 `@deprecated since 2026-05-29` 的类型，按 [[deprecated-removal-convention]] 在 6/12 之后第一次发版可移除：

| 行号 | 类型 | 注释 |
|------|------|------|
| line 25 | `RequiredCapabilityLevel` | "compatibility alias for old imports only" |
| line 42 | `RequiredCapabilityHostPolicyOptions` | "inline the parameter object at the call site" |
| line 52 | `RequiredCapabilityHostPolicyResult` | "Will be removed after 2026-06-12" |
| line 77 | `RequiredCapabilityClassifierInput` | "Will be removed after 2026-06-12" |

注意：line 100 的 `createRequiredCapabilityHostPolicy` 签名还在用 `RequiredCapabilityHostPolicyOptions` / `RequiredCapabilityHostPolicyResult`；line 101 同。删除前需先 inline 这两处签名。

---

## 2. Goals

1. **P0 #5** — 验证 `patches/` 不存在 + 在 release/PR 描述中标注此项已完成
2. **P0 #6（修订）** — 决策树：
   - **路径 A（推荐）**：保留 `obsidian-callout-manager` 依赖，标记为"运行时仍在用"，关闭本 review 项；理由：当前 record-note callout 集成功能依赖此包
   - **路径 B（如要移除）**：先移除 `src/callout.ts`、`src/plugin.ts` 对该包的运行时调用 + 测试 mock，再 `npm uninstall`；属于功能改造，应另起 SDD
3. **P0 #7** — `jest.config.js` 移除 `collectCoverage: true`（line 20），保留 `coverageDirectory` 与 `coverageProvider`（仅作为 `--coverage` flag 触发时的配置参数）
4. **H-1** — 在 2026-06-12 之后第一次发版前：
   - inline `createRequiredCapabilityHostPolicy` 签名中的 deprecated 接口（line 99-101）
   - grep 全仓确认 4 个 deprecated 类型无外部消费者
   - 删除 4 个 `@deprecated` 类型定义（line 20-25, 38-46, 48-56, 72-80 注释 + 类型块）

## Non-goals

- 不动 `langchain` / `react` / `@sqliteai` / `@sqlite.org` 等其他依赖（各有独立 SDD）
- 不动 jest 的 ts-jest preset、moduleNameMapper、transform 等核心配置
- 不动 `pa-agent-required-capability-policy.ts` 的运行时逻辑（仅做类型层删除 + 签名 inline）
- 不重新引入 `patch-package` workflow（即使将来有 patch 需求，也另起 SDD）

---

## 3. Spec Design

### 3.1 P0 #5 验证步骤

```bash
test ! -d patches/ && echo "OK: no patches dir"
grep -E '"patch-package"|"postinstall"' package.json || echo "OK: no patch-package config"
```

PR 描述里附此 2 行输出，说明无残留可清理。

### 3.2 P0 #6 决策与执行

**当前推荐：路径 A（保留）**。理由：
- record-note callout 模板支持是产品功能（不是开发期工具）
- `getApi(plugin)` 返回 Obsidian Callout Manager 插件 API，无现成替代
- 停更 3 年但 alpha 版本 API 稳定，无 CVE 报告

**操作**：
1. 在本 SDD 标注：本项关闭，原 review 信息基于过期 grep
2. 不改动 package.json
3. 在 [[v2-1-review-decisions]] memory 加备注："#6 obsidian-callout-manager 保留，运行时活跃"

**如果用户后续决定走路径 B**，另起 SDD 处理（涉及 callout 功能重写或下线）。

### 3.3 P0 #7 jest.config.js 改动

```diff
   // Indicates whether the coverage information should be collected while executing the test
-  collectCoverage: true,
+  // collectCoverage: false,  // 显式 --coverage flag 触发；jest 默认 false
```

不动：
- `coverageDirectory: "dist/coverage"` —— 当显式 `--coverage` 时仍生效
- `coverageProvider: "v8"` —— 同上
- 其他全部配置

CI 影响审计（执行前必须确认）：
- 检查 `.github/workflows/*.yml` 中是否有显式跑 coverage 收集的步骤
- 若 CI 依赖 `npm test` 输出 `dist/coverage`，需把 CI 命令改成 `npm test -- --coverage`

### 3.4 H-1 执行步骤（2026-06-12 之后）

**Step 1**: inline 签名（消除 deprecated 接口的内部消费）

```typescript
// src/ai-services/pa-agent-required-capability-policy.ts:99-101 改为
export function createRequiredCapabilityHostPolicy(
    options: {
        userInput: string;
        availableCapabilities: ReadonlySet<RequiredCapability>;
        classification?: RequiredCapabilityClassification;
    },
): {
    hostPolicy: PaAgentHostPolicy;
    initialRuntimeInstruction?: string;
    classification: RequiredCapabilityClassification;
} {
    // ... 函数体不变
}
```

**Step 2**: grep 4 个类型确认无外部消费者

```bash
grep -rn "RequiredCapabilityLevel\b" src/ __tests__/ --include="*.ts" --include="*.tsx"
grep -rn "RequiredCapabilityHostPolicyOptions\b" src/ __tests__/ --include="*.ts" --include="*.tsx"
grep -rn "RequiredCapabilityHostPolicyResult\b" src/ __tests__/ --include="*.ts" --include="*.tsx"
grep -rn "RequiredCapabilityClassifierInput\b" src/ __tests__/ --include="*.ts" --include="*.tsx"
```

预期：除 `pa-agent-required-capability-policy.ts` 自身定义行外，0 命中。

**Step 3**: 删除类型定义

- 删 line 20-25（`RequiredCapabilityLevel` 注释 + 类型）
- 删 line 38-46（`RequiredCapabilityHostPolicyOptions`）
- 删 line 48-56（`RequiredCapabilityHostPolicyResult`）
- 删 line 72-80（`RequiredCapabilityClassifierInput`）

**Step 4**: `tsc -noEmit -skipLibCheck` + `npm test` + `npm run build`

---

## 4. Acceptance Criteria

- [ ] `patches/` 目录不存在（grep 输出附 PR 描述）
- [ ] `obsidian-callout-manager` 处置决策记录（路径 A 关闭 / 路径 B 另起 SDD）
- [ ] `npm test` 默认无 coverage 输出，`dist/coverage/` 不被默认创建
- [ ] `npm test -- --coverage` 仍输出 v8 coverage 到 `dist/coverage/`
- [ ] CI workflow 已审计 + 必要时同步改 `--coverage` flag
- [ ] H-1（6/12 之后执行）：4 个 deprecated 类型 grep 仅命中定义行 → 删除后 grep 0 命中
- [ ] H-1 后 `tsc -noEmit -skipLibCheck` 通过
- [ ] H-1 后 `npm test` 全部通过
- [ ] H-1 后 `npm run build` 产物可在真机加载

---

## 5. Verification

| 项 | 命令 | 预期 |
|----|------|------|
| #5 | `test ! -d patches/` | exit 0 |
| #5 | `grep "patch-package" package.json` | 无输出 |
| #6 | `grep "obsidian-callout-manager" package.json` | 路径 A：保留命中；路径 B：0 命中 |
| #7 | `npm test 2>&1 \| grep "Coverage"` | 无 coverage 区块 |
| #7 | `npm test -- --coverage 2>&1 \| grep "All files"` | 输出 coverage 表 |
| #7 | `ls dist/coverage` after `npm test` | 不存在或为空 |
| H-1 | `grep -rn "RequiredCapabilityLevel\b" src/ __tests__/` | 0 命中 |
| H-1 | `grep -rn "RequiredCapabilityHostPolicyOptions\b" src/ __tests__/` | 0 命中 |
| H-1 | `grep -rn "RequiredCapabilityHostPolicyResult\b" src/ __tests__/` | 0 命中 |
| H-1 | `grep -rn "RequiredCapabilityClassifierInput\b" src/ __tests__/` | 0 命中 |
| 全量 | `tsc -noEmit -skipLibCheck && npm test && npm run build` | 全过 |

真机 smoke：
- record-note callout 模板渲染正常（验证路径 A 没误删）
- PA Agent chat 正常工作（验证 H-1 类型清理无运行时回归）

---

## 6. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| #5 patches 目录在 PR 合入前被重新引入 | 低 | PR 提交前再次跑验证脚本；合入流水线加 `test ! -d patches/` 守卫（可选） |
| #6 review 信息过期（已发现） | 中 | 已在 §3.2 修订；本 SDD 默认采用路径 A 保留依赖 |
| #6 路径 B 误判 transitive 残留 | 中 | grep 必须覆盖 .ts/.tsx/.d.ts/__tests__/__mocks__；路径 B 走时同步检查 `package-lock.json` 中其他依赖是否将其作为 peer dep |
| #7 CI 依赖默认 coverage | 中 | §3.3 显式列为前置步骤：审计 `.github/workflows/*.yml`；若有则同步改 `--coverage` flag |
| #7 IDE jest 集成失效 | 低 | VSCode/WebStorm jest 集成读 jest.config.js；coverage 仅在 inspector 显式开启时启用，不受默认值影响 |
| H-1 4 类型有 plugin 外部消费者（如他人 fork 引用） | 极低 | 这些类型仅在 src/ 内部使用，未出现在 main.js bundle 之外的公共 API；release notes 提一句即可 |
| H-1 inline 签名后第三方扩展不兼容 | 极低 | 函数签名结构等价，TS structural typing 下任何旧 import 仍能赋值；alias 只是命名层 |
| H-1 deprecated 注释里的 "Will be removed after 2026-06-12" 时间过早执行 | 中 | 本 SDD 明确等到 6/12 之后第一次发版；批 2 PR 可先 ship 其他三项，H-1 单独后置 |

---

## 7. Implementation Order

PR 拆分建议（如需进一步降 review 风险）：

- **PR-1（立即可发）**：#5 验证文档 + #7 jest.config.js + #6 决策记录（路径 A，无代码变更）
- **PR-2（6/12 之后）**：H-1 deprecated 类型清理 + 签名 inline

或合并单 PR（#5/#6/#7 + H-1）等到 6/12 之后一起发。**默认推荐拆 PR-1/PR-2**：因为 #7 jest.config.js 改动有开发者体验收益（本地测试更快），无需等 H-1。

---

## 8. Critical Files

- `patches/`（确认不存在）
- `package.json:61` — `obsidian-callout-manager` 依赖行（路径 A 不动）
- `jest.config.js:20` — `collectCoverage: true` 改为注释或 `false`
- `src/ai-services/pa-agent-required-capability-policy.ts:20-25, 38-46, 48-56, 72-80` — 4 个 deprecated 类型块（H-1 阶段删除）
- `src/ai-services/pa-agent-required-capability-policy.ts:99-101` — `createRequiredCapabilityHostPolicy` 签名（H-1 阶段 inline）
- `.github/workflows/*.yml` — 审计 CI 是否依赖默认 coverage
- 消费者审计参考：`src/callout.ts:4`、`src/plugin.ts:4`、`src/types/obsidian-callout-manager.d.ts:1`、`__tests__/plugin-record-note.test.ts:50`、`__tests__/callout.test.ts:4`（#6 路径 B 时需处理）

---

## 9. References

- v2.1.2 review report — P0 项 #5/#6/#7
- v2.1.2 review report — H 类项 H-1
- [[deprecated-removal-convention]] — 6/12 节点约定
- [[v2-1-review-decisions]] — review 5 决策汇总
