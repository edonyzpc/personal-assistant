# DEC-073 — Chat Canvas 预览与原生打开

Decision ID: DEC-073
Status: Accepted
Updated: 2026-10-23
Authority: Owner 于 2026-10-21 确认 Chat 图文预览、点击后新标签页原生 Canvas 完整交互，以及生成时快照、打开最新文件、默认路径可修改和一次「保存并打开」的产品行为；2026-10-22 真实验收后选择“预览跟随原生解析，原始 JSON 原样保存”，后续审查修复请求又明确图片渲染不应受准入拦截。Accepted 记录这些明确选择，分别见下述修订；运行实施、Git、closeout 与发布授权分别记录。
Implementation authority: 2026-10-22 Owner 要求按 B-184 完成全部开发测试及 test vault 验收；2026-10-23 明确要求收尾并提交到本地 master。必要验收已完成，当前实现与历史证据见下列链接；推送与发布仍分别授权。
Work item: B-184

编号沿革：本地 B-184 提交原使用 DEC-072；2026-10-23 合入远程 master 时，该编号
已由 Pagelet 决策占用，因此改为 DEC-073 并同步引用。产品决定及其授权日期不变。

## Context

Chat 当前把 JSON Canvas 显示为代码，用户需要直接看见笔记、文字、分组与连线的关系，
再按需进入 Obsidian Canvas 操作。原生 Markdown 的 Canvas 嵌入只显示形状，不显示
卡片文字，不能独自满足图文预览。公开工作区 API 可以在新标签页打开真实 `.canvas`
文件；完整交互应由原生 Canvas 接管。

本选择遵循[产品北极星](../pa-product-north-star.md)的「安静且可信」：读图不制造文件，
用户决定留下并打开画布时才保存；保留对话原始内容，避免再次打开时覆盖用户在 Canvas
里的手工修改。已有 [DEC-070](./dec-070-chat-rendering-lifecycle-performance.md) 与
[DEC-071](./dec-071-pa-ui-state-rendering.md) 继续约束原生 Markdown 兼容、交互状态及资源生命周期。

## Options Considered

| Option | Benefits | Costs / risks | Why selected or rejected |
| --- | --- | --- | --- |
| 继续展示 JSON 或仅提供文件链接 | 沿用当前文本和文件打开能力 | 无法直接看图，用户仍需手动保存或打开 | 不满足本次直接预览要求 |
| 只使用原生 `![[图.canvas]]` 嵌入 | 使用宿主既有嵌入 | 原生嵌入缺少卡片文字，且先要有文件 | 不作为完整图文预览方案 |
| Chat 内显示生成时图文快照，用户保存并交给原生 Canvas | 读图与落盘分离；完整编辑由宿主承担；原对话和手工编辑均可保留 | 需要专门的预览呈现、文件关联及打开衔接 | Owner 选择 |
| Chat 内复制完整编辑器或与原生文件双向同步 | 可在消息内完成更多编辑 | 扩大编辑、冲突、同步和生命周期责任 | 不纳入本次范围 |

## Decision

1. Chat 支持 JSON Canvas 图文预览。显式 `canvas` / `jsoncanvas` 代码块进入对应结构
   校验；普通 `json` 只有可严格确认为 JSON Canvas 时才增强显示，不按标题或关键词
   识别。保留原始 JSON、原消息和复制语义，不强迫用户先修改提示词。
2. 预览完整表达 `text`、`file`、`link`、`group` 与边的关系和布局。文件节点可使用
   宿主既有的笔记、图片、PDF 等本地嵌入，不缩为 Markdown-only。网页链接在 Chat
   显示 URL 卡片，不自动抓取网页；图中的原始文件、链接及扩展数据保留在保存内容中。
3. Chat 负责预览的平移、缩放、选字和原始 JSON 查看。明确的右上角操作按钮负责
   保存及打开；画布拖动、选字或节点操作不隐含保存。桌面、移动和键盘共享同一行为。
4. 预览及流式生成不自动写入笔记库。首次打开前显示可修改的默认路径，沿 Obsidian
   新文件位置规则及画布标题拟定；原型的 `Canvas/` 是示例目录，不成为新增产品默认。
   完整内容准备就绪后，用户一次点击「保存并打开」即可
   保存并在新标签页打开，不增加必经的第二次确认。真实绑定的已有 `.canvas` 文件
   直接「打开 Canvas」，不另存或重写。重名的无关文件不得被覆盖。
