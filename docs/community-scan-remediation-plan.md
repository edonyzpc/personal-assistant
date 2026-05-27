# Obsidian Community Scan 修复方案

> **Status (2026-05-25)**: Historical — Ollama support was removed in v2.0.0. References below to Ollama as a supported provider are no longer accurate; see [`CHANGELOG.md`](../CHANGELOG.md) for the v2.0.0 break-change release notes.
## Summary

- 目标：优先修复会影响社区审核、用户信任和发布资产可信度的问题，同时把大范围兼容性告警拆成后续低风险批次处理。
- 第一阶段聚焦：release assets、artifact attestations、manifest description、网络与隐私披露、`fetch(data:)`、`moment` import、`vault.configDir` 兼容迁移。
- 第二阶段聚焦：popout window compatibility、`confirm` Modal 化、DOM/timer helper、序列化和类型告警降噪。
- 不把扫描器所有 warning 一次性清零。大范围 UI/DOM/timer 改动必须独立验证，避免为了降噪引入 Obsidian popout、Mobile 或 Jest 回归。

## Priorities

| Priority | Scope | Rationale |
| --- | --- | --- |
| P0 | 无当前阻断项 | 两轮审阅均未发现必须暂停发布或重写架构的问题。 |
| P1 | Release attestation, release asset set, privacy/network disclosure, `vault.configDir` migration, `fetch(data:)`, core tests | 这些会影响社区审核结果、用户数据连续性或发布流程可信度。 |
| P2 | `manifest-beta.json`, shared confirmation helper, selected stringification fixes, docs sync | 风险较低，但值得在同一轮或紧随其后处理。 |
| P3 | popout/timer/activeDocument 全量兼容、CSS lint、类型告警清理 | 面广且容易产生 UI 或测试回归，适合单独批次。 |

## Current Resolution Status

Status date: 2026-05-18.

| Scope | Status | Evidence |
| --- | --- | --- |
| P0 blockers | Resolved | Current review found no release-blocking issue. |
| Release assets and attestations | Resolved | `.github/workflows/release.yml` stages `main.js`, `manifest.json`, and `styles.css` in `release-assets/`, attests the same staged files, and uploads that same three-file set. |
| Manifest scanner copy | Resolved | `manifest.json` and `manifest-beta.json` descriptions no longer include the flagged `Obsidian` wording. |
| Privacy/network disclosure | Resolved | `README.md`, `README-CN.md`, and this plan include the network matrix. The Chat row now explicitly covers prompt, selected note/tool context, Memory search query, and selected Memory excerpts or note snippets used in the final answer prompt. |
| Memory confirmation copy | Resolved | Prepare/update confirmation copy explains notes are not changed or deleted, note text may be sent to the configured AI provider, Memory search may use the question, background changed-note updates may send changed note text, and AI credits/API calls may be used. |
| `vault.configDir` local state compatibility | Resolved | VSS state and Stats shards write under `vault.configDir`, keep legacy `.obsidian` reads, and tests cover custom config directory and duplicate shard behavior. |
| `fetch(data:)`, `moment`, and high-signal stringification | Resolved | SQLite inline assets decode local `data:` URLs without `fetch`, `moment` imports come from `obsidian`, and AI/model content coercion avoids silent `[object Object]` output on reviewed paths. |
| Shared destructive confirmation helper | Resolved for current high-risk paths | `globalThis.confirm` usage was replaced with `confirmUserAction`; no `globalThis.confirm` references remain in `src/`. |
| Full popout/timer/CSS/type warning cleanup | Deferred | These are intentionally P3 follow-up batches and are not considered current release blockers. See Deferred Items. |

Verification completed for this remediation pass:

- `npm test -- --runInBand`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `make deploy`
- Obsidian test-vault smoke for Personal Assistant command execution, Records Preview, Vault Statistics Preview, Statistics tab interaction, and visible chat panel.

## Phase 1: Release And Manifest

### Changes

