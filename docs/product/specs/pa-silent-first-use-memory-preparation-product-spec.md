# Silent First-Use Memory Preparation Product Spec

Document status: Approved
Updated: 2026-08-12
Work item: B-126
Decision: [DEC-028 — Silent Memory auto-prepare for first use](../decisions/dec-028-silent-memory-auto-prepare.md)
Authority: 首次 Chat 触发的静默 whole-vault Memory 准备、透明度、失败状态与保留确认边界。

## Problem And Product Outcome

- User problem: 用户首次提问时被重量级 Memory Approval Modal 阻断，无法先得到答案。
- Product outcome: 首次 Chat 立即回答，同时在后台准备 whole eligible vault 的 Memory；只在真实可用后自动启用，失败、取消和关闭不冒充成功。
- North Star fit: 让笔记在需要时自然浮现，以低打扰方式建立 Memory，同时通过来源边界、状态真实性和随时 opt-out 保持可信。

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

### Non-goals

- NG-01: 不实现 recent-first/progressive build；本次选择是 whole eligible vault rebuild。
- NG-02: 不改变 embedding model、provider 限额、batch/concurrency 或价格。
- NG-03: 不建立 setup wizard、PA Cloud、Fresh Custom provider 或新的 consent persistence。
- NG-04: 不把 Pagelet shared first-use state 复用为 Memory admission。

## User Flow And States

1. 用户配置 provider/token，并保持 `Use memory from my notes` 开启。
2. 首次 Chat preflight 返回 `first-use`；PA 立即继续回答，并显示“Memory 正在后台准备中，准备完成后将自动启用”。
3. 后台只有一个 whole eligible vault rebuild；后续 Chat 可继续 answer-now 并看到仍在准备的真实状态。
4. Durable usable success 后才切换为 ready/auto-refresh；后续 Chat 可使用 Memory。
5. Total failure 保持可重试状态并给出非阻断失败反馈；关闭 Memory 或卸载会取消旧运行且不显示迟到成功。
6. 非 first-use rebuild 继续显示既有 blocking confirmation。
7. 如果 IndexedDB marker 仍是 unknown，后台 prepare 在 reset/provider 前停止；当前 Chat 正常回答，且不会把 unknown 当作“首次没有 marker”。后续状态路径在 state store 恢复后 hydrate 并重新判定 ready/first-use/recovery。
8. 如果 destructive rebuild abort/total-fail，重启后仍显示原来的 first-use、settings-changed 或 local-memory-missing 路径；只有完整 ready 与 policy/lifecycle admission 都成功才清除 recovery guard。Admission 失败不会留下可用 Memory snapshot。

## Trust, Data And Authority

- Source evidence: [DEC-028](../decisions/dec-028-silent-memory-auto-prepare.md) 记录 Owner 于 2026-08-11 对方案 A 的当前明确选择，以及同日后续对“marker unknown 时 fail-closed”的方案 1 选择；更早 Discovery 内容只作问题/方案输入，不作批准证据。
- Data sent / stored: eligible Markdown chunks 可发送给 configured embedding provider；向量与 marker 存在设备本地 OPFS/IndexedDB，可重建，不修改 vault source notes。
- User disclosure / confirmation: first-use 是 DEC-028 的窄静默例外；Settings 持续披露数据/provider/cost/opt-out，Chat 显示后台准备状态。其他 whole-vault recovery、manual 与 costly 路径继续逐次确认。
- Reversibility / recovery: 用户可关闭 Memory 取消在途准备，也可重置本地 Memory copy；失败不升级 policy，后续 hydration 按 guard 恢复原 first-use/settings-changed/local-memory-missing reason。
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

## Open Decisions

None. Owner 于 2026-08-11 已选择首次 Chat 静默后台 whole-vault Memory 构建，并在同日后续明确选择 marker unknown 时方案 1（fail closed）；Fresh Custom、progressive build 与 release timing 不属于本决定。

## Delivery Handoff

- Active Package: [B-126 Silent First-Use Memory Preparation](../../development/active/silent-first-use-memory-preparation/README.md)
- Architecture contracts: [VSS SQLite/WASM Current Architecture](../../architecture/vss-sqlite-wasm-architecture.md)、[VSS Local State](../../architecture/vss-local-state-plan.md)、[VSS Embedding Refresh](../../architecture/vss-embedding-refresh.md)、[PA Data Boundary](./pa-data-boundary-product-spec.md)
- Release / rollout boundary: PR #378 只在 focused failure/concurrency/lifecycle tests、full CI 与适用 Obsidian smoke 通过后可合并；自动化 mock 不等于真实 iOS/Android 证明。
