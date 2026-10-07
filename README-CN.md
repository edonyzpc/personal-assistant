# Obsidian Personal Assistant

<p align="center">
    <span>An Obsidian plugin which help you to automatically manage Obsidian.</span>
    <br/>
    <a href="./README-CN.md">简体中文</a>
    ·
    <a href="/README.md">English</a>
    <br/>
    <img alt="Tag" src="https://img.shields.io/github/v/tag/edonyzpc/personal-assistant?color=%23000000&label=版本&logo=tga&logoColor=%23008cff&sort=semver&style=social" />
    <img alt="Downloads" src="https://img.shields.io/github/downloads/edonyzpc/personal-assistant/total?label=下载量&logo=obsidian&logoColor=%23b300ff&style=social" />
</p>

> ***功能提示***: 拾页可以从允许范围内的笔记发现关联，供你核对来源或继续到 Chat 讨论，操作见[当前拾页指南](./docs/guides/pagelet-user-guide.md)。聊天助手也可以读取来自你笔记的 Memory。开启 Memory 并配置 AI Provider 后，首次 Chat 可以不弹阻断确认、直接在后台准备 Memory：符合 Data Boundary 的笔记文本会发送给已配置的 embedding provider，并可能消耗 API credits。你可以随时在 Settings 关闭 Memory；索引恢复、设置变更和手动重建等高成本路径仍会先确认。

> ***历史 v2.7 用户指南***: 归档的[v2.7 中文指南](./docs/archive/v2.7-user-guide.md)及[英文指南](./docs/archive/v2.7-user-guide-en.md)保留当时的工作流和视频脚本。当前仓库行为请参考[使用手册](./Manual-CN.md)与[当前指南](./docs/guides/README.md)。文档于 2026-10-06 对照仓库整理；实际安装构建提供哪些功能，仍以安装版本及发布记录为准。

> ***项目文档***: 项目需求、讨论、决策、产品/架构契约、开发 workflow、Backlog 与历史资料统一从 [项目文档导航](./docs/index.md) 进入。

## Personal Assistant 演示

> ***macOS 演示***: 展示 AI Chat 使用 Memory、理解当前笔记、生成可视化关联，以及 Pagelet 审阅工作流。
<div align="center">

https://github.com/user-attachments/assets/5420fb9a-209c-44c8-b32e-cafb8f2820a7

</div>

> ***iOS 演示***: 展示移动端 Chat、Mermaid 渲染、Featured Images 和关联发现。
<div align="center">

https://github.com/user-attachments/assets/4832e962-85da-477f-b341-0c3443b718cd

</div>

## 60 秒开始 AI Chat

1. 点击左侧 Personal Assistant 图标，直接打开 AI Chat。
2. 尚未配置 AI 时，可在 Chat 空态选择 **Qwen 中国**、**Qwen 国际**或 **OpenAI**，按需填写 API Token；若现有 Provider 配置完整、只缺 Token，PA 不会覆盖已有 URL 或模型。
3. 点击 **Start** 保存并开始。Custom endpoint/model 使用 **Advanced setup** 进入 Settings；首次打开 Settings 时仅展开 AI Provider，其他分组保持折叠，之后以你的展开/折叠选择为准。

<div align="center">
<video src="./docs/assets/featured-images-ai-generation.mp4" placeholder="personal assistant support generating featured images by AI" autoplay loop controls muted title="featured image generation"></video>
</div>

> ***AI 助手帮助管理 Obsidian***
<div align="center">
<img src="./docs/assets/Personal-Assitant-With-AI.gif" alt="personal assistant support AI"/>
</div>

> ***展示 vault 的统计数据***
<div align="center">
<img src="./docs/assets/personal-assistant-v1.3.3.gif" alt="usage video"/>
</div>

<div align="center">
<img src="./docs/assets/personal-assistant-v1.3.1.gif" alt="usage video"/>
</div>

