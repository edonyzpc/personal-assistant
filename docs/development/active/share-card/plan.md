# Share Card Delivery Plan

Document status: Approved
Updated: 2026-08-04
Work item: B-124
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Product spec: [PA Share Card Product Spec](../../../product/specs/pa-share-card-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

交付 B-124 的固定文本卡片、三个显式入口、实测分页和本地 clipboard/Vault export，
并以 focused tests、项目 gate、专项 review 和真实 Obsidian test-vault smoke 证明行为。
不增加设置、媒体抓取、外部发布、commit、closeout 或 release。

## Dependencies And Source Surface

- Modal / Markdown lifecycle: `obsidian` 的 `Modal`、`Component`、`MarkdownRenderer`、
  `Setting`、`Notice`、`Vault.createBinary`。
- Capture: plugin-owned SVG `foreignObject` + Canvas adapter。它只序列化已净化的受控 card
  DOM，以 computed-style allowlist 内联必要样式，拒绝 `url(...)` 资源值，并固定 rasterize 为
  `1080×1440` PNG；不得创建 runtime `<style>`、使用 `innerHTML` 或引入 capture package。
- Shared platform DOM: `src/platform-dom.ts` 的 active document/window 与 animation-frame helpers。
- Chat: `RenderedMessage`、`ensureCompletedMessageActions`、历史 assistant 与 turn finalize paths。
- Pagelet: `PanelCallbacks`、`PanelView.currentVisibleFindings`、Prepared read-only controls、
  `PageletOrchestrator.initialize()` callback wiring。
- Editor: `src/plugin.ts` command registration and `Editor` selection APIs。
- UI/i18n: `src/custom.pcss`、plugin/pagelet JSON locale resources。
- Gates: focused Jest、Local Validation Gate、docs/check notices、lint/build/bundle audit、test-vault smoke。

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| 1. Authority + source design | Accepted Decision、Approved Product Spec/SDD、测试映射 | docs + source/API verification | docs:check、P0/P1/P2 design finding closed | Before runtime edit if product scope is unresolved |
| 2. Core | types、text preparation、measured pagination、renderer、clipboard/Vault export | `src/share-card/*` + focused tests | core tests + typecheck | Before integration if capture/pagination contract fails |
| 3. Integration + UI | Chat/Pagelet/selection entry、responsive modal、locale、CSS、notices | current integration surfaces | focused Chat/Pagelet/locale tests + community scan | Before app smoke if DOM/lifecycle review has P2+ |
| 4. Validation + review | full justified gates、PA review/fix、deployed app smoke | repo + test vault | required checks green and observed AC evidence | Tracker `Validated`; no closeout/commit |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| Character pagination clips or loses Markdown | actual DOM fit callback + progress-guaranteed semantic splitter | unit order/content assertions + runtime overflow smoke | plain-text fallback; keep Modal retryable |
| Preview transform changes export pixels | independent fixed-size offscreen export DOM | pixel dimension test + preview/export comparison | capture only unscaled export host |
| Clipboard failure creates surprise file | no automatic copy→save escalation | mock clipboard denial and assert zero Vault writes | explicit Save remains available |
| Multi-page overwrite/partial success | shared unique batch + truthful result | conflict/partial-write tests | preserve existing files; report saved count |
| Remote Markdown causes network/privacy drift | text-first preparation + post-render media pruning; no proxy | sanitizer tests + capture DOM inspection | textual placeholder/plain-text fallback |
| Async close/switch writes stale UI | operation token, busy mutex, Component/offscreen cleanup | rapid navigation/close tests | ignore stale completion; user can reopen |
| Capture adapter breaks mobile/bundle/community gate | owner-document APIs、无 runtime style/HTML injection、fixed dimensions、notice/bundle audit | type/build/community scan + runtime smoke | 保留文本/分页契约并替换 rasterizer，不改变入口或数据语义 |

## Validation Strategy

- Focused tests: paginator/text preparation, capture/path/result semantics, Modal lifecycle, Chat action,
  Pagelet callback/payload and editor selection helper/command boundary。
- Type/lint/build gate: focused Jest → `npx tsc -noEmit -skipLibCheck` → `git diff --check` →
  community DOM scan → docs/notices → lint/build/bundle audit。
- Obsidian smoke: `make deploy` 后观察 Chat、Pagelet、selection、light/dark、长内容分页、
  current-page copy、single/multi-page save、已有文件避让及 preview/PNG consistency。
- Real-device / community / release gate: 标准 test-vault smoke 覆盖 desktop runtime；若当前
  环境可用再补 iPhone evidence，但不得从 desktop 推断真实触控。正式 community/release
  scan 与发布不在本工作项授权范围。

## Approval

- Plan authority: User request 2026-08-04 + DEC-026
- Approved on: 2026-08-04
- Authorized implementation scope: design、development、tests、review 与 local Obsidian smoke；
  excludes closeout、commit、push、tag、publish、release。
