# DEC-029 — 在 Chat 内完成首次 AI 配置，并让首次 Settings 聚焦 AI Provider

Decision ID: DEC-029
Status: Accepted
Updated: 2026-08-23
Authority: Owner 于 2026-08-23 在 PR #378 merge-gate follow-up 中明确选择方案 1：保留 Chat inline provider/token setup 与首次 Settings 默认折叠。该选择只授权本文边界，不把 2026-08-10 Discovery proposal 追认为既往批准。
Work item: B-126

## Context

首次安装时，用户需要先配置 AI provider 与 API token 才能使用 Chat。旧路径要求离开 Chat、打开长 Settings 页面、完成配置后再返回，增加了页面跳转和认知负担。PR #378 已实现一个有界的 Chat inline setup，同时让首次 Settings 只展开 AI Provider group；merge-gate review 发现这两项用户可见行为尚缺正式产品授权。

API token 通过 Obsidian `SecretStorage` 保存。iOS Keychain 曾出现同步读取冻结，因此被动 render、composer input 与普通 Settings display 不能为了判断 token 而读取 SecretStorage；只有明确用户动作可以探测未知 token 状态。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 1. 保留有界 inline setup 与首次 Settings 聚焦 | 用户可在 Chat 上下文内用两步完成常用 preset 配置；Settings 首屏噪音更低 | 需要处理 SecretStorage/data.json 跨存储失败、token unknown 与可访问性状态 | **Selected**：Owner 于 2026-08-23 明确选择 1；符合“少管理、安静且可信” |
| 2. 移除两项行为，恢复只通过 Settings 配置 | 权威与实现更窄，维护面更小 | 首次体验继续需要页面跳转与长表单 | Rejected by the current Owner choice |

## Decision

批准以下 first-run 行为：

1. Chat 空态发现 AI 配置不完整时，可直接提供 Qwen 中国、Qwen 国际与 OpenAI preset，以及仅在需要时显示的 token 输入；Advanced setup 继续进入 Settings。
2. 若现有 provider tuple 已完整、只缺 token，inline setup 只请求 token，不覆盖 provider URL 或 model。若 token 已存在而 provider tuple 不完整，选择 preset 时复用现有 token，不要求重复输入。
3. 保存由单一协调操作完成：provider tuple 与 preset identity 一致写入，token 使用 SecretStorage；失败必须保持 setup incomplete、显示可重试错误，并对已写部分做 best-effort compensation。补偿失败不得宣称成功。
4. Token cache 保持 `unknown | present | missing`。被动 render、composer input、Settings display 与本地只读 Memory status 不读取 SecretStorage；明确的 provider 选择、token 管理、Chat submit 或 AI/Memory command 可以探测 unknown，随后重新计算 readiness。
5. 首次打开 Settings、且尚无 collapse preference 时，只展开 AI Provider group，其他 groups 默认折叠。用户对任一 group 的展开/折叠选择必须在后续打开时优先于默认值。
6. Inline setup 必须提供键盘提交、可识别的 provider selection、token label、busy/live error 状态与移动端触控尺寸。

本决定不批准 Fresh Custom inline provider、wizard、Test Connection、PA Cloud、新 provider/model、自动网络探测、Memory consent 扩张或 release timing。Custom/advanced 配置继续留在 Settings。

## Consequences

- Product behavior: 常见新用户可在 Chat 内完成 provider + token 配置；高级用户仍可进入完整 Settings。
- Architecture / data / safety: 不新增 token 存储；SecretStorage 与 settings 文件没有跨存储原子事务，因此采用明确提交顺序、可观察失败与 best-effort compensation，而不是虚假承诺绝对 atomic。
- Compatibility / migration: 不新增 persisted plugin setting 或 schema migration；Settings collapse preference 继续使用现有本地 UI storage，缺失 key 按首次默认处理。
- Work created or removed: B-126 增加 inline setup、token tri-state、首次 Settings default/persistence 与对应自动化/Obsidian smoke 验收；Discovery 中 Fresh Custom、wizard 与更宽 first-run 方向继续未批准。

## Revisit Trigger

- Inline setup 的失败率、误配置率或可访问性证据显著高于 Settings-only 路径。
- iOS 实机证明显式 token 探测仍会造成不可接受的 Keychain freeze。
- 新 provider/custom endpoint 需求无法在“常用 preset inline、advanced in Settings”边界内表达。

## Traceability

- Discovery: [First-Run Experience & Platform Robustness](../../development/discovery/first-run-and-platform-robustness.md)
- Product Spec: [B-126 First-Run Product Spec](../specs/pa-silent-first-use-memory-preparation-product-spec.md)
- Architecture / SDD: [B-126 SDD](../../development/active/silent-first-use-memory-preparation/sdd.md)
- Backlog / successor decision: [Backlog B-126](../../backlog.md)、[B-126 Tracker](../../development/active/silent-first-use-memory-preparation/tracker.md)
- Supersedes / superseded by: None；作为 [DEC-028](./dec-028-silent-memory-auto-prepare.md) owning contract 下的 scoped decision，授权 B-126 的 inline setup 与 Settings focus slice
