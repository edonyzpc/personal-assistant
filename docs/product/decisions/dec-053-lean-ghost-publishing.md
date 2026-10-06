# DEC-053 — 精简 Ghost 内容同步与人工上线

Decision ID: DEC-053
Status: Accepted
Updated: 2026-10-06
Authority: Owner 在本次 blog2ghost 讨论中确认 note 唯一内容源、同 ID 草稿覆盖、人工上线、tab URL 预览及取消恢复等范围；在明确 Ghost 编辑器深链与 API 写入的区别后，接受“新文/草稿在 Ghost Publish，已发布文章在 PA 确认更新”，并要求完整整理方案。2026-10-06 后续提出关联字段精简为一个 ID，在说明配置站点、按 ID 查询及独立预览资源边界后，要求“更新方案设计”，明确将字段命名为 GHOST_ID，并明确不要旧字段兼容。最初授权为方案与文档；同日后续要求按 SDD 设计、开发和测试，并明确 GLM 周限额后由 GPT 完成开发验证。Git、closeout 与 release 未授权；实际执行状态由 B-163 Tracker 维护。
Work item: B-163

## Context

现有流程把笔记转换、远端格式合并、完成基线、恢复记录、自动渲染探针与人工确认耦合。
Owner 在 anthelion 使用时遇到来源失效、结果未确认和 Check preview 行为难以理解，
希望只维护 Obsidian 内容，在 Ghost 查看真实页面后人工上线。

| 类别 | 依据与边界 |
| --- | --- |
| 明确要求 | note 是受管内容唯一来源；有 ID 的草稿直接覆盖；无 ID 或明确不存在才新建；查询失败解释原因；不考虑中断续接、跨设备恢复和 Undo；通过 tab 打开 URL review |
| 明确上线选择 | 新文/草稿由用户在 Ghost Publish；已发布文章保留旧版在线，经 PA 人工确认后更新原 ID，不 Unpublish |
| 明确关联收敛 | 只识别与写入 GHOST_ID，不兼容旧字段；站点来自配置，状态和链接按 ID 查询；临时预览 ID 留在 PA 内部，不替换正式 ID |
| 已核实事实 | Ghost 6.65 的 published 正文修改暂存在编辑器；普通 Admin API PUT published 更新线上内容，PUT draft 取消发布；后台深链只定位文章，不填入另一份候选 |
| 工程收敛 | 复用既有转换、图片、渲染依赖及 Ghost API；临时草稿仅隔离新版并提供真实预览 URL，移除其历史/恢复职责 |
| 证据边界 | 原始 Chat 第一次来源失效的具体事件未确定；全局时效检查的源码机制不等于该次事件的完整因果证据；新方案验收与限制以 B-163 Tracker 为准 |

## Options Considered

| Option | Benefits | Costs / risks | Disposition |
| --- | --- | --- | --- |
| 原文章改 draft 再发布 | 单 ID | 已发布旧文下线 | Owner 不接受此含义 |
| 新版直接 PUT published 原文，再打开后台 | 无临时稿 | review 前已经上线 | 不满足人工上线边界 |
| 填入 Ghost 编辑器暂存区，再由用户 Update | 所有上线按钮在 Ghost | 需要额外浏览器/编辑器集成，普通 API 不提供该能力 | 不采用；Owner 要求少开发、复用后台 |
| 临时草稿后人工搬运到原文章 | 无新集成 | 正文与摘要、封面等字段需手动搬运 | 不选为主流程 |
| 草稿直接同步；已发布文章临时预览后 PA 确认 | 复用 API、真实主题预览、旧文在线、原 ID 更新 | 已发布文章最后回到 PA；有一个预览资源需复用/清理 | Owner 接受 |

## Decision

1. 每次明确触发读取当前选定 note，生成完整受管内容；不保留 Ghost 手工正文、排版
   或受管字段，不进行历史基线比较、冲突合并或单独的“覆盖全部”确认。
2. 以配置站点和 note 唯一关联字段 `GHOST_ID` 精确查询。ID 不编码发布状态或
   公开链接；status、url、uuid、updated_at 按需读取，不回写 note。无 ID 或 Ghost 明确
   返回该 ID 不存在才创建草稿；其他查询错误停止。已有 draft 同 ID 覆盖并保持 draft；
   新建成功只回写正式 ID，不再生成/维护额外 note UID、site、post URL。
3. published 原文章保持在线。创建/覆盖一份 PA 预览草稿，用户可直接在 tab 查看真实
   Ghost URL；在 PA 点击“确认更新线上文章”后才将本次候选写回原 ID，保持 published。
   不把预览稿发布为第二篇正式文章，不执行 Unpublish。
