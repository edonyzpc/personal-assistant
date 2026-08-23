# First-Run AI Setup And Silent Memory Preparation Product Spec

Document status: Approved
Updated: 2026-08-23
Work item: B-126
Decision: [DEC-028 — Silent Memory auto-prepare for first use](../decisions/dec-028-silent-memory-auto-prepare.md)
Scoped decision: [DEC-029 — Inline AI setup and first Settings focus](../decisions/dec-029-inline-ai-setup-and-settings-focus.md)
Authority: 首次 Chat 的常用 AI 配置、首次 Settings 聚焦、静默 whole-vault Memory 准备、透明度、失败状态与保留确认边界。

## Problem And Product Outcome

- User problem: 新用户需要离开 Chat、穿过长 Settings 页面完成最小 AI 配置；完成后首次提问又会被重量级 Memory Approval Modal 阻断。
- Product outcome: 常用 provider 用户可在 Chat 上下文内完成配置并立即提问；首次 Chat 同时在后台准备 whole eligible vault 的 Memory，只在真实可用后自动启用。
- North Star fit: 减少设置管理和阻断，让用户更快开始提问并让笔记自然浮现；通过显式 SecretStorage 探测、来源边界、状态真实性和随时 opt-out 保持可信。

## Scope

### In Scope

- B-126/REQ-01: 当 `memoryEnabled=true`、Chat preflight 得到 `reason="first-use"` 且 provider 配置可用时，当前 Chat 返回 `answer-now`，不显示 Approval Modal、不等待 rebuild，并只启动一个后台 rebuild。
- B-126/REQ-02: 首次 rebuild 处理 whole eligible vault；仍执行共享 folder/tag/generated-note exclusion，不修改或删除 Markdown。Settings 必须说明 eligible note text 可能发送给 configured embedding provider、可能使用 API credits，并提供可发现的 Memory opt-out；Chat 必须说明 Memory 正在后台准备且只会在 ready 后自动启用。
- B-126/REQ-03: 重复或并发 Chat 复用同一 active preparation；不得启动平行 whole-vault rebuild，也不得把“正在准备”表示为 ready。
- B-126/REQ-04: 仅 durable backend 报告 usable ready 且本轮未 abort/total-fail 时，才可持久化 `auto-refresh-after-prepare` 并允许后续 Chat 使用 Memory。Partial success 只有在 durable usable 时可成功，失败文件保持可重试；total failure、throw、abort、unload 或 opt-out 必须保持非 ready 且后续可重试。
- B-126/REQ-05: `local-memory-missing`、`settings-changed`、手动 Prepare/Update 与其他非首次 costly rebuild 继续使用 Memory-specific blocking confirmation；DEC-028 不授予 Pagelet、Memory Extraction、vault write 或 external action 权限。
- B-126/REQ-06: 关闭 Memory 会取消 active preparation 并阻止后续 provider work、policy upgrade、成功 Notice 与 stale status mutation；plugin unload/reload 也必须终止旧 lifecycle 的可见副作用。Desktop 与 mobile 共用该语义。
- B-126/REQ-07: Destructive rebuild 在任何 `index.reset()` 或 embedding-provider call 前，必须完成 IndexedDB marker truth preflight：whole-vault retry journal 已 durable 保存，且 marker truth 已 hydrate 为 known absent，或旧/unknown marker 已按同一 generation durable invalidate。Marker 未 hydrate且 durable invalidation 不可用时必须 fail closed，保留旧 index/marker，provider call 为 0；首次 Chat 继续 `answer-now`，待 state store 恢复后重新判定。此规则不扩大改变普通 non-destructive maintenance 的既有 process-local retry 语义。
- B-126/REQ-08: 每次 destructive rebuild 必须在 reset 前 durable 保存原始 recovery reason（`first-use`、`settings-changed` 或 `local-memory-missing`）。Hydration 优先该 guard；abort/total failure 保留它，成功且 policy/lifecycle admission 完成后才清除。若 index 已准备但 `memoryApprovalPolicy` 持久化或 lifecycle admission 失败，必须 compensation rollback 为 non-ready 并恢复原 reason；重启不得把已批准/阻断的 recovery rebuild 误降为 silent `first-use`。
- B-126/REQ-09: Chat 空态在 AI 配置不完整时提供 Qwen 中国、Qwen 国际、OpenAI preset 与按需 token 输入；Custom、URL/model 高级编辑继续通过 Settings link 完成，不在 inline surface 展开。
- B-126/REQ-10: 现有 provider tuple 完整且只缺 token 时，只写 token；现有 token 可在 preset 补齐 partial provider config 时复用。成功必须持久化完整 provider tuple 与 `aiProviderPreset`；任一保存失败保持 setup incomplete、显示可重试错误，并对本次已写 settings/token 执行 best-effort compensation，补偿失败不得宣称成功。
- B-126/REQ-11: Token presence 使用 `unknown | present | missing`。被动 render、input、Settings display 与本地只读 Memory status 不读取 SecretStorage；明确用户发起的 provider 选择、token 管理、Chat submit 或 AI/Memory command 可以探测 unknown，再重新计算 readiness 并定向刷新相关 surface。
- B-126/REQ-12: 没有已存 collapse preference 时，Settings 只展开 `ai-provider` group，其他 groups 默认折叠；每个 group 的用户选择以显式 boolean 持久化，缺失 key 仍回落到首次默认。
- B-126/REQ-13: Inline setup 支持键盘提交、programmatic provider group/selection、token accessible name、保存 busy 状态、`aria-live` 错误反馈和移动端 44px controls；失败后保留可重试状态。

