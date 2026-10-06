# Ghost Blog Publishing Product Spec

Document status: Approved
Updated: 2026-10-06
Work item: B-163
Decision: [DEC-053](../decisions/dec-053-lean-ghost-publishing.md)
Authority: Owner 已接受的精简目标、行为和验收标准。接续 B-153 规格；批准不代表交付证明，执行状态和实际证据由 B-163 Tracker 维护。

## Problem And Product Outcome

把 Obsidian note 同步为 Ghost 可发布内容，自动处理转换、图片与必要渲染依赖；用户
查看真实 Ghost 页面并人工上线。Obsidian 是受管内容唯一来源，PA 不再承担格式合并、
发布历史与恢复管理。符合 [North Star](../pa-product-north-star.md) 的轻量复用和低管理负担。

## Scope

| Requirement | 目标行为 |
| --- | --- |
| B-163/REQ-01 | 复用桌面 @blog2ghost 当前笔记、路径、名称入口；本次真实目标固定，同名歧义才询问。准备授权包含必要图片上传、草稿写入与最小关联写回。 |
| B-163/REQ-02 | 笔记只以 GHOST_ID 保存正式文章关联，站点来自 PA 配置；按 ID 查询真实状态，不从 ID 推断已发布。无 ID 或 Ghost 明确确认该 ID 不存在才新建 draft；网络、鉴权、错误地址或响应无法解析不等于不存在。有 draft ID 直接覆盖并保持 draft，无历史基线前置或第二次覆盖确认。 |
| B-163/REQ-03 | 新文/已有草稿通过 Ghost Publish 上线。published 原文保持在线；另存 PA 预览草稿，PA 的明确人工确认才把本次候选覆盖到原 ID，保持 published 和原 URL；不 Unpublish，不发布预览稿。 |
| B-163/REQ-04 | 受管内容完全由当前 note 与本次生成结果决定；不保留 Ghost 手工正文/排版，不三方合并。字段按下表处理，不让 Agent 临时猜测字段归属。 |
| B-163/REQ-05 | 保留既有 Markdown→可编辑 Lexical、代码、表格、显式整篇/标题/块嵌入、图片转存、Prism/Mermaid/数学能力；保留注释、重复首 H1、题图整理。缺失/排除/循环嵌入、必要图片处理或转换失败明确报错，不静默丢内容。普通双链不展开：已发布关联转 URL，否则保留可见文字并提示。 |
| B-163/REQ-06 | 直接在 Obsidian tab view 打开 Ghost 预览 URL；后台入口复用 Ghost 编辑器深链。移除自动 probe、Check preview、检查票据和页面可见性门禁；不以点开过预览作为提交凭据。 |
| B-163/REQ-07 | 准备时固定候选；review 和确认使用同一候选。后续 note 修改通过再次同步纳入，不在确认时悄悄改发新版。真实来源权限、连接、目标身份、取消和同一目标的重复并发写仍检查；无关 vault 变化和 PA 关联回写不使候选失效。 |
| B-163/REQ-08 | note 的同步关联仅识别与写入 GHOST_ID；状态、URL、uuid、updated_at 按需查询，不写回 note。PA 内部最多保留一个对应预览资源指针，preview ID 不替换正式 ID。无 Ghost 专用持久操作阶段、完成基线、Undo 或重启/跨设备续接。新触发从当前 note 准备，不复活历史 Chat 操作。 |
| B-163/REQ-09 | 重复准备复用对应 PA 预览草稿；确认更新成功后清理该 exact draft。取消/离开不更新原文章、不建立清理队列；清理失败单独提示，不把已成功更新改成失败或再次提交。 |
| B-163/REQ-10 | 查询/准备未发送、明确远端成功、明确失败、写入结果未确认分别报告。Ghost 成功但本地回写失败仍保留真实 ID/URL 与入口；未知写入不自动重发，无可靠 ID 的未知 POST 提示到 Ghost 核实。 |
| B-163/REQ-11 | 正常卡片新文/草稿显示“打开预览”“在 Ghost 编辑”；published 候选显示“打开预览”“确认更新线上文章”。重新同步使用原触发入口或一个次级动作。取消 Continue、Restore、Replace all、独立摘要再生成与检查状态按钮；已有草稿的显式改 URL 可在 Ghost 后台完成。 |
| B-163/REQ-12 | 仅支持 GHOST_ID，不兼容、回退读取、迁移或自动清理旧关联字段。无 GHOST_ID 即未关联；需要沿用旧文章时由用户显式填写 GHOST_ID。新建成功只写回正式 ID；原 ID 精确不存在后新建成功可替换，失败不清空已有 GHOST_ID。不改正文/内容字段/其他属性，不批量删除历史存储或远端旧草稿。 |