- 修改 `manifest.json` 的 `description`，去掉单词 `Obsidian`。
- 同步修改 `manifest-beta.json`，避免 beta/BRAT 渠道继续触发同类告警。
- 修改 `.github/workflows/release.yml`：
  - 构建后创建 release staging 目录，例如 `release-assets/`。
  - staging 目录只放正式支持的三件套：`main.js`、`manifest.json`、`styles.css`。
  - 对 staging 目录中的同一组三个文件生成 artifact attestations。
  - `gh release create` 上传同一组三个文件，不上传 `manifest-beta.json`。
  - workflow permissions 保留 `contents: write`，新增 `id-token: write` 和 `attestations: write`。
  - 不启用 `artifact-metadata: write`，因为当前只为 release files 生成 attestation，不创建 linked artifacts storage records。
- 更新 `docs/release-process.md`：
  - GitHub Release 只包含 `main.js`、`manifest.json`、`styles.css`。
  - `manifest-beta.json` 仍可用于本地部署或 beta 流程，但不是正式社区 release asset。

### Boundary Conditions

- Attestation 的 subject 文件必须和最终 release asset 的字节及文件名一致。
- 不要对 `dist/main.js` attest 后再用不同路径或不同 manifest 上传 release。
- `make deploy` 可以继续复制 `manifest-beta.json` 到本地 test vault，只要文档明确这不是正式 release asset。

## Phase 2: Privacy And Network Disclosure

### Changes

- 在 `README.md` 和 `README-CN.md` 增加可审计的网络使用矩阵。
- 在 Memory 准备和设置文案中补充后台更新说明：
  - 用户首次 Prepare/Update 成功后，changed notes 可能在后台更新 Memory。
  - 后台更新可能把变更笔记内容发送到用户配置的 AI provider。
  - 笔记不会被修改或删除。
  - 可能产生 AI credits/API calls。
- 明确插件没有 telemetry 或 analytics。默认 Statistics history 存储在当前设备的本地 Obsidian app storage；只有用户启用跨设备 Statistics sync 时才写入 vault-visible history 文件。

### Disclosure Matrix

| Feature | Trigger | Data Sent | Destination | Background | User Control |
| --- | --- | --- | --- | --- | --- |
| Chat | User sends a message | Prompt; selected note/tool context when enabled; Memory search query and selected Memory excerpts or note snippets used in the final answer prompt when Memory is enabled | Configured AI provider | No | Provider/chat/Memory settings |
| AI note tools | User runs summary or note AI actions | Current note content and generated prompt | Configured AI provider | No | User action/settings |
| Memory prepare/update | User confirms prepare/update | Note text and Memory search/query data | Configured AI provider | No for manual path; changed notes may update in background after success | Memory settings/background toggle |
| Memory changed-note maintenance | After successful approval and durable Memory ready | Changed note text | Configured AI provider | Yes | Memory settings/background toggle |
| DashScope web search | User enables web search path | Prompt/context required for web search | DashScope/Bailian | No | Feature setting |
| Featured image generation | User runs image generation | Current note content used to create image prompt, then image prompt/task request | Configured AI provider and DashScope/Bailian | Polls task status after request | User action/settings |
| Plugin/theme updater | User runs updater/install flow | Plugin/theme IDs and HTTP requests | GitHub/jsDelivr | No | User action |
| Ollama | User selects local provider | Prompt/embedding text | Local Ollama endpoint | Depends on feature | Provider setting |

### Boundary Conditions

- User-facing copy must keep product language such as `Memory`, `Memory from your notes`, `Prepare memory`, and `Update memory`.
- Do not expose VSS/RAG/embedding/SQLite/OPFS/chunks/backend jargon in ordinary settings or confirmation modals.
- Existing tests that enforce user-facing Memory vocabulary should remain valid or be updated deliberately.

## Phase 3: Config Directory Compatibility

### Changes

- Replace hardcoded `.obsidian` storage roots with helpers that accept `Vault` or `vault.configDir`.
- Affected areas:
  - VSS marker and manifest paths in `src/vss/state.ts`.
  - Stats store shard paths in `src/stats/stats-store.ts`.
  - Defaults and migrations for `statsPath` and `vssCacheExcludePath` in `src/settings.ts` and plugin load code.
- New writes should use `vault.configDir`.
- Reads should support legacy `.obsidian/...` paths for existing users.
- Settings migration should only adjust old default values. It must not overwrite user-customized paths.

### Migration Rules

