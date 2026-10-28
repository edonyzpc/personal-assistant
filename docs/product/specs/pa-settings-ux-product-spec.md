# Settings UX Product Spec

Document status: Approved
Updated: 2026-10-29
Work item: B-191
Decision: [DEC-076](../decisions/dec-076-settings-ux-and-adaptive-graph.md)
Authority: 已确认 Settings 预览的用户行为、能力保留、双语／双端要求及验收标准；批准产品方向不等于运行代码已实施或技术设计已验收。

## Problem And Product Outcome

- User problem: 配置数量与说明使用户难以判断如何开始、当前是否生效，以及在哪里调整。
- Product outcome: 常用 AI 连接配置后即可开始使用；用户能理解状态，并找到有效偏好、数据范围和管理入口。
- North Star fit: 少管理、少干扰；保留独立退出和真实状态，维持“安静且可信”。

## Authority And Preview

Owner 已确认 [交互预览](../../archive/2026/b191-settings-ux-preview.html)。
其产品锁为四组结构、行式层级、摘要与按需细节、Settings 内部详情返回、保留 Policy model、
图谱初始尺寸自适应，以及预览中仍保留的有效选项。预览只用于说明布局／流程：示例模型、
密钥状态、Memory 记录、模拟保存结果和 Obsidian 外壳不得替代真实数据／宿主 UI。

预览里管理／维护空态是示意，不能据此删除当前记录操作、遗忘保护、旧版治理恢复或
法律链接。现有权限确认、提交前不生效、网络成本告知及失败恢复继续有效。

## Scope

### In Scope

- B-191/REQ-01: 沿用四组结构，收起时提供真实、短而有用的摘要；首次只展开 AI，后续尊重已有折叠偏好。移除重复标题、无操作的未来清理占位及不适用子项。
- B-191/REQ-02: AI 连接集中对话和图片连接；保留服务商、凭据、地址、聊天／Policy／Memory 模型及支持的服务商选项。配置状态只来自已知事实，保存凭据不等于联网验证；Ghost 仍有按需配置与完整兼容选项。
- B-191/REQ-03: 使用偏好按功能组织；普通显示偏好随父项隐藏时不清空其值，既有权限撤销规则不受此保值规则覆盖。保留拾页独立控制、快速捕获三种目标及后处理、标签外观、保存建议、统计偏好与图片默认模型／数量。
- B-191/REQ-04: Memory 展示已保存偏好、当前有效状态和暂停原因；对话学习／本地学习／后台更新不互相授权。完整管理、纠正、暂停、遗忘、恢复及实际清理保持可达，常用设置与高后果维护分层。
- B-191/REQ-05: 来源界面明确全局排除、拾页额外排除、Memory 额外排除及生成笔记策略。编辑草稿与已生效范围区分，明确保存后才生效；失败保留草稿及重试，不扩大数据范围。
- B-191/REQ-06: 悬浮本地图谱初始尺寸适配所属窗口；取消手动宽高及旧值的运行作用。保留深度、显示、折叠、打开方式、多条配色规则及自动应用控制，不改变普通标签页或现场编辑能力。
- B-191/REQ-07: 设置内详情有明确返回路径，保留概览的展开／滚动及邻区草稿，恢复合理焦点。现有精确跳转与功能现场入口保持；共享编辑内容使用原保存 owner，各入口只提交自己修改的字段，保存位置、模型等不得互相覆盖。
- B-191/REQ-08: 所有新增／修改文案同时提供 zh/en，桌面与移动端均可理解和操作；适应长模型／路径、窄屏、200% 文本、键盘、触摸和深浅主题。仅展示当前平台支持的操作并解释必要依赖。

### Non-goals

- 不取消除图谱宽高外的有效设置，不更改学习、后台、联网、同步、公开范围或费用策略。
- 不重写 AI/provider、Memory/VSS、图谱算法或存储架构；不新增 router、全局 store、配置 schema 引擎、依赖或设置模式。
- 不新增向导、Test Connection、自动密钥探测、批量清理或持续窗口尺寸管理。
- 不新增持久 Memory Tab，不把设置默认项接成生成任务，不改纯文本生图的参数能力边界。
- 不重做 Obsidian 设置外壳，不在本轮要求真实模型采样、iPhone 硬件或发布。

## Information Architecture And Field Disposition

所有名称以双语词典为准；表中字段是实施定位，不向普通用户展示。