4. 新文章和已有草稿的正式上线由 Ghost Publish 完成。复用 Ghost 的文章编辑深链，
   不开发另一套编辑器、后台或自动填表功能。
5. 自动生成字段固定为缺失的摘要、SEO 描述，以及新文章缺失的 slug；人工值优先，
   明确清空阻止补齐。其他受管可选内容缺失就清除。已有 URL、作者、访问范围、发布时间、
   模板等未纳入同步的运营信息保持。字段表由 Product Spec 唯一维护。
6. 准备形成一份当前候选，预览与确认使用这一份内容。准备后再修改 note，须再次同步
   才能纳入新版；确认不能偷偷读取并上线未预览的新内容。保留真实权限、连接、目标身份、
   取消及请求并发检查；不因无关笔记或 PA 关联属性写回导致的全局变化作废候选。
7. 取消自动渲染 probe、检查票据、预览 tab 存活/可见性门禁。打开预览不是确认动作，
   也不是确认前必须由机器记录的步骤。缺图/转换失败仍是准备错误；视觉 review 由用户完成。
8. 删除 Ghost 专用的持久操作阶段、完成基线、Undo 快照、中断/重启续接、跨桌面裁决和
   历史标签扫描。只保留 note 的正式 post ID、最小预览资源指针及当前会话候选/真实结果；
   预览指针按配置站点和原 post ID 定位 preview ID，不写入 note。
9. 预览稿重复准备可复用；更新原文章成功后清理本次 PA 草稿。清理失败不改写正式更新
   成功事实，不自动排队恢复。关闭/重启后重新准备，不承诺恢复旧候选或确认。
10. Ghost 已确认写入与本地关联回写分别报告；本地失败不能抹去远端成功。实际发送后
    丢失响应可报告“结果未确认”，停止自动重发，不盲目 POST 或把未知说成确定失败。

## Supersession And Preserved Boundaries

本决定局部接续 [DEC-045](./dec-045-ghost-blog-publishing.md) 的格式保留、自动检查、
恢复/续接、完成记录、字段补齐、关联元数据及 UI 规则（包括第 14 项的多属性要求），并接续 [DEC-051](./dec-051-proportionate-confirmation-and-contract-alignment.md)
第 6 项中的 Ghost 恢复能力。旧 Decision 与 B-153 验收保留历史含义，不能重新引入已取消门禁。

保留显式来源、Data Boundary、SecretStorage、Markdown/Lexical 可编辑内容、代码/表格、
显式嵌入、图片转存、Prism/Mermaid/数学支持、注释与重复标题/题图整理。保留全站配置
不写入、非任意脚本执行、非 newsletter、非批量/移动发布及非双向同步边界。
“note 为准”仅指约定内容字段，不扩大为站点/作者/访问控制设置管理。

## Consequences

- 正常路径只需要准备、查看预览和一次人工上线动作；draft 写入不追加确认。
- 最小预览资源指针不等于恢复任务。取消专用恢复后，不承诺网络丢失响应与进程中断下
  的全局 exactly-once；当前动作不得自动重复未知写入。
- 仅支持 `GHOST_ID`；旧关联字段不读取、不回退、不迁移、不自动清理。无 `GHOST_ID`
  按新文章处理；用户要沿用旧文章时显式填写该 ID。不要求旧 completed record。
  精确原 ID 不存在后新建成功，才允许替换失效 ID；失败不清空关联，不批量删除旧历史存储。
- 单字段以当前配置站点为边界，切站需明确重新关联；ID 不足以自动辨认旧站点，不为此
  另建多站点或隐藏的笔记历史映射。标题、标签、摘要等内容字段不在本次元数据精简范围。
- 后续实施需独立授权。若实现不满足验收，可回退该次实现变更并保留外部文章/关联；
  不通过删除文章或把旧流程重新写成当前产品要求来“回滚”。

## Revisit Trigger

Ghost 提供稳定的同 ID 隔离待发布接口；用户重新要求在 Ghost 完成全部更新操作；真实
使用明确需要恢复、多人协作或跨设备交接。仅届时讨论对应扩展，不预建支持层。

## Traceability

- [Product Spec](../specs/pa-ghost-blog-publishing-product-spec.md)
- [完整精简方案与实施边界](../../development/ghost-blog-publishing-design.md)
- [B-163 Tracker](../../development/active/lean-ghost-publishing/tracker.md)
- [B-153 历史验收](../../archive/2026/b153-ghost-blog-publishing-validation.md)
