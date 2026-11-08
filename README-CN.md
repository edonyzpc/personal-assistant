<h1 align="center">Personal Assistant</h1>

<p align="center"><strong>随手记下，需要时自然浮现。</strong></p>
<p align="center">Obsidian 中的开源 AI 助手。找回旧笔记、发现新关联，<br/>把阅读与思考整理成可以保存、可以分享的成果。</p>

<p align="center">
  <a href="https://github.com/edonyzpc/personal-assistant/releases"><img src="https://img.shields.io/github/v/release/edonyzpc/personal-assistant?color=%23000000&amp;label=Version&amp;logo=tga&amp;logoColor=%23008cff&amp;sort=semver&amp;style=social" alt="最新正式版" /></a>
  <a href="https://github.com/edonyzpc/personal-assistant/releases"><img src="https://img.shields.io/github/downloads/edonyzpc/personal-assistant/total?logo=obsidian&amp;logoColor=%23b300ff&amp;style=social" alt="GitHub 发布资源累计下载量" /></a>
  <a href="https://github.com/edonyzpc/personal-assistant/stargazers"><img src="https://img.shields.io/github/stars/edonyzpc/personal-assistant?style=social" alt="GitHub Stars" /></a>
</p>

<p align="center">
  <a href="#开始使用"><strong>安装与开始使用</strong></a> ·
  <a href="#产品演示">产品演示</a> ·
  <a href="./Manual-CN.md">使用手册</a> ·
  <a href="./README.md">English</a>
</p>