> ***记录预览***
<div align="center">
<img src="./docs/assets/personal-assistant-v1.2.4.gif" alt="usage video"/>
</div>

> ***快速输入 callout***
<div align="center">
<img src="./docs/assets/personal-assistant-v1.3.2.gif" alt="usage video"/>
</div>

> ***自动更新 metadata***
<div align="center">
<img src="./docs/assets/personal-assistant-v1.2.0.gif" alt="usage video"/>
</div>

> ***自动更新插件、主题***
<div align="center">
<img src="./docs/assets/personal-assistant-v1.1.6.gif" alt="usage video"/>
</div>

> ***使基本使用方法示例***
<div align="center">
<img src="./docs/assets/personal-assistant-v1.1.1.gif" alt="usage video"/>
</div>

## 功能特性
> ***注意***: 当前支持的特性都是出于我个人使用 Obsdiain 的需求，欢迎提交你们期望的功能特性需求。

1. 在指定目录自动创建 note，note 名称可以格式化配置方便管理
2. 自动打开当前 note 的关系视图
3. 像 macOS 的快速备忘录一样使用 Memos 做记录
4. 在命令面板中快速开关插件
5. 自动更新插件
6. 自动更新主题
7. 自动设置关系视图的颜色
8. 聊天时使用来自笔记的 Memory，也可以选择立刻普通回答
9. 拾页从当前笔记发现关联，展示有来源的洞察，并可继续到 Chat 讨论；发现过程本身不修改笔记

## 研发

请参考[这里](./DEVELOPEMENT.md).

### Memory 准备性能说明

从 `1.6.4` 开始，重建 Memory 会把多个文件的 note chunks 汇入全局 embedding batch，并使用按服务商感知的限速策略，不再使用固定的逐文件等待。Qwen `text-embedding-v4` / `text-embedding-v3` 重建时单次最多发送 10 个 chunks，并带有 token-aware throttle 和重试进度提示。长时间运行的 Memory Notice 会实时显示扫描 notes、生成 embeddings、写入索引、等待重试和 ready 等状态。

手动 `Update memory` 当前仍保留更保守的逐文件 refresh 路径，但也会显示文件级进度，并且仍会先跳过 unchanged notes，避免无变化文件消耗 embedding。让 refresh 共享 rebuild 的全局 batch pipeline 是下一阶段的大 vault 体验优化。

### Memory 后台维护说明

在某台设备上首次后台准备成功，或经确认的恢复/手动准备成功后，后续 changed notes 可以在 Obsidian 打开期间由后台自动维护。只要本地 SQLite/WASM Memory index 已 ready，Chat 不再等待 refresh；它会先使用上一版已准备好的 Memory 回答，同时后台 reconcile/refresh 会更新 changed notes。

自动维护把 Memory embedding 数据写入设备本地 SQLite/WASM OPFS 后端，并把 VSS 维护状态写入本地 Obsidian app storage。它不会在 vault 中创建新的 `vss-index-state/`、`vss-index-state/<deviceId>/manifest.json` 或 `vss-cache/dirty.json` 文件。如果本地 Memory 暂时不可用或未准备好，助手会提示后台更新不可用，需要在本设备重新准备 Memory 后才能恢复自动维护。

### 网络与隐私说明

Personal Assistant 不上传 telemetry 或 analytics。可选的能力使用统计设置默认关闭；启用后只生成本地诊断事件，包含能力/服务商 ID、状态和耗时，不包含 prompt、笔记正文、路径、URL、凭据或模型输出，详见[本地使用事件契约](./docs/operations/pa-agent-telemetry-baseline.md)。默认情况下，Statistics history 存储在当前设备的本地 Obsidian app storage 中，插件不会上传这些统计数据。如果你开启跨设备同步 Statistics history，插件会创建 vault-visible 的 Statistics history 文件，让你已有的 vault sync 机制同步这些文件；Git 用户会看到这些文件变化。

