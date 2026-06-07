# SDD: TypeScript Strict 模式 + Jest Coverage 门槛 (1.4 / 1.5)

**Status:** Draft, awaiting approval (2026-06-01)
**Phase:** v2 review followup batch 3
**Scope:** 编译期与测试期的工程门禁强化，2 项打包成同一份 SDD

---

## 1. Context

`docs/v2-fix-plan.md` Phase 1 还有两项与"工程门禁"相关的开放：

| 项 | 文件 | 性质 |
|---|---|---|
| 1.4 | `tsconfig.json` | 三个独立 strict flag → `"strict": true`（开启 6 个额外检查） |
| 1.5 | `jest.config.js` | `coverageThreshold` 当前注释，启用基线门槛 |

打包同一 SDD 的理由：
- 两项都是构建期 / 测试期门禁，无运行时风险
- 启用 `"strict": true` 后部分 strict 错误的修复可能让 coverage 数据漂移；先 strict 再 coverage 顺序处理可以一次拿到稳定基线
- 门禁改动失败模式相同（CI 中断），同 PR 失败可一起回滚

**Bonus**: 现有 tsconfig 实际已开 `noImplicitAny` / `strictNullChecks` / `strictPropertyInitialization`（line 13/16/18），强项已具备。`"strict": true` 额外开启的是 4 个相对低噪声的检查（详见 §3.1）。

---

## 2. Goals / Non-goals

### Goals

1. **1.4** 把三个独立 strict flag 替换为 `"strict": true`，等价开启另外 4 个 strict 子检查（`strictFunctionTypes` / `strictBindCallApply` / `noImplicitThis` / `useUnknownInCatchVariables`），并显式启用 `alwaysStrict`
2. **1.5** 启用 `coverageThreshold` 配置，初始数值取实测基线下浮 5%，作为"防退化"地板而非 aspiration 上限
3. 修复启用 strict 后所有编译错误（预期主要在测试 mock 文件，源码代价低）
4. 不阻塞当前任何已通过的测试

### Non-goals

- 不开启 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`（不在 `"strict": true` 默认集合，单独启用代价大、收益低，未来另行评估）
- 不重写测试结构 / 测试模式（仅修类型错误）
- 不调整 `lib` / `module` / `target` / `jsx` 等编译器配置
- 不调整既有 mock 设计（仅修类型）
- 不要求 100% coverage（仅锁定基线，长期可逐步提）

---

## 3. Spec

### 3.1 项 1.4 — `"strict": true`

#### `"strict": true` 的子集映射

参考 TypeScript 5.x 文档，`"strict": true` 等价于开启以下 8 个：

| 子检查 | 当前状态 | 启用后 |
|---|---|---|
| `noImplicitAny` | ✅ 已开 (line 13) | ✅ 不变 |
| `strictNullChecks` | ✅ 已开 (line 16) | ✅ 不变 |
| `strictPropertyInitialization` | ✅ 已开 (line 18) | ✅ 不变 |
| `strictFunctionTypes` | ❌ 未显式开 | ✅ 新增 |
| `strictBindCallApply` | ❌ 未显式开 | ✅ 新增 |
| `noImplicitThis` | ❌ 未显式开 | ✅ 新增 |
| `useUnknownInCatchVariables` | ❌ 未显式开 | ✅ 新增 |
| `alwaysStrict` | ❌ 未显式开 | ✅ 新增 |

新增 5 个子检查的预期错误规模（仅估计，实施时跑一次 `tsc --strict` 取真实清单）：

- `strictFunctionTypes` — 函数参数双向协变收紧；项目使用大量 langchain 回调，可能 0-3 处
- `strictBindCallApply` — `Function.prototype.bind/call/apply` 类型严格；典型用法都写 lambda，预估 0
- `noImplicitThis` — 隐式 `this: any` 在 lambda 内禁止；项目几乎不用 `function` 关键字 + this，预估 0-2 处
- `useUnknownInCatchVariables` — `catch (e)` 中 `e` 类型从 `any` 改为 `unknown`，需要 `instanceof Error` 守卫；**这是预期错误最多的子项**，全仓 grep `catch (` 大概 30-50 处
- `alwaysStrict` — `"use strict"` 自动注入；运行时无变化，无错误

#### 目标 `tsconfig.json` 完整内容

```json
{
  "compilerOptions": {
    "outDir": "dist",
    "paths": {
      "plugin": ["./src/plugin"],
      "utils": ["./src/utils"]
    },
    "module": "ESNext",
    "target": "ES2020",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "allowJs": true,
    "importHelpers": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "strict": true,
    "lib": ["DOM", "ES2020"],
    "typeRoots": [
      "./node_modules/@types",
      "./src/types"
    ],
    "types": ["node", "jest"]
  },
  "include": [
    "**/*.ts",
    "**/*.tsx"
  ]
}
```

**Diff:**
- 移除：`"noImplicitAny": true` / `"strictNullChecks": true` / `"strictPropertyInitialization": true` 三行
- 新增：`"strict": true` 一行
- 等价集 + 新增 5 个子检查

#### Catch 块改造模式

`useUnknownInCatchVariables` 的修复 pattern：

```typescript
// Before
try {
    doThing();
} catch (e) {
    log("failed", e.message); // ❌ 'e' is unknown
}

// After (Pattern A: instanceof guard)
try {
    doThing();
} catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("failed", message);
}

