# SDD: apiToken 明文链清理（v2.5）

**Status:** [D] Drafting
**Phase:** v2.5

---

## 1. Context

v2.0（2026-05-29，commit `04a16d4`）引入 keychain 迁移代码，自动把老用户存于 `data.json` 的 `apiToken` 字段（CryptoHelper 加密的 base64 串）解密后写入系统 keychain（vault-scoped SecretStorage）。当前 v2.1.2，迁移代码已在生产环境运行约 3 天。

按 `./docs/v2-release-schedule.md` 的明文清理触发条件，v2.5 满足两个独立约束后启动一次性删除：

- 经过 v2.0 / v2.1 / v2.2 / v2.3 / v2.4 共 ≥ 5 个 minor 升级机会
- 距 v2.0 发版（2026-05-29）≥ 6 个月（即 ≥ 2026-11-29）

迁移代码现状（按文件枚举）：

| 文件 | 行号 | 内容 |
|------|------|------|
| `./src/settings.ts` | 59-60 | `/** @deprecated legacy data.json token migrated to SecretStorage on load */` + `apiToken?: string;` |
| `./src/utils.ts` | 189-190 | `personalAssitant` 常量 + `@deprecated Remove after v2.5.0` |
| `./src/utils.ts` | 192-? | `CryptoHelper` 类整体（PBKDF2/AES-GCM 解密工具）+ `@deprecated Remove after v2.5.0` |
| `./src/plugin.ts` | 14 | `import { CryptoHelper, ..., personalAssitant } from './utils';` |
| `./src/plugin.ts` | 117-118 | `private cryptoHelper: CryptoHelper = new CryptoHelper();` + `@deprecated` 注释 |
| `./src/plugin.ts` | 1172-1196 | `migrateSettings()` 中：读 `this.settings.apiToken` → `cryptoHelper.decryptFromBase64()` → 写入 SecretStorage 的迁移段 |
| `./src/plugin.ts` | 1219-1221 | `getLegacyAPITokenSecretId()` 方法（返回 `KEYCHAIN_API_TOKEN_ID` 老 keychain id） |
| `./src/plugin.ts` | 1224-1227 | `hasConfiguredAPIToken()` 中 legacy id fallback 分支 |
| `./src/plugin.ts` | 1247 | （需进一步评估）其它 legacy id 读取点 |
| `./src/utils.ts` | 184-194 | `getVaultScopedSecret(secretStorage, scopedId, legacyId)` —— legacy id fallback helper |
| `./src/settings.ts` | 748、1533 | settings UI 中通过 `plugin.getLegacyAPITokenSecretId()` 触达 legacy keychain |

代码总行数预估 ~110 行，分散在 3 个文件 + 若干测试 fixture。

---

## 2. Goals

v2.5 一个 PR 内一次性删除 apiToken 明文链相关全部死代码：

1. 删除 `./src/settings.ts` 的 `apiToken?: string;` 字段定义
2. 删除 `./src/utils.ts` 的 `personalAssitant` 常量
3. 删除 `./src/utils.ts` 的 `CryptoHelper` 类整体
4. 删除 `./src/plugin.ts` 的 `cryptoHelper` 私有字段 + `import` 语句对应符号
5. 删除 `./src/plugin.ts` 的 `migrateSettings()` 中 apiToken 读取/解密/迁移段（line 1172-1196）
6. 删除 `./src/plugin.ts` 的 `getLegacyAPITokenSecretId()` 方法
7. 评估 `./src/utils.ts` `getVaultScopedSecret` legacy fallback 是否同步删除（取决于是否仍有调用方依赖 legacy id）
8. 删除 `hasConfiguredAPIToken()` 与 settings UI 中的 legacy id 分支
9. 删除任何 `__tests__/api-token-migration.test.ts` 类型的迁移单测

---

## 3. Non-goals

- 不需要"keychain 迁移工具"或独立工具版本：迁移逻辑已在 v2.0 自动完成，无需补做
- 不需要 v2.4 出"迁移过渡版本"：5 个 minor 已是过渡窗口本身
- 不需要 banner 通知：6 个月 + ≥ 5 minor 自动迁移机会已是足够触达
- 不动其他 deprecated flag 清理（参见 `./docs/archive/sdd-deprecated-flags-removal.md`，那是 v2.2 范围）
- 不重写 SecretStorage 接入：现有 vault-scoped id 路径保持

---

## 4. Spec design

### 4.1 删除范围（按 PR commit 顺序）

**Commit 1 — `./src/settings.ts`**

```diff
-    /** @deprecated legacy data.json token migrated to SecretStorage on load */
-    apiToken?: string;
```

同时检查 `DEFAULT_SETTINGS` 中是否有 `apiToken` 默认值需清理。

**Commit 2 — `./src/utils.ts`**