| Group / area | Existing choices and actions | Target |
| --- | --- | --- |
| AI / 对话连接 | `aiProvider`、`aiProviderPreset`、token | 预设选择、当前模型摘要、凭据管理；保留自定义配置与确认边界 |
| AI / 高级连接与模型 | `baseURL`、`chatModelName`、`policyModelName`、`embeddingModelName` | 保留，按需展开；Policy model 可独立指定 |
| AI / 服务商选项 | `qwenThinkingEnabled`、`webSearchEnabled` | 支持该能力时展示；按真实思考／联网行为命名 |
| AI / 图片连接 | `imageGenerationConnectionMode`、`imageGenerationBaseURL`、独立 token | 从保存格式移入此处；独立连接时才显示专属字段 |
| Preferences / 拾页 | `enabled`、`backgroundDiscoveryEnabled`、`petVisible`、`proactiveHints` | 独立保留；拾页关闭后隐藏无关子项，状态不冒充运行 |
| Preferences / 拾页细节 | `outputLanguage`、`petCorner`、`proactiveHintsQuietHours.*` | 角色显示才出现位置；主动提示开启才出现静默时段；时间合为一组 |
| Preferences / 快速捕获 | `enabled`、`destination`、`inboxPath`、`postProcessingEnabled` | 三目标完整保留；`daily` 是记录笔记，不冒称 Obsidian Daily Notes；收件箱路径条件展示 |
| Preferences / 提醒与外观 | `operationsProactiveSaveSuggestionsEnabled`、`tagStyleEnabled` | 准确名称；标签外观默认关闭与关闭后的主题接管不变 |
| Preferences / 统计 | `displaySectionCounts`、`countComments`、`animation`、`statisticsSyncEnabled` | 同一统计详情；统计历史同步从宽泛“同步与匿名分享”归位，保留独立控制 |
| Preferences / 图谱 | `depth`、`showTags`、`showAttach`、`showNeighbor`、`collapse`、`type`、`enableGraphColors`、`colorGroups[].query/color`、`autoColors` | 共用编辑内容，Settings 内部详情／现场 Modal；配色规则可增删和恢复默认 |
| Preferences / 图谱尺寸 | `localGraph.resizeStyle.width/height` | 唯一取消的配置；用初始自适应替代，无新开关 |
| Preferences / 图片默认偏好 | `featuredImageModel`、`numFeaturedImages` | 保留；本次生成参数仍归 Chat 使用现场 |
| Preferences / Ghost | 站点、Admin API key、`defaultVisibility`、`maxUploadBytes`、Prism/Mermaid/KaTeX profile 与兼容确认 | 桌面端按需展开；限额／渲染兼容为高级项，复用库时才出现确认；留空限额为未知 |
| Notes / Memory 与个性化 | `memoryEnabled`、`memoryExtractionEnabled`、`memoryExtractionIncludeVaultInsights`、`retrievalHabitProfile.enabled`、`memoryApprovalPolicy` | 主开关／状态／管理入口；学习与后台详情保留独立偏好和准确告知 |
| Notes / 当前理解与恢复 | 当前理解、最近变化、纠正／暂停／恢复／分享范围／遗忘／撤销；条件出现的 `memoryAutoAcceptPaused` 和旧版治理动作 | 不因示例只展示一条记录而删减；Settings 内完整管理，精确目标仍可达 |
| Notes / 来源范围 | `dataBoundary.excludedFolders/excludedTags/generatedNotePolicy`、`pagelet.excludedFolders/excludedTags/excludedPatterns`、`vssCacheExcludePath` | 集中组织但分清作用域；路径子串匹配写作“路径包含这些文字” |
| Notes / 保存与格式 | `targetPath`、`fileFormat`、`author`、`noteTemplate`、`recordIndexPath`、`previewLimits`、`pagelet.reviewsFolder`、`featuredImagePath` | 按保存对象组织；文件命名、模板、索引和预览数量留在详情；快速捕获目标不重复编辑 |
| Notes / 聊天图片 | 原图、引用、查看、清理和既有删除流程 | 从使用偏好移入管理；保留唯一入口及平台／确认边界 |
| Maintenance | Memory 更新／重建／重置／旧缓存／技术状态、`debug`、恢复与法律信息 | 依据实际状态提供操作；保留高后果确认、真实链接；移除未来清理类别占位 |

## User Flow And States

1. 常用新用户在 Chat inline setup 或 AI 组配置；可直接开始提问，不新增引导步骤。
2. 已配置用户先看服务商／当前模型／凭据事实，按需展开高级连接，或进入相关功能详情。
3. 从 Settings 进入图谱、图片偏好、Memory 等内部详情；返回后原展开、草稿、滚动和焦点保持。
   从图谱现场命令进入时保留当前工作上下文，复用同一编辑内容，不强制跳到 Settings。
4. Memory 关闭但对话学习偏好为开时，显示“偏好已开启 · 当前随 Memory 暂停”；
   Memory 开启但对话学习关闭时说明“停止新增学习”，不声称已有理解已被遗忘。
   明确关闭对话学习时仍撤销知识库结构分享；重新开启学习不自动恢复分享，需单独选择。
5. 草稿保存中／失败时不显示虚假的生效状态；权限仍按已提交事实判断。保存失败在对应区域
   保留草稿和重试，不能全页重绘丢失其他修改。
6. 图谱仅在新悬浮视图初始化时适配；保存显示选项不重设已打开窗口的尺寸。
7. 没有图片／Memory 记录时显示真实空态；恢复动作只在可执行或可解释状态下出现。

## Bilingual And Responsive Contract