### Association Metadata

PA 只识别和写入一个同步关联字段；标题、标签、摘要、SEO 等发布内容仍按 Field Policy 处理。

```yaml
GHOST_ID: 6ac4f4e0910d6f00010bb89b
```

- 单一目标站点来自 PA 配置。ID 只定位该站的文章，不编码站点、发布状态或公开 URL。
  每次同步查询 Ghost 的 `status`、`url`、`uuid`、`updated_at`，只用于本次操作与结果展示。
- 后台编辑入口由配置站点和 `/ghost/#/editor/post/{id}` 生成；公开链接使用 Ghost 返回的
  `url`；草稿预览按返回的 `uuid` 生成 `/p/{uuid}/`，不把 post ID 当 uuid 或公开 slug。
- 文本属性 `GHOST_ID` 是唯一关联来源。旧 `pa_ghost_post_id`、`pa_ghost`、`pa_ghost_site`、
  `pa_ghost_post_url` 不读取、不回退、不迁移、不自动清理；无 `GHOST_ID` 即按新文章处理，
  即使旧字段中有 ID 也不关联原文。用户要沿用原文时显式填写 `GHOST_ID`。
- `GHOST_ID` 存在但值非法时说明关联问题，不当无 ID 新建。创建成功才写回返回的正式 ID；
  已有 ID 未变时不重复改写。远端成功但本地 ID 回写失败按局部失败报告，不重复创建文章。
  正式关联包括新建后仍为 draft 的原稿，预览资源不属于正式关联。
- 单字段不保留站点历史，不承诺自动识别跨站复制或换站后的旧 ID。切换目标站点时，用户
  明确重新关联（清除旧 ID 后新建，或指定目标站文章 ID）；不把新站查无记录解释为旧站
  文章已删除，不增加多站点路由或隐藏的笔记关联账本。
- 临时预览稿的 ID 仅保存在 PA 内部资源指针中。note 始终关联正式文章；即使 published
  的新版预览已保存，也不把 preview ID 写入 `GHOST_ID`。

### Field Policy

| 字段 | 来源与缺失行为 |
| --- | --- |
| 标题 | 明确发布标题优先，否则文件名；不由 AI 改写标题 |
| 正文/正文媒体 | 当前 note 清理、展开、转换后的完整内容；只改导出副本 |
| 发布标签 | 仅明确配置的发布标签；缺失/空列表清除旧受管标签。PA 必要内部资源标识独立处理，不修改其他标签实体 |
| 封面 | 沿用明确 ghost.feature_image → 普通非空 feature_image → 主笔记唯一 PA 题图的来源优先级；没有候选就清除旧封面，不保留远端旧图，不从普通正文图片猜选 |
| 摘要 | 人工 ghost.custom_excerpt / 普通非空 excerpt 优先；缺失基于本次清理后内容生成；明确空/null 清除并禁止补齐 |
| SEO 描述 | 人工 ghost.meta_description 优先；缺失基于本次内容生成；明确空/null 清除并禁止补齐 |
| slug / URL | 新文章人工 ghost_slug 优先，否则生成简短英文 slug；接受 Ghost 返回的实际 URL。已有文章普通同步不改 URL；后台显式更改后按 ID 读取真实 URL 用于入口和链接，不回写 URL 属性 |
| PA 渲染注入 | 随本次内容重建 PA 管理区域，复用已兼容站点配置；保留非 PA 人工注入，不写全站配置 |
| 作者、访问范围、发布时间、主题模板及其他未管理字段 | 已有文章保持；新文用已配置/平台默认值，不因 note 缺失而清除，不扩大为运营设置管理 |