| 功能 | 触发条件 | 发送的数据 | 目标位置 | 是否后台 | 用户控制 |
| --- | --- | --- | --- | --- | --- |
| Chat | 你发送消息 | Prompt；启用时选中的笔记/工具上下文、Memory 查询及片段；Chat 模型支持图片时附加图片的处理副本 | 配置的 AI provider | 否 | Provider、Chat、Memory 和附件控制 |
| AI note tools | 你运行 summary 或 note AI 操作 | 当前 note content 和生成的 prompt | 配置的 AI provider | 否 | 用户操作和 AI 设置 |
| Memory prepare/update | 开启 Memory 且已配置 AI Provider 后的首次 Chat；或经确认的恢复/手动操作 | 符合 Data Boundary 的 note text 和 Memory search 数据 | 配置的 embedding provider | 首次准备在后台运行；手动操作显示阻断进度；成功后 changed notes 可能后台更新 | Memory 开关、Data Boundary 排除规则、Provider 设置和后台开关 |
| Memory changed-note maintenance | Memory 已准备且后台更新开启 | Changed note text | 配置的 AI provider | 是 | Memory 后台设置 |
| Qwen web search | 你开启 Qwen web search | 问题和最终 prompt context | DashScope/Bailian | 否 | Qwen response 设置 |
| Featured image generation | 你运行图片生成 | 用于生成图片 prompt 的当前 note content，以及图片 prompt 和 task 请求 | 配置的 AI provider 和 DashScope/Bailian | 请求后会轮询 task 状态 | 用户操作和 AI 设置 |
| Chat 图片生成/编辑 | 你明确请求生成或编辑图片 | 图片描述、获授权的参考图片副本；用笔记准备描述时的已选笔记文本；获取已完成图片的 GET 请求 | 配置的 Chat/图片连接；服务返回的阿里云 OSS 图片结果 URL | 提交后可能轮询任务状态；完成后下载图片以保存到本地 | 明确请求、来源选择和图片连接设置 |
| Share Card 远程图片 | 你为包含远程图片引用的内容打开 Share Card | 对所引用图片 URL 的 GET 请求；插件不向这些请求添加笔记正文或 AI 凭据 | 内容引用的图片服务器，包括 SVG 内受支持的图片引用 | 打开 Share Card 时开始准备资源 | 用户操作与内容中的图片引用 |
| 拾页发现 | 你运行发现或开启自动准备 | 允许范围内的锚点/来源笔记文本，以及可选网页查询 | 配置的 AI provider；配置且受支持的网页搜索 | 自动准备可在后台运行 | 拾页设置和 Data Boundary 排除规则 |
| Ghost 准备/更新 | 你明确使用 `@blog2ghost` | 选中文章及所需媒体发送到 Ghost；准备元数据所用的笔记文本发送到配置的 AI provider | 配置的 Ghost 站点与 AI provider | 否 | 显式工作流、本桌面凭据、在 Ghost 首发，以及确切候选版本的更新确认 |
| Plugin/theme updater | 你运行 updater/install 流程 | Plugin 或 theme ID 以及下载请求 | GitHub 和 jsDelivr | 否 | 用户操作 |

图片的数据、存储与同步边界见[图片聊天指南](./docs/guides/multimodal-chat-user-guide.md)；Ghost 的准备与正式发布边界见[Ghost 工作流](./skills/blog2ghost/SKILL.md)。

图片服务器会收到请求的 URL，包括图片引用中已有的查询参数，以及常规请求元数据。

打包的 LangChain 依赖包含一个可选的 tokenizer 词典加载路径，目标为 `https://tiktoken.pages.dev/js/<encoding>.json`。Personal Assistant 当前在本地估算 prompt 大小，Chat 调用链不调用这个加载路径。如果依赖的 token 计数路径调用它，会下载公开的编码词典，不发送 prompt、笔记文本或 AI 凭据；服务器仍会收到常规请求元数据。打包产物出现该域名表示存在潜在的依赖请求路径，不代表每次 Chat 都实际发起请求。