| 中文 | English | Rule |
| --- | --- | --- |
| AI 连接 | AI connection | 与现有分组语义一致 |
| 使用偏好 | Preferences | 不把功能管理都堆在常用首屏 |
| 笔记与隐私 | Notes & privacy | 所有数据范围标清对象 |
| 高级与维护 | Advanced & maintenance | 技术诊断与高后果恢复按需进入 |
| 返回设置 | Back to settings | 清晰返回、恢复原入口焦点 |
| 偏好已开启 · 当前随 Memory 暂停 | Preference on · Paused while Memory is off | 分开偏好和实际状态，颜色不是唯一信号 |
| Policy model | Policy model | 两种语言均保留名称，并提供用途说明 |
| 初始尺寸自动适配当前窗口 | Initial size fits the current window | 不承诺持续跟随或记忆拖拽尺寸 |

- 中文／英文共用控件、顺序和权限语义；沿用宿主 UI 语言，不新增 PA 全局语言开关。
  拾页输出语言与 UI 语言分开，不能借翻译重置用户输出偏好。
- 复用 Obsidian 字体、颜色与布局 token，`pa-` 样式不泄漏。桌面保持行式布局；长值可占整行。
- 窄屏按内容重排，输入／选择器可以上下排列；320 CSS px 无整页横向滚动，关键模型／路径可完整检查。
  文本和控件不固定高度；移动输入至少 16px、触摸目标约 44px，200% 文本不遮挡主要动作。
- 使用一个实际滚动容器；详情页不叠加另一套固定 viewport 滚动。返回、错误、保存动作始终可达。
- Tab、Shift+Tab、Enter/Space、适用的 Escape 使用原生语义；关闭详情返回原触发入口。
- Ghost 仅桌面展示；移动图谱不提供无效悬浮选择。角色位置按真实平台能力展示。
  窄屏是布局条件，不等同于平台能力判断。

## Trust, Data And Authority

AI 连接摘要仅展示已有凭据缓存状态，不被动读取未知 SecretStorage；Ghost 编辑器沿用
现有本地凭据状态接口，只向 UI 返回状态，不返回密钥值。不发起 provider 或 Ghost
网络探测；密钥已保存或本地格式有效不等于连接已经验证可用。
首次 Memory 准备、对话学习、知识库结构分享、后台更新及 Debug 保留真实的数据／成本说明。
高后果动作延续原确认；界面归位不新增数据收集、扩大来源、伪造确认或清理历史。

## Acceptance Criteria

- B-191/AC-01: 四组和摘要可定位，首次／重开符合现有偏好；单一入口无重复编辑字段，无无效占位。
- B-191/AC-02: 高级 Policy model 与自定义连接可达；图片连接归位，切换预设不呈现矛盾配置；AI 摘要无被动密钥读取，所有连接无网络探测；Ghost 沿用本地凭据状态接口，选择与可见范围不丢失。
- B-191/AC-03: 普通偏好的父子条件真实切换、恢复后原值保持，既有撤权例外见 AC-04；后台／角色／提醒和捕获后处理不联动，三捕获目标及统计／图片默认项完整。
- B-191/AC-04: Memory 偏好开启但暂停、停止新增学习、独立本地学习、pending／failure 状态有准确表达；关闭对话学习保留既有结构分享撤权行为；完整管理／恢复动作和确认可达。
- B-191/AC-05: 全局／局部范围语义明确；生成笔记策略与来源排除均在明确保存后才生效，编辑草稿不触发保存或取消 Memory 准备；失败不扩权且可重试，一次保存不覆盖未编辑的其他范围。
- B-191/AC-06: 宽高控件消失，旧宽高不影响初始适配；常规／窄桌面窗口中图谱不越界，其他 hover 与普通 tab 不被误处理；现场编辑和配色规则完整，保存不 resize 当前图谱。
- B-191/AC-07: 详情返回、精确记录／恢复 deep link、局部刷新、关闭中异步完成均不丢草稿或复活已关闭界面；图片模型／数量与保存路径分入口保存互不覆盖。
- B-191/AC-08: zh/en key 对齐且无漏译，桌面与移动各有实际界面证据；长标签、320px、200% 文本、键盘及触摸可完成主要路径，主题与平台差异符合上述规则。

## Open Decisions

本轮产品范围没有阻塞项。其他取消候选不进入实施范围；以后明确选择时再作新决定。
已实施的状态、所有权与兼容规则见 Settings Current Status；最终验证单独保留，
文档审定与原型通过本身不代表生产验收。

## Implementation And Evidence

- [当前实现责任与兼容规则](../../architecture/settings-status.md)、[B-191 最终验证](../../archive/2026/b191-settings-ux-validation.md)。完成的 SDD／Plan／Tracker 已按文档流程吸收并移除。
- Baselines: [Simple Settings](./pa-simple-settings-product-spec.md)、[Memory Control Center](./pa-memory-control-center-product-spec.md)、[Settings Current Status](../../architecture/settings-status.md)。
- Owner 于 2026-10-28 授权开发测试及必要本地部署／双端验收，2026-10-29 授权收尾、提交 master 与推送远程；不包含版本发布。
