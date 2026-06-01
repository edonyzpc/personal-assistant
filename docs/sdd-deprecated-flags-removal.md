# SDD: 无消费者 flag 清理（v2.2）

**Status:** [x] Done
**Phase:** v2.2

---

## 1. Context

v2.1.2 review 阶段定位到 2 个 settings flag 已无实际消费者，属于 no-op 或仅在内部留痕的隐藏开关。继续保留这些字段会让新成员误以为有功能可调用，增加心智负担。趁 v2.2 这次小版本顺手清掉，与 apiToken 链清理（v2.5，参见 `./docs/sdd-apitoken-cleanup.md`）拆开为两次推进。

涉及字段与定位：

| 字段 | 定义 | 使用点 | 状态 |
|------|------|--------|------|
| `paAgentAnswerStreamEnabled` | （类型未在 settings.ts 现存定义中找到） | `./src/plugin.ts:1084-1087` 在 `migrateSettings()` 中以 `delete (this.settings as ...).paAgentAnswerStreamEnabled` 的形式被清理 | 已是清理代码，但意味着曾经存在过、需扫尾 |
| `nativeToolPlanningSmokeEnabled` | `./src/settings.ts:70` 类型定义 + `./src/settings.ts:140` 默认值 `false` | `./src/ai-services/chat-service.ts:102` 唯一消费点；`./src/plugin.ts:1062-1065` migrateSettings 中类型归一化 | 字段存在但 chat-service 中是隐藏 smoke 开关 |

**为何 v2.2 而非 v2.5**：这两个清理与 apiToken 链解耦，无 6 个月窗口/keychain 迁移的依赖；提前清理可减少 v2.2 → v2.5 之间维护时遇到的"这是干啥的"翻找成本。

---

## 2. Goals

1. 删除 `paAgentAnswerStreamEnabled` 字段及全部清理代码（已在 `migrateSettings` 中存在的 delete 块也一并删，因为再也不会出现该字段）
2. 删除 `nativeToolPlanningSmokeEnabled` 字段及全部消费点：
   - `./src/settings.ts:70` 类型定义
   - `./src/settings.ts:140` 默认值
   - `./src/ai-services/chat-service.ts:102` 使用分支
   - `./src/plugin.ts:1062-1065` migrateSettings 中类型归一化逻辑
3. CHANGELOG 加 breaking section（覆盖手工改过 `data.json` 启用过这俩 flag 的早期用户）
4. settings UI 中如有 toggle 暴露这俩 flag → 一并删除

---

## 3. Non-goals

- 不动其他 flag（如 `qwenThinkingEnabled`、`enableMetadataUpdating` 等仍在用的）
- 不动 apiToken 明文链（v2.5 范围，参见 `./docs/sdd-apitoken-cleanup.md`）
- 不重构 settings 类型层结构（仅做字段移除）
- 不改 `chat-service.ts` 的 native tool planning 主链路 —— 仅删 smoke 分支条件

---

## 4. Spec design

### 4.1 全仓 grep 验证（PR 第 1 步）

实施前必须先扫一遍引用，确认 review 阶段的清单完整：

```bash
grep -rn "paAgentAnswerStreamEnabled\|nativeToolPlanningSmokeEnabled" src/ __tests__/
```

预期命中：

- `paAgentAnswerStreamEnabled` 仅命中 `./src/plugin.ts:1084-1087`
- `nativeToolPlanningSmokeEnabled` 命中 4 处：`./src/settings.ts:70`、`./src/settings.ts:140`、`./src/ai-services/chat-service.ts:102`、`./src/plugin.ts:1062-1065`

实际有出入则同步更新本 SDD 的 `Critical files` 章节。

### 4.2 删除步骤（按 PR commit 顺序）

**Commit 1 — settings.ts 类型与默认值**

```diff
-    nativeToolPlanningSmokeEnabled: boolean;
```

```diff
-    nativeToolPlanningSmokeEnabled: false,
```

**Commit 2 — chat-service.ts 消费点**