```diff
-/** @deprecated Remove after v2.5.0 — only used for one-time migration decryption */
-export const personalAssitant = "personal-assistant-plugin-api-token";
-
-/** @deprecated Remove after v2.5.0 — only used for one-time migration decryption */
-export class CryptoHelper {
-    // ... entire class body ...
-}
```

`CryptoHelper` 引用了顶部 `// code from https://github.com/meld-cp/obsidian-encrypt/...`（line 134）注释 —— 注释一并清理。

**Commit 3 — `./src/plugin.ts`**

```diff
-import { CryptoHelper, KEYCHAIN_API_TOKEN_ID, getVaultApiTokenId, hasSecretValue, icons, personalAssitant } from './utils';
+import { KEYCHAIN_API_TOKEN_ID, getVaultApiTokenId, hasSecretValue, icons } from './utils';
```

`KEYCHAIN_API_TOKEN_ID` 是否保留视 §4.2 评估结果决定。

```diff
-    /** @deprecated Remove after v2.5.0 — only used for one-time migration decryption */
-    private cryptoHelper: CryptoHelper = new CryptoHelper();
```

`migrateSettings()` 中（line 1172-1196）整段删除：

```diff
-            const rawApiToken = this.settings.apiToken;
-            const scopedTokenId = this.getAPITokenSecretId();
-            const legacySecretId = this.getLegacyAPITokenSecretId();
-            if (rawApiToken && rawApiToken !== "sk-xxx") {
-                const decrypted = await this.cryptoHelper.decryptFromBase64(rawApiToken, personalAssitant);
-                if (decrypted) { ... } else { ... }
-            } else if ("apiToken" in this.settings) {
-                delete this.settings.apiToken;
-                changed = true;
-            }
-            if (this.app.secretStorage.getSecret(scopedTokenId) === null) {
-                const legacyToken = this.app.secretStorage.getSecret(legacySecretId);
-                if (hasSecretValue(legacyToken)) { ... }
-            }
```

```diff
-    getLegacyAPITokenSecretId(): string {
-        return KEYCHAIN_API_TOKEN_ID;
-    }
```

`hasConfiguredAPIToken()` 中（line 1224-1227）legacy 分支删除，仅保留 scoped id 路径。

**Commit 4 — 测试 fixture 与单测清理**

- 全仓 grep `personalAssitant`、`CryptoHelper`、`apiToken`（精确匹配字段而非 token 字符串）、`getLegacyAPITokenSecretId`
- 删除相关单测（如 `__tests__/api-token-migration.test.ts` 类型文件）
- 调整 `__tests__/settings-migration.test.ts` 中触达迁移分支的用例

**Commit 5 — CHANGELOG + release notes**

- CHANGELOG 加 breaking section：v1.x 跳升至 v2.5 用户需重新输入 API Token
- release notes 顶部 Notice 框：「首次升级如来自 v1.x，需在 Settings 重新输入 API Token」

### 4.2 `getVaultScopedSecret` legacy fallback 评估

`./src/utils.ts:184-194` 的 `getVaultScopedSecret(secretStorage, scopedId, legacyId)` 提供 legacy id 兜底读取。删除前需在 PR 第一步执行：

```bash
grep -rn "getVaultScopedSecret\|KEYCHAIN_API_TOKEN_ID" src/ __tests__/
```

判定准则：

- **全部调用方都把 `legacyId === scopedId` 传入** → 可以连同 `legacyId` 形参一起删除
- **仍有调用方依赖跨 vault 的旧 id** → 保留函数，但删除 apiToken 相关的 legacy id 路径

预期结果：v2.0 迁移已把全部老用户搬到 scoped id，但删除前必须 grep 确认。

### 4.3 风险窗口（跳版本升级）

| 升级路径 | apiToken 行为 | 用户感知 |
|---------|--------------|---------|
| v1.x → v2.0 → v2.1 → ... → v2.5 (正常路径) | v2.0 自动迁移到 keychain，v2.5 删除迁移代码无影响 | 无感 |
| v1.x → v2.5（跳版本） | data.json 的 `apiToken` 被 TS 类型缩窄忽略；keychain 中无 token | 启动后 AI 调用失败 → Settings 重新输入一次 token |
| v2.0+ → v2.5（已迁移过） | data.json 已无 `apiToken`，keychain 已有 scoped token | 无感 |

**关键事实**：跳版本用户**不丢其他配置**，仅 token 一项需重输。这是 v2.5 release notes 必须明显标注的风险点。

---

## 5. Acceptance criteria

