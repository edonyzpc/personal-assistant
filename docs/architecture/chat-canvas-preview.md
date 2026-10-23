# Chat Canvas 预览与原生文件

Document status: Current
Updated: 2026-10-23
Work item: B-184
Authority: 当前 Chat Canvas 的渲染、资源、保存和历史恢复技术契约。
Product: [DEC-073](../product/decisions/dec-073-chat-canvas-preview-native-open.md) 与 [Product Spec](../product/specs/pa-chat-canvas-preview-product-spec.md)。

## 职责与入口

Chat 展示生成时 JSON 的图文预览；显式保存后将真实 `.canvas` 交给 Obsidian 原生标签页。
预览不承担节点编辑、连线编辑或原生 Undo，不复制私有 CanvasView，也不新增 Agent 命令。
稳定选择、来源与效果分别遵循 [Command Architecture Contract](./pa-agent-architecture-plan.md#command-architecture-contract)
和 [UI 生命周期](./pa-ui-state-rendering.md)。

| 边界 | 当前 owner 与源码 |
| --- | --- |
| 原始消息与显示版本 | [chat-view](../../src/chat/chat-view.ts) 及既有 native Markdown bridge；`onPublish` 只增强已经发布的 buffer，held 版本仍由“查看最新”控制 |
| 识别与定位 | [canvas-blocks](../../src/chat/canvas/canvas-blocks.ts) 使用 markdown-it fence/行映射；原文与显示副本分别定位 |
| 预览和局部状态 | [CanvasPreview](../../src/chat/canvas/CanvasPreview.tsx)、[mountCanvasPreview](../../src/chat/canvas/mountCanvasPreview.tsx)；React 管理专用子容器，外层 Markdown owner 负责释放 |
| 引用显示 | [canvas-resource-port](../../src/chat/canvas/canvas-resource-port.ts)；图片展示例外、当前 vault 身份及非图片 SourceAccess 边界 |
| 保存与原生打开 | [canvas-artifact-service](../../src/chat/canvas/canvas-artifact-service.ts)；插件范围共享进行中操作、真实文件事实和公开 Vault/Workspace API |
| 原消息关联 | [chat-history-manager](../../src/chat/chat-history-manager.ts)、[chat-history-store](../../src/chat/chat-history-store.ts) 的原消息窄事务；可选格式见 [Canvas types](../../src/chat/canvas/types.ts) |

## 识别、显示与生命周期

- 显式 `canvas` / `jsoncanvas` 按 JSON Canvas 校验；普通 `json` 需有明确结构证据。
  不按标题、关键词或仅有 nodes/edges 键识别；普通空对象等歧义仍显示代码。
  校验不可信输入的类型、唯一 ID、有限几何和边引用，保留合法扩展字段及未知节点占位。
- 完整闭合且有效的块才能预览。流式残缺内容不补齐、不自动修复；保存还需已完成且
  可核验的原消息绑定。按语言、正文和 occurrence 匹配原生代码块；第三方处理导致
  映射不明时保留代码，不能替换邻块。无全局 JSON processor，不增强嵌入笔记里的代码块。
- 原始 JSON 保留 CRLF/LF/CR，复制与创建不重新序列化；DOM 匹配使用宿主规范化正文。
  表格显示副本的行号不能代替原文位置。重复相同块仍拥有独立 artifact。
- HTML 节点与 SVG 连线表达已有坐标、文字、分组、背景、方向和标签；没有自动布局或
  图编辑依赖。Fit 对非空画布使用实际包围盒，空画布才使用默认范围。
- 标题、“生成时预览”、缩放/Fit/原始 JSON、可修改路径和显式打开按钮沿当前主题与
  双语文案。拖动背景、选字、缩放或操作节点不保存、不打开。窄容器保留可达按钮，
  SVG 使用独立 title/aria-labelledby；HTML viewport 的 `data-ignore-swipe` 避免宿主侧栏横滑。
- 视角、JSON 展开及路径草稿属于 view-local 状态；文件事实属于 service/history。
  无关 tick 复用 root，隐藏暂停发布并保留已有内容，显示新回复仍走既有 held 机制。
  路径草稿更新不能顺带发布 held 中的新回复。
- 失效时立即禁止迟到发布并移除隔离 buffer；已开始的原生 Markdown render settle 后
  再卸载 Component，清理迟到注册的资源。关闭释放 React root、观察器、监听器和子 owner。
  原生编辑不触发 Chat 快照主动重绘；重新挂载的引用内容明确标为当前文件，不建立媒体副本。

## 图片展示与非图片边界

按 [Data Boundary 的 B-184 例外](../product/specs/pa-data-boundary-product-spec.md#22-exclusion-is-a-hard-default)，
图片沿宿主原生能力展示，不因来源排除而隐藏。这覆盖文字图片引用、图片 file 节点、
group 本地图片背景和获准嵌入笔记内的图片；本地目标仍须为当前 vault 的真实图片 TFile。
HTTP(S)、协议相对及宿主支持的内嵌图片保留原生加载，远端图片会产生网络请求。
展示不授予 Agent 来源权限，不进入模型上下文/source receipts，不新增 provider 请求。

笔记正文、PDF/音视频和其他非图片仍在宿主展开前检查当前 SourceAccess 路径、文件及
内容边界；不能仅因写成 `![]` 就豁免。引用块和多行定义复用 markdown-it 的引用语义，
Share Card scanner 的可选输入不改变其默认 localizer。嵌套笔记保留自身 sourcePath，
递归引用与取消遵守当前 owner，拒绝时占位，不能先读后遮挡。
网页节点是 URL 卡片；iframe、字体和远端非图片媒体不自动加载。

Canvas 文字使用原生空 sourcePath，拟保存目录不重新定义其相对引用；文件字段使用
相应 Canvas 位置上下文，嵌入笔记内部使用该笔记路径。更改目标只失效实际依赖目标的
资源分支，不重读已有文字或改写 JSON。嵌套 Canvas 使用宿主仅形状 embed，不递归
建立图编辑器。Obsidian 1.14.4 的相关接线证据及版本限制见[验收记录](../archive/2026/b184-chat-canvas-preview-validation.md)。
原生 tab 内的文件、链接和编辑由 core 按自身规则处理，PA 的模型来源策略不约束 core。

## 保存与原生打开

1. 默认位置来自 `FileManager.getNewFileParent` 和捕获的来源位置。先显示实际路径并
   允许修改；不强制 `Canvas/`，不借用 Record 的保存目录，背景切笔记不改已显示目标。
2. 点击固定 artifact、原消息版本、完整原文与可见目标。新保存和恢复的路径都限于
   当前 vault 的 `.canvas`；局部协议校验补足共享路径工具，禁止 `file:` 等外部目标。
   检查目标策略、父目录及无覆盖；不隐式创建目录，竞争占用时报告冲突，不静默换路径。
3. 同 artifact 的双击/跨 view 操作共用进行中状态。先窄事务记录 pending，再公共
   `Vault.create` 一次；pending 是保存事实线索，不是权限。创建后持有真实 TFile 并
   保存关联；关联失败准确报告“已保存，关联未记录”，不重建或删除文件回滚。
4. 已打开的真实 Canvas leaf 经 `loadIfDeferred` 和 FileView 文件核验后复用，否则
   `getLeaf('tab').openFile(file)`；打开失败保留已保存事实，重试只打开。隐藏/关闭的
   view 不接收迟到打开，不抢焦点，已发生文件效果仍准确写回原记录。
5. 后续打开当前文件，绝不用旧 JSON 覆盖原生编辑。文件绑定来自真实保存/宿主核验，
   不能从模型文件名、标题、相同内容或某个 file 子节点猜测整图绑定。
6. 运行期 rename 跟随活 TFile；delete/替换使旧实例失效。跨重启路径只是当前位置
   提示，不承诺离线改名或永久身份。pending 只核实保存结果，内容相同才恢复 saved；
   不同或未知时供用户检查，不自动 create、覆盖或扫描 vault 猜测。删除聊天不删除产物。

首次创建直接保存原始 JSON；不借临时文件移动触发引用改写。以后在 Obsidian 中移动/
改名沿宿主及用户链接更新设置处理，不另建链接维护机制，也不反写 Chat 快照。

## 历史兼容与回退

assistant 的可选 `canvasArtifacts` 存 version、artifact ID、块定位，以及可选的
operationId/pending-or-saved/path/sourceHash。原 JSON 已在消息 content 中，不重复存储。
当前消息复用 host message ID；legacy 关联必须同时核验原历史绑定、assistant 正文 hash
与原 user hash，不伪造 provenance。真实持久 turn 绑定来自 ConversationPersistence，不能从可见条数推导。

字段贯通序列化、恢复、clone 与 Memory/IndexedDB/Unavailable store。窄 patch 只改
原 assistant 的关联；普通迟到整轮写入不得按 phase 覆盖新关联，assistant 身份改变时
不能继承旧关联。同会话其他轮更新不撤销原消息核验。未知/损坏版本隔离关联，不把它
当成“未保存”，不破坏正文、不复活删除的记录。TFile、DOM、权限、回调及 owner 不持久化。

Chat 关联仍是设备本地；vault 文件遵循用户既有同步。没有新 object store、依赖、后台
任务、设置页或额外发布资产。回退可停止局部增强并保留代码；已有 Canvas 和原生编辑
内容保留，不删除用户文件。验证依据和已知宿主限制见[紧凑验收记录](../archive/2026/b184-chat-canvas-preview-validation.md)。
