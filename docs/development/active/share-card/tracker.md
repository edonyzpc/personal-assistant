# Share Card Development Tracker

Document status: Current
Delivery status: Validating
Updated: 2026-08-04
Work item: B-124
Authority: 本 track 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [PA Share Card Product Spec](../../../product/specs/pa-share-card-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: Completion review + final automated gates → Obsidian app smoke
- Next action: 完成 selection、Chat、Pagelet、light/dark、narrow/mobile、copy/save 的 test-vault 可见界面验证并记录证据。
- Blocker / decision needed: 无产品决策；测试 Mac 当前锁屏，需解锁后完成可见界面 smoke。
- Last verified behavior: 11 个 focused suites、full test/lint/build/deploy、TypeScript、docs、community scan 与 bundle audit 通过；最终独立定向复审无 P0–P2，待 app smoke。

Requirement traceability: B-124/REQ-01, B-124/REQ-02, B-124/REQ-03,
B-124/REQ-04, B-124/REQ-05, B-124/REQ-06, B-124/REQ-07, B-124/REQ-08,
B-124/REQ-09, B-124/REQ-10, B-124/AC-01, B-124/AC-02, B-124/AC-03,
B-124/AC-04, B-124/AC-05, B-124/AC-06, B-124/AC-07, B-124/AC-08,
B-124/AC-09, B-124/AC-10.

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-124/REQ-04/05 / AC-05/06 | Markdown preparation + measured paginator | [x] Complete | container-aware processor stripping; fragment-safe Markdown and 50k/24 boundary suites |
| T-02 | B-124/REQ-03/08/10 / AC-04/09 | fixed renderer + responsive/modal lifecycle | [x] Complete | renderer/modal suites; immediate pending-render cancellation; inert capture host; task-state text |
| T-03 | B-124/REQ-01/02 / AC-01..03 | Chat/Pagelet/selection integration | [x] Complete | partial-warning Chat fail-closed; strict no-path Pagelet payload; original selection command suites |
| T-04 | B-124/REQ-06/07/09 / AC-07/08 | clipboard/Vault export + unique/partial semantics | [x] Complete | data-URL Canvas capture; clipboard timing; per-Vault serialized batch tests |
| T-05 | B-124/AC-04..09 | CSS/locales + focused UI/runtime tests | [x] Complete | locale/modal/renderer tests; TypeScript/lint/community scan |
| T-06 | B-124/AC-10 | docs/notices/local gate/review/build/bundle/smoke | [~] In progress | docs/notices/build/bundle/deploy PASS; app smoke pending |

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | 原稿以固定字符数估算页面并可能删除 frontmatter-like 内容 | 改为 SDD measured pagination 且保留所有文本 | paginator tests + overflow smoke | Closed in design |
| F-02 | P1 | 原稿多页保存复用同一 mutable DOM，且 copy failure 自动写 Vault | 独立 offscreen capture + one batch；copy failure 不升级权限 | export tests + app smoke | Closed in design |
| F-03 | P2 | 原稿缺少移动端 preview、unique path、busy/stale cleanup 和 media privacy 边界 | 已进入 REQ-03/05/07/08/10 与 SDD | focused tests + app smoke | Closed in design |
| F-04 | P1 | WebKit 中 blob URL 的 SVG `foreignObject` 会污染 Canvas，PNG 导出可能抛 `SecurityError` | 改用编码后的自包含 SVG data URL，保留显式输出尺寸 | export regression + build/deploy；真实 WKWebView 为后续 release evidence | Closed |
| F-05 | P1 | reference image 扫描跨空白吞定义/普通链接，且 malformed opener 会漏掉后续有效图片 | 仅消费紧邻 reference label；malformed 后继续扫描 | 3 个定向 Markdown 回归 | Closed |
| F-06 | P2 | 关闭后重开 Modal 可让两个 exporter 并发选择同一 Vault path | `WeakMap<Vault, tail>` 串行化完整 folder/path/capture/write transaction | 双 exporter 同秒延迟 capture 回归，第二批选择 `-2` | Closed |
| F-07 | P1 | quote/list/lazy-container fence info 可在 DOM prune 前触发已注册 processor，且误判 fence 会漏净化外部 media | 跟踪 paragraph/list container、CommonMark tab stop 与合法 paragraph interruption | Markdown preparation 回归，含 lazy nested、ordered interruption、indented code | Closed |
| F-08 | P1 | oversized Markdown 单块 raw slice 会切断 active syntax 并改变后续页面渲染 | deterministic safe-fragment scanner；重建可证明的 wrappers，复杂歧义 typed fail-closed | paginator 回归，含 links/emphasis/container fence/60+ lines/limits | Closed |
| F-09 | P1 | Pagelet callback 携带 `sourcePath`，违背 AC-02 严格文本投影 | 从 callback request 和 Modal payload 移除 path | Panel/orchestrator exact-payload regressions | Closed |
| F-10 | P2 | close/unload 只能清 DOM，悬挂 Markdown/rAF await 会返回 stale card 或堵住 save queue | per-render cancellation race，cleanup 立即唤醒并抛专用取消信号 | 原 deferred 未 resolve 前 render 即 reject；export 不 capture/write | Closed |
| F-11 | P1 | `completed_with_warning` 同时代表 benign warning 与 provider/idle/wall-clock partial output | 三类 interruption warning 强制 fail-closed；benign completed warning 可分享；显式资格持久化 | Chat live/history regressions | Closed |
| F-12 | P2 | DOM sanitizer 删除 task checkbox 后丢失完成/未完成语义 | prune 前替换为 inert `[x]` / `[ ]` 文本 | renderer sanitizer regression | Closed |
| F-13 | P1 | HTML block 结束、混合 thematic marker 与 quote/list indented code 会扰乱 paragraph/code 状态，可能漏删 processor info 或改写 literal | 增加 HTML block lifecycle、同-marker thematic break 与 container-aware indented-code 状态；低于 `W+4` 的内容继续净化 | 36 个 Markdown preparation 回归；独立 27 + 16 fixture 矩阵无 P0–P2 | Closed |
| F-14 | P1 | 尾部空白、inline-code backtick run、reference definition、container fence info/marker 与 mid-line block marker 在强制分页时可能丢失或改变语义 | 保留或 typed fail-closed；reference use/definition 必须同页；跳过 code literal；fragment 起点与 fence body 需独立可渲染 | 41 个 paginator 回归；独立 delta 复审无 P0–P2 | Closed |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-08-04 | Design prerequisite | repo authority/source review | PASS | DEC-026、Approved Product Spec/Plan/SDD；原稿已吸收并删除 |
| 2026-08-04 | AC-01..09 | 11 focused suites | PASS | completion fixes 后 783/783；Markdown 36/36、paginator 41/41、renderer 6/6 |
| 2026-08-04 | AC-09/10 | TypeScript, ESLint, `git diff --check`, community source scan | PASS | 无 runtime style node / `innerHTML` / `outerHTML` source match |
| 2026-08-04 | AC-10 | docs/notices/dependency gates | PASS | `docs:check` 167 files / 1124 links；third-party notice check；`npm ci --dry-run` |
| 2026-08-04 | AC-04..10 | final `make deploy` | PASS | 183 suites / 3871 tests；lint/build；assets copied to repo-local test vault |
| 2026-08-04 | AC-10 | browser bundle audit | PASS | 4,828,934 bytes；gzip 1,488,519 < 1,572,864 budget；无 dynamic script element |
| 2026-08-04 | AC-10 | adversarial product/runtime/UI completion audit | PASS after fixes | F-04..F-14 closed；最终独立定向复审无 P0–P2 |

## Closeout Readiness

- [x] Owning contract 与实际行为一致。
- [ ] Required review/smoke/release evidence 已记录。
- [ ] 未完成项已进入 Backlog。
- [x] 稳定结论已吸收到 current contract/tests。
- [ ] 过程文档已标记 delete-after-absorption 或 unique archive evidence。
