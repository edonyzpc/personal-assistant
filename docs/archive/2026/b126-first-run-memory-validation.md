# B-126 First-Run AI Setup And Silent Memory — 最终验证证据

Document status: Archived
Delivery status: Closed
Closed date: 2026-10-05
Work item: B-126
Authority: 原 B-126 已验收开发范围的历史自动化、设备和 CI 证据；不作为当前行为或执行状态权威。

## 范围与权威

Owner 于 2026-08-11 批准 silent first-use Memory 与 unknown marker fail-closed；
2026-08-23 选择有界 inline setup/首次 Settings AI 聚焦，以及 legacy Provider
方案 B。B-126/REQ-01..14、AC-01..14 的开发与适用验证已完成；2026-10-05
Owner 明确授权 closeout 实际完成任务。

当前行为已吸收到 [DEC-028](../../product/decisions/dec-028-silent-memory-auto-prepare.md)、
[DEC-029](../../product/decisions/dec-029-inline-ai-setup-and-settings-focus.md)、
[Product Spec](../../product/specs/pa-silent-first-use-memory-preparation-product-spec.md)、
[VSS Architecture](../../architecture/vss-sqlite-wasm-architecture.md)、
[Local State](../../architecture/vss-local-state-plan.md)、
[Embedding Refresh](../../architecture/vss-embedding-refresh.md) 与
[Data Boundary](../../product/specs/pa-data-boundary-product-spec.md)。
Fresh Custom、wizard、Test Connection、PA Cloud、progressive build、provider/model
性能和 release timing 未获本范围批准，继续归 [Backlog B-126](../../backlog.md)
及 [Discovery](../../development/discovery/first-run-and-platform-robustness.md)。

## 需求与最终证据

| Requirement / AC | 最终证据 |
| --- | --- |
| REQ/AC-01..06 | First-use answer-now/no Modal、单 active rebuild、truthful status、durable usable success、保留 recovery/manual confirmation、disable/unload 取消由 focused/full 保护；Desktop/iPhone 的响应和 reload lifecycle 通过 |
| REQ/AC-07..08 | unknown marker 零 reset/provider、durable 原 reason guard、失败/abort/restart、policy compensation 及 stale prepared-handle no-op 由真实 VSS fixtures 和独立复核通过 |
| REQ/AC-09..13 | 三个 approved presets、token-only 零 settings write、existing-token reuse、有序 Provider/token 事务和 counted leases、fail-closed compensation、tri-state 被动零 Keychain 读取、草稿/焦点/a11y 由 focused/full 与 Desktop/iPhone 宿主观察通过 |
| REQ/AC-14 | Raw provider-aware identity 和三个 exact 历史 Qwen model 保留 admission；Ollama/unknown/missing identity 保持 incomplete，retained token 不代替 Provider 选择。Migration/reload/admission fixtures 与独立复核通过 |

## 最终冻结门禁与 CI

- 2026-08-23 最终 focused gate 为 **9 suites / 903 tests**；full regression
  **189 suites / 4186 tests**。TypeScript、lint、production build、full/release
  docs、platform guard/self-test、diff/community hygiene 通过；Provider/Settings/VSS
  对抗复审无剩余 P0/P1/P2。
- 2026-08-24 current-build Desktop 和 iCloud deploy 重用/执行对应 189/4186
  门禁，并分别验证 exact deployed assets。Desktop 原 assets/data/localStorage
  恢复并核对 hash；iPhone data.json SHA-256 前后不变。
- Published runtime-bearing head `479b1eee2758958382bed012058c4005e42fba7a` 的
  GitHub Actions run `32740493156` / job `97473518005`：`validate` 9m17s
  success，Test/Lint/Build/audit/guard/notices/docs 通过。
- 当时 28 项 exact content-locked Episodic/Retrieval docs finding 为既有 advisory，
  没有 B-126/DEC-029 新问题；不把这些历史警告写成产品失败或隐藏 debt。

## 独有设备与失败证据

- Obsidian 1.13.6 Desktop retained-token reload 的 passive token 为 `unknown`，
  本地 Memory status 可用；首次 Settings 仅 AI Provider 展开，非 AI 的显式偏好
  和 AI 的折叠偏好重开保持。Qwen Intl 的临时选择和显式 retained-token probe
  后 Start 可用；该观察未保存 provider 或发起请求。
- Edony iPhone 15、iCloud `test`、plugin 2.9.2：被动 Chat/Settings 输入及
  本地 `Memory ready` 响应正常、token `unknown`；明确 Update memory action
  才将 token 解析为 `present` 并打开正常 11-note confirmation，真实触摸 Cancel
  阻止 provider work；reload 回到 `unknown`，无 Notice/error 或迟到进度。
- 最新 build 的 Desktop 可见 Provider save-failure 恢复稳定 URL 并显示本地化
  retry feedback；Memory 控件无 clipping，Chat 本地文本可输入清除，fresh errors
  为空。最新 iPhone 四资产 byte-match、`isMobile=true`，同类内存 save-failure
  恢复 DashScope URL，Memory ready（9 prepared notes），fresh Inspector Errors
  为空；未发 provider request 或修改 token。
- F-13..21 修复涵盖 legacy provenance、Chat/Settings 队列、stale rebuild ownership、
  readiness 通知、键盘/触摸焦点、PR metadata、queued credential leases、secret
  写后抛错和 pending Custom/Memory 控件；最后完整门禁及非作者复核均闭合。

设备证据只有 portrait；landscape、iPad、Android 未测试。自动化 mobile mock
不替代真机；这里的真机证据也不外推至未观察的平台或后来改变的实现。
Settings 和 SecretStorage 只承诺运行时协调、best-effort compensation；进程 crash
跨存储原子性不在本 slice 中，不虚构 durable crash-atomic marker 或保证。

## Closeout 处置

2026-10-05 只读 GitHub 元数据确认 [PR #378](https://github.com/edonyzpc/personal-assistant/pull/378)
为 closed/merged，合并时间 `2026-08-24T15:06:46Z`，merge commit
`d874f5e0af0b0572f3f853fe5c82685390d991fa` 是当前 HEAD 的祖先。最终 PR head
为 `4166976fb1dc886ec58c6ed499ad2727c5451903`；PR 最终描述记录对应 head CI
run `32741666433` 以及相同 9/903、189/4186 与 iPhone smoke 结果。本次没有
重新运行 CI 或 smoke。上文 `479b1eee` 是较早已成功 CI 的历史 head；其
remediation 与 prepared-run ownership 的等价变更已整合，不能把它误当最终
merge commit 或要求它仍是当前 HEAD 的直接祖先。

稳定行为、迁移边界和关键 failure matrix 已由当前契约/测试承接；原 Feature Home、
Tracker 和 SDD 为吸收后可删过程文件。没有本次批准开发范围内未完成任务，
更宽 first-run 产品方向保留待决定身份。该记录的历史 CI head 不是当前源码身份，
合并事实与历史验证分别记录，不由它推导某个版本发布。
