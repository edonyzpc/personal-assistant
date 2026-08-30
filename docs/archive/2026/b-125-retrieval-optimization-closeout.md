# B-125 Retrieval Optimization Closeout Evidence

Document status: Archived
Delivery status: Closed
Updated: 2026-08-30
Work item: B-125
Authority: B-125 已完成实现、验证与 rollout disposition 的紧凑历史证据；当前产品行为仍以 DEC-027、PA Active Vault Indexer Product Spec、现行 VSS/PA Agent architecture、源码与 focused tests 为准。

## Outcome

B-125 已完成 Chat 与 Pagelet 共用 retrieval pipeline 的 scoped 优化：

- `CHAR-PHRASE` CJK index/query 同构与独立 lexical generation；
- selected-model strict rerank、live-source revalidation 与最多 8 份最终 evidence；
- bounded Local / Deep Breadth / Convergence PPR、single opaque bridge、Worker cancel/
  late-discard 与 direct-only fallback；
- Chat/Pagelet 各自 Host-owned 的一次 relaxed recovery，以及 Pagelet 0–2 个独立
  verified insights；
- Win32 scoped waiver 下四个 effective flags 强制关闭，保留 direct/vector fallback。

最终 source-frozen production artifact 为
`1c93ef2407ccbe27f459780a67753e4b09fccbb6283e58887c6abcda877ccac1`。
2026-08-30 owner 在 Linux 证据闭合后接受建议，对 `lexicalProfile`、
`strictReranker`、`graphPpr` 与 `relaxedRecovery` 四项均给出 **approve rollout**
disposition。该 disposition 允许后续单独的 shipping-default 实现/发布 lane；它本身不
改写当前 default-off 源码，不授权 commit、push、tag、publish 或 release。

## Final Verification

| Evidence slice | Result |
| --- | --- |
| Local / review / source freeze | PASS；最终 production build 通过 lint 与 210 suites / 5,450 tests；dist、repo test vault 与 iCloud plugin artifact byte-match |
| Desktop App | PASS；selected-reranker 六个 ranking 均为 rank 1、structured temporal、Recovery、Pagelet 0/1/2、source-triggered lexical upsert、flag lifecycle 与 affected Pagelet readiness/lifecycle evidence 均按 impact scope 闭合 |
| Real iPhone | PASS；iOS 18.7 / Obsidian 1.13.7 setup 绑定当前 artifact；ordinary Provider、graph-enabled Recovery/readiness/modal/deadline/cleanup、cancel/late-discard/queue release 三个 core slices 闭合；无需第四个 Pagelet case |
| OPFS | PASS by impact-scoped reuse；当前后续修复未改变 persistence code/input，不重复 full-App restart |
| Darwin exact renderer | PASS；receipt SHA-256 `56bdda4d8646918301b7a6337459a0b9b41eaf9e4fb9000297934fc6ede5dd60`，绑定同一 production artifact |
| Linux exact renderer | PASS；Obsidian 1.11.7 / Electron 39.5.1 / Node 22.22.0，exact `app://obsidian.md/index.html`，receipt SHA-256 `09e104e35a98e118a85987b0c391142f2ddd8c8a18a66efc81b7d62c31c76f5a` |
| Darwin + Linux canonical aggregate | PASS；policy `B-125-WIN32-TEMPORARY-SUPPORT-WAIVER-2026-08-13`，platforms exactly `[darwin, linux]`，aggregate SHA-256 `58ecfc3c6090486537fb7a6c23326719dcbfa144d21438e572d366d476660d54` |

## Linux R3 Final Adjudication

R3 handoff archive SHA-256 为
`04371b2975b78920d1c55e80a56cc9249a72d9f4d484b1785444eb126287b09a`。
独立复核确认 26 个 immutable inputs、exact vault/target binding、Linux distribution、
launch PID/SID/PGID seed、process-group cleanup、CDP closure、receipt 与 canonical aggregate
相互一致；46 项结构化断言全部通过。关键辅助证据 SHA-256：

- capture binding：`8c23685f419cd42402f1c31848630127bca65deb45b0cd165b7b3d68a179f3e7`；
- process seed：`4dd789094b6ddb9295bb2bc51bb20046474cace13e8a8c3b3096186b46986777`；
- outer cleanup：`a0e4ba31d657000158cd47a89a8da85d4261e712e1f93640bb8e2dc7d3ba1748`。

