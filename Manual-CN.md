# Personal Assistant 插件使用手册

于 2026-10-31 对照当前 **`master`** 更新，随下一次正式版交付。已安装旧版的设置可能不同，请使用对应发布版本或按[源码构建说明](./README-CN.md#安装与最少配置)操作。[English manual](./Manual.md) · [首次任务](./README-CN.md#用一篇笔记试试)

## 背景
关于笔记工具类产品我非常欣赏 Kepano 的理念 —— [File Over App](https://twitter.com/kepano/status/1675626836821409792?s=20)，我对使用 Obsidian 笔记工具有类似的思考。作为工具，Obsidian 唯一需要做的是帮助我在记录时只需要关心一件事情——记录思考，剩下的由工具本身帮我完成。因为任何一个好的记录系统都不应该耗费大量的时间去维护，一旦需要不断地「定期」维护一个记录系统，那么就违背了记录的初衷，因为记录系统维护和管理本身并不能产生太大的价值除了耗费时间，所以最理想的情况就是完全没有维护和管理，当然这是理想情况，所以我力求尽可能压缩维护管理的时间成本 —— 自动化是一个好办法。

想做好笔记的 Obsidian 用户一定期望把自己的时间花在记录和思考上，所以在使用 Obsidian 的时候大多会有类似的期望 —— **少耗费时间来做管理，多把时间花在记录和思考上**。面对这样的需求的时候，如果有一个帮助自动化完成这些管理任务的插件，那么非常有价值。

以上就是我开发 personal assistant 插件的初衷，Personal Assistant 插件是一个 Obsidian 平台的插件，它聚焦在帮你记录更多想法与灵感以及更好回顾过往记录，主要的做法就是自动化（减少交互、一键完成管理任务），同时还支持很多个性化配置以及多插件联动。

## AI Chat

### 1. 简介

Personal Assistant 在笔记库内提供 Chat。选择笔记上下文后，可围绕正在阅读的内容提问；准备 Memory 后，可找回其他允许范围内的相关材料。[首次任务](./README-CN.md#用一篇笔记试试)提供一个非敏感的小示例。

### 2. 入口

- **侧栏图标**：点击 Personal Assistant 图标打开 Chat。
- **命令面板**：搜索 `Personal Assistant: 打开PA智能体`。
- **空态设置**：选择 Qwen 中国、Qwen 国际或 OpenAI，按需填写 Token。自定义接口或模型使用 **Advanced setup**。

### 3. 配置

在 **设置 → Personal Assistant → AI 连接** 中：

1. 点击“添加默认服务”，选择 OpenAI、DashScope 中国／国际或 Custom，填写 API Key。预置会填入对应模型与地址；Custom 需补全兼容的聊天／embedding 设置。凭据使用 Obsidian SecretStorage 保存。
2. 需要修改模型或 API 地址时展开“高级设置”，完成后点“保存并设为默认”。新建 OpenAI 连接默认使用 `gpt-6.1-terra`，不会自动改写已保存连接，账户仍需具备对应模型权限。
3. 核对概览中的“聊天”“笔记检索（Memory）”和“图片”。各用途可跟随默认服务支持的能力，也可通过“按功能调整”选择其他已保存连接；“管理已保存连接”用于编辑或移除连接。

从旧设置升级时，“使用已保存的 Key”让你确认 Key 所属服务并核对保留的配置，不会发送测试请求。不要将保留的 Key 推定为其他服务商的凭据。

Chat 空态也提供标准服务商设置，“Advanced setup”会打开上述设置。保存必需配置后，Chat 显示正常建议提示。

OpenAI 连接中选定的聊天模型统一通过 Responses API 用于 Chat 和文字辅助。Custom Chat 固定使用 OpenAI-compatible Chat Completions；DashScope 沿用 SDK 兼容路径与服务参数。协议由保存的服务归属决定，模型名或在 Custom 中填写官方地址不会切换协议。协议兼容仍不代表任意模型都支持工具、图片输入、embedding，或账户具有对应模型权限。

填写凭据前，先检查“笔记与隐私 → PA 可以使用的笔记”和 Memory 设置。首次单笔记任务只需要聊天能力；笔记检索和图片生成分别有自己的服务依赖。若只想先体验选定笔记，请在发送前关闭 Memory 和拾页自动发现。Memory 默认开启，首次 Chat 可能在后台准备允许范围内的笔记，将文本发送到 embedding 服务商并使用 API 额度；本地索引不代表全部在本地处理。

Memory 为不同检索配置保留独立的本设备 profile。切换 profile 不会自动全库重建；兼容的已有索引可复用，未启用的 profile 不执行付费后台维护。更换 embedding 模型／维度可能需要准备；请查看实际状态，按需选择“准备 Memory”或“更新 Memory”。

### 4. 发送消息

- 在底部输入框输入问题，`Enter` 发送，`Shift+Enter` 换行。
- 回复逐步显示；停止按钮中断生成并保留已有回答。
- 桌面悬停消息时显示操作按钮；移动端点击消息右上角「⋯」，或长按标题、气泡留白处打开操作菜单。正文仍可长按选字。

### 5. 来源与笔记上下文

- 打开 Markdown 笔记后，可使用 Chat 的建议提示总结当前笔记、发现关联或起草内容。
- 查看实际展示的上下文、笔记路径或来源入口，并打开原笔记核对。回答看起来合理，本身不能证明使用了 Memory 检索。
- 准备或更新 Memory 后，Chat 可以查找当前笔记之外的已索引笔记。

### 6. 网页搜索与笔记操作

- 配置的服务商支持时，可在设置中开启 Web Search；可用网页结果会显示链接。
- 读取能力包括 Memory 查询、当前笔记、有限范围的笔记元数据/片段、Canvas 摘要、标签和 skill 指引。
- 当前笔记操作能力可用时，明确的新建、追加、编辑或属性更新请求可以直接执行。希望先检查时，请明确要求“先给预览”。分析、引用的指令和仅预览请求不会执行修改；目标不清或超出已有授权时仍需澄清或确认。
- 执行后核对实际结果和笔记差异。满足条件的已完成改动可撤销；若会覆盖后续编辑，撤销会停止。待处理提案或结果未知不代表已经完成。现行边界见 [DEC-051](./docs/product/decisions/dec-051-proportionate-confirmation-and-contract-alignment.md)。

### 7. Memory

Memory 还包含个人上下文，与可检索的笔记索引不同。“AI 记忆提取”在 Memory、学习开关和相应同意条件满足时，可从用户消息学习有用偏好；它可能在后台将用户消息发送到配置的 Chat 服务商并使用额度。可在 Memory 设置查看、更正或遗忘个人信息。关闭提取只停止新学习；Memory 仍开启时，已存信息可以继续使用，直到遗忘或关闭 Memory。

Memory 准备完成后，助手可以先查找来自笔记的内容再回答；输入框的 Memory 按钮显示可用、准备中或已关闭等状态。

Memory 默认开启，可在“笔记与隐私 → 使用来自笔记的 Memory”关闭，笔记索引保存在本设备。配置检索连接并发送首次 Chat 后，PA 可能不弹阻断确认，直接在后台准备 Memory；符合数据范围的笔记文本会发送给该 embedding 服务商，可能使用 API 额度。文件夹、标签及生成笔记排除规则仍生效；恢复、设置变更和手动重建等高成本路径仍会先确认。

### 8. 图片、拾页与 Ghost

- 支持视觉的 Chat 模型可回答附加图片的问题，处理副本发送给该服务商。图片生成／编辑使用“图片”用途选择的兼容连接：官方端点的 OpenAI，或已识别 DashScope 端点的 Wan。自定义 Chat 地址不会因此支持生图。上传图片或讨论 prompt 本身不会生图，详见[图片聊天指南](./docs/guides/multimodal-chat-user-guide.md)。
- 拾页发现有笔记来源的关联；“在聊天中讨论”会准备新会话，由你检查后手动发送。发现过程本身不修改笔记，操作见[拾页指南](./docs/guides/pagelet-user-guide.md)。
- 桌面显式 `@blog2ghost` 可将选中的笔记准备到 Ghost，过程中可能保存草稿或上传必要媒体。首次正式发布由你在 Ghost 完成；已有文章的更新/恢复仍需确认确切且已检查的候选版本。详见[Ghost 工作流](./skills/blog2ghost/SKILL.md)。

### 9. 常见情况

- **填写 Token 后仍显示设置提示**：等待保存完成；打开的 Chat 会随设置更新。
- **旧命令或右键插件管理消失了**：这些入口已经退役。请使用 Obsidian 自身的插件／主题设置；旧操作见[历史演示](./docs/guides/historical-demos.md)。
- **首次回答慢或 Memory 仍在准备**：检查连接和 Memory 状态。服务延迟与后台准备耗时不同，不承诺固定完成时间。

## 更新插件功能

此功能在 3.0.4 之前已退役，PA 不再注册插件更新命令。请使用 Obsidian 的社区插件设置；旧版本操作见[历史演示](./docs/guides/historical-demos.md)。

## 更新主题功能

此功能在 3.0.4 之前已退役。请使用 Obsidian 的外观设置管理主题；旧版本操作见[历史演示](./docs/guides/historical-demos.md)。

## 开关插件功能

此功能及 PA 图标的旧右键插件管理入口在 3.0.4 之前已退役。已有插件和启用状态保留，请改用 Obsidian 设置。[历史演示](./docs/guides/historical-demos.md)。

## callouts 快捷输入功能

Callout 是带类型和样式的 Markdown 引用块，例如：

```markdown
> [!info] 提示
> 内容
```

在命令面板运行“列出 callout 以快速插入”，搜索并选择样式，随后将复制的标记粘贴到笔记并填写内容。可使用 Obsidian 内置及受支持的自定义 Callout 样式；不需要模型。旧界面录制见[历史演示](./docs/guides/historical-demos.md)。

## local graph 功能

局部图谱帮助查看当前笔记与其他笔记的链接关系。打开一篇笔记，在命令面板运行“悬浮本地图谱”；需要时自行在 Obsidian 绑定快捷键。该功能使用 Obsidian 图谱能力，不需要 AI 模型。

桌面默认的悬浮展示还需要 **Hover Editor** 插件，PA 会调用其转换为悬浮窗口的命令。请启用该依赖，或在 PA 局部图谱设置中选择普通图谱展示。移动端不执行桌面悬浮转换。

设置可调整关系深度、标签、附件、近邻节点和配置折叠，并可按文件夹、类型或标签设置图谱颜色。旧布局截图和视频见[历史演示](./docs/guides/historical-demos.md)，不作为当前界面说明。

## fleeting thoughts 记录功能

随手记录使用 Quick Capture，集中浏览使用 Records Preview；旧 startup-recording 命令已退役。

### 结构化创建 fleeting thoughts 记录

运行 **PA: Quick Capture**，输入内容，核对显示的保存位置后保存。设置中可选择日记、收件箱或当前笔记。基础记录不需要模型；可选 AI 后处理默认关闭，启用后可能向配置的服务商发送记录文本。

在 PA 的“笔记模板”中配置新记录的模板，留空使用内置默认模板。模板支持内置占位符，不执行 Templater 脚本。旧 `note record` 演示不代表当前命令，见[历史演示](./docs/guides/historical-demos.md)。

### 一键预览 fleeting thoughts 记录

在 PA 设置中选择记录目录和预览数量，再运行“预览配置目录中的记录”。点击记录可回到原笔记继续编辑，不需要模型。

## 统计状态显示功能

在命令面板运行“显示统计”，查看笔记库概览、每日写作、增长和组成四种视图，不需要 AI 模型。

设置可选择默认视图、是否启用动画，以及是否跨设备同步统计历史。历史默认保存在本设备 Obsidian app storage；打开跨设备同步后会创建笔记库可见文件，交由已有同步机制处理。旧界面录制见[历史演示](./docs/guides/historical-demos.md)。

## AI 摘要与分享

- 打开笔记后运行“AI 摘要”，使用配置的 Chat 服务商完成摘要，该任务会发送笔记文本。
- “AI 题图”通过兼容图片服务生成插图，需要单独的图片配置与额度，与 Chat 图片输入不同。
- “将所选内容分享为卡片”排版选中的内容，基础文字排版不需要模型；它不是模型生图。内容中有远程图片引用时，会向对应图片服务器发起请求。

## 元数据自动更新功能

旧 frontmatter 自动更新器、命令和设置在 3.0.4 之前已退役。已有笔记属性保留。Chat 中明确授权的属性修改是另一项当前能力，遵循上文的笔记操作边界。[历史演示](./docs/guides/historical-demos.md)。

## References
1. [我的 PKM 系统](https://www.edony.ink/my-pkm/)
2. [Personal Assistant 支持 Vault 统计状态预览|Obsidian Plugin - Personal Assistant](https://www.edony.ink/personal-assistant-feature-to-display-statistics/)
3. [Obsidian callout 快捷方法](https://www.edony.ink/obsidian-callout-kuai-jie-fang-fa/)
