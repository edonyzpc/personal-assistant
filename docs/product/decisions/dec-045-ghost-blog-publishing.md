# DEC-045 — Obsidian 到 Ghost 的预览确认发布

Decision ID: DEC-045
Status: Accepted
Updated: 2026-09-28
Authority: Owner 在本次讨论中确认来源、发布流程、桌面与多桌面范围、临时预览草稿和覆盖式恢复，随后明确要求落设计文档；未授权实现。
Work item: B-153

## Context

用户在 Obsidian 写作，发布到 Ghost 时仍需调整代码高亮、Mermaid、公式和图片。
目标是把笔记一次准备成可直接发布的文章，只保留必要的预览确认，符合
[北极星](../pa-product-north-star.md)中复用原有笔记、低管理负担与可信执行的要求。

Ghost Admin API 能创建草稿、发布、更新和撤销发布；普通 PUT 会修改正式文章。
edony.ink 页面声明 Ghost 6.65。对应 v6.65.0 的预览路由将已发布文章重定向到线上 URL，
不能借原文章 Preview 暂存尚未 Update 的新版。官方文档、源码及站点配置观察见
[设计依据](../../development/ghost-blog-publishing-design.md#external-evidence)。

## Options Considered

| Option | Benefit | Cost / conclusion |
| --- | --- | --- |
| 直接用 Send to Ghost | 当前笔记转 HTML 后创建文章 | 不能承接图片上传、关联更新、渲染验证和多桌面恢复，仅作参考 |
| 原文章 Preview 承载所有修改 | 无额外草稿 | 已发布文章的链接不承载未提交版本，不满足确认前线上不变 |
| PA 独立页面预览 | Ghost 无额外文章 | 不能保证真实主题与 injection 效果，未选 |
| Ghost 临时预览草稿 | 在真实站点检查主题和渲染 | Owner 选择 A；接受 PA 自动创建、复用和成功提交后的清理 |

## Decision

1. `@blog2ghost` 支持当前笔记、路径、名称。Obsidian 是正文来源；原笔记正文和
   图片引用不因导出而改写。Ghost 可有不改变内容的格式调整，可靠对应的未变部分尽量保留。
2. 首次调用只准备 Ghost 草稿；用户在 Ghost Preview 后点击 Publish。
   更新与恢复先准备临时预览草稿，用户可在 Obsidian 网页视图或浏览器打开链接，
   回到 PA 确认后才写回原文章。正式 ID/URL 保持稳定。
3. 全站兼容配置复用，缺少的能力按文章补充；不自动修改全站设置。
   PA 只维护自己生成的注入区域，保留人工内容；使用固定验证过的渲染方案。
4. 显式嵌入展开，普通双链只转换链接或保留可见文字；图片上传到目标 Ghost。
   缺失来源、图片或关键渲染失败不能报告可发布，不通过静默丢内容完成任务。
5. 标题、标签、封面、摘要的管理规则及最小关联属性按 Product Spec；内部属性不自动公开。
   本次请求授权草稿准备、资源上传、最小关联写回；不授权发送 newsletter。
6. 首版桌面交付，支持多桌面继续更新同一篇 PA 新建文章；移动发布和旧文章接管延期。
   各桌面自行配置凭据；发布记录与必要快照可随 vault 同步，不能仅凭文章 ID 盲写。
7. 未确认的临时草稿保留并复用，提交成功后自动清理 PA 对应草稿。取消、失败、
   结果不明或发现人为接管时保留现场，不删除正式文章。
8. 首版提供「撤销 PA 最近一次更新」：预览旧版本、确认后覆盖恢复范围内的远端内容，
   无额外差异审查或自动合并步骤；Obsidian 保持当前内容。预览后版本变化则刷新再确认。
   Unpublish 是另一个动作，首版复用 Ghost 后台，不作为更新或恢复的前置步骤。

## Consequences

- 接续本次早期「发布指令直接上线」建议：最终确认点以第 2 条为准。
- 临时预览稿是实现用户已选 A 的必要资源；不是第二篇正式文章，也不自动 Publish。
- Skill 负责说明与引导，宿主负责确定性转换、凭据、受控网络副作用和确认，不能用
  Skill 文本突破现有 [Agent 权限与来源边界](../../architecture/pa-agent-architecture-plan.md)。
- 不新增通用 CMS/任务平台、双向同步引擎、任意脚本执行器或独立同步服务。
- 产品范围已批准；技术设计仍需最小可行性验证，不把文档标作实现或真实站点验收。

## Revisit Trigger

真实 Ghost/Obsidian 验证无法完成受隔离的渲染检查、预览与提交内容不一致，或所用
同步方式不能带齐快照时，先报告具体失败与影响；不得静默退化为直接上线、纯文本
预览、只支持单桌面或整篇不可编辑 HTML。扩大旧文章接管、移动端、全站设置或邮件范围须另议。

## Traceability

- [Product Spec](../specs/pa-ghost-blog-publishing-product-spec.md)
- [设计与实施验收拆分](../../development/ghost-blog-publishing-design.md)
- [Backlog B-153](../../backlog.md#下一步可执行)
