# B-125 Retrieval Shipping Default — 最终验证与 Beta 证据

Document status: Archived
Delivery status: Closed
Closed date: 2026-10-05
Work item: B-125
Authority: DEC-031 dated amendment 的历史验证/发布证据；不作为当前行为或执行状态权威。

## 范围与完成结果

2026-09-04 Owner 批准 B-125/REQ-09、AC-09 shipping-default amendment；
2026-09-05 已完成 implementation、Linux/Mac/iPhone 验证、master gate、Hosted
Community 和 `2.10.0-beta.1` 发布。2026-10-05 Owner 授权 closeout 实际完成任务。

行为和回滚边界已吸收到 [DEC-031](../../product/decisions/dec-031-b125-retrieval-shipping-default.md)、
[Active Vault Indexer amendment](../../product/specs/pa-active-vault-indexer-product-spec.md#102-b-125-shipping-default-amendment)
与 [VSS Architecture](../../architecture/vss-sqlite-wasm-architecture.md)。
原 B-125 算法验证仍见 [原 closeout](./b-125-retrieval-optimization-closeout.md)，不重写其证据。

## 需求、风险与证据

| Requirement / AC | 最终证据 |
| --- | --- |
| REQ-09/AC-09：版本化 defaults、sparse rollback | Absent/invalid raw 在受支持 identity 使用四项 defaults；显式 false 单项回滚；加载、无关保存和 reload 不物化隐式值。8 个 affected suites、后续定向和独立复核通过 |
| REQ-09/AC-09：平台边界 | 修正负向排除误放 unknown/partial identity 的 F-03；positive allowlist、Win32/Android mask 优先、raw immutability 的 2 suites / 13 tests 及后续集成/完整门禁通过 |
| AC-09：当前产物与既有行为 | Post-fold Linux/Mac loaded identity 和 iPhone canary 使用同一最终产物；原算法/provider/预算/来源边界保持，OPFS/lexical 的不变行为复用明确标识的 pre-fold provenance |
| AC-09：发布门禁 | exact-master 的完整 release gate、source CI、Hosted Community 和 Beta workflow/资产核验均通过 |

## 最终本地与发布身份

- Mac 为 macOS 26.6.2 arm64、Node 22.22.3、npm 10.9.8；focused gate
  **8 suites / 763 tests**，TypeScript、whitespace 和 DOM source scan 通过。
  Linux post-fold/Mac `make deploy` 完整门禁均为 **210 suites / 5489 tests**。
- 最终 `main.js` SHA-256：
  `db4c41b174e1e27d983f4d981b53647760cd101e7b813ba7a4cba4727c22089e`；
  Mac dist、Linux post-fold、iCloud copy、iPhone loaded 和 GitHub Beta asset 一致。
- Release-source local/tracking/live `master`：
  `1b91dec8c27c9afb9411595e983d3d3773d5b7ce`；source CI run
  `33937177557` success。最终 `make release` 的 lint/build/legal/docs/bundle
  与 210/5489 全通过，Jest 自然退出 0，无 forced-exit/open-handle warning。
  Bundle 为 6,799,638 bytes，gzip 2,697,702 < 2,883,584 budget。
- Hosted Community preview 精确对应上述 master，`Completed`、**Error=0**，
  33 Warning / 7 Recommendation；不把 warning 数称作零问题。
- `2.10.0-beta.1` 唯一 single-parent signed packaging commit：
  `c16693e37592fc99afcd5fb8ae3d78c000a1e2a1`，parent 是上述 master，只有
  7 个生成 packaging files。Annotated tag object 为
  `d016734d39c58236b2e1423ae607fba05a23682d`，peeled tag 和 remote beta branch
  均指向 packaging commit；workflow `33938756443` success。
- GitHub Release 为 non-draft prerelease，六资产为 LICENSE、main.js、manifest.json、
  NOTICE、styles.css、THIRD_PARTY_NOTICES.md。下载 manifest version 正确，SHA-256
  `069dcac35c7971f7eea718e98a570e7d7bed2bc1941a5c5b9f4ed678bb83688c`。

## iPhone 与 provenance 限制

Edony iPhone 15 / iOS 26.6.1、plugin 2.9.2 的四项 iCloud assets 逐字节一致；
loaded identity `blocker=null`，load 为 `2026-09-04T15:47:30.855Z`。Canary
前后 rollout v1 / B-125 / DEC-027 / DEC-031、mask `none`、four-on 稳定，
raw root 和四字段 absent。一次经明确外发授权的真实触摸 Chat turn canonical
completed，1 call / 1 result 严格配对，`search_memory` success、hit=1、
`Dog.md` positive source、`includeInNextPrompt=true`，最终 Provider answer
committed。该 observation 确实进入后续 prompt；未插桩底层请求数，不声明
精确 provider/embedding 计数。

Memory 前后 ready（69 documents），plan `ready/none`、无需批准、可立即回答；
UI responsive，Markdown mutation=0，fresh console/window/unhandled errors=0。
一个无 token 的重复 evaluation 在 setup 前被 active-probe guard 拒绝，未产生
第二个 Chat turn。Content-free receipt SHA-256 为
`69325e5eebc3fb6750e8dac783e4123240ee6b6db510392b31c1a79f5e9c0cf7`。

Linux pre-fold lexical-only rebuild 处理 218/218 rows，provider/embedding/Markdown
writes 均为 0；完整 App restart 改变 renderer/main PID 和 time origin，OPFS
ready/non-fallback、67 files/218 chunks、2,539,520 bytes 与 index/storage hashes
连续。该行为证据的 pre-fold artifact 为
`c78cf12096f4cf34bf540a8f49a7548d367d445f8919bb9c7d2677d6059755e7`，
不得冒充 post-fold exact-artifact restart。Post-fold 只折叠身份而未改该行为，
provenance 已获接受；Mac 早期 worker forced-exit warning 由最终自然退出
release gate 闭合。

实际 BRAT install/update smoke 未执行，是独立后续验证，不影响已完成的源码、
发布和资产结论。B-127 aggregate/p95/profiler/recovery/cancellation 扩展认证未
执行，继续按 [Backlog B-127](../../backlog.md) 的可重复回归、平台扩展或统计声明
需求重启；本记录不声称低端硬件性能承诺或 Windows/Android four-on 支持。
