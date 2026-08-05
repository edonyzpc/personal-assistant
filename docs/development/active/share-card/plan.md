# Share Card Delivery Plan

Document status: Approved
Updated: 2026-08-05
Work item: B-124
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Product spec: [PA Share Card Product Spec](../../../product/specs/pa-share-card-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

交付 B-124 的固定完整渲染卡片、三个显式入口、真实 DOM 分页和本地
clipboard/Vault export。远程图片、Vault Embed、Mermaid/SVG/Canvas 等明确视觉内容
进入 preview 与 PNG；失败必须显示占位或可重试错误，不能以 text-only PNG 冒充成功。

不增加设置、通用页面截图、任意第三方交互视图、proxy、上传/发布、commit、closeout
或 release。

## Approved Technical Boundary

- Capture runtime 精确锁定 `@zumer/snapdom@2.23.2`，使用 `scale:2`、`dpr:1`、
  `type:"png"`、`useProxy:""`、`embedFonts:false`、`reconcile:false`、
  `outerShadows:false`、`resolvePicturePlaceholders:false`、`cache:"disabled"`。SnapDOM
  内部 cache 禁用不影响 PA 每 Modal 的显式资源去重缓存。
- 用户批准 SnapDOM 仅在离屏图片文档中所需的 runtime style 与已审计 dependency 模式；
  该例外不允许向 Obsidian live UI 注入 style，也不豁免 bundle/community/mobile gate。
- PA 在 SnapDOM 前拥有资源权限：只解析输入明确引用的远程/Vault 资源，通过
  `requestUrl`/Vault API 读取并转换成 data URL。SnapDOM 输入不得残留 HTTP(S) 资源。
- 一个 typed completeness report 记录 resolved/placeholder/failed 资源。PNG Blob 成功
  不是完整成功的充分条件。
- Renderer 只保留批准的静态视觉结果；脚本、表单、iframe、audio/video、任意执行型
  processor 与第三方交互 DOM 继续变成可见占位。Mermaid 是 v1 唯一允许的 fenced
  visual processor；普通 fenced code 保持代码文本。

## Source Surface

- Core: `src/share-card/{share-card-types,share-card-markdown,share-card-paginator,
  share-card-renderer,share-card-export,share-card-modal}.ts`。
- New resource boundary: `src/share-card/share-card-resources.ts`，集中显式 URL/Vault 读取、
  data URL、预算、取消和 completeness report。
- Integrations: `src/chat/chat-view.ts`、`src/chat/types.ts`、Pagelet callback/orchestrator、
  `src/plugin.ts` editor command。不可显示的 `resourceBasePath` 与 source label 分离。
- UI: `src/custom.pcss` 与 plugin/pagelet locale JSON。
- Dependency/notices: `package.json`、`package-lock.json`、`THIRD_PARTY_NOTICES.md`（若当前
  checker 所需）。

## Delivery Slices

| Slice | Outcome | Focused exit gate |
| --- | --- | --- |
| 1. Authority/design | F-15/F-16 closed；Plan/SDD 与 Product Spec 一致 | `docs:check`、`git diff --check` |
| 2. Resource boundary | explicit refs → bounded local data URLs + typed report + abort/cache | resource unit tests；no unrelated Vault read；no proxy |
| 3. Render/paginate | approved visual DOM preserved；stable once-per-content render；visual atomic pagination | remote/Vault/Mermaid/SVG/Canvas fixtures；overflow/order/no-loss tests |
| 4. Capture/export | SnapDOM exact options；no HTTP(S) at capture；fixed pixels；truthful clipboard/save results | capture/options/network guard + clipboard/path/partial regressions |
| 5. UI/integration | preview completeness state、占位、three entry resource context、CSS/locales | modal/Chat/Pagelet/selection/a11y tests |
| 6. Validate/review/smoke | full justified gates、independent PA review、deployed app evidence | focused/full gates + Desktop smoke；可用时补 real-device mobile evidence |

## Risk And Recovery

| Risk | Prevention | Detection / recovery |
| --- | --- | --- |
| SnapDOM 静默遗漏 CORS 资源 | PA pre-inline + residual HTTP(S) assertion + typed report | preview 显示占位/失败；capture 不冒充完整成功 |
| Embed/重复引用耗尽内存 | Vault `stat.size` 预检 + post-read check；每 Modal canonical cache；count/byte/time/depth 与 32 MiB localized-output budget；note embed 仅沿显式 embed 有界递归并使用 cycle guard；逐页顺序 capture | cycle/depth/subpath/read/output-budget 失败显示占位并进入 incomplete；用户缩短内容或重试 |
| Processor 执行扩权 | 仅保留 Mermaid visual fence；其他 info 作为普通 code | processor fixtures；未知交互结果占位 |
| 图片/图表加载后改变分页 | 单次稳定 render；image decode/fonts/DOM quiet wait；visual block atomic | Resize/overflow checks；超高视觉块等比缩放，不裁剪 |
| SnapDOM dependency 规则冲突 | exact version + narrow artifact-only exception + source/bundle audit | local gate；正式发布前 hosted community scan；失败则停止发布并重新决策 |
| Mobile WebKit 污染/内存差异 | data URL input、`dpr:1`、逐页 cleanup、owner document/window | Desktop + iOS/Android smoke；失败保留旧文件并可重试 |
| 关闭/切页产生 stale work | AbortSignal、Component owner、operation token、per-Vault save queue | cancellation/rapid-nav/reopen tests |

## Validation Strategy

1. 每个 slice 执行 `implement → focused test → review → fix → verify`。
2. Local Validation Gate：focused Jest、TypeScript、`git diff --check`、community source scan。
3. 依赖 gate：exact lock、notice/license、`npm ci --dry-run`、lint/build/bundle audit。
4. `make deploy` 后在 test vault 验证三个入口、light/dark、长文本、remote/Vault image、
   Mermaid/SVG/Canvas、资源失败、copy、single/multi save 与 1080×1440 PNG。
5. 不从 Chrome 或 Desktop 推断 iOS/Android；真实设备不可用时明确记录未验证风险。

## Approval And Stop Point

- Product/media decision: user option C, 2026-08-05。
- Capture runtime decision: user option A, 2026-08-05。
- Mode: `implement-approved-spec`。
- Stop at validated implementation；不含 closeout、commit、push、tag、publish 或 release。