### Non-goals

- NG-01: 不实现 recent-first/progressive build；本次选择是 whole eligible vault rebuild。
- NG-02: 不改变 embedding model、provider 限额、batch/concurrency 或价格。
- NG-03: 不建立 setup wizard、PA Cloud、Fresh Custom inline provider、新 provider/model、Test Connection 或新的 consent persistence；Custom/advanced 配置继续位于 Settings。
- NG-04: 不把 Pagelet shared first-use state 复用为 Memory admission。

## User Flow And States

1. AI 配置不完整时，Chat 空态提供三个常用 preset；已有 provider tuple 只缺 token 时仅补 token，Custom/advanced 进入 Settings。
2. Start 只在 provider/token 条件满足时启用。保存中显示 busy；成功后进入正常 Chat，失败则显示 live error 并保持可重试。
3. 首次 Settings 只展开 AI Provider；用户之后的展开/折叠 preference 在重开时保持。
4. 用户保持 `Use memory from my notes` 开启并发送首次 Chat；preflight 返回 `first-use` 时 PA 立即继续回答，并显示“Memory 正在后台准备中，准备完成后将自动启用”。
5. 后台只有一个 whole eligible vault rebuild；后续 Chat 可继续 answer-now 并看到仍在准备的真实状态。
6. Durable usable success 后才切换为 ready/auto-refresh；total failure 保持可重试状态。关闭 Memory 或卸载会取消旧运行且不显示迟到成功。
7. 非 first-use rebuild 继续显示既有 blocking confirmation。
8. IndexedDB marker 为 unknown 时，后台 prepare 在 reset/provider 前停止；当前 Chat 正常回答，后续在 state store 恢复后重新判定。
9. Destructive rebuild abort/total-fail 后重启仍保留原 first-use、settings-changed 或 local-memory-missing reason；只有完整 ready 与 policy/lifecycle admission 都成功才清除 recovery guard。

## Trust, Data And Authority

- Source evidence: [DEC-028](../decisions/dec-028-silent-memory-auto-prepare.md) 记录 Owner 2026-08-11 的 silent Memory/marker choices；[DEC-029](../decisions/dec-029-inline-ai-setup-and-settings-focus.md) 只使用 Owner 2026-08-23 的方案 1 作为 inline setup/Settings 批准证据。更早 Discovery 内容只作输入。
- Data sent / stored: Inline setup 本身不发起 provider request；provider tuple/preset identity 写入 plugin settings，API token 写入 Obsidian SecretStorage，collapse preference 写入本地 UI storage。首次 Memory 的 eligible Markdown chunks 可发送给 configured embedding provider；向量与 marker 存在设备本地 OPFS/IndexedDB。
- User disclosure / confirmation: 用户明确选择 preset、输入 token 并点击 Start；这只配置 BYOK provider，不授予其他 capability。Memory first-use 是 DEC-028 的窄静默例外；Settings 持续披露数据/provider/cost/opt-out，其他 costly 路径继续确认。
- Reversibility / recovery: Provider/token 可在 Settings 修改；setup 保存失败保持 incomplete 并尝试恢复旧 settings/token。用户可关闭 Memory 或重置本地 Memory copy；失败不升级 policy，后续 hydration 按 guard 恢复原 reason。
- Recovery identity: IndexedDB 只持久化 content-free rebuild reason/timestamp，不保存 note text；guard 防止 restart 把需要再次确认的 recovery rebuild 误分类为 silent first-use。

## Acceptance Criteria

