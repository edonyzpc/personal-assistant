# SDD: React → Preact 切换评估（触发型占位）

**Status:** [T] Triggered evaluation only — 当前不实施
**Phase:** 无（触发型，可能永远不实施）

---

## 0. 重要声明

**本 SDD 当前不进入实施。** 它的存在是为了：
1. 记录 v2.1.2 review 决策 ③（C1：现在不切换 Preact alias）的依据
2. 写明"未来什么条件下重新评估"——避免每次 review 重复讨论
3. 一旦触发条件满足，作为正式 SDD 的起草起点

如果你在 review 时读到这份文档，请检查 §3 的触发条件是否已满足；若未满足，本文档维持现状。

---

## 1. Context

### 1.1 当前状态（2026-06-01）

`src/components/` 仅 2 个 tsx 文件：

```
src/components/
├── RecordList.tsx
└── Statistics.tsx
```

引用方：
- `src/stats-view.ts:2` — `import { createElement } from "react"`
- `src/preview.ts:4` — `import { createElement } from "react"`
- `src/components/RecordList.tsx:1` — `import { useEffect, useRef } from "react"`
- `src/components/Statistics.tsx:1` — `import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react"`
- `src/components/Statistics.tsx:25` — `await import("react-chartjs-2")`（动态加载）

依赖（package.json）：
- `react@18.3.1`
- `react-dom@18.3.1`
- `react-chartjs-2@^5.3.0`
- `@types/react@18.3.28`
- `@types/react-dom@18.3.7`

→ 已固定 React 18.3.1 type-compatible 版本组合。

### 1.2 v2.1.2 review 决策 ③

review 给出三选项：
- A：保持 React 18.3.x（不动）
- B：升 React 19
- C：切 Preact alias（`react` → `preact/compat`）

**当时决策：C1 = 现在不切（采用 A）。** 理由汇总在 [[v2-1-review-decisions]]。

### 1.3 之前的"组件数 ≥ 5 触发"逻辑被废弃

[[react-evaluation-trigger]] memory 早期版本写"当 components/ 下 .tsx 文件 ≥ 5 时复议 Preact alias"。该逻辑基于 bundle size 摊薄假设。

**用户视角修正（2026-06-01）：bundle size 不作为产品决策驱动力**。组件数量是 bundle 摊薄的代理信号，bundle 不重要 → 组件数量也不再是触发器。

memory 文件需同步更新（见 Wave 1.F memory 更新批次）。

---

## 2. Goals

- **本 SDD 当前不实施任何切换**——属 `[T] Triggered evaluation only` 状态
- 仅作为"未来如何评估 Preact 切换"的预备规范
- 明确列出触发条件（§3）+ 触发后的评估流程（§4）

## Non-goals

- 当前不修改 `package.json`、`esbuild.config.mjs`、`jest.config.js`
- 不预先做 Preact POC（无触发条件即不投资）
- 不评估 Preact 与 Solid/Vue/Svelte 等其他轻量框架的 trade-off（决策范围只是 React vs Preact alias）
- 不优化 React 18 → 19 升级路径（独立讨论项）

---

## 3. 触发条件（修正版，2026-06-01 后生效）

任一满足即启动正式 Preact 评估 SDD：

### 3.1 触发器 A：使用 React 独占特性

任意新组件用到以下任一特性：
- **Suspense + lazy** —— 实际上 `Statistics.tsx:1, 25` 已经在用 `Suspense` + `lazy(...await import(...))`；preact/compat 对 Suspense + lazy 的支持是部分的（基础 case OK，concurrent 边界 case 有差异），新增此类组件需重新 POC 验证
- `useTransition` —— preact/compat 暂未完整支持 concurrent transition 语义
- `useDeferredValue` —— 同上
- React Concurrent rendering 完整语义（time slicing / interruptible render）
- **React Server Components** —— preact/compat 不支持，自动 disqualify

### 3.2 触发器 B：引入 preact/compat 不完全兼容的第三方 React 库