`./src/ai-services/chat-service.ts:102` 当前形态：

```typescript
const nativeToolPlanningOptions = this.plugin.settings.nativeToolPlanningSmokeEnabled
    ? { nativeToolPlanningInternalGate: true, nativeToolCallingValidatedModels: SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS }
    : { nativeToolPlanningInternalGate: true, ... };
```

判定方案：smoke 分支彻底无人使用，直接保留 `else` 分支作为唯一行为。

```diff
-const nativeToolPlanningOptions = this.plugin.settings.nativeToolPlanningSmokeEnabled
-    ? { nativeToolPlanningInternalGate: true, nativeToolCallingValidatedModels: SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS }
-    : { nativeToolPlanningInternalGate: true, ... };
+const nativeToolPlanningOptions = { nativeToolPlanningInternalGate: true, ... };
```

如果 `SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS` 常量在删除后无其他引用，同步删除常量定义。

**Commit 3 — plugin.ts migrateSettings 清理**

`./src/plugin.ts:1062-1065` 中 nativeToolPlanningSmokeEnabled 的类型归一化分支：

```diff
-            if (
-                "nativeToolPlanningSmokeEnabled" in this.settings
-                && typeof this.settings.nativeToolPlanningSmokeEnabled !== "boolean"
-            ) {
-                this.settings.nativeToolPlanningSmokeEnabled = false;
-            }
+            // 字段已在 v2.2 移除：旧 data.json 中的残留字段在 TS 类型缩窄后被忽略，
+            // 由通用残留字段清理路径（如有）兜底；migrateSettings 不再单独归一化。
```

`./src/plugin.ts:1084-1087` 中 paAgentAnswerStreamEnabled 的清理代码（是否保留）：

| 选项 | 处理 | 风险 |
|------|------|------|
| A. 直接删除清理代码 | data.json 残留的 `paAgentAnswerStreamEnabled` 字段会持续留存（因 TS 类型不匹配，写回 `saveSettings` 时未必清掉） | 低 —— 字段是 boolean 噪声，运行时被 TS 类型缩窄忽略，不影响行为 |
| B. 保留清理代码到 v2.3 后再删 | 多保留 1 个 minor 周期 | 心智负担多 1 个版本 |

**采用方案 A**：直接删除清理段。理由：

1. boolean 噪声字段在 `JSON.stringify(this.settings)` 写回时是否带回取决于 TS 类型缩窄行为，但即使带回也无消费者读取
2. 心智负担大于实际收益
3. 如担心残留，可统一用一段 `cleanupResidualSettingsFields()` helper 在某次重构时统一处理（不在本 PR 范围）

```diff
-            if ("paAgentAnswerStreamEnabled" in this.settings) {
-                delete (this.settings as Partial<PluginManagerSettings> & { paAgentAnswerStreamEnabled?: unknown }).paAgentAnswerStreamEnabled;
-                changed = true;
-            }
```

**Commit 4 — settings UI 清理**

实施前 grep settings.ts 中是否有 toggle UI 暴露这俩 flag：

```bash
grep -n "paAgentAnswerStreamEnabled\|nativeToolPlanningSmokeEnabled" src/settings.ts
```

预期：仅类型定义+默认值命中（已在 Commit 1 处理）。如有 UI toggle 命中，本 commit 同步删除。

**Commit 5 — 测试 fixture 与单测**

```bash
grep -rn "paAgentAnswerStreamEnabled\|nativeToolPlanningSmokeEnabled" __tests__/
```

清理：

- mock 的 `Partial<PluginManagerSettings>` 构造中带这俩字段的位置 → 删字段
- 直接为 smoke 分支写的单测 → 删测试用例

**Commit 6 — CHANGELOG**

```markdown
### Removed (Breaking)
- `paAgentAnswerStreamEnabled` setting field — 已无消费者，曾经的内部 stream 开关
- `nativeToolPlanningSmokeEnabled` setting field — 已无消费者，曾经的 native tool planning smoke 测试开关

如你曾手工修改 `data.json` 启用过这两个 flag，升级后字段会被自动忽略；不影响其他配置。
```

