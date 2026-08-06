# Share Card Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-08-05
Work item: B-124
Authority: 本 track 的唯一执行状态、finding、验证证据与 closeout readiness。
Product spec: [PA Share Card Product Spec](../../../product/specs/pa-share-card-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: Validated full-fidelity implementation under approved SnapDOM option A
- Next action: 等待用户另行授权 commit/push 或 lifecycle closeout；真实 iOS/Android 只作为后续
  release evidence，不冒充本轮 Desktop/mobile-viewport 验证。
- Blocker / decision needed: none；F-15/F-16 已由用户于 2026-08-05 明确关闭。
- Last verified behavior: Chat、Pagelet、selection 三入口，13 页 measured preview，显式资源、
  light/dark、420px 窄窗、clipboard、双主题 13 页 Vault Save、close/reopen/cleanup 与 preview/PNG
  一致性已在部署后的 Obsidian test vault 观察；最终完整项目 gate、bundle audit 与日志检查通过。

Requirement traceability: B-124/REQ-01, B-124/REQ-02, B-124/REQ-03,
B-124/REQ-04, B-124/REQ-05, B-124/REQ-06, B-124/REQ-07, B-124/REQ-08,
B-124/REQ-09, B-124/REQ-10, B-124/AC-01, B-124/AC-02, B-124/AC-03,
B-124/AC-04, B-124/AC-05, B-124/AC-06, B-124/AC-07, B-124/AC-08,
B-124/AC-09, B-124/AC-10.

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-124/REQ-04/05 / AC-05/06 | Markdown/resource preparation + measured paginator | [x] Complete | focused fixtures + deployed 5071-char/13-page smoke；每页 body `603=603`，remote/Vault/nested heading/Mermaid/SVG/placeholder 均进入 preview/PNG |
| T-02 | B-124/REQ-03/08/10 / AC-04/09 | fixed renderer + responsive/modal lifecycle | [x] Complete | fixed `540x720`、light/dark、420px scale、44px actions、warning aggregation、close/reopen 与零残留 capture host 已实测 |
| T-03 | B-124/REQ-01/02 / AC-01..03 | Chat/Pagelet/selection integration | [x] Complete | partial-warning Chat fail-closed；strict no-path Pagelet payload；三个真实可见入口均打开统一 Modal |
| T-04 | B-124/REQ-06/07/09 / AC-07/08 | SnapDOM capture + clipboard/Vault export | [x] Complete | Copy light/dark 成功且不隐式写 Vault；light/dark 各保存 13 张有序 unique PNG，全部 `1080x1440` |
| T-05 | B-124/AC-04..09 | CSS/locales + focused UI/runtime tests | [x] Complete | placeholder/warning 在 Copy/Save 后保留；双主题 preview/PNG、Mermaid 可读性、窄窗分页与 actions 已观察 |
| T-06 | B-124/AC-10 | docs/notices/local gate/review/build/bundle/smoke | [x] Complete | dependency/full tests/lint/build/bundle/deploy/docs/community scan 与干净 Obsidian console/errors 均通过 |

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
| F-14 | P1 | 尾部空白、inline-code backtick run、reference definition、container fence info/marker 与 mid-line block marker 在强制分页时可能丢失或改变语义 | 保留或 typed fail-closed；跨块 reference definition 以不可见上下文注入且不生成空白页；跳过 code literal；fragment 起点与 fence body 需独立可渲染 | paginator/reference 回归；独立 delta 复审无 P0–P2 | Closed |
| F-15 | P1 | 原始 spec 指定 `@zumer/snapdom`，实现未做固定版本 bake-off 或 deviation approval 即改为自研 capture adapter | 用户选择 A：精确锁定 2.23.2，PA 预本地化显式资源、禁用 proxy、生成完整性报告；批准仅限离屏图片文档的 audited runtime style/dependency 模式 | 2.23.2 能力/Chrome gate；Plan/SDD、dependency/bundle/community/mobile gates | Closed by owner decision |
| F-16 | P1 | “文本型 Markdown、移除媒体/Embed、捕获不发起资源请求”是 Agent 后加的产品边界，不是原始 spec 的明确要求 | 用户于 2026-08-05 选择方案 C：尽量保留远程图片、Vault Embed、图表与实际渲染结果，并接受对应资源请求/读取和失败恢复边界 | DEC-026 与 Product Spec REQ-04/05/09 | Closed by owner decision |
| F-17 | P1 | 初版 full-fidelity resolver 对 Markdown note embed 仅占位；literal scanner、SVG namespace/raster validation、Vault 大文件预读、重复 occurrence 输出放大、无效引用计数与 timeout 后 lingering request 存在契约/安全缺口 | 有界递归 whole/heading/block embed；literal 零 I/O；namespace-aware strict SVG；raster magic；stat preflight + post-read；canonical cache + explicit-count/32 MiB output budget；shared deadline + bounded-concurrency circuit breaker | resource focused suite + full gates | Closed |
| F-18 | P1 | 分页 probe 重跑 Markdown processor；视觉块被强制独占整页，code literal 可误判视觉；raw HTML 可能在 sanitize 前 connected；重复文本启发式映射、逐 code point 标记、inline-code HTML marker 与 task/list 层级边界会造成错误样式、DOM 放大、空 list shell 或状态丢失 | semantic block prepare-once + inert static clone；非枚举 exact source-range render plan + capped safe-boundary sentinel + deterministic Range clone；code 使用 literal marker；task item 仅允许经结构 key 证明的同层 sibling boundary，并 canonical snap 到 `<li>` 前；视觉贪心/isolated oversize；仅 safe standalone Mermaid 可 connected staging | renderer/paginator focused suite（含 50k CJK、重复 strong/em/link/code、task/nested-list state）+ independent delta review | Closed |
| F-19 | P1 | 完整性只看当前预览页，Copy/Save success 可覆盖 warning；排队中的 Save 在关闭后仍可能开始 folder/path mutation | 聚合所有 prepared pages 的 issue/fallback；成功仅表示传输/写入；queue/deferred mutation 前 cancellation checkpoint | modal/export focused suite + full gates | Closed |
| F-20 | P1 | literal sentinel 清理会全局删除尚未处理的空 element sentinel，真实 selection 因 boundary marker detached 无法打开 | 维护 pending element sentinel 集合；仅在消费前移出 preserve set，空 span pruning 跳过其余 pending markers | helper regression + 5071-char/13-page deployed selection smoke | Closed |
| F-21 | P1 | Mermaid 内嵌 `<style>` 被安全清理后，SVG node 回退为黑底且 label 对比度不足，preview/PNG 虽一致但不满足完整保真 | 删除 `<style>` 前后 diff 有限 paint/text computed properties，并在属性清理后物化安全 inline 值；外部或 unsupported resource-bearing style 进入 completeness issue | renderer regression；light/dark preview 与 `1080x1440` page-10 PNG 可读 | Closed |

## Validation Log

> 2026-08-04 的 text-first 验证是已被 2026-08-05 C+A 契约取代的历史证据，不作为当前
> full-fidelity implementation 的通过依据；当前验证只认下方新增的 2026-08-05 记录。

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-08-04 | Design prerequisite | repo authority/source review | PASS | DEC-026、Approved Product Spec/Plan/SDD；原稿已吸收并删除 |
| 2026-08-04 | AC-01..09 | 11 focused suites | PASS | completion fixes 后 783/783；Markdown 36/36、paginator 41/41、renderer 6/6 |
| 2026-08-04 | AC-09/10 | TypeScript, ESLint, `git diff --check`, community source scan | PASS | 无 runtime style node / `innerHTML` / `outerHTML` source match |
| 2026-08-04 | AC-10 | docs/notices/dependency gates | PASS | `docs:check` 167 files / 1124 links；third-party notice check；`npm ci --dry-run` |
| 2026-08-04 | AC-04..10 | final `make deploy` | PASS | 183 suites / 3871 tests；lint/build；assets copied to repo-local test vault |
| 2026-08-04 | AC-10 | browser bundle audit | PASS | 4,828,934 bytes；gzip 1,488,519 < 1,572,864 budget；无 dynamic script element |
| 2026-08-04 | AC-10 | adversarial product/runtime/UI completion audit | PASS after fixes | F-04..F-14 closed；最终独立定向复审无 P0–P2 |
| 2026-08-04 | Decision provenance | original spec vs current authority reconciliation | BLOCKED | F-15/F-16 是未批准偏差；自动化通过不能替代用户决定 |
| 2026-08-05 | F-16 / REQ-04/05/09 | owner content/media decision | PASS | 用户选择方案 C（完整渲染保真）；F-15 capture runtime 仍阻断 |
| 2026-08-05 | F-15 | exact npm 2.23.2 package + gitHead source audit | PASS with blockers | MIT、无 runtime dependency、ESM 153,731 bytes / gzip 50,173；确认 runtime style/HTML/fetch 模式，且无公开 fetch adapter；真实 Obsidian bake-off 待完成 |
| 2026-08-05 | F-15 / AC-04/06 | isolated Chrome full-fidelity bake-off | PARTIAL PASS | `scale:2,dpr:1,type:"png"` 精确输出 1080×1440；text/gradient/pseudo/SVG/Canvas/data-image 保真。无 CORS 的远程 SVG 仅 console 报错且从成功 PNG 缺失，证明 PA 仍需资源预处理与 typed completeness report；Obsidian Desktop/iOS/Android 未验证 |
| 2026-08-05 | F-15 / REQ-09 | owner capture runtime decision | PASS | 用户选择方案 A；批准精确 SnapDOM 2.23.2 + artifact-only runtime style 窄例外，要求 PA pre-inline、no proxy、completeness report 与真实后续 gate |
| 2026-08-05 | REQ-01..10 / AC-01..10 | 7 Share Card focused suites + 4 entry/governance suites | PASS | Share Card 179/179；Chat/Pagelet/selection/governance 585/585 |
| 2026-08-05 | F-17..19 | adversarial resource/runtime/modal/package/docs review | PASS after fixes | resource、once-render、exact Range、bounded sentinel、nested task/list、all-page completeness 与 queue cancellation findings closed；最终 delta review ✅OK，无 P0–P2 |
| 2026-08-05 | AC-09/10 | TypeScript、ESLint、docs、notices、diff/community scan、`npm ci --dry-run` | PASS | docs 168 files / 1128 links；notices 35 runtime packages / 11 resources；community source scan 无 match（exit 1） |
| 2026-08-05 | AC-10 | production build + browser bundle audit | PASS | `dist/main.js` 5,037,021 bytes；gzip 1,554,726 < 1,572,864 budget；无 dynamic script element |
| 2026-08-05 | AC-04..10 | final `make deploy` | PASS | 184 suites / 3,936 tests；lint/build；最新 assets copied to repo-local test vault |
| 2026-08-05 | AC-01/10 | Obsidian CLI runtime setup | PASS | Obsidian 1.13.4；明确 `vault=test` 路径；plugin enabled/reloaded；`share-selection-as-card` 注册；准确打开 `share-card-smoke.md`；debug/mobile 已恢复 off |
| 2026-08-05 | AC-04..09 | real Obsidian Desktop smoke | BLOCKED | macOS 当前锁屏，Computer Use 无法进入可见窗口。CLI 可打开真实 modal 且显式远程资源请求得到预期 200/404，但 `document.visibilityState=hidden`、`requestAnimationFrame` 1.5s 未触发，触发 production 5s readiness timeout；这是锁屏节流证据，不能替代解锁后的 preview/copy/save/visual interaction PASS |
| 2026-08-05 | F-20 / AC-05 | boundary regression + deployed selection rerun | PASS after fix | 7 Share Card suites 181/181；真实 5071 chars → 13 pages，全部固定 540×720，body `clientHeight=scrollHeight=603`，末页保留 `SHARE-CARD-SMOKE-END` |
| 2026-08-05 | F-21 / AC-06 | Mermaid cleanup fidelity | PASS after fix | 普通 render node `rgb(236,236,255)`/stroke/label computed style 经有限安全 materialization 保留；light/dark preview 与 page-10 PNG 均清晰，runtime `<style>` 仍删除 |
| 2026-08-05 | AC-01..03/10 | deployed visible entrypoints | PASS | Chat 仅 5 条完成 assistant 回复显示 action；Pagelet 仅导出两条 visible findings、无 path/diagnostics；selection 以原始 5071-char Markdown 打开 |
| 2026-08-05 | AC-04..06/10 | deployed preview/resources/themes | PASS | 13 页无 overflow；remote/Vault image、nested heading embed、Mermaid、static SVG 与可见 failure placeholder 进入 preview/PNG；light/dark 视觉与页码一致。whole/block/cycle/depth/Canvas 由 focused fixtures 覆盖，未冒充额外真机视觉证据 |
| 2026-08-05 | AC-07/08/10 | real Copy + Vault Save | PASS | light page 5 与 dark page 1 Copy 均收到 clipboard success；Copy 前无 `PA-Cards` 写入。最终 light batch `152608` 与 dark batch `152844` 各 13 张，26/26 PNG 均为 `1080x1440` 且顺序/命名完整；warning 未被 success 覆盖 |
| 2026-08-05 | AC-04/09/10 | close/reopen + narrow mobile viewport | PASS | Escape 后 modal/capture host `0/0`，同一 selection 可重开；Desktop mobile emulation + 420×850 window 下 scale `0.685185...`、document/modal horizontal overflow 0、nav/actions 全部 44px，真实翻到 page 2 后关闭；非真实 iOS/Android 触控声明 |
| 2026-08-05 | AC-10 | final gate + bundle + deployed logs | PASS | final `make deploy`: 185 suites / 3945 tests，lint/typecheck/build；`dist/main.js` 5,042,744 bytes、gzip 1,557,501 < 1,572,864；SnapDOM 2.23.2；community scan无 match；干净 final smoke console 仅 CLI receipts、errors none |

## Closeout Readiness

- [x] Owning contract 与用户已确认边界一致。
- [x] Required review/smoke evidence 已记录；release evidence 不在本轮授权范围。
- [x] 无未完成的本 track 实现项；真实 iOS/Android 属后续 release evidence。
- [x] 稳定结论已吸收到 current contract/tests。
- [ ] 过程文档已标记 delete-after-absorption 或 unique archive evidence。