5. 原生打开使用真实 `.canvas` 文件。文件与已打开标签页可复用，获得当前 Obsidian
   Canvas 支持的完整交互；原生移交后的文件与链接由 Obsidian 自身规则处理。
   不把一个 `file` 节点或模型声称的文件名当作整张画布的既有文件身份。
6. Chat 保持明确标注的「生成时预览」，固定原始 JSON 中的节点位置、文本、边及引用，
   原生编辑不回写原消息或原始 JSON。文件节点仍引用 vault 中的文件，不创建笔记或
   附件历史副本；本地引用重读时标明「引用内容为当前文件」，不冒称历史内容。当前
   owner 按下述图片展示例外与非图片 Data Boundary 保留已展示内容与交互，原生编辑后不主动重绘；
   重开时仅在本地重新核验引用。
   保存关联绑定稳定画布产物，以后打开文件当前内容，绝不以旧快照覆盖手工编辑。
   重命名更新已核实关联，删除或关联失效时说明实际情况；删除聊天不连带删除已保存文件。
7. 沿用 B-181 的稳定身份、独立 owner、正文 held 与「查看最新」行为；无关更新不
   重建预览，隐藏暂停显示工作，关闭释放资源。预览扩展不替换其他原生 Markdown
   能力，也不建立第二套任务 runtime。
8. 用户点击触发的是普通 UI 文件保存与打开。实现可以复用现有 UI 保存能力及公开
   Vault API，不必伪装为 Agent Operations。图片展示沿宿主原生规则，不因 Agent 或
   Data Boundary 的来源排除而隐藏，包含远端及宿主支持的内嵌图片；实际本地图片
   仍核验当前 vault 文件身份。笔记正文和非图片资源在展开前检查当前共享 Data
   Boundary；被拒绝时只显示占位，不泄露新增文件事实，不借用已结束 Agent run 的 guard。
   模型文本、预览文件及 UI 查看不授予
   Agent 读取或写入权限，不自动把所预览文件的内容送给模型，也不新增 AI 请求或费用。
   原生移交后属于 Obsidian core 行为，PA Agent 的来源控件不会自动约束 core。
   不承诺 PA 对这次文件创建提供统一 Undo；原生编辑的 Undo 由 Obsidian 承担。
9. 失败反馈区分数据、资源、保存、关联和打开阶段。已经保存而未打开时只重试打开；
   效果未知时先核实原操作，不因缺少关联记录就再次创建。历史关联只持久化必要的
   可校验数据，恢复不自动重放保存或打开，也不恢复运行期权限、DOM 或回调。
10. Canvas 文字的相对引用跟随原生 Canvas 解析，不由拟保存目录重新定义；嵌入
    笔记的内部引用仍按该笔记自身位置解析，文件节点及分组背景沿字段的宿主规则
    核验实际文件。修改保存目录不重写原始 JSON，也不接管原生 Canvas 解析器。

## 2026-10-22 Relative Reference Revision

此前 D-04 方案要求 Canvas 文字按拟保存路径解析，并将原始 JSON 原样落盘。真实
Obsidian 1.14.4 验收中，同一 `![](./image.png)` 在 Chat 的 B 路径预览显示 B 图，
保存到 B 后原生 Canvas 却显示 A 图。独立核对同版本宿主接线确认：文字节点使用空
`sourcePath`，文件节点另有 Canvas 文件路径上下文；公开 API 没有原生文字解析基准
的设置入口。这个反例保留为原方案的真实 FAIL，不能用后续标准回填为 PASS。

向 Owner 提供的取舍为：跟随原生解析并原样保存（最小改动）；保存时转换相对引用
（会改写保存内容）；或保留原方案并暂缓该项。建议第一项，以保留原始内容和原生
职责边界；Owner 本轮明确选择第一项，取代
SDD 与 Product Spec 中“拟保存目录决定文字引用基准”的旧规则，保留原始内容及
原生完整交互的优先级，不增加链接重写器或私有原生 renderer 补丁。