> **版本说明**：本文面向当前 `master`，准备随下一次正式版交付；商店中的已发布版本可能尚无相同界面或能力。需要 Obsidian **1.11.4+**。提前体验请见[源码构建](#开发与贡献)。

## 产品演示

**从几篇旧笔记，到一篇新的作品。** 阅读时，拾页带回值得探索的关联；在 Chat 中继续整理材料，用 Writing 起草文章、CreateImage 生成配图，再保存到笔记或制作分享卡片。

<!-- PA-MEDIA:S1:START -->
<table width="100%"><tr><td align="center">
  <strong>产品主画面与演示视频 · 素材待补</strong><br/>
  旧笔记来源、图文成稿与 PA 工作区，呈现阅读积累怎样成为新作品。<br/>
  此处将放置真实界面大图及视频入口。
</td></tr></table>
<!-- PA-MEDIA:S1:END -->

想亲手试一遍？[复制演示笔记与提问](./docs/guides/reading-to-sharing-demo.md)。你也可以从下面任意一项开始。

---

## 让以前的笔记，帮助今天的思考

在 **PA Agent** 中直接说出想完成的事：比较几篇阅读笔记、寻找项目里的不同意见，或把零散材料整理成提纲。**Chat** 帮你理解眼前的内容；准备好 **Memory** 后，过去记下的材料也能参与回答，并通过实际返回的来源回到原文。

> 找出我关于“把阅读用起来”的笔记，比较其中的经验，给这篇短文推荐一个切入角度，并列出你使用的来源。

需要落到笔记里时，也可以明确请求新建、追加、编辑或更新属性。希望先检查，就说“先给预览”。

<!-- PA-MEDIA:S4:START -->
<table width="100%"><tr><td align="center">
  <strong>Chat 与 Memory · 素材待补</strong><br/>
  当前问题、来自旧笔记的不同材料、整理后的观点与来源链接。
</td></tr></table>
<!-- PA-MEDIA:S4:END -->

[Chat 与笔记操作](./Manual-CN.md#ai-chat) · [Memory 设置](./Manual-CN.md#7-memory)

## 阅读时，发现值得继续探索的联系

**拾页 Pagelet** 从正在使用的笔记出发，寻找有依据的关联。开启后台发现和主动提示后，有用的发现可以在阅读过程中轻轻浮现；你也可以运行“拾页：发现关联”主动寻找。

打开洞察、阅读来源，再选择 **“在聊天中讨论”**，把这条线索交给 PA 继续探索。准备的材料由你检查，问题由你发送。发现本身不修改笔记，也不保证每次都有新结果。

<!-- PA-MEDIA:S3:START -->
<table width="100%"><tr><td align="center">
  <strong>拾页主动洞察 · 素材待补</strong><br/>
  阅读中的真实提示、具体关联与来源，以及“在聊天中讨论”入口。
</td></tr></table>
<!-- PA-MEDIA:S3:END -->

[了解拾页](./docs/guides/pagelet-user-guide.md)

## 把想法变成作品

在 Chat 输入 **`@`**，选择要做的任务，让 PA 接着使用已有材料。

| 任务入口 | 可以完成什么 |
| --- | --- |
| **`@Writing`** | 把阅读积累写成短文，查看和修改文案版本，再确认保存为笔记。 |
| **`@CreateImage`** | 生成配图，继续编辑选定图片，选择目标笔记保存。需要对应的图片服务。 |
| **分享卡片** | 从 Chat、拾页或笔记选区制作卡片；也可在命令面板运行“将所选内容分享为卡片”。卡片排版本身不需要生图模型。 |

<!-- PA-MEDIA:S7:START -->
<table width="100%"><tr><td align="center">
  <strong>图片生成与编辑 · 素材待补</strong><br/>
  一次真实图片任务、完整生成结果，以及编辑和保存按钮。
</td></tr></table>
<!-- PA-MEDIA:S7:END -->

<!-- PA-MEDIA:S8:START -->
<table width="100%"><tr><td align="center">
  <strong>分享成果 · 素材待补</strong><br/>
  从文章摘录制作的真实分享卡片，展示文字排版与最终成品。
</td></tr></table>
<!-- PA-MEDIA:S8:END -->

Chat 也支持用图片提问；**图片理解与图片生成是两项不同能力**，分别需要支持它们的模型或连接。[图片、写作与保存指南](./docs/guides/multimodal-chat-user-guide.md)

## 随手记录，回看自己的积累

<a id="完整能力"></a>

| 想做的事 | PA 提供的工具 |
| --- | --- |
| 快速留下一个想法 | **Quick Capture** 保存到日记、收件箱或当前笔记；基础记录不需要 AI。 |
| 集中回看记录 | **Records Preview** 浏览配置目录中的记录，点击回到原文。 |
| 看见写作与笔记库的变化 | **Statistics** 展示概览、每日写作、增长与组成；不需要 AI。 |
| 整理阅读界面 | 快速插入 **Callout**、查看**局部图谱**；桌面悬浮图谱需要 Hover Editor，也可选择普通图谱展示。 |
| 为笔记补充摘要和题图 | **AI 摘要**使用聊天服务，**AI 题图**使用兼容的图片服务。 |
| 保留有用的个人上下文 | **个人记忆与风格参考**可在相应开关和同意条件下使用，在 Memory 设置查看、更正、暂停参考或遗忘。 |

使用 Ghost 写博客？桌面端的 **`@blog2ghost`** 可以准备文章草稿和媒体，需要配置 Ghost 凭据。首次正式发布在 Ghost 中完成；已有文章更新需确认已检查的版本。[Ghost 工作流](./skills/blog2ghost/SKILL.md)

[完整使用手册](./Manual-CN.md)

---

<a id="用一篇笔记试试"></a>

## 开始使用

**先了解数据与费用：** Chat 会按任务将问题及允许的笔记、图片或工具上下文发送给所选服务商。Memory 默认开启，配置后的首次 Chat 可能后台准备允许范围内的笔记；后续更新和拾页自动发现也可能使用 AI 额度。首次请求前检查 **“笔记与隐私 → PA 可以使用的笔记”**；范围规则不会自动识别敏感信息，本地索引也不代表全部本地处理。只想先试 Chat 时，可以关闭“使用来自笔记的 Memory”和拾页后台发现。

1. **安装 PA。** 在 Obsidian 的 **设置 → 第三方插件 → 浏览** 搜索 **Personal Assistant**，作者为 **edonyzpc**。[打开插件目录](https://obsidian.md/plugins?id=personal-assistant) · [查看发布记录](https://github.com/edonyzpc/personal-assistant/releases)。发布准备期的新增能力需使用上方版本说明中的对应构建。
2. **连接 AI。** 打开 **PA 设置 → AI 连接 → 添加默认服务**，选择服务、填写 API Key 并保存。先配置“聊天”即可；要检索旧笔记或生成图片时，再配置对应能力。
3. **打开一篇笔记开始。** 点击 PA 侧栏图标，或运行 **“打开PA智能体”**；选择 **“我的笔记”**，输入下面的问题。

> 这篇笔记最值得继续展开的想法是什么？给我一个今天能做的小尝试，说明依据。先讨论，不修改笔记。

没有合适的笔记，可以使用[虚构示例](./docs/guides/reading-to-sharing-demo.md)。核对回答是否用到了原文，再决定继续追问、启用 Memory，或试试拾页和创作任务。

[配置与排错](./Manual-CN.md#ai-chat) · [数据、网络与依赖说明](./docs/operations/network-and-dependencies.md)

## 常见问题

<details>
<summary><strong>需要付费吗？支持哪些 AI 服务？</strong></summary>

PA 是开源插件，AI 调用的费用由你选择的服务商和账户决定。可配置 OpenAI、DashScope 中国／国际及兼容的自定义聊天服务，并按任务选择不同连接。聊天、工具、图片理解、笔记检索和图片生成需要分别得到模型支持。

Custom Chat 使用 OpenAI-compatible Chat Completions 接口。OpenAI 图片生成／编辑只接受官方 `https://api.openai.com/v1`；Wan 使用支持的 DashScope 端点。自定义 Chat／检索兼容不代表支持图片生成。[连接设置](./Manual-CN.md#3-配置)

</details>

<details>
<summary><strong>我的笔记、图片和个人记忆会怎样使用？</strong></summary>

笔记仍保存在自己的 Obsidian 笔记库。执行 AI 任务时，允许的相关内容可能发送给配置的服务商；Memory 准备也可能发送笔记正文。图片任务会发送必要描述和所选参考图片，获取生成结果及分享卡片中的远程图片也会联网。

“AI 记忆提取”在对应开关与同意条件满足时，可从用户消息学习个人上下文并使用 Chat 额度。可在 Memory 设置查看、更正或遗忘；关闭提取不等于删除已保存的信息。数据范围、后台发现和 Memory 均有控制入口。[完整说明](./docs/operations/network-and-dependencies.md) · [Memory 控制](./Manual-CN.md#7-memory)

</details>

<details>
<summary><strong>PA 会直接修改笔记吗？</strong></summary>

讨论和拾页发现本身不修改笔记。明确的新建、追加、编辑或属性更新请求可以直接执行；想先检查时请要求“先给预览”。Writing 保存、图片保存和 Ghost 工作流各有自己的明确操作与确认步骤。支持的已完成笔记改动可撤销；如果会覆盖后续编辑，撤销会停止。[操作边界](./Manual-CN.md#6-网页搜索与笔记操作)

</details>

<a id="mobile-vss-验证说明"></a>

<details>
<summary><strong>桌面和手机都能用吗？</strong></summary>

PA 支持桌面与移动端，但各能力有独立限制：Ghost 仅桌面；移动端图谱不使用桌面悬浮转换。Memory 的历史应用验证覆盖桌面与 iOS，**Android Memory 尚未完成实机验证**。聊天历史保存在本设备，不随笔记库跨设备同步；图片输入、生成及模型兼容性按具体服务判断。[图片与同步说明](./docs/guides/multimodal-chat-user-guide.md)

</details>

<details>
<summary><strong>换检索模型需要重新准备 Memory 吗？</strong></summary>

更换模型或维度可能需要准备，但兼容的已有配置可以复用。不同检索配置保留各自的本设备索引，未使用的配置不做付费后台维护；切换本身不等于全库上传或重建。[Memory 设置](./Manual-CN.md#7-memory)

</details>

<details>
<summary><strong>语音和旧版的插件管理功能在哪里？</strong></summary>

语音仍在规划中，没有可用流程或承诺日期。旧插件／主题更新、插件启停、Memos 入口及 metadata 自动更新已退役；[历史演示](./docs/guides/historical-demos.md)保留其适用背景。

</details>

## 帮助 PA 变得更好

欢迎在 [Issues](https://github.com/edonyzpc/personal-assistant/issues) 分享**想完成什么、卡在哪里、希望怎样改善**。请不要公开 API Key 或私人笔记。如果 PA 对你有用，也欢迎 [Star 项目](https://github.com/edonyzpc/personal-assistant)。

[使用手册](./Manual-CN.md) · [更多指南](./docs/guides/README.md) · [更新记录](./CHANGELOG.md) · [BRAT 测试版](./docs/operations/brat-beta-testing.md)

---

## 开发与贡献

开发者从[开发说明](./DEVELOPEMENT.md)与[项目文档](./docs/index.md)进入。README 的方案、分镜、截图清单和占位替换方法见[素材准备指南](./docs/development/workflows/readme-media-production.md)。

<a id="安装与最少配置"></a>

<details>
<summary><strong>从当前源码构建与手动安装</strong></summary>

使用 Node.js 22 LTS、npm 10 或 11，在包含目标改动的仓库 checkout 中执行：

```sh
npm ci
npm run build
```

将 `dist/main.js`、`dist/manifest.json` 和 `dist/styles.css` 一起复制到 `<笔记库>/<配置目录>/plugins/personal-assistant/`，然后重新加载或启用插件；默认配置目录为 `.obsidian`。手动安装正式版时，使用[同一发布版本](https://github.com/edonyzpc/personal-assistant/releases)中的三个文件。旧源码或发布包不会因此获得新界面。

</details>

由 [edony](https://github.com/edonyzpc) 创建，感谢[上游项目与贡献者](./THIRD_PARTY_NOTICES.md)。客户端源码自 2.8.0 起使用 **AGPL-3.0-only**；历史版本保留原许可，PA 名称、图标及市场身份另有商标条款。

[LICENSE](./LICENSE) · [NOTICE](./NOTICE) · [第三方声明](./THIRD_PARTY_NOTICES.md) · [商标说明](./TRADEMARKS.md) · [网络与依赖披露](./docs/operations/network-and-dependencies.md)