### Base64 用途说明

Personal Assistant 及其打包依赖使用 Base64 进行二进制传输与本地资源加载：把处理后的图片附件和参考图片编码为 data URL，读取 SVG 与 Share Card 资源中受支持的内嵌位图，把打包字体作为 data URL 使用，以及解码 SQLite WASM 二进制。本地 worker 的 data URL 兼容路径也使用 Base64 解码。Worker 代码与 WASM 模块是随包分发的可执行资源，SQLite 集成与依赖来源见下方说明。

Memory 分页还使用 Base64url 在工具调用之间传递 JSON 查询状态、状态指纹和偏移量。这些游标可能包含查询过滤条件；Base64 是可逆编码，不是加密或凭据保护机制。依赖工具中也存在 Base64 转换或校验路径，例如解码二进制 embedding 响应。

### VSS SQLite/WASM 依赖说明

本地 Memory 索引使用官方 [`@sqlite.org/sqlite-wasm`](https://github.com/sqlite/sqlite-wasm) 包中的 `sqlite3.wasm`，固定版本为 `3.53.0-build1`。SQLite 保存本地 Memory 元数据、笔记分块与 embedding。构建时，包中的 WASM 二进制与 JavaScript 加载器连同 PA 的 SQLite worker 代码被内嵌到 `main.js`；需要时，插件为 worker 源码和解码后的 WASM 字节创建本地 Blob URL，再启动 worker，不从外部服务器下载 WASM 模块。准备或更新 Memory 仍可能向配置的 AI provider 发送笔记文本，详见上方披露。

WASM 模块从 `wasi_snapshot_preview1` 导入九个函数：`clock_time_get`、`environ_get`、`environ_sizes_get`、`fd_close`、`fd_fdstat_get`、`fd_read`、`fd_seek`、`fd_sync` 和 `fd_write`。这些接口通过随包的 Emscripten JavaScript 实现提供时钟、环境信息与文件描述符支持。在 PA 的 worker 集成中，文件描述符对应 Emscripten 虚拟文件系统与流，环境值由运行时构造，并非直接绑定到宿主操作系统的文件系统、环境变量或进程启动接口。SQLite 数据库通过 worker 中独立的浏览器 OPFS VFS 持久化。该模块没有 socket 或进程启动导入；仅凭 WASI 导入名称不能认定它拥有更广的宿主权限，也不能作出恶意软件结论。

原始 WASM 指纹（2026-10-07 核对）：

| 字段 | 值 |
| --- | --- |
| 依赖包 | `@sqlite.org/sqlite-wasm@3.53.0-build1` |
| 包内文件 | `dist/sqlite3.wasm` |
| 原始字节长度 | `864752` |
| 原始 WASM 字节的 SHA-256 | `02d7e48164395fa68f81c6ec33e9da5461be397dc57602ac0cd89b4bbba1d312` |

已按 `package-lock.json` 中记录的 SHA-512 integrity 核对缓存的 npm 发布包；包内 WASM、已安装依赖文件，以及从本地 `dist/main.js` 解码出的唯一 WASM 模块逐字节一致，指纹如上。这证明依赖包到打包产物的字节一致性，不证明从上游 C 源码进行可复现构建；缺少社区扫描产物的指纹时，也不能据此认定该次扫描中的模块身份。依赖或二进制变化后，需要重新核对指纹。

来源与许可信息见 [SQLite WASM 文档](https://sqlite.org/wasm/doc/trunk/index.md)、[Emscripten 文件系统说明](https://emscripten.org/docs/porting/files/file_systems_overview.html)和[第三方声明](./THIRD_PARTY_NOTICES.md)。发布包含该后端的版本前，需要复核上游包的许可证和发布条款是否符合分发场景。

### License 与商业化边界

从 `2.8.0` 开始，Personal Assistant 客户端源码使用 `AGPL-3.0-only`。历史版本不会被追溯重新授权；旧 tag 和旧发布包继续保留当时发布时的 license notices 与 metadata。查看当前版本的源码和法律信息时，请以对应 GitHub tag、source archive、`LICENSE`、`NOTICE` 和 `THIRD_PARTY_NOTICES.md` 为准。

`2.8.0` 是 license 与合规迁移版本，不引入账号系统、license key、checkout 流程、功能锁、托管商业服务或付费 entitlement 校验。未来托管服务、支持、质保、隐私或商标条款可以单独制定，但不得限制 AGPL 赋予用户对客户端进行使用、修改和再分发的权利。

`Personal Assistant` 名称、`personal-assistant` 插件 ID、图标、logo 和市场身份不随 AGPL 客户端许可证授权给 fork 使用。详见 [TRADEMARKS.md](./TRADEMARKS.md)、[NOTICE](./NOTICE) 和 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

### Mobile VSS 验证说明

本地 VSS SQLite/WASM 后端已经在 Obsidian Desktop 和 Obsidian iOS 的测试 vault 上完成 smoke test，覆盖重建、刷新、重载后持久化、聊天和 Memory references 展示。由于当前没有 Android 实机测试设备，Android 尚未完成完整实机验证，因此 Android VSS 支持应视为待验证状态。

## 安装

插件已经在[插件市场](https://obsidian.md/plugins?search=personal%20assistant#)上架了，现在你可以直接在 Obsidian 应用程序中安装这个插件，请查看[手册](https://help.obsidian.md/Extending+Obsidian/Community+plugins#Install+a+community+plugin)获取更多详细信息。
![install with plugin market](./docs/assets/install-within-plugin-market.png)

### 通过 BRAT 安装

- 在 Obsidian 中安装 BRAT 插件；
- 打开命令面板输入 BRAT 命令：`Add a beta plugin for testing`；
- 将字符串 `https://github.com/edonyzpc/personal-assistant` 拷贝到对话框中；
- 点击添加插件，等待 BRAT 自动下载插件文件；
- BRAT 提示安装完成之后在设置的插件页面查找安装号的插件；
- 刷新插件列表找到安装的插件；
- 使能该插件；

### 手动安装

- 通过源码编译: `npm install && npm run build` 或者直接从 [release page](https://github.com/edonyzpc/personal-assistant/releases) 下载
- 将这些文件 `main.js`, `styles.css`, `manifest.json` 拷贝到 vault 配置目录下的插件目录，通常是 `{VaultFolder}/.obsidian/plugins/personal-assistant/`。如果你的 vault 使用自定义配置目录，请使用对应配置目录而不是 `.obsidian`。

## 使用

### 1. 在指定目录自动创建 note
- 打开命令面板找到对应的命令
![command 1](./docs/assets/command-1.png)
- note 自动创建并打开，此时可以直接开始你的记录了
- 【***推荐***】使用 [Templater](https://github.com/SilentVoid13/Templater) 插件的 `Folder Templates` 配置 note 模版，从而实现目录级别的模版自定义
### 2. 在 hover 打开 memos
- 打开命令面板找到对应的命令
![command 2](./docs/assets/command-2.png)
- 开始你的 memos 之旅
### 3. 打开当前笔记的关系图
- 打开命令面板找到对应的命令
![command 3](./docs/assets/command-3.png)
- 插件的设置中有更多设置选项，包括深度、展示标签等
- 查看包括 backlink 和 outgoing-link 关系图
### 4. 开关插件
- 打开命令面板找到对应的命令
![command 4](./docs/assets/command-5.png)
- 选择你要开关的插件，该命令支持根据插件名检索
- 【***注意***】插件选择界面中，插件名前面绿色的 checkbox 代表插件已经打开，红色的 uncheckbox 代表插件已经关闭
### 5. 更新插件
- 打开命令面板找到对应的命令
![command 6](./docs/assets/command-6.png)
- 触发该命令
- 在右上角的通知窗口查看插件更新状态