原始 `result.json` 保持诚实的 `BLOCKED / model_reported_unexpected_diagnostic`，没有
追溯改写。根因不在 retrieval 或 Linux renderer：只读 Codex audit 在 renderer receipt
与 aggregate 已完成后，把受控 process-group shutdown 期间的 Electron GPU/zygote 日志
标成 `outer_cleanup_gpu_shutdown_noise`；single-use finalizer 又允许任何未列入
`ALLOWED_DIAGNOSTICS` 的 model diagnostic 独立阻塞其已自行验证为 PASS 的结构化证据。
这违反 evidence-authority boundary，形成 false blocker。Desktop/Darwin 不运行这条
Linux-only model/finalizer 与 Linux zygote/GPU shutdown 路径，因此不会发现该 tooling
缺陷。

本次以 canonical receipt verifier、capture/seed/cleanup proof 和 byte-identical aggregate
为权威，接受 Linux slice；不为一次性、未跟踪 handoff tooling 追加第四次 Linux run。
若未来复用该 tooling，model log interpretation 只能是 advisory；blocking state 必须来自
finalizer 自己声明并验证的结构化 schema/invariants，不能由自由生成的新 diagnostic code
覆盖 canonical PASS。

## Per-Flag Rollout Disposition

| Flag | Owner disposition | Required rollback boundary |
| --- | --- | --- |
| `lexicalProfile` | APPROVED FOR ROLLOUT | 保留显式 lexical preparation、vector-only fallback、lexical-only derived-state rollback；Win32 effective false |
| `strictReranker` | APPROVED FOR ROLLOUT | 保留 invalid/timeout direct-hybrid-first fail-open；Win32 effective false |
| `graphPpr` | APPROVED FOR ROLLOUT | 保留 whole-PPR/direct-only safety fallback、cancel/late-result isolation 与 flag-scoped rollback；Win32 effective false |
| `relaxedRecovery` | APPROVED FOR ROLLOUT | 保留 one-token limit、same-query/frozen-plan、cumulative max-8 projection 与 finalization reserve；Win32 effective false |

`src/vss/retrieval-calibration.ts` 中 `provisional`、
`offline_provisional_winner`、`inherited_unvalidated` 与 `defaultEnabled=false` 继续描述当前
dormant validation payload 的来源和当前源码状态，不再承担 B-125 rollout status。
本次不静默重标、不改变参数，也不因此生成新 artifact/重跑设备矩阵。未来 shipping-
default source change 必须建立新的明确 profile/evidence identity、保留每项 explicit false
rollback 与 Win32 mask，并运行受影响的 focused/default/on/off/lifecycle gates。

## Residual Risk And Follow-Up

- iPhone 15 / iOS 17.0 / Obsidian 1.11.4 是声明 floor；较新真实 iPhone 证据是 owner
  接受的 proxy，不是 exact-floor PASS。
- Win32 仅在 B-125 scoped support matrix 中排除；不是 Win32 compatibility PASS 或 PA
  永久移除 Windows。恢复需按 DEC-027 的 exact receipt/App/OPFS/lifecycle gate 重新批准。
- 33/47 episodes、p95、process physical footprint、Xcode/Instruments 与 floor-grade
  performance certification 属于非阻塞 B-127；本 closeout 不冒充这些证据。
- 本 closeout 没有执行 shipping-default mutation、commit、push、tag、publish 或 release。

## Information Disposition

| Information | Durable destination |
| --- | --- |
| 产品、数据、rollout 与 rollback 边界 | DEC-027 与 PA Active Vault Indexer Product Spec |
| 当前 runtime ownership、flag/platform/calibration boundary | VSS SQLite/WASM、PA Agent architecture、源码与 focused tests |
| 最终 local/Desktop/iPhone/Darwin/Linux evidence、owner disposition 与 residual risk | 本文件 |
| B-127 扩展性能认证 | Backlog B-127 |
| Feature Home、Plan、SDD、Tracker 与逐轮 finding/verification 日志 | 结论吸收后删除；Git 历史可恢复 |
