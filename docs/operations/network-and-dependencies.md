# Network, dependencies and legal disclosures / 网络、依赖与法律说明

Updated: 2026-10-31

[English README](../../README.md) · [中文 README](../../README-CN.md)

## Original code acknowledgements / 原有代码来源致谢

These acknowledgements are retained from the previous README; they supplement the formal license and third-party notices. 以下承接旧 README 的代码来源致谢，补充正式许可及第三方声明：

- [obsidian-advanced-new-file](https://github.com/vanadium23/obsidian-advanced-new-file): `createNote`, `createDirectory`.
- [obsidian-callout-manager](https://github.com/eth-p/obsidian-callout-manager): `CalloutPreviewComponent`, `color.ts`.
- [better-word-count](https://github.com/lukeleppan/better-word-count): the `stats` package.

This page preserves detailed disclosures moved from the README. It describes current source unless a version or historical verification date is specified. The README follows current master in preparation for the next release; published packages may differ.

In stable 3.0.4, Chat image generation/editing uses supported Wan connections. Current source additionally supports the official OpenAI image adapter; its results may be returned as image bytes or downloaded from service-provided result URLs. The adapter accepts only `https://api.openai.com/v1`. Custom Chat/embedding connections do not automatically support image generation.

本页承接 README 的详细披露。除注明版本或历史核对日期的段落外，以当前源码为准；README 按当前 master 编写，为下一次正式发布准备，已发布包可能不同。

稳定版 3.0.4 的 Chat 生图／编辑使用受支持的 Wan 连接。当前源码另支持官方 OpenAI 图片适配，结果可作为图片字节返回或从服务提供的结果 URL 下载；适配仅接受 `https://api.openai.com/v1`。Custom 聊天／embedding 连接不会自动支持生图。

## English

### Network and privacy note

Personal Assistant does not upload telemetry or analytics. The old capability-usage toggle has been retired; the [local usage-event document](../operations/pa-agent-telemetry-baseline.md) is engineering background, not a current Settings instruction. By default, Statistics history is stored in local Obsidian app storage on the current device and is not uploaded by the plugin. If you enable cross-device Statistics history, the plugin creates vault-visible Statistics history files so your normal vault sync can carry them; Git users will see those files change.

| Feature | Trigger | Data sent | Destination | Background? | User control |
| --- | --- | --- | --- | --- | --- |
| Chat | You send a message | Prompt; selected note/tool context, Memory search query and excerpts when enabled; processed copies of attached images when the Chat model supports images | Configured AI provider | No | Provider, chat, Memory, and attachment controls |
| AI note tools | You run summary or note AI actions | Current note content and the generated prompt | Configured AI provider | No | User action and AI settings |
| Personal Memory learning | Memory and AI Memory Extraction are enabled and consent conditions permit | User messages used to extract useful personal context; additional vault-insight learning has its own permission | Configured Chat provider | May run after conversation turns and use credits | Inspect/correct/forget in Memory settings; disabling extraction stops new learning, not use of existing information while Memory is on |
| Memory prepare/update | First Chat while Memory is enabled and the AI provider is configured; or an approved recovery/manual action | Eligible note text and Memory search data | Configured embedding provider | First-use preparation runs in the background; manual actions block on progress; after success, changed notes may update in background | Memory on/off, Data Boundary exclusions, provider settings, and background toggle |
| Memory changed-note maintenance | Memory has been prepared and background updates are enabled | Changed note text | Configured AI provider | Yes | Memory background setting |
| Qwen web search | You enable web search for Qwen responses | Question and final prompt context | DashScope/Bailian | No | Qwen response setting |
| Featured image generation | The command prepares a source-bound Chat draft; you submit the request | Selected note text for description preparation, then image prompt and authorized image references | Configured Chat and Images connections: supported OpenAI or Wan service; result-image hosts when a URL is returned | OpenAI may return a completed image directly; asynchronous Wan tasks are polled | Inspect the draft/source, submit explicitly, and configure the image connection |
| Chat image generation/editing | You explicitly request an image or edit | Image description and authorized reference-image copies; selected note text when used to prepare the description; GET requests when completed-image URLs are returned | Configured Chat/image connections and service-provided image-result hosts | Async task status may be polled; returned image bytes or downloaded results are saved locally | Explicit request, source selection, and image connection settings |
| Share Card remote images | You open Share Card for content containing remote image references | GET requests to the referenced image URLs; the plugin does not add the note body or AI credentials to these requests | The image hosts referenced by the content, including supported image references within SVG | Resource preparation starts when the Share Card opens | User action and the content's image references |
| Pagelet discovery | You run discovery or enable its automatic preparation | Permitted anchor/source note text and optional web queries | Configured AI provider; configured supported web search | Automatic preparation may run in background | Pagelet settings and Data Boundary exclusions |
| Ghost preparation/update | You explicitly use `@blog2ghost` | Selected article and required media to Ghost; title, article text and, when choosing tags, existing Ghost tag names to the configured AI provider | Configured Ghost site and AI provider | No | Explicit workflow, desktop-local key, first publication in Ghost, and exact-candidate update confirmation |

See [image chat and storage](../guides/multimodal-chat-user-guide.md) and the [Ghost workflow](../../skills/blog2ghost/SKILL.md) for their data, storage, and publication boundaries.

Image hosts receive the requested URL, including any query parameters already present in the image reference, and normal request metadata.

The bundled LangChain dependency contains an optional tokenizer-dictionary loader for `https://tiktoken.pages.dev/js/<encoding>.json`. Personal Assistant currently estimates prompt sizes locally and does not invoke that loader in its Chat call paths. If a dependency token-counting path invokes it, it downloads the public encoding dictionary without sending prompts, note text, or AI credentials; the server still receives normal request metadata. A domain appearing in the bundle identifies a potential dependency request, not an observed request on every Chat interaction.

### Base64 usage note

Personal Assistant and its bundled dependencies use Base64 for binary transport and local asset loading: encoding processed image attachments and reference images as data URLs, reading supported inline raster images in SVG and Share Card resources, carrying bundled fonts as data URLs, and decoding the SQLite WASM binary. A local worker data-URL compatibility path also decodes Base64. Worker code and the WASM module are executable packaged assets; the SQLite integration and its dependency are described below.

Memory pagination also uses Base64url to carry JSON query state, a state fingerprint, and an offset between tool calls. These cursors may contain query filters; Base64 is reversible encoding, not encryption or a credential-protection mechanism. Dependency utilities also contain Base64 conversion/validation paths, such as binary embedding-response decoding.

### VSS SQLite/WASM dependency note

The local Memory index uses `sqlite3.wasm` from the official [`@sqlite.org/sqlite-wasm`](https://github.com/sqlite/sqlite-wasm) package, pinned to `3.53.0-build1`. SQLite stores local Memory metadata, note chunks, and embeddings. The build embeds the package's WASM binary and JavaScript loader together with PA's SQLite worker code in `main.js`; when needed, the plugin creates local Blob URLs for the worker source and decoded WASM bytes, then starts the worker. It does not download the WASM module from an external server. Preparing or updating Memory can still send note text to the configured AI provider, as disclosed above.

The WASM module imports nine functions from `wasi_snapshot_preview1`: `clock_time_get`, `environ_get`, `environ_sizes_get`, `fd_close`, `fd_fdstat_get`, `fd_read`, `fd_seek`, `fd_sync`, and `fd_write`. These provide clock, environment, and file-descriptor support through the bundled Emscripten JavaScript implementations. In PA's worker integration, file descriptors refer to the Emscripten virtual filesystem and streams; environment values are constructed by the runtime. They are not bindings to the host operating system's filesystem, environment variables, or process-launch APIs. SQLite database persistence uses a separate browser OPFS VFS in the worker. This module has no socket or process-launch imports. The WASI import names alone do not establish broader host access or a malware verdict.

Raw WASM fingerprint (verified on 2026-10-07):

| Field | Value |
| --- | --- |
| Package | `@sqlite.org/sqlite-wasm@3.53.0-build1` |
| File inside the package | `dist/sqlite3.wasm` |
| Raw byte length | `864752` |
| SHA-256 of the raw WASM bytes | `02d7e48164395fa68f81c6ec33e9da5461be397dc57602ac0cd89b4bbba1d312` |

The cached npm archive was checked against the SHA-512 integrity recorded in `package-lock.json`. Its WASM file, the installed dependency file, and the sole WASM module decoded from the local `dist/main.js` were byte-for-byte identical and had the fingerprint above. This verifies package-to-bundle byte consistency; it does not prove a reproducible build from upstream C source or identify a Community scan's module without that scan's artifact fingerprint. Recheck the fingerprint when the dependency or binary changes.

See the [SQLite WASM documentation](https://sqlite.org/wasm/doc/trunk/index.md), [Emscripten filesystem overview](https://emscripten.org/docs/porting/files/file_systems_overview.html), and [third-party notices](../../THIRD_PARTY_NOTICES.md) for provenance and licensing. Before publishing a release with this backend, review the upstream package license and release terms for your distribution scenario.

### License and commercial boundary

Starting with version `2.8.0`, the Personal Assistant client source is licensed under `AGPL-3.0-only`. Historical releases are not relicensed retroactively; previous tags and artifacts retain the license notices and metadata published with those releases. For the current release, use the exact GitHub tag, source archive, `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md` files as the source and legal reference.

Version `2.8.0` is a license and compliance migration release. It does not introduce an account system, license key, checkout flow, feature lock, hosted commercial service, or paid entitlement check. Future hosted services, support, warranty, privacy, or trademark terms may be separate, but they must not restrict AGPL rights to use, modify, and redistribute the client.

The `Personal Assistant` name, `personal-assistant` plugin ID, icons, logos, and marketplace identity are not licensed to forks by the AGPL client license. See [TRADEMARKS.md](../../TRADEMARKS.md), [NOTICE](../../NOTICE), and [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

### Mobile VSS validation note

The local VSS SQLite/WASM backend has been smoke-tested on Obsidian Desktop and Obsidian iOS with the test vault, including rebuild, refresh, reload persistence, chat, and Memory references. Android has not been fully validated on a physical device yet because no Android test device is currently available, so Android VSS support should be treated as pending verification.


## 中文

### 网络与隐私说明

Personal Assistant 不上传 telemetry 或 analytics。旧能力使用统计开关已退役；[本地使用事件文档](../operations/pa-agent-telemetry-baseline.md)作为工程背景保留，不代表当前设置入口。默认情况下，Statistics history 存储在当前设备的本地 Obsidian app storage 中，插件不会上传这些统计数据。如果你开启跨设备同步 Statistics history，插件会创建 vault-visible 的 Statistics history 文件，让你已有的 vault sync 机制同步这些文件；Git 用户会看到这些文件变化。

| 功能 | 触发条件 | 发送的数据 | 目标位置 | 是否后台 | 用户控制 |
| --- | --- | --- | --- | --- | --- |
| Chat | 你发送消息 | Prompt；启用时选中的笔记/工具上下文、Memory 查询及片段；Chat 模型支持图片时附加图片的处理副本 | 配置的 AI provider | 否 | Provider、Chat、Memory 和附件控制 |
| AI note tools | 你运行 summary 或 note AI 操作 | 当前 note content 和生成的 prompt | 配置的 AI provider | 否 | 用户操作和 AI 设置 |
| 个人记忆学习 | Memory、AI 记忆提取及同意条件满足 | 用于提取个人上下文的用户消息；额外从笔记洞察学习另有权限 | 配置的 Chat 服务商 | 可在对话后后台执行并使用额度 | Memory 设置中查看／更正／遗忘；关闭提取只停止新学习，不停止 Memory 开启时使用已有信息 |
| Memory prepare/update | 开启 Memory 且已配置 AI Provider 后的首次 Chat；或经确认的恢复/手动操作 | 符合 Data Boundary 的 note text 和 Memory search 数据 | 配置的 embedding provider | 首次准备在后台运行；手动操作显示阻断进度；成功后 changed notes 可能后台更新 | Memory 开关、Data Boundary 排除规则、Provider 设置和后台开关 |
| Memory changed-note maintenance | Memory 已准备且后台更新开启 | Changed note text | 配置的 AI provider | 是 | Memory 后台设置 |
| Qwen web search | 你开启 Qwen web search | 问题和最终 prompt context | DashScope/Bailian | 否 | Qwen response 设置 |
| Featured image generation | 命令准备带来源的Chat草稿，由你提交请求 | 用于准备描述的已选笔记文本，随后发送图片描述及获授权的参考图 | 配置的Chat与Images连接：受支持的OpenAI或Wan服务；返回图片URL时对应的结果服务器 | OpenAI可直接返回完成图片；Wan异步任务会轮询 | 检查草稿／来源、主动提交及图片连接设置 |
| Chat 图片生成/编辑 | 你明确请求生成或编辑图片 | 图片描述、获授权的参考图片副本；用笔记准备描述时的已选笔记文本；返回已完成图片URL时的GET请求 | 配置的Chat／图片连接及服务返回的图片结果服务器 | 异步任务可能轮询；返回的图片字节或下载结果保存到本地 | 明确请求、来源选择和图片连接设置 |
| Share Card 远程图片 | 你为包含远程图片引用的内容打开 Share Card | 对所引用图片 URL 的 GET 请求；插件不向这些请求添加笔记正文或 AI 凭据 | 内容引用的图片服务器，包括 SVG 内受支持的图片引用 | 打开 Share Card 时开始准备资源 | 用户操作与内容中的图片引用 |
| 拾页发现 | 你运行发现或开启自动准备 | 允许范围内的锚点/来源笔记文本，以及可选网页查询 | 配置的 AI provider；配置且受支持的网页搜索 | 自动准备可在后台运行 | 拾页设置和 Data Boundary 排除规则 |
| Ghost 准备/更新 | 你明确使用 `@blog2ghost` | 选中文章及所需媒体发送到 Ghost；标题、文章正文，以及需要选标签时的现有 Ghost 标签名发送到配置的 AI provider | 配置的 Ghost 站点与 AI provider | 否 | 显式工作流、本桌面凭据、在 Ghost 首发，以及确切候选版本的更新确认 |

图片的数据、存储与同步边界见[图片聊天指南](../guides/multimodal-chat-user-guide.md)；Ghost 的准备与正式发布边界见[Ghost 工作流](../../skills/blog2ghost/SKILL.md)。

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

来源与许可信息见 [SQLite WASM 文档](https://sqlite.org/wasm/doc/trunk/index.md)、[Emscripten 文件系统说明](https://emscripten.org/docs/porting/files/file_systems_overview.html)和[第三方声明](../../THIRD_PARTY_NOTICES.md)。发布包含该后端的版本前，需要复核上游包的许可证和发布条款是否符合分发场景。

### License 与商业化边界

从 `2.8.0` 开始，Personal Assistant 客户端源码使用 `AGPL-3.0-only`。历史版本不会被追溯重新授权；旧 tag 和旧发布包继续保留当时发布时的 license notices 与 metadata。查看当前版本的源码和法律信息时，请以对应 GitHub tag、source archive、`LICENSE`、`NOTICE` 和 `THIRD_PARTY_NOTICES.md` 为准。

`2.8.0` 是 license 与合规迁移版本，不引入账号系统、license key、checkout 流程、功能锁、托管商业服务或付费 entitlement 校验。未来托管服务、支持、质保、隐私或商标条款可以单独制定，但不得限制 AGPL 赋予用户对客户端进行使用、修改和再分发的权利。

`Personal Assistant` 名称、`personal-assistant` 插件 ID、图标、logo 和市场身份不随 AGPL 客户端许可证授权给 fork 使用。详见 [TRADEMARKS.md](../../TRADEMARKS.md)、[NOTICE](../../NOTICE) 和 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。

### Mobile VSS 验证说明

本地 VSS SQLite/WASM 后端已经在 Obsidian Desktop 和 Obsidian iOS 的测试 vault 上完成 smoke test，覆盖重建、刷新、重载后持久化、聊天和 Memory references 展示。由于当前没有 Android 实机测试设备，Android 尚未完成完整实机验证，因此 Android VSS 支持应视为待验证状态。