- v2.5 启动后 `data.json` 不再触发任何 `apiToken` 字段处理路径
- 全测试通过（`__tests__/settings-migration.test.ts`、`__tests__/plugin.test.ts` 等）
- `tsc -noEmit -skipLibCheck` 干净
- `npm run build` 成功，bundle 中无 `personalAssitant` / `CryptoHelper` / `decryptFromBase64` 字符串
- 全仓 grep `apiToken`、`personalAssitant`、`CryptoHelper`、`getLegacyAPITokenSecretId` 仅命中 CHANGELOG / release notes / archive 文档
- 手工验证（关键）：
  1. 准备测试 vault：删除 keychain entry + 在 `data.json` 写入旧 `apiToken` 字段（CryptoHelper 加密后的 base64 串）
  2. v2.5 启动 → 应弹出"请重新输入 API Token"提示，AI 调用失败
  3. 用户在 Settings 重输 token → 工作恢复
- v2.5 release notes 顶部明显位置有"v1.x 跳升用户需重输 token"提示

---

## 6. Verification

### 6.1 自动化

```bash
tsc -noEmit -skipLibCheck
npm test
npm run build
grep -rn "personalAssitant\|CryptoHelper\|getLegacyAPITokenSecretId" src/ __tests__/
```

最后一条 grep 应无业务代码命中。

### 6.2 手工

| 场景 | 步骤 | 期望 |
|------|------|------|
| 干净启动 | 已迁移过的 vault 启动 v2.5 | 无 Notice，AI 正常工作 |
| v1.x 跳升 | 测试 vault 写入旧 apiToken 后启动 v2.5 | Notice 提示重输；keychain 仍空 |
| Settings UI | 打开 Settings → API Token 字段 | 输入后保存到 vault-scoped id，重启后保留 |
| 多 vault | 同机 2 个 vault 都已迁移 | 各自 keychain 独立无串扰 |

### 6.3 production confirmation 前置

删除前确认 v2.0 迁移代码在生产环境实际跑过的覆盖率：

- 是否存在用户**禁用 plugin → 长期不重启 → 仍未触发 migrateSettings 的群体**
- 通过 Sentry / 用户反馈 / GitHub issue 历史评估
- 评估结果若显示 ≥ 5% 用户从 v1.x 跳升 → 触发 §8 复议

---

## 7. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| `getVaultScopedSecret` legacy fallback 仍有非 apiToken 调用方 | 中 | PR 第一步 grep；仅当所有调用方都用同一 id 才删 fallback |
| v1.x 跳升用户比例超预期 | 中-高 | 复议触发器 §8；release notes 明显标注；保留 Notice 提示 |
| 测试 fixture 残留 `apiToken` 构造 | 低 | Commit 4 全仓 grep 清理 |
| v2.0 自动迁移在某些用户上未实际执行（plugin 禁用 / 长期不开 vault） | 中 | §6.3 production confirmation；触发复议 |
| `KEYCHAIN_API_TOKEN_ID` 常量命名仍含 `_API_TOKEN_` 但语义已变 | 低 | 评估是否同步重命名为 vault-scoped 含义；非本 PR 范围则记入 followup |
| settings UI 路径中 legacy id 引用残留（`./src/settings.ts:748、1533`） | 中 | Commit 3 同步清理；构建后手工触达 Settings 页面验证无报错 |

---

## 8. 复议触发

发版前若发现以下任一情况，本 SDD 推迟 1 个 minor（v2.6）：

- 生产环境数据显示 ≥ 5% 用户仍从 v1.x 跳升至 v2.x
- v2.0 自动迁移在某些路径未触发的 bug report ≥ 3 例
- v2.4 之前发现 keychain 写入失败的偶发问题，需要 v2.5 保留 fallback

复议后处理：

- v2.5 改为加 banner 通知（"如果你的 token 在升级后失效，请在 Settings 重输"）
- v2.6 再执行删除

---

## 9. Critical files

**修改：**

- `./src/settings.ts` — 删 `apiToken?: string;` 字段（line 59-60）
- `./src/utils.ts` — 删 `personalAssitant` 常量（line 189-190）+ `CryptoHelper` 类（line 192-）+ 顶部第三方代码归属注释（line 134）
- `./src/plugin.ts` — 删 import 中的 `CryptoHelper` / `personalAssitant` 符号（line 14）+ `cryptoHelper` 字段（line 117-118）+ migrateSettings apiToken 段（line 1172-1196）+ `getLegacyAPITokenSecretId()`（line 1219-1221）+ `hasConfiguredAPIToken()` legacy 分支（line 1224-1227）

**评估后决定（依赖 §4.2 grep 结果）：**

- `./src/utils.ts:184-194` — `getVaultScopedSecret` legacy fallback
- `./src/settings.ts:748、1533` — settings UI 中 `getLegacyAPITokenSecretId()` 调用点

**删除（如存在）：**

- `__tests__/api-token-migration.test.ts` 类型的迁移专项单测
- `__tests__/settings-migration.test.ts` 中的迁移分支用例

**新增：**

- `CHANGELOG.md` v2.5.0 section 加 breaking note
- release notes（v2.5）顶部加跳版本风险提示