// After (Pattern B: 显式注解放宽 — 保留 any)
try {
    doThing();
} catch (e: any) { // 明确表态保留旧行为
    log("failed", e.message);
}
```

**项目应优先用 Pattern A**。Pattern B 仅在临时（如已经决定后续重构的代码）使用，必须配 TODO 注释。

#### 实施时的标准修复清单（占位，实施时填实）

```
- [ ] src/foo.ts:NNN — catch(e) → instanceof Error guard
- [ ] __tests__/bar.test.ts:NNN — mock 函数缺 this 标注
... (实施 PR 中按 tsc 输出补全)
```

预期总计：
- 源码 (`src/`)：< 10 处（catch 块为主）
- 测试 (`__tests__/`)：< 30 处（mock 类型为主）
- mocks (`__mocks__/`)：0-2 处

实施 PR 应分多个 commit：
1. `chore: enable strict mode in tsconfig` （只改配置）
2. `fix(types): handle unknown in catch blocks` （catch 块批量修）
3. `fix(types): tighten test mock types` （测试侧批量修）

### 3.2 项 1.5 — Jest Coverage 门槛

#### 当前状态

`jest.config.js:45` `coverageThreshold` 注释。`collectCoverage: true` 已开（line 20），但无门槛。

#### 制定门槛流程

**Step 1**：实施 PR 中先跑 `npm test -- --coverage --runInBand`，记录 4 项基线数据：

```
基线（实施时填实）：
- statements: __%
- branches:   __%
- functions:  __%
- lines:      __%
```

**Step 2**：把基线 - 5% 作为门槛初值。原则：

- 取整到个位（如基线 71.4% → 门槛 66%）
- 至少不低于 50%（一个能"被信任"的最小值）
- 至多不高于基线 - 3%（给开发空间，避免门禁过死）

**Step 3**：写入 `jest.config.js`：

```javascript
coverageThreshold: {
    global: {
        statements: __, // 基线 - 5
        branches:   __, // 基线 - 5
        functions:  __, // 基线 - 5
        lines:      __, // 基线 - 5
    },
},
```

**初始预估值**（实施时以实测为准）：基线在 65-75% 区间，门槛设 60-70%。

#### 排除路径设计

不需要 coverage 的路径用 `coveragePathIgnorePatterns`（默认已含 `/node_modules/`）。本项目应额外排除：

```javascript
coveragePathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/__mocks__/",     // mock 文件本身不需要 coverage
    "/__tests__/",     // 测试文件本身不需要 coverage
    "/scripts/",       // 构建脚本不在 jest 范围
    "/src/types/",     // 仅类型声明文件
],
```

注意：jest 默认会把 `__tests__` 算在 testMatch 而非 sources，但显式排除避免 ts-jest preset 误算 .d.ts 文件。

#### 为什么 -5%

1. **Buffer**：开发期间 PR 可能临时降低某指标 1-2%，门槛 -3% 可能太紧；-5% 平衡
2. **稳定地板**：目标是"防退化"，未来可逐步提门槛（如每季度 +2%），不是一开始就强推高覆盖率
3. **CI 不阻塞**：第一次开门禁后立刻在 CI 上跑通是关键

### 3.3 顺序约束

**必须先 1.4 后 1.5**：
- `"strict": true` 修复后部分文件可能新增 `if (!x) throw` 类守卫语句
- 这些守卫的 then 分支被测试到的概率可能下降 → branches coverage 下降
- 先把 strict fix 落地，再用 coverage 锁定真实基线，否则门槛立即被破

---

## 4. Test Plan

### 4.1 1.4 验证

- `npx tsc -noEmit -skipLibCheck` 必须通过（核心验证）
- `npm test -- --runInBand` 全部测试必须通过（mock 类型修复后无回归）
- `npm run lint` 通过（lint 规则不动，但部分 `as any` 删除可能改变 lint warn 数量）
- `npm run build` 通过（esbuild 不依赖 strict，但确认整个 build 链路不被破坏）

回归测试：
- 重点抽查 catch 块 fix 后的错误日志是否仍能拿到 message（不能丢信息）
- 重点抽查测试 mock 修复后的行为断言是否仍正确

### 4.2 1.5 验证

- `npm test -- --coverage --runInBand` 必须通过门槛
- 故意把某文件 1 个分支测试删掉验证：是否会触发门槛 fail（confirm 真生效）
- 故意把覆盖率拉到门槛之上 1% 验证：fail 后修复一个测试就过门槛（confirm 不会卡死）

### 4.3 全量门禁

- `npx tsc -noEmit -skipLibCheck`
- `npm test -- --runInBand --coverage`
- `npm run lint`
- `git diff --check`
- `npm run build`

无 UI 变更，无需 Obsidian smoke。

---

## 5. Implementation Steps

按依赖顺序：

1. **1.4 第 1 步：开 strict，列错误清单**
   - 编辑 `tsconfig.json`：删 3 个独立 flag、加 `"strict": true`
   - 跑 `npx tsc -noEmit -skipLibCheck 2>&1 | tee strict-errors.txt`
   - 把 `strict-errors.txt` 放在 PR 描述里作为修复清单（不入 commit）

2. **1.4 第 2 步：批量修 catch 块**
   - 用 `useUnknownInCatchVariables` 错误清单做依据
   - 每处用 Pattern A（`e instanceof Error ? e.message : String(e)`）
   - 跑 `npx tsc -noEmit -skipLibCheck` 确认 catch 错误清零
   - commit: `fix(types): handle unknown in catch blocks`

3. **1.4 第 3 步：修测试 mock 类型**
   - 处理 `strictFunctionTypes` / `noImplicitThis` 报告的剩余错误
   - mock 函数添加正确的 this 注解或参数注解
   - 跑 `npx tsc -noEmit -skipLibCheck` 全绿
   - commit: `fix(types): tighten test mock types`

4. **1.4 第 4 步：跑测试**
   - `npm test -- --runInBand` 全绿
   - 如有测试 fail，回看 mock 改动是否破坏行为，必要时调整断言

5. **1.5 第 1 步：取 coverage 基线**
   - 跑 `npm test -- --coverage --runInBand`
   - 抓 stdout 末尾的 4 项数字
   - 在 PR 描述写明：基线 / 门槛初值

6. **1.5 第 2 步：启用 coverageThreshold**
   - 编辑 `jest.config.js`：解开 `coverageThreshold` 注释填入数值，加 `coveragePathIgnorePatterns`
   - 跑 `npm test -- --coverage --runInBand` 通过门槛
   - commit: `chore(test): enable coverage threshold floor at baseline -5%`

7. **全量验证**：跑 §4.3 全量门禁

---

## 6. Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| strict 错误清单超预期（> 50 处） | 中 | 实施第 1 步取得真实清单后评估；如 > 100 处考虑拆分 PR 或暂缓某子检查（写明放弃理由） |
| catch 块 fix 后丢失原始 error 对象（调试困难） | 中 | Pattern A 保留 `e` 原始对象，只对 `.message` 做 instanceof 守卫；必要时 log `e instanceof Error ? e.stack : e` |
| 测试 mock 类型修复破坏测试行为 | 中 | 修类型不改运行时；每个 mock 改动后单独跑相关测试文件确认 |
| coverage 基线极低（< 50%） | 中 | 如基线 < 50%，门槛设到 max(基线 - 5, 40)；同时在 v2-fix-plan 加新条目跟踪"提升 coverage 至 60%" |
| coverage 门槛在 CI 上不稳定（小幅波动 fail） | 低 | -5% buffer 已留出余地；如仍 flaky 改为 -8% 或缩小到关键模块（src/ai-services 单独门槛） |
| `useUnknownInCatchVariables` 在 langchain 回调中触发难以处理的类型错误 | 低 | langchain 大多数 catch 在自定义 invoker 内，全在项目代码控制；如有第三方库调用栈，可临时 `as any` + TODO |
| `noImplicitThis` 在 React class 组件 / Obsidian view 触发 | 低 | 项目主要是 functional components；class 组件少，逐个改即可 |
| 启用 strict 后 langchain / Obsidian 类型定义自身错误浮现 | 低 | `skipLibCheck` 已开，第三方库类型问题不会阻塞 |

---

## 7. Critical Files

**修改:**
- `tsconfig.json` — 3 行 flag 替换为 1 行 `"strict": true`
- `jest.config.js` — `coverageThreshold` 配置 + `coveragePathIgnorePatterns`

**实施时新发现修改清单**（按 §5 第 1 步 `tsc` 输出生成；当前为空占位）:
- `src/**/*.ts` 中所有 catch 块（具体清单待 strict-errors.txt）
- `__tests__/**/*.ts` 中类型不严的 mock（具体清单待 strict-errors.txt）

**阅读参考（无需改动）:**
- TypeScript 5.x 文档 `--strict` 子项映射
- Jest 配置文档 `coverageThreshold` 字段

---

## 8. Rollback

两项独立可回滚：

- 1.4：还原 `tsconfig.json` 三行 + 还原所有 catch 块 / mock 类型修复
  - 注意：tsconfig 单回滚但保留类型修复也可（修复版本类型更严但运行时等价）
- 1.5：注释 `coverageThreshold` 与 `coveragePathIgnorePatterns` 行

如 1.4 在 CI 上阻塞但已合并，可临时把 `"strict": true` 单项关闭重启 CI；不需 revert 整个 PR。

---

## 9. Verification Checklist

- [ ] `tsconfig.json` 含 `"strict": true`，无 3 个独立 strict flag
- [ ] `npx tsc -noEmit -skipLibCheck` 通过
- [ ] `npm test -- --coverage --runInBand` 通过门槛
- [ ] `jest.config.js` 含 `coverageThreshold` 与 `coveragePathIgnorePatterns`
- [ ] `npm run lint` 通过
- [ ] `git diff --check` 通过
- [ ] `npm run build` 通过
- [ ] PR 描述含基线 / 门槛数值表
- [ ] 故意降低 1 行覆盖率验证门槛会 fail（实施时本地试，commit 前还原）

---

## 10. Workflow

1. 本 SDD 通过 review 后合并 docs PR
2. 创建 worktree `feat/strict-coverage`，按 §5 步骤实施
3. 第 1 步获取 strict 错误清单后，**先写到 PR 描述并暂停**让用户确认是否继续（如清单超预期可调整范围）
4. 通过 §9 验证清单后开 PR
5. PR 合并后更新 `docs/v2-fix-plan.md` 的 1.4 / 1.5 状态