新增 React 库前必须先查 [preact/compat 兼容矩阵](https://preactjs.com/guide/v10/differences-to-react/)：
- 不在矩阵 / 矩阵标 ❌ → 自动触发评估，决定保留 React 还是放弃该库
- 矩阵标 ⚠️ → 触发轻量 POC（半天）
- 矩阵标 ✅ → 不触发

### 3.3 已废弃的触发器（不再适用）

| 旧触发器 | 废弃理由 |
|----------|----------|
| `src/components/*.tsx` 文件数 ≥ 5 | bundle size 不作为决策驱动；组件数与产品价值无关 |
| package.json 中 React 类依赖体积超 X MB | 同上 |
| 移动端冷启动慢 | 已通过 WASM 懒加载 + chunk 拆分缓解，不需要换框架解决 |

---

## 4. 触发后的评估流程（占位 spec）

一旦 §3 任一条件满足，启动正式 SDD（届时本文档转 `[x] superseded`）。届时正式 SDD 至少覆盖以下内容：

### 4.1 兼容性审计（前置 4-8 小时）

1. 列出当前 `src/` 中所有 React API 调用点
2. 对照 [preact/compat 差异列表](https://preactjs.com/guide/v10/differences-to-react/)
3. 标注每个调用是 ✅ / ⚠️ / ❌
4. ❌ 项是否能改写为兼容形式 / 是否必须保留 React

### 4.2 POC（1 天）

```javascript
// esbuild.config.mjs（POC 阶段）
alias: {
  "react": "preact/compat",
  "react-dom": "preact/compat",
  "react/jsx-runtime": "preact/jsx-runtime",
}
```

```javascript
// jest.config.js（POC 阶段，moduleNameMapper 添加）
moduleNameMapper: {
  "^react$": "preact/compat",
  "^react-dom$": "preact/compat",
  "^react/jsx-runtime$": "preact/jsx-runtime",
  // 现有 .wasm / ?worker-source 映射保持
}
```

### 4.3 验证矩阵

| 项 | 命令 / 操作 | 通过条件 |
|----|------|------|
| 类型 | `tsc -noEmit -skipLibCheck` | 无 error（preact 类型 != React，可能需要 `@types/preact-compat` 或 type assertion） |
| 单测 | `npm test` | 全过；重点关注 `__tests__/` 中渲染相关测试 |
| 构建 | `npm run build` | esbuild 通过，bundle 产物可加载 |
| 真机 | Statistics view 加载 | Chart 渲染正常、`Suspense` fallback 行为不退化 |
| 真机 | RecordList 渲染 | 列表正常滚动、useRef 行为不变 |
| 真机 | `react-chartjs-2` 集成 | chart 正常更新；hover/legend 无回归 |

### 4.4 决策点

POC 完成后回答以下问题，决定是否切换：

- 兼容性 ❌ 项数量 == 0？
- 全部测试通过？
- 真机 smoke 通过？
- 第三方库（`react-chartjs-2`）有无回归？
- bundle 实际产物变化（仅记录，不作为决策驱动力）

任一答案是"否"→ 不切换，本 SDD 关闭，记录原因；下一次触发时复用本评估流程。

---

## 5. Acceptance Criteria

**当前阶段（不实施）：**
- [x] 本 SDD 已撰写并标注 `[T] Triggered evaluation only`
- [x] 触发条件 §3 已修订，移除"组件数 ≥ 5"
- [x] [[react-evaluation-trigger]] memory 同步更新（在 Wave 1.F 批次执行）

**触发后正式 SDD（未来）：**
- preact/compat alias 切换后所有现有组件行为不变
- 全测通过
- 真机 smoke 通过
- bundle 实际收益数据被记录（仅参考，不作决策驱动）

---

## 6. Verification（当前阶段）

本阶段无代码改动，仅文档：

```bash
# 验证 SDD 存在且 Status 标对
grep -E "^\*\*Status:\*\* \[T\]" docs/sdd-react-preact-evaluation.md

# 验证废弃触发器不再生效（确认 memory 已同步）
grep -i "组件数\|component count\|>= 5\|≥ 5" .claude/projects/*/memory/project_react_evaluation_trigger.md && \
  echo "WARN: memory 还残留组件数触发器" || echo "OK: memory 已修订"
```

---

## 7. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| 触发条件设计过严，错过应该切换的窗口 | 低 | §3.1 已包含"现有 Statistics.tsx 已用 Suspense+lazy"的提醒——新增同类组件就触发；用户可随时手动启动评估 |
| 触发条件设计过松，无谓投入 POC 时间 | 低 | §3 两条都需要"新增"动作（新组件 / 新依赖）才触发；现有代码不会被动触发 |
| preact/compat 不完全等价 React 18 concurrent | 中 | POC 阶段重点验证 `Suspense` + `lazy` + 任何已用的 concurrent 特性 |
| `react-chartjs-2` v5+ 在 preact/compat 下行为差异 | 中 | POC 必须包含 chart 真机 smoke；该库内部有 `useEffect` + canvas 操作，preact 调度时序可能有差异 |
| memory `react-evaluation-trigger` 未同步更新 | 中 | Wave 1.F 显式包含此 memory 更新；本 SDD §6 verification 第二条 grep 守卫 |
| bundle size 未来重新成为决策驱动 | 低 | 用户已确认 v2.1.2 阶段 bundle 不驱动决策；若未来变化，本 SDD §3 可加触发器 C |

---

## 8. 何时关闭本 SDD

| 场景 | 操作 |
|------|------|
| §3 任一条件满足，启动正式实施 SDD | 本 SDD 标 `[x] superseded`，链接到新 SDD |
| 项目长期不触发（>1 年） | 本 SDD 维持 `[T]`，作为决策记录保留 |
| Preact 重大版本演进改变兼容矩阵 | 在 §3 / §4 加 changelog 注释，不重写整个 SDD |
| 用户决定永久放弃 Preact 路径 | 本 SDD 标 `[x] closed (decision: stay on React)` |

---

## 9. Critical Files（占位）

实施时（非当前阶段）会动到：

- `package.json` — 加 `preact` 依赖、可能保留或移除 `react`/`react-dom`
- `esbuild.config.mjs` — `alias` 配置
- `jest.config.js` — `moduleNameMapper` 配置
- `tsconfig.json` — 可能需要 `paths` 配置或 type 调整
- `src/components/*.tsx` — 验证触发的特性是否需要改写
- `src/stats-view.ts:2`、`src/preview.ts:4` — `createElement` import 位置

当前阶段：**0 个文件改动**。

---

## 10. References

- v2.1.2 review 决策 ③（C1：现在不切）
- [[react-evaluation-trigger]] memory（修订版，2026-06-01 后生效）
- [[v2-1-review-decisions]] memory
- [[user-product-direction]] memory（独立开发者，bundle 不驱动决策）
- [Preact compat 差异列表](https://preactjs.com/guide/v10/differences-to-react/)