摘要与 SEO 只使用已配置文本 AI，基于本次合法来源、同语言、忠实且不补造事实；不读取
远端旧摘要作缺失补齐。生成失败共用准备失败出口，提示人工填写或再次触发；不创建
缺必需准备结果的候选，不新增自动恢复/循环重试。显式清空仍直接成功处理。

普通双链仅对本次明确链接且获准的目标，从 `GHOST_ID` 取得 post ID，在当前配置站点
核实已发布状态和真实 URL；单字段即有效，不要求目标 note 带 UID/site/URL。不读取
completed record、不外发或展开目标正文；查询失败或无法确认时保留可见文字并提示。
这一辅助链接降级与本次发布目标的查询失败停止写入分别处理。

### Non-goals

- PA 自动 Publish 新文、Unpublish、newsletter、定时或批量发布、移动发布。
- Ghost→Obsidian 双向同步、Ghost 手工正文合并、历史版本管理、Undo、跨设备交接、重启续接。
- 新编辑器、Ghost 后台替代品、浏览器自动填表、自动页面渲染验收或逐像素比对。
- 全站配置/权限管理、任意笔记脚本执行、把整篇文章变成单个不可编辑 HTML blob。
- 旧关联字段兼容/迁移、未绑定旧文章的扫描接管；明确 GHOST_ID 的更新不要求旧 PA 基线。

## User Flow And States

1. 读取本次选定 note 和已配置站点，按 ID 查询；查询失败给具体原因，不继续创建。
2. 从当前 note 转换、处理图片与字段，固定一份候选。无 ID/明确不存在新建 draft；
   已有 draft 同 ID 覆盖；published 创建/覆盖关联预览 draft。
3. 显示“草稿已保存，等待在 Ghost 发布”或“更新稿已准备，线上原文尚未被 PA 修改”。
   预览按钮直接打开 URL，不声明自动检查通过。
4. draft 用户在 Ghost Publish；published 用户在 PA 确认后，按当前目标状态和 API
   版本写回原 ID。目标已消失或不再 published 时停止旧确认，提示重新同步，不能借旧
   确认新建或把用户主动撤下的文章重新发布。预览被更改时需重新准备本次 note 候选。
5. 保存返回的真实结果，再处理关联写回/预览清理。次要失败不覆盖主要写入事实。

本次会话可呈现准备中、等待人工操作、更新中、完成或需处理问题；这些是当前执行事实，
不是新增持久恢复状态机。旧 Chat 保留结果和链接，不能在重启后恢复旧确认按钮。

| 情况 | 用户提示与下一步 |
| --- | --- |
| 连接/鉴权/查询失败 | 说明未进入文章写入，给检查站点、网络或 Admin Key 的对应建议 |
| 缺图、转换或自动字段生成失败 | 说明失败对象和原因，修正后重新同步；若已有图片上传成功，如实区分部分准备效果 |
| Ghost 保存成功、本地关联保存失败 | 给已保存文章 ID/入口及关联问题，当前动作复用已知 ID，不再次 POST |
| 发送后未收到可靠确认 | 显示“保存结果未确认”；已知 ID 可作一次只读核实，无可靠 ID 引导 Ghost 后台核实；不自动重发 |
| 更新成功、预览清理失败 | 明确更新已成功，附待清理预览入口；不回滚/重复提交，不建队列 |
| 权限撤销、取消、站点改变 | 停止后续写入，保留此前真实结果；不要笼统改报“保存结果未知” |