---

## 5. Acceptance criteria

- 全仓 grep `paAgentAnswerStreamEnabled` / `nativeToolPlanningSmokeEnabled` 仅命中 CHANGELOG / archive 文档
- `tsc -noEmit -skipLibCheck` 干净
- `npm test` 全通过
- `npm run build` 成功
- 用户的 `data.json` 中如残留这两个字段，启动后被 TS 类型缩窄静默忽略（不抛异常、不卡启动）
- settings UI 打开后无暴露这俩 flag 的 toggle

---

## 6. Verification

### 6.1 自动化

```bash
# 引用清查
grep -rn "paAgentAnswerStreamEnabled\|nativeToolPlanningSmokeEnabled" src/ __tests__/

# 类型与构建
tsc -noEmit -skipLibCheck
npm test
npm run build
```

### 6.2 手工

| 场景 | 步骤 | 期望 |
|------|------|------|
| 干净 vault | v2.2 启动 | 无 Notice，settings UI 正常 |
| 残留字段 | 手工在 `data.json` 写入 `"paAgentAnswerStreamEnabled": true` 和 `"nativeToolPlanningSmokeEnabled": true` 后启动 v2.2 | 无报错；保存后字段是否被清掉非关键，但不应让插件崩 |
| native tool planning 主链路 | 在已配置 native tool calling 模型的 vault 触发对话 | 行为与 v2.1.2 一致（chat-service.ts:102 删除 smoke 分支后仅保留 else 分支） |
| AI Chat 流式回答 | 触发任意 AI 回答 | 流式 UI 正常（删除 paAgentAnswerStreamEnabled 不影响 stream 主链路；它本就是 no-op） |

---

## 7. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| `nativeToolPlanningSmokeEnabled` 在 hidden 测试 fixture 中被用 | 中 | Commit 5 全仓 grep 清理；测试通过后再合 |
| `SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS` 常量在 chat-service 之外仍有引用 | 低 | grep 后决定是否同步删常量；如有其他引用则保留 |
| 用户的 `data.json` 残留字段触发 TS 类型不匹配的写回行为 | 低 | TS 类型缩窄会忽略未声明字段；最坏情况字段在 data.json 持续存在但无副作用 |
| `paAgentAnswerStreamEnabled` 的 migrateSettings 清理代码删除后，存量 vault 的字段无人清理 | 极低 | 仅是 data.json 中无害噪声字段；不接受复杂兜底 |
| settings UI 仍暴露 toggle 但本 SDD 漏改 | 中 | Commit 4 显式 grep settings.ts 的所有命中；构建后手工打开 Settings 验证 |
| 删除 chat-service smoke 分支改变了 native tool planning 默认行为 | 中 | 删除前确认 smoke 分支与默认分支差异（仅 `nativeToolCallingValidatedModels` 字段）；如默认行为依赖该字段则改为始终启用 validation |

---

## 8. Critical files

**修改：**

- `./src/settings.ts` — 删 `nativeToolPlanningSmokeEnabled: boolean;`（line 70）+ 默认值 `nativeToolPlanningSmokeEnabled: false,`（line 140）
- `./src/ai-services/chat-service.ts` — 简化 `nativeToolPlanningOptions` 三元为唯一分支（line 102 周边）；评估 `SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS` 常量是否同步删
- `./src/plugin.ts` — 删 `migrateSettings()` 中 nativeToolPlanningSmokeEnabled 类型归一化分支（line 1062-1065）+ paAgentAnswerStreamEnabled 清理段（line 1084-1087）

**评估后决定：**

- `./src/ai-services/chat-service.ts` 的 `SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS` 常量（如无其他引用则删）
- `./src/settings.ts` 中如有 settings UI toggle 暴露这俩 flag（grep 后处理）
- `__tests__/` 中触达这俩字段的 fixture 与用例

**新增：**

- `CHANGELOG.md` v2.2.0 section 的 Removed (Breaking) 子段
