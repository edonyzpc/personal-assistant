# Share Card Delivery Plan

Document status: Approved
Updated: 2026-08-06
Work item: B-124
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Product spec: [PA Share Card Product Spec](../../../product/specs/pa-share-card-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

交付 B-124 的固定完整渲染卡片、四个显式入口、真实 DOM 分页和本地
clipboard/Vault export。远程图片、Vault Embed、Mermaid/SVG/Canvas 等明确视觉内容
进入 preview 与 PNG；失败必须显示占位或可重试错误，不能以 text-only PNG 冒充成功。
2026-08-06 amendment 同时交付 Ring selection-first/current-note fallback、有效 YAML/
basename 投影、图形 logo + `Personal Assistant`、Ring 可见中英本地化标签、local-only Source Han
Serif、端侧 Ring 几何与整批 `16 → 15 → 14px` 最大有效字号。

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
- Source Han Serif 随插件提供并在 capture 前成为本地 `data:` font；不允许外部 font
  URL/CDN、字体网络请求或 runtime `<style>` 注入。加载失败进入可重试错误而非静默替换。
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
  Pet Action Ring 与 `src/plugin.ts` editor command。不可显示的 `resourceBasePath` 与 source
  label 分离；Ring source resolver 必须在 active editor selection 与 current Markdown
  note 之间按权威顺序选择。
- UI: `src/custom.pcss` 与 plugin/pagelet locale JSON。
- Dependency/assets/notices: `package.json`、`package-lock.json`、Source Han Serif 本地字体
  asset/data URL 生成边界、`THIRD_PARTY_NOTICES.md`（若当前 checker 所需）。

## Delivery Slices

| Slice | Outcome | Focused exit gate |
| --- | --- | --- |
| 1. Authority/design | F-15/F-16 closed；Plan/SDD 与 Product Spec 一致 | `docs:check`、`git diff --check` |
| 2. Resource boundary | explicit refs → bounded local data URLs + typed report + abort/cache | resource unit tests；no unrelated Vault read；no proxy |
| 3. Render/paginate | approved visual DOM preserved；stable once-per-content render；visual atomic pagination | remote/Vault/Mermaid/SVG/Canvas fixtures；overflow/order/no-loss tests |
| 4. Capture/export | SnapDOM exact options；no HTTP(S) at capture；fixed pixels；truthful clipboard/save results | capture/options/network guard + clipboard/path/partial regressions |
| 5. UI/integration baseline | preview completeness state、占位、原三入口 resource context、CSS/locales | modal/Chat/Pagelet/selection/a11y tests |
| 6. Validate/review/smoke | full justified gates、independent PA review、deployed app evidence | focused/full gates + Desktop smoke；real-device mobile 作为 release residual |
| 7. 2026-08-06 owner amendment | Ring 第四项 Share；selection-first/note fallback；valid-YAML/basename；brand/font；Ring 可见中英本地化标签与几何；整批字号 | source/font/pagination/Ring focused tests + full gate + deployed Desktop + owner-approved Obsidian iPhone simulation evidence |

## Risk And Recovery

| Risk | Prevention | Detection / recovery |
| --- | --- | --- |
| SnapDOM 静默遗漏 CORS 资源 | PA pre-inline + residual HTTP(S) assertion + typed report | preview 显示占位/失败；capture 不冒充完整成功 |
| Embed/重复引用耗尽内存 | Vault `stat.size` 预检 + post-read check；每 Modal canonical cache；count/byte/time/depth 与 32 MiB localized-output budget；note embed 仅沿显式 embed 有界递归并使用 cycle guard；逐页顺序 capture | cycle/depth/subpath/read/output-budget 失败显示占位并进入 incomplete；用户缩短内容或重试 |
| Processor 执行扩权 | 仅保留 Mermaid visual fence；其他 info 作为普通 code | processor fixtures；未知交互结果占位 |
| 图片/图表加载后改变分页 | 单次稳定 render；image decode/fonts/DOM quiet wait；visual block atomic | Resize/overflow checks；超高视觉块等比缩放，不裁剪 |
| 字体缺失或暗中联网导致视觉/隐私漂移 | bundled Source Han Serif → data URL；capture 前显式 font readiness；外部 font URL 为 0 | font-load/failure tests + network guard；失败可重试，不以 fallback 冒充 PASS |
| 字号优化让同批页面排版不一致 | 先测 16px；15/14px 仅在减少总页数时按序接受第一个最大有效值 | candidate page-count fixtures；preview/copy/save 全页字号一致断言 |
| SnapDOM dependency 规则冲突 | exact version + narrow artifact-only exception + source/bundle audit | local gate；正式发布前 hosted community scan；失败则停止发布并重新决策 |
| Mobile WebKit 污染/内存差异 | data URL input、`dpr:1`、逐页 cleanup、owner document/window | Desktop + iOS/Android smoke；失败保留旧文件并可重试 |
| 关闭/切页产生 stale work | AbortSignal、Component owner、operation token、per-Vault save queue | cancellation/rapid-nav/reopen tests |

## Validation Strategy

1. 每个 slice 执行 `implement → focused test → review → fix → verify`。
2. Local Validation Gate：focused Jest、TypeScript、`git diff --check`、community source scan。
3. 依赖 gate：exact lock、notice/license、`npm ci --dry-run`、lint/build/bundle audit。
4. `make deploy` 后在 test vault 验证四个入口、Ring selection/note 两分支、light/dark、
   brand/font、Ring 可见中英本地化标签、长文本与整批字号、remote/Vault image、Mermaid/SVG/Canvas、资源
   失败、copy、single/multi save 与 1080×1440 PNG。
5. 不从 Chrome 或 Desktop 推断 iOS/Android。2026-08-06 owner 明确允许本轮 iPhone 使用
   Obsidian mobile emulation + `393x852` phone viewport；必须标注模拟边界，真实设备作为
   后续 release residual，不阻断本轮 validated implementation。

## Approval And Stop Point

- Product/media decision: user option C, 2026-08-05。
- Capture runtime decision: user option A, 2026-08-05。
- Action Ring/source/visual/font/layout/pagination amendment: user decision, 2026-08-06。
- iPhone validation evidence: owner-approved Obsidian mobile emulation for this delivery, 2026-08-06。
- Mode: `implement-approved-spec`。
- Stop at validated implementation；不含 closeout、commit、push、tag、publish 或 release。