## Trust, Data And Authority

- 来源仍限本次选定文章、显式嵌入、图片、发布字段和受管注入；Data Boundary、排除规则
  与当前外发权限继续有效。取消全局时效误判不等于解除来源权限。
- Ghost 密钥留在桌面 SecretStorage，不进入 note、模型、预览 URL 或日志。模型仅为
  已批准文本字段生成接收本次合法文本，不接收图片二进制或 Admin 凭据。
- 人工确认绑定本次候选和原文章 ID；Agent 参数或“打开过页面”不能代替用户确认。
- note 只保存正式 post ID；预览资源指针仅定位 PA 草稿，不保存正文历史、执行阶段或确认。
  不承诺跨设备/中断下永不产生遗留草稿，不借此恢复旧扫描与补偿流程。
- 预览 URL 可被持有者访问，仅作用户入口，不放入公共正文或模型上下文。

## Acceptance Criteria

| Acceptance | 可观察通过条件 |
| --- | --- |
| B-163/AC-01 | 三种选源入口准确；无 ID/精确不存在新建 draft，普通查询错误零文章写入；已知 draft 同 ID 覆盖，无 baseline 前置。 |
| B-163/AC-02 | 正文及受管字段完全按 Field Policy；Ghost 手工内容被覆盖；缺失可选字段清除、自动字段基于本次生成、明确清空不生成、已有 URL/运营字段保持。 |
| B-163/AC-03 | published 准备/取消不改变原文章；同一预览 ID 可复用；确认后原 ID/URL 更新并保持 published；没有 Unpublish、误 Publish 预览稿或邮件发送。 |
| B-163/AC-04 | 真实 tab 可打开 Ghost 预览，后台深链定位正确；只带 post ID 的 note 也能查询状态和生成入口，公开 URL 来自响应、预览使用 uuid；无自动 probe、tab 票据或 Check preview 门禁；draft 可在 Ghost 人工 Publish。 |
| B-163/AC-05 | 确认只提交本次候选；无关 note/元数据事件和 PA 关联写回不使之失效；真实权限撤销/取消/连接变化仍阻止后续写；同目标重复点击不并发提交。 |
| B-163/AC-06 | 新增内容通过再次同步纳入；原目标状态变化、API 版本碰撞和预览被更改均明确提示，不靠旧确认改变目标或发布未 review 内容。 |
| B-163/AC-07 | 远端成功但关联回写失败仍显示真实成功和入口；未知写入不自动重发；清理失败不改写更新成功。未发送错误不称 result_unknown。 |
| B-163/AC-08 | 现有综合夹具的正文、代码、表格、显式嵌入、图片、Mermaid、行内/块级公式及可编辑性保持；无 completed record 时普通双链仍可按真实已发布关联转 URL，辅助查询失败保留文字；注释/重复标题/题图整理与来源排除仍正确。 |
| B-163/AC-09 | 只识别/写入 GHOST_ID；仅有旧字段仍按未关联新建，旧字段不迁移/修改，非法 GHOST_ID 不当无 ID 新建。精确原 ID 不存在后新建成功才替换，失败保留已有 GHOST_ID，preview ID 不混入，内容/其他属性不变。旧 Chat 不续接确认；不再写专用恢复/完成/Undo 存储，不批量清理历史数据。 |

## Open Decisions

核心产品选择已确认。具体实现复用现有组件，任何新增数据/权限/媒体边界或恢复能力须
重新讨论；不把工程偏好或旧测试要求当作本轮新增产品限制。

## Delivery Handoff

- [完整方案、职责、实施顺序与验证映射](../../development/ghost-blog-publishing-design.md)
- [B-163 Tracker](../../development/active/lean-ghost-publishing/tracker.md)：当前实施、验证与证据限制。
- [Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
- [B-153 历史验收](../../archive/2026/b153-ghost-blog-publishing-validation.md)：不得作为本修订已实现证据。