若后续宿主规则变化或用户改选目录相对语义，重新核对实际原生行为并取得相应选择；
可回退局部预览增强，保留原始消息、JSON、已保存文件与用户原生编辑，不改写这些
产物来模拟恢复旧行为。当前选择对应的实现与新验收结果由 Tracker 持有。

## 2026-10-22 Image Display Revision

后续代码审查发现引用块/多行定义的图片会绕过 Canvas 资源扫描，按原 B-184 的
“所有资源准入、无远端请求”约束列为 P1。Owner 随后明确指出图片引用渲染合理，
“准入不应该拦截这个渲染”，要求确认并修复。核对普通 Chat 的原生 Markdown
调用后确认，Canvas 额外拦截图片会使同一图片因界面或语法不同而显示不一致。

本轮据此选择图片展示的窄例外：text、file 图片节点、group 本地图片背景及获准
嵌入笔记中的图片遵循原生渲染；本地排除目录的图片可展示，远端/内嵌图片使用宿主
既有加载能力。图片网络加载是实际网络效果，不再宣称零远端请求；它不等于网页
正文抓取，也不向模型提供图片或授予 Agent 来源权限。笔记正文、PDF/音视频等
非图片内容仍检查共享边界，网页节点仍为 URL 卡片，不开放 iframe。

这替代旧合同对图片显示的拦截要求，保留此前扫描反例和旧审查依据，不追溯改称
原规范只约束模型。相比补强图片拦截，该选择保持原生可读性；相比移除全部资源
准入，它不扩大笔记/非图片内容权限。不添加图片确认弹窗或新的来源开关。
若以后重新选择图片隔离策略，应重新取得决定；回退只影响预览，不修改原始 JSON、
已保存 Canvas 或用户原生编辑。当前行为与测试由 Tracker 持有。

## Consequences

- Product behavior: 用户可以直接读图，忽略预览不会产生文件；真实点击将明确的
  保存效果与进入原生编辑连成一步。生成时快照与文件当前版本各有清晰含义。
- Architecture / data / safety: Chat 预览、普通 UI 文件效果和原生编辑职责分开；
  文件身份、完整内容、数据边界及真实效果均需核实。UI 预览不扩大 Agent 上下文或权限。
- Compatibility / migration: 保留普通 JSON 和全部原始消息；旧历史没有保存关联时
  仍可显示，不能猜测已保存产物。宿主既有媒体能力与 B-181 交互连续性继续有效。
- Work created or removed: Product Spec 与当前 Architecture 持有稳定行为和实现；
  Active Package 及演示原型吸收后删除，独有反例和实际验收压缩保留。

## Revisit Trigger

- 用户明确要求 Chat 预览随原生文件编辑实时更新，或在 Chat 内直接编辑画布。
- 实际原生 API、宿主嵌入或媒体行为无法满足这里约定的图文、交互或数据边界。
- 出现跨会话关联无法识别、重复创建或旧快照覆盖编辑的实际故障，需要调整身份与恢复方案。
- 需要新增网页抓取、模型读取、跨 vault、同步或其他超出既有权限与网络范围的行为。

## Traceability

- Product Spec: [Chat Canvas Preview Product Spec](../specs/pa-chat-canvas-preview-product-spec.md)。
- Architecture: [Chat Canvas](../../architecture/chat-canvas-preview.md)；
  [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)；
  [UI 状态与宿主生命周期](../../architecture/pa-ui-state-rendering.md)；
  [Data Boundary 硬排除](../specs/pa-data-boundary-product-spec.md#22-exclusion-is-a-hard-default)。
- Validation and disposition: [B-184 最终验收](../../archive/2026/b184-chat-canvas-preview-validation.md)。
  原型只提供设计输入，视觉要求已被当前 Spec/Architecture/组件吸收；真实写入与
  原生交互以该记录的实际宿主证据为准。
- Platform facts: [Obsidian Canvas](https://obsidian.md/help/plugins/canvas)、
  [原生嵌入限制](https://obsidian.md/help/embeds)、
  [公开 API](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)与
  [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/)。
- Supersession: 本轮仅替代图片 UI 展示的旧限制，范围见上节和共享 Data Boundary 的对应例外；DEC-070、DEC-071、模型来源与非图片权限继续有效。实现和发布分别授权。