- B-126/AC-01: First-use Chat 的测试证明 Approval Modal 调用为 0、首个回答不等待 rebuild，且恰好调度一个后台 whole eligible vault rebuild。
- B-126/AC-02: Settings 与 Chat 的中英文 copy 覆盖 note text/provider/API cost、notes unchanged、ready-after-success 和 Memory opt-out；exclusion fixture 证明被排除笔记不会进入 embedding input。
- B-126/AC-03: 两个并发 Chat 及 Chat+manual overlap 的测试证明同类 rebuild 复用 active promise、不同动作不会并行写，status 在运行期间为 preparing 而非 ready。
- B-126/AC-04: Durable success、partial durable success、zero-updated empty vault、total failure、throw、abort、ready-marker publication failure 与 unavailable durable backend 测试分别断言 `ok`、ready marker 与 `memoryApprovalPolicy`；浏览器未授予 persistent-storage permission 本身不等同于 backend unusable，沿用既有“本次可用但可能需稍后再准备”的语义。
- B-126/AC-05: `local-memory-missing`、`settings-changed`、manual Prepare/Update 仍调用 blocking confirmation；Cancel/answer-now 在确认前不会产生 provider call。
- B-126/AC-06: 运行中关闭 Memory及 plugin unload/reload 测试证明 abort 被传播，旧 lifecycle 不再发 provider 请求、保存 auto policy、更新 status 或显示成功/失败 Notice；desktop/mobile mock 都覆盖该路径。
- B-126/AC-07: State-store fixture 预置旧 marker/index 后让 IndexedDB initialize/hydrate 与 durable invalidation 均不可用，证明 destructive rebuild 的 `index.reset()`、embedding model/provider call、policy upgrade 与 ready publication 均为 0，旧 marker/index 保持不变，first-use Chat 返回 `answer-now`；恢复 state store 后按 hydrated marker 重新判定。另一个 known-absent fixture 证明成功 hydrate 后可正常 rebuild，并覆盖 unknown/old marker 可被 atomic transition durable invalidate 后才继续的路径。Persistent-storage permission denied 单独覆盖并保持 usable-but-evictable 语义。
- B-126/AC-08: Restart fixtures 分别证明 settings-changed abort 与 local-memory-missing total failure 保留原 durable guard/reason，first-use guard 仍为 first-use；三者均不因 marker null 互相误分类。Policy-save/lifecycle-admission failure fixture 证明 `rollbackPreparedRebuild(reason)` 后 ready marker/policy admission 均不可用，原 guard/reason 可在 restart hydrate；完整成功路径原子清 guard。
- B-126/AC-09: Fresh/incomplete setup 测试证明三个 preset 可选、Start 在配置/token 未满足时禁用、Advanced link 可达 Settings，且成功保存完整 tuple 与 preset identity。
- B-126/AC-10: Token-only、partial config + existing token、provider-save failure、token-write failure、compensation failure 与 unload race 测试分别证明不覆盖无关配置、不要求重复 token、不宣称失败事务成功，reload 后 settings/token 一致或明确 incomplete。
- B-126/AC-11: Retained-token reload 测试证明 passive Chat/Settings/Memory status 的 SecretStorage reads 为 0；明确 Chat、provider 或 AI/Memory action只在 token unknown 时探测一次，并将结果更新到相关 surface。
- B-126/AC-12: Settings fixture 证明无 storage 时仅 AI Provider 展开；展开非 AI group、折叠 AI Provider 后重开分别保持；任一 group 的存储存在不会改变其他缺失 groups 的默认。
- B-126/AC-13: DOM/CSS 测试证明 provider group/selection、token label、Enter、busy/live error 与移动端 44px targets；失败后 Start/input 可继续使用。

## Open Decisions

None for the approved slices. Owner 于 2026-08-11 选择 silent Memory/marker fail-closed，并于 2026-08-23 选择保留 inline setup 与首次 Settings 聚焦。Fresh Custom、wizard、Test Connection、provider performance、progressive build 与 release timing 继续未批准。

## Delivery Handoff

- Active Package: [B-126 First-Run AI Setup And Silent Memory Preparation](../../development/active/silent-first-use-memory-preparation/README.md)
- Architecture contracts: [VSS SQLite/WASM Current Architecture](../../architecture/vss-sqlite-wasm-architecture.md)、[VSS Local State](../../architecture/vss-local-state-plan.md)、[VSS Embedding Refresh](../../architecture/vss-embedding-refresh.md)、[PA Data Boundary](./pa-data-boundary-product-spec.md)
- Release / rollout boundary: PR #378 只在 focused failure/concurrency/lifecycle tests、full CI 与适用 Obsidian smoke 通过后可合并；自动化 mock 不等于真实 iOS/Android 证明。