- Default `.obsidian` vaults should keep identical effective paths.
- Custom config directory vaults should:
  - Prefer the new `vault.configDir` path.
  - Fall back to legacy `.obsidian/...` for existing stats and VSS marker/manifest reads.
  - Deduplicate Stats daily shards by date and device when the same shard exists under both the current config directory and the legacy `.obsidian` directory.
  - Migrate or copy lightweight state where safe.
  - Never silently rebuild Memory if durable local index appears missing.
- If VSS state is missing after migration, preserve current product behavior:
  - Explain that Memory may need to be prepared again.
  - Explain notes are not lost.
  - Require explicit user confirmation before costly rebuild.

### Boundary Conditions

- `DEFAULT_SETTINGS` cannot directly read `vault.configDir`; dynamic defaults belong in plugin load/migration code.
- Tests should cover both default `.obsidian` and custom config directory vaults.
- Avoid changing OPFS semantics. OPFS remains local cache data and is not synced vault state.

## Phase 4: Fetch, Moment, And Targeted Source Fixes

### Changes

- Replace `fetch(data:)` in `src/vss/sqlite-vector-index.ts` with local `data:` URL decoding to `Blob`.
- Keep low-level SQLite/WASM loading local. Do not introduce a general remote URL loader here.
- Import `moment` from `obsidian` instead of the standalone `moment` package.
- Fix high-signal stringification warnings where object values can become `[object Object]`, especially AI message/content and settings labels.

### Boundary Conditions

- The SQLite/WASM normal path is an esbuild `dataurl` inline asset. The fix should preserve that path.
- Do not route VSS WASM loading through AI service adapters.
- If a future remote asset fallback is needed, it should be designed and disclosed separately.

## Phase 5: Confirmation And Popout Compatibility

### Changes

- Replace `globalThis.confirm` usages with a shared Obsidian Modal helper, for example `confirmUserAction(app, options)`.
- For destructive or costly actions, the no-DOM/test fallback should return `false`.
- Address `document`, `querySelector`, `createElement`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, and `globalThis` warnings in focused batches.

### Boundary Conditions

- Do not copy separate confirmation Modal implementations into multiple modules.
- Popout compatibility changes should prefer Obsidian `activeDocument`/`activeWindow` where available.
- Timer changes in service or test-heavy code need focused tests, because `window.setTimeout` can behave differently from Jest globals.

## Phase 6: CSS And Remaining Lint Noise

### Changes

- Remove or justify remaining `!important` usages.
- Replace short hex colors with six-digit hex where practical.
- Resolve duplicate selectors/properties in source CSS rather than only in minified `styles.css`.
- Keep Tailwind directives in source CSS if they are build-input only; do not chase scanner output from built/minified CSS unless it affects community review.
- Review custom web component selectors such as `l-bouncy-arc` and `l-quantum`; document or wrap them if scanner keeps treating them as unknown type selectors.

## Verification Plan

### Focused Tests

```bash
npm test -- __tests__/vss.test.ts __tests__/vss-state.test.ts __tests__/stats-store.test.ts __tests__/stats-manager.test.ts __tests__/sqlite-vector-index.test.ts __tests__/memory-manager.test.ts --runInBand
```

### Full Checks

```bash
npm test -- --runInBand
npm run lint
npm run build
git diff --check
```

### Release Checks

- Inspect the workflow diff manually.
- Verify the release workflow only uploads:
  - `main.js`
  - `manifest.json`
  - `styles.css`
- Verify artifact attestations are generated for the same staged files.
- Run release dry-run before publishing:

```bash
make release-dry-run VERSION=x.y.z
```

### Obsidian Smoke Tests

- For Memory/VSS/settings changes, run `make deploy`, reload or re-enable the plugin in the test vault, and verify:
  - Existing Memory state is detected for default config dir.
  - Custom config dir legacy state does not silently disappear.
  - Prepare/update confirmation explains data, AI provider, cost, and background changed-note maintenance.
  - Background update copy does not use internal jargon.

## Deferred Items

- Full `activeDocument`/`activeWindow` refactor.
- Broad timer helper rollout.
- Deep type cleanup for imported third-party types reported as `error`/`any`.
- Complete CSS lint cleanup of minified `styles.css` output.
- GitHub artifact attestation verification from the community scanner side after the next real release.
