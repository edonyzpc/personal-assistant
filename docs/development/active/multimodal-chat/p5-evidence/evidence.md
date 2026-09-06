# B-129 P5 生产验证证据

记录日期：2026-09-06。交付状态只见 [Tracker](../tracker.md)，验收边界见
[Product Spec](../../../../product/specs/pa-multimodal-chat-product-spec.md) 与
[SDD](../sdd.md)。本目录保留本任务 Desktop 与 iOS 原始 JSON 及判读，
不包含图片字节、完整日志、私有设置或 API 凭据。

首次成功的统一 `make deploy` 退出 0，236 suites / 6101 tests 通过。当时部署与加载
的生产 `main.js` SHA-256 为
`6e0e3727ed901655ccfbc0691e6d06b184992be8bf66bf41136434c4dfd3d5ca`；
重开回执再次记录同一加载 hash 和发生变化的插件加载时间。全量日志仅留本机
`/tmp/b129-full-deploy-02.log`，没有复制到本目录。

## 服务、附件与重开

| 原始回执 | 已观察结果 | 验证边界 |
| --- | --- | --- |
| [Desktop services 01](./desktop-services-01.json) | 前 8 项通过，case 09 原始结果为 `retry_not_idempotent` | 保留失败，未改写为通过。后续只读核对确认附件字段结构相同，首返回与 Zod 重读的对象键顺序不同，runner 的 `JSON.stringify` 比较误报；修正只涉及 runner |
| [Desktop services 02](./desktop-services-02.json) | 独立新 run 11/11 通过；原件 hash、PNG/HEIC preview/provider、本机版本/turn/owner、精确正文、正式 PNG/JPEG、取消重试及重复保存一致 | 没有模型调用。重复保存分项值为 completed、附件语义相同、正文及 hash 相同。原图缺失采用受控 Vault lookup 注入，未物理删除原图；不证明完整 Chat 文案流程 |
| [Desktop attachment rules 01](./desktop-attachment-rules-01.json) | 根目录、指定目录、笔记同目录、相对子目录 4/4 通过；目标均不是活动笔记，实际嵌入链接可解析、正文/hash 与重试路径一致 | 每种规则仅一张小型合成 PNG；测试暂改宿主公开可设置的 `attachmentFolderPath`，前后均 `/` 且已恢复。不替代 iOS 验证，也不表示同步排除已配置 |
| [Reopen prepare](./desktop-reopen-prepare-01.json) | 3/3 通过；原件真实写入后注入一次 asset finalize 失败，持久记录仍 preserving；另在真实 note create 后取消，保留 partial 保存记录 | 故障点明确注入，原件和正文实际落盘；不声称发生了系统崩溃。两个故障属于不同 asset/保存操作 |
| [Reopen resume](./desktop-reopen-resume-01.json) | 2/2 通过；真实插件重载后实例变化、加载 hash 相同，启动已恢复 pending；同源重导沿用原 ID/路径且新增原图写入为 0；partial、版本和 turn 均能读取 | resume 只核对 partial 可由全局列表访问，并未代替真实 UI 继续保存。原始回执保持当时的 partial 状态 |

上述 runner 的临时 wrapper、lease 和活动会话指针均按回执恢复；没有全局清缓存、
删除原件或调用模型。四规则检查保留其公开附件设置的前后值，未复制其他设置。

随后集成负责人真实操作 More → 未完成的笔记保存 → 继续保存，完成
`b129-reopen/desktop-reopen-01/partial.md`，打开后可见正式 PNG。磁盘笔记中的
`pa_writing.state` 为 completed，并有正式附件链接。这是 resume 之后的单独
UI 观察，不回写原始回执，也不将其外推成文案生成或风格功能验收。

## Files 原件与请求入口

集成负责人通过真实文件选择入口导入 `chart-sips.heic`，在草稿中移除附件后
原件仍在。随后进行手动清理前，已用 `shasum -a 256` 只读复核，以下两个
文件的 SHA-256 均为
`88d2d594a6f6b1ffd23285c076928621033a7574a2be3270ae7543305186f5c4`：

- `test/pa-images/img_39f46d087ee24694a5c883ea42a684db.heic`
- `test/b129-p0-fixtures/chart-sips.heic`

原文件未复制进本目录。此证据证明该 Files 路径保留收到的合成 HEIC 原字节，
不外推 Photos 是否交付相册原件。

之后集成负责人从 Manage saved originals 选中该合成原件，界面显示已知引用
为 0；确认精确路径后移入回收站，原路径不再存在。
[清理后的原始回执](./original-cleanup-ui.json) 记录目标已不存在，其他受核对的
HEIC、PNG 和正式 JPEG hash 保持不变。因此上述 `img_39f...heic` 目前缺失是
这次明确的测试清理结果，不是导入或草稿移除丢失原件。“已知引用 0”仍只代表
PA 的已知引用范围，没有全库或其他 App 无引用的保证。

集成负责人还真实点击缓存清理，看到 `Unused copies cleared` 及保留原件/正式
附件的反馈；展开同步说明时可见 Obsidian Sync 需逐设备配置、Git 已跟踪文件
不因规则自动停止跟踪、iCloud 无可靠子目录排除能力。这些是 UI/说明可达证据，
不表示外部同步配置已完成。回执中的 `observer: false` 记录该快照时 observer
已关闭，不将此前 wire 中 `installed: true` 误写成仍有测试 wrapper 遗留。

| 请求入口快照 | 记录的内容 | 不可推导的结果 |
| --- | --- | --- |
| [DeepSeek wire](./wire-deepseek.json) | `deepseek-v4-flash` 共 3 个被观察请求，各有一个 JPEG 图片块 | 不是 provider 回执，不证明图片被服务端使用或正确理解 |
| [Qwen wire](./wire-qwen.json) | `qwen3.6-plus` 共 2 个被观察请求；第 1 个只有文字，第 2 个有一个 JPEG 图片块 | 不能把第 1 个请求也记作附图成功，也不能只凭第 2 个请求入口判断响应质量 |

两份 wire 都明确标记 `fetch_entry_observation`。它们记录的是进入所包裹 fetch
的请求尝试；`state: complete` 表示观测条目处理结束，**不是响应交付或 provider
确认收到**。更早捕获的 fetch 可以绕过 observer，因此计数不代表宿主全部网络
请求。快照只保留模型、块类型、文字长度、图片 MIME、字节数/hash 与检查结果，
没有请求正文、地址、认证头、图片 base64 或响应内容。

被观察的图片块为 JPEG，2,385 bytes，SHA-256
`62a5b81f07ce77caa7020479948fd530348713f9ad157280fc48e00295737160`。
记录的 EXIF、IPTC、XMP、APP13 Photoshop marker 检查均为 false；这只描述
本次 marker 检查范围，不表述为所有元数据为空。

集成负责人另在真实 Chat 界面观察到 Qwen 描述了“深绿背景”和“淡黄色方块”，
与本任务合成图片相符；对应合成回复也保留在
[人工恢复漏素材的原始记录](./recovered-missing-materials.json) 中。这是该样例
的有限视觉观察，**不是 wire JSON 内的响应证据**，也不是整体图片理解保证。
Qwen 返回带代码围栏的 JSON，按当时的 SDD 进入人工选择/编辑正文的恢复入口，未将它
当成自动验证通过的文案版本。

在这条真实人工恢复路径，生成版本显示 **Associated images (0)**；原始记录中
该版本的 `associatedImages` 及其 turn 的 `writingImages` 均为空。首次归档时该
关联缺失尚待修复与复核；后续修复证据见下节，原始失败保持不变。现有服务
runner 使用显式构造的关联图片，不能替代这条 UI 路径。真实 UI 已观察到复制
AI 正文精确匹配，编辑后 V2 标示 `Edited by you`，
回选 V1 原文不变；这些文本版本行为不抵消图片关联缺失。

Style 的四个场景字段填写并确认后，当时的旧 Memory 兼容态返回准确的兼容错误，
正文与字段保留，未建立风格记录。这是失败提示/输入保留证据，不是风格授权或
后续投影成功。用户后来批准的 I-09 安全升级见下文 DEC-030，交付与验收状态由
Tracker 承接。

## 恢复关联修复后的 Desktop 复核

后续 `make deploy` 第 3 轮的完整基线为 236 suites / 6117 tests 通过，日志
为本机 `/tmp/b129-full-deploy-03.log`。该基线构建当时未重载；之后又完成 Chat
恢复隔离的窄修，相关 Chat 202 tests、TypeScript、lint 和独立 review 通过，
重新 build / deploy-current。[实际加载身份](./i10-loaded-identity.json) 记录
新的插件实例、加载时间 `2026-09-06T11:02:16.417Z`，生产 `main.js` SHA-256 为
`cf6f686eccb01331c9c91dbf3dcfe18ca44bbc6e55c2700cf68639044ff984ed`。
下面的真实操作对应这一新实例；不将前一构建的完整 gate 描述为最后窄修后
再次运行的完整 gate。

| 追加原始回执 | 已观察结果 | 验证边界 |
| --- | --- | --- |
| [旧图重新解析与恢复](./i10-reresolve-recovery.json) | 同设备旧会话通过 `resolve_chat_images` 重新解析 PNG，后续请求入口带其 JPEG 副本；持久 assistant 恢复信息保留该图引用 | 集成负责人随后真实恢复 UI 显示 Associated images (1)、Version 3 / AI draft；JSON 快照记录的是恢复前 turn 与 wire，不伪称内含 UI 截图或恢复后版本 |
| [同轮双图恢复](./i10-multi-recovery.json) | 新聊天同轮加入 HEIC + PNG；user 与待恢复 assistant 均保留两图引用，被观察请求含两份 JPEG 副本 | 集成负责人真实恢复 UI 显示 Associated images (2)；wire 仍只有 fetch-entry 意义，不是 provider 回执 |
| [双图真实保存](./i10-multi-save.json) | 真实保存 UI 默认勾选两图；持久版本有两图关联，保存记录 completed，正式附件为 JPEG + PNG，HEIC 原件留存；打开笔记可见两图 | 原始 inline checker 的 `bodyStartsExact: false` 保留。它把长度为 6 的 frontmatter 分隔符按 7 跳过，误截了正文首字；不是产品正文改变 |
| [同一笔记的检查器复核](./i10-multi-save-verified.json) | 改用整段匹配 header 长度，`bodyStartsExact`、原件 hash、正式附件 hash、receipt final note hash 与 completed 检查均通过；`noteUnchangedSincePrior: true` | 只修正检查方法，没有修改产品或笔记。该记录与上一份必须一起判读；`styleRevisionCount: 0` 表示此版本未绑定风格，不证明完整 Memory 风格链路 |
| [双图保存后的真实重载](./i10-multi-reload.json) | 实际插件重载后新实例仍加载 cf6f，时间 `2026-09-06T11:13:27.302Z`；两图版本、completed receipt、笔记/原件/正式附件 hash 及模型设置恢复共 6 项检查通过 | 未发起新模型请求。真实 Writing versions UI 显示 1 · AI draft、Exact writing text 和 Associated images (2)；当时模型恢复为 `deepseek-v4-flash` 只证明该次持久设置恢复，不代表由该模型重新验证图片，也不是用户后续指定的当前模型 |

这一有限合成样例已实际走通“模型回复 → 人工恢复 → 两图关联版本 → 默认保存
全部图片 → 打开笔记显示 JPEG + PNG”。旧图重新解析和当轮两图的恢复引用均已
复核，不能再把此前 Associated images (0) 当作新构建的当前结果。
真实重载后版本与保存结果继续存在。Desktop 最后检查为 `dev:errors` 返回
`No errors captured`、`dev:debug off` 返回 `Debugger detached`、
`dev:mobile off` 返回 `already disabled`；不外推为所有历史执行均无错误。

上述三次取得有效文案内容的模型回复均为 fenced JSON，当时的严格协议要求人工
恢复；本地链路审查未发现自动添加围栏。用户于 2026-09-06 随后明确批准
“单个完整 JSON 代码块兼容”与 I-09 “旧 Memory 兼容态安全升级”，见
[DEC-030 生产验证后的兼容补充](../../../../product/decisions/dec-030-multimodal-chat-image-copywriting.md#2026-09-06-生产验证后的兼容补充)
及当前 SDD。这里保留的是批准前构建的实测结果，**不证明兼容修复后的自动
artifact 路径或安全升级已在新宿主构建通过**，也不据此将整体标为 Validated。

上述阶段尚无当前生产构建的真实 iOS 验收证据；本轮新增生产服务证据见下文，
旧 P0 仍只保留原平台可行性范围。用户尚未授权整体 closeout，不改变交付状态。

## 后续桌面交互补验

以下仍对应 cf6f 已加载构建，没有新的模型调用。集成负责人在双图 V1 上本地
修改正文并保留 V2，界面标示 `Edited by you`；两版的保存预览均保留两张图。
随后回选 V1，真实确认保存到 `b129-production-services/desktop-02/ui-reselected-v1-note.md`，
界面报告正文及全部图片保存完成。回执包含两版确切正文、两图引用以及 V1 的
两份 completed 保存记录；原件、正式附件与保存记录中的 final note hash 一致。

| 回执 | 已观察结果 | 边界 |
| --- | --- | --- |
| [动画失败项移除前](./final-ui-animation-before-remove.json) | 真实 Files 选择合成动画 GIF；界面提示提供静态 PNG/JPEG、保留原件并显示移除/从 Files 添加入口，原件 hash 与 fixture 一致 | 真实界面仍显示已有测试文字；此初版只读采集器选中了容器而非 textarea，JSON 没有 `ui.draft` 字段，不能用缺失字段证明草稿内容。原回执不改写 |
| [动画失败项移除后](./final-ui-animation-after-remove.json) | 真实移除失败项后，正文仍为 `B129 恢复验证：保留这段文字。`，失败入口消失且 Ask 恢复可用；原件仍在，所有正式文件 hash 未变 | 采集器改为读取实际 textarea；没有重新导入或重新生成文案。两份记录一起证明这次失败与移除路径 |
| [缓存清理后](./final-ui-cache-cleared.json) | 真实点击清理后，持久处理副本为 0 项，原件、两份正式图文笔记和附件 hash 均未变 | 该快照只证明清理结果；后续重建与删除聊天另有以下回执 |
| [预览缓存重建后](./final-ui-cache-rebuilt.json) | 真实 UI 再次预览后，持久副本重建为 2 项 preview JPEG，分别为 128 × 80 / 2,385 bytes 和 640 × 480 / 32,157 bytes；原件及正式文件仍在 | 证明这两张合成图的本机预览重建，不外推 provider/note 副本或其他格式 |
| [删除合成聊天前](./final-ui-cleanup-before.json) → [删除后](./final-ui-cleanup-after.json) | 真实 UI 删除确切的双图合成聊天，确认会话不存在；按删除前预登记清单复核 9 个文件均存在且 hash 不变，包括两份笔记、正式附件、HEIC/PNG 原件和动画 GIF | 删除后回执绑定删除前回执的 SHA-256，未从删除后的空保存记录推导文件安全；仅覆盖这份明确清单，不声称全库扫描 |

之后原图管理的重复说明检查确认只有同步指引，缺少约定的 provider 图片可见
内容说明；按 I-11 修复，修复后的宿主证据另行记录。继续操作时检测到用户
切换到设置并把 Chat/Policy 模型改为 `qwen3.8-max`，暂停了 UI 操作。2026-09-06
用户明确指定使用阿里云百炼的 `qwen3.8-max`，并告知 DeepSeek 不支持图片；后者
属于用户提供的信息，不是从模型自述或下面的离线夹具推出的能力结论。

后续用于恢复检查的临时切换模型操作被自动审批拒绝；更早已获允许的 `setValue`
随后延迟生效，使设置短暂变为 DeepSeek。集成负责人已通过真实设置 UI 恢复，
并用 CLI 与磁盘设置复核 Chat/Policy 均为 `qwen3.8-max`。这里区分审批拒绝、
延迟生效和实际恢复，不把拒绝记为切换已执行；用户指定的模型设置已保留。
最后错误捕获为空，debugger 与 mobile emulation 均已关闭。

## 离线能力错误与草稿保留

[Desktop 离线 SDK 回执](./capability-offline-desktop-01.json) 对应同一 cf6f 构建，
安装时动态读取的模型为 `qwen3.8-max`。本地 transport 向真实 SDK 返回一次
HTTP 400 图片不支持错误，生产能力缓存变为 `unsupported`；记录为
`fetchAttempts: 1`、`matchingUnsupportedResponses: 1`、`networkDelegations: 0`。
没有向真实 provider 转发请求，因此**不证明 Qwen 不支持图片**。

错误前后的草稿均为 69 字符，文字 SHA-256 同为
`ae01b8564d01b06e8aa066755420db53e145442e9f073dfeb4fb70a1f82045a7`；
同一张图的 asset ID、content hash、ordinal 和 ready 状态保持一致，
`draftUnchanged: true`。卸载前已确认生产 Chat 终态、无队列或 in-flight 请求，
卸载后记录 `manually_uninstalled`，没有保留 transport wrapper。

原始回执顶层 `state: inspect_response` 的临时说明仍称 UI 操作未能确认提交，
与其内层已记录的一次匹配 400 响应矛盾；原文逐字保留，不据此抹掉实际 SDK
错误与草稿快照。集成负责人随后在真实 UI 看见 YOU 中的该合成请求，ASSISTANT
显示 `Answer failed / The answer did not finish`，composer 保留相同文字与 PNG，
Ask 为 disabled，补足了该次提交和失败后输入保留的观察。未捕获瞬时切换模型
通知，故不声称已验证该通知，也不把这次离线失败路径当作真实 provider 能力或
切换后恢复发送的完整验收。

## 兼容增量构建与加载

I-09 安全升级和 I-12 单个完整 JSON 代码块兼容完成后，统一验证为 lint、
build、platform guards 与 238 suites / 6199 tests 通过，进程均退出 0。
完整日志保留本机 `/tmp/b129-compat-final-{lint,build,tests}.log`。
[新构建加载回执](./compat-final-load.json) 记录 Desktop 实际加载 SHA-256
`f27e9407b31bd4cdc1c5d7f20f348b5f8490d03c53fd9c7db82b2433b6b51100`，
加载时间 `2026-09-06T12:54:58.497Z`，Chat/Policy 均为 `qwen3.8-max`。
升级入口存在，实际旧设备仍为兼容模式；该回执不证明已经升级。
同一构建的四份资产已复制并逐字节核对 iCloud test 目标，但尚无此次 iOS
实际加载或触控通过证据。Desktop `dev:errors` 返回 `No errors captured`；
随后 CUA 桌面连接超时、Mirroring 点击返回 `noWindowsAvailable`，这些操作通道
失败不作为插件正确性结论。剩余验收及恢复操作以 Tracker 为准。

[升级预检首次回执](./compat-upgrade-desktop-01.json) 在读取前置快照时返回
`MemoryGovernancePersistenceError`，事件列表为空，没有调用公开升级动作，
也未安装 observer。随后一次只读 repository.initialize 返回
`Cannot set properties of null (setting 'onupgradeneeded')`，当时原因待诊断；不能把
这次预检阻塞记为升级成功或完整的失败后资料 hash 保留验收。

### I-13 存储修复与 I-09 后续预检

上述初始化错误后来定位为临时活动窗口的 IndexedDB factory 在 Settings 关闭后
失效，I-13 改用稳定 realm 的工厂，没有清库或重建用户资料。修复后的完整
238 suites / 6202 tests 通过，构建 SHA-256 为
`aa9cb8e11e01cb6d7a3243419003ce08f1ff14e7eaf084b0873c72f8da93cbdb`。
集成负责人核对 Desktop test 实际加载于 `2026-09-06T13:22:27.267Z`，独立
b129-style-test 加载于 `2026-09-06T13:21:28.355Z`；关闭 Settings 后，两库
真实 repository.initialize 均成功。这里记录宿主存储入口恢复，不提升为风格
生命周期或自动文案版本验收。该阶段 iCloud 仍为前述 f27e 副本，实际 iOS 加载未证实。

[升级预检 Desktop 02 原始回执](./compat-upgrade-desktop-02.json) 在 aa9cb 下完成
前置读取并调用公开升级动作一次，实际结果为 `safely_refused`，原因
`legacy_projection_mismatch`。完整原始 Profile、兼容字段与治理状态的前后 hash
均不变；迁移身份及原回滚期限保留，observer 已恢复。回执明确没有发生受 lease
保护的升级提交，不把安全拒绝算作升级成功。

后续定位确认这次拒绝来自升级实现比较了错误对象；**不是
旧资料损坏的证据**。原始错误文案与拒绝原因不改写，后续修复也不属于上述
aa9cb 构建的已验证结果。

此比较对象错误已完成最小修复，25 项直接测试、TS/scoped lint 和独立 review
通过。新构建 SHA-256 为
`2f0f5ca48a938239fdb38ddabf4653368c0fbc4a2ff99283eae75a0016e1b68a`，
Desktop test 实际加载于 `2026-09-06T13:39:57.952Z`；iCloud test 的四份资产
已复制并逐字节核对一致。这里只复用 aa9cb 的 238/6202 完整基线，未在 2f0f
再次运行全量；实际 iOS 加载依据下文后续同步回执，独立于文件一致性核对。

[升级预检 Desktop 03 原始回执](./compat-upgrade-desktop-03.json) 对应 2f0f：
公开动作仅调用一次，结果为 `safely_refused / profile_evidence_unsupported`。
完整原始 Profile、兼容字段与治理状态前后不变，正确保留旧模式；原迁移身份及
回滚期限不变，observer 已恢复。此次没有发生升级提交，不证明成功升级的宿主
路径，也不将证据不足解释成资料损坏。

### 本轮主路径验证的停止点

真实 Qwen 验证的原始回执仅留本机 `test/b129-qwen-artifact/qwen-01/receipt.json`
与 `qwen-02/receipt.json`，不复制大段事件。qwen-01 因探针设置浅拷贝错误而
在实际请求前停止，外发 0 次。修正后的 qwen-02 唯一物理请求为 HTTP 200，
携带合成图的 JPEG 副本，首轮状态 completed；后续模型配置被探针的一次预算
挡下，首轮正文没有保留。该结果仅提供部分链路证据，**不能据此判定产品失败，
也不能宣称自动 artifact 成功**。fetch 已恢复、用户设置不变；本轮不再请求。

集成负责人于 13:41 在真实 iPhone 点击侧栏成功，确认 Obsidian vault 为 test。
Safari 第二次生产 Console 粘贴并按 Return 后，CUA 一度没有显示 history 或
sentinel、输入画面为空；随后同步回执证实该次已实际执行成功，先前画面属于
延迟，不能继续记为 iOS 服务缺证据。未再执行新的 Console 或重做 P0。

| iOS 原始回执 | 已观察结果 | 边界 |
| --- | --- | --- |
| [综合结果](./ios-combined-result-01.json) 与 [生产 wrapper](./ios-production-01.json) | 实际 iOS 加载 2f0f，时间 `2026-09-06T13:45:42.178Z`；生产组合检查 passed | 证明该次真实 WKWebView 执行与加载身份，不是 CUA 空画面的推断 |
| [生产服务](./ios-services-01.json) | 11/11 通过，涵盖 PNG/HEIC 原件与处理副本、版本/历史、正式附件、真实 note-create 后取消与重试、原件缺失拒绝及 hash 保留 | 服务级调用；缺失来源为受控注入，不冒充真实删除、Files 触控或保存 UI |
| [相对附件目录](./ios-relative-01.json) | 1/1 通过，实际正式附件遵循相对子目录规则 | 单项生产附件规则，不重复 Desktop 四规则矩阵 |
| [安全升级](./compat-upgrade-ios-01.json) | `safely_refused / profile_evidence_unsupported`，原始 Profile、兼容字段、治理状态、迁移身份和回滚期限保留，observer 恢复 | 所有保数据检查通过；没有升级提交，不证明成功升级 |

此前准备阶段的独立风格 server 已卸载且请求为 0；随后同一现有夹具用于下文
最小闭环，不把这条历史快照当作最终请求数。当前 test 的 Chat/Policy 均为
`qwen3.8-max`，探针 fetch 与设置恢复已只读复核。收敛原则及交付状态见 Tracker，
不把历史记录差异逐条转成新任务。

### 自动文案 V1 与最小风格闭环

[自动 V1 原始快照](./style-ui-01-before.json) 对应独立 b129-style-test 的 2f0f
实例，加载时间 `2026-09-06T13:59:14.976Z`。集成负责人实际在 Chat UI 发送，
本地真实 SDK 回复后自动产生一个持久文案版本；快照核对正文 hash、AI draft
来源、turn 对应版本、无 recovery，且使用和登记的风格均为 0。该次夹具请求为
1 次。UI 手势来自独立 CUA 观察，JSON 是随后真实生产记录的只读核对；本地
合成回复不证明远程 provider 质量或完整视觉文案效果。

[风格闭环原始回执](./style-final-loop.json) 复用上述版本，没有新建历史或版本、
替换来源 reader 或直接写 IDB。明确调用生产 remember 后登记所选版本/hash
对应的 claim、revision 和 action；新增第 1 次本地 ChatService/SDK 请求注入
该 revision，实际样例 hash 匹配。生产 pause 成功后，新增第 2 次相同场景请求
不再注入任何风格，请求文本中也不含被观察的旧样例；两次均正常 stop 并产生自动
artifact。这里检查的是请求内的样例；夹具固定回复相同正文，不拿回复文字
是否变化作为风格生效证据。

本轮新增请求严格为 2 次本地调用，无远程转发；remember/pause 是生产服务
动作，**没有验证点击对应 UI**。结束后夹具已卸载，自动提取关闭、consent
paused，未自动开启提取。异场景、当前要求覆盖、纠正/恢复/Forget 与自动提取
准入分支复用已有源码回归，不声称这两次请求覆盖全部治理动作。T-03～T-13
按实现和服务验收收口，实际 UI 证据与明确边界由 T-14 汇总。

### I-14 移动草稿布局

iOS 已通过真实 Files 选中 `chart-sips.heic` 并显示 preview，发现草稿行受按钮
挤压。修复仅涉及 CSS 的行布局与 hidden 规则，build/diff 通过，已执行
deploy-current / deploy-icloud-current。main 保持 2f0f，styles SHA-256 为
`a5998eba0c6fd0f027eb1e68f2d2d132f955a0daa6c9ad94d642fd7b863c50b2`。
iOS 于 `2026-09-06T14:28:02.215Z` 读取到该新 CSS 文件；重载前的真实界面
中，按钮虽 hidden=true，computed display 仍为 inline-flex、height 为 44，
直接证实旧界面的覆盖问题，见[布局修前回执](./b129-ios-layout-before.json)。
实际重载并重新从 Files 加入同图后，[布局修后回执](./b129-ios-layout-after.json)
于 `2026-09-06T14:31:13.369Z` 记录 hidden 按钮 display=none、height=0；
filename 为 277.1875×19、status 为 329.1875×32、remove 为 44×44，实际截图
可操作，I-14 布局通过。

同次回看另发现原件重载后预览不可显示：img complete=true、naturalWidth=0，
来源为 blob。此问题随后由 I-15 定位并修复；I-14 的 CSS 修改没有改变 JS，
不将缓存问题归因于该布局修复。

### I-15 缓存恢复与最终 iOS 保存

[原始诊断](./ios-preview-diagnostic.json) 记录缓存 Blob 元数据仍在，但读取字节
抛出 `NotFoundError`，原件未受影响。窄修将不可读缓存按 miss 处理，只从重新
校验通过的原图重建副本。新增 2 项回归、该 suite 25 tests、TS/scoped lint/diff、
独立 review、build 与两目标部署通过；复用 aa9cb 的 238 suites / 6202 tests
完整基线，没有在最后 SHA 重跑全量。最终 Community 源码扫描无匹配，通过。

最终 main SHA-256 为
`327f06e05c89e7997c826a70cc6b6d97876c993cc908f4312644bd9a35521d0b`。
iOS 于 `2026-09-06T14:40:44.977Z` 实际加载，[Desktop 加载回执](./cache-recovery-desktop-loaded.json)
记录 `14:41:10.958Z`。同一 PNG+HEIC 会话预览恢复可见；最终真实 iOS 重载于
`14:43:44.871Z`，[重载后的预览回执](./cache-recovery-ios-preview-final.json)
在 `14:44:20.951Z` 记录 PNG 自然尺寸 320×180、HEIC 640×480，均完整解码。

集成负责人实际完成 iOS Chat→Writing versions→AI draft 关联两图→默认全选
→Preview→Save exact→打开新笔记，JPEG+PNG 均可见。
[最终保存回执](./ios-ui-save-final.json) 的 8 项检查全部通过：保存完成、沿用
所选版本、正文 hash 相同、默认两图、正式 PNG/JPEG、全部来源与正式附件 hash
匹配、正式附件位于 pa-images 外，以及移除草稿后合成 HEIC 原件仍保留。
UI 操作为实际观察；回执中的 Markdown/hash 核对来自同步后的 iCloud 文件，
不冒充设备 IDB 检查；重载后显示由上述独立 DOM 回执证明。本段保存与重载
没有新增模型请求。

上述证据完成 T-14/T-15 的首版限定验收。远程模型质量、最低旧版本实际安装、
每种输入手势未穷举，以及风格 remember/pause 为服务调用而非 UI 点击，继续
作为验证边界保留，不新增矩阵或执行任务。交付状态仅由 Tracker 维护；未归档、
提交、推送或发布。

## 原始副本身份

以下 39 份 JSON 从对应本机或 iCloud `test/` 文件逐字节复制，复制后比较源与副本；
未重排、删字段或修改首次失败。数字为原文件字节数，hash 为 SHA-256。
表中 `iCloud test/` 指 `/Users/edonyzpc/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/`。

| 副本 | 本机原文件 | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| [ios-ui-save-final.json](./ios-ui-save-final.json) | `test/b129-ios-ui-save-final.json` | 3942 | `2755304ef93bbb7ad6d122ddc683877bb3542fb531c78f1fa9b853195aaa6658` |
| [ios-preview-diagnostic.json](./ios-preview-diagnostic.json) | `iCloud test/b129-ios-preview-diagnostic.json` | 1623 | `096faaec269a84430f0a917eaacc2f8d0429ea072e7a881e8a83e171d0cf8b1d` |
| [cache-recovery-ios-preview-final.json](./cache-recovery-ios-preview-final.json) | `iCloud test/b129-cache-recovery-ios-preview-final.json` | 1052 | `0dc22c25a1c619b7bca8a9a8a493019f322f45077a412a3a29a2ce2a5d24241d` |
| [cache-recovery-desktop-loaded.json](./cache-recovery-desktop-loaded.json) | `test/b129-cache-recovery-desktop-loaded.json` | 1263 | `e8a6e9010e27a1cc42b864e90b1a6bb33c3dbfe01298fb6b1afba1c780e97201` |
| [style-ui-01-before.json](./style-ui-01-before.json) | `test/b129-style-ui-01-before.json` | 4118 | `682c98d4daaeab7ef9f0704adc23b34e402dd36d63b65480ac58a7e38341eebf` |
| [style-final-loop.json](./style-final-loop.json) | `test/b129-style-final-loop.json` | 6082 | `c38981432d5cf6db74b43e3d5eea3a24f12efb96aa512eb96b911d05374bf563` |
| [b129-ios-layout-before.json](./b129-ios-layout-before.json) | `iCloud test/b129-ios-layout-before.json` | 246 | `a44c250d9b6900a9af5a1778ebff793180bd4f3038087df8303b77d00b1005f2` |
| [b129-ios-layout-after.json](./b129-ios-layout-after.json) | `iCloud test/b129-ios-layout-after.json` | 839 | `6e6911f750c0c214b0a0fb9f9df030268b2bf7576b41754962f47bd03786c711` |
| [compat-final-load.json](./compat-final-load.json) | `test/b129-compat-final-load.json` | 913 | `7e50fee7bf7e490bccfab4d3c08d2a8ba2a2a1efc4595265caa691b8051cffd5` |
| [compat-upgrade-desktop-01.json](./compat-upgrade-desktop-01.json) | `test/b129-governance-upgrade/desktop-upgrade-01/receipt.json` | 1388 | `9be6dcbdf13a6f8121b30ff82d2cbab249963280a9a760aaff5e609756a7695d` |
| [compat-upgrade-desktop-02.json](./compat-upgrade-desktop-02.json) | `test/b129-governance-upgrade/desktop-upgrade-02/receipt.json` | 7263 | `9a835c630f23108f2a27ca8ce3ee016d1f91c4c105a3ad78931cb11b5ceb010e` |
| [compat-upgrade-desktop-03.json](./compat-upgrade-desktop-03.json) | `test/b129-governance-upgrade/desktop-upgrade-03/receipt.json` | 7322 | `d0010a933f940f3bd31476ca483bb40639f9eee9ddbf012e0de1181ea037d1c9` |
| [ios-combined-result-01.json](./ios-combined-result-01.json) | `iCloud test/b129-ios-combined-result-01.json` | 1668 | `9714d8a9b2133002adf716e18d73972e23b5f80cf1faa2aa41b157368e5ff2b2` |
| [ios-production-01.json](./ios-production-01.json) | `iCloud test/b129-ios-production/ios-production-01/receipt.json` | 5372 | `325984b476227b5ce039e130b15ef095ab09633f98607f3529955ed662bd44cb` |
| [ios-services-01.json](./ios-services-01.json) | `iCloud test/b129-production-services/ios-production-01-services/receipt.json` | 18670 | `0bcb6840091f21cdb2d889945843dbad65023fddc1e916526e65805393ea430a` |
| [ios-relative-01.json](./ios-relative-01.json) | `iCloud test/b129-attachment-rules/ios-production-01-relative/receipt.json` | 2916 | `2ecae8a9ccb65e69217b1b489cfc01272fa271966878f56b7912a2883144b83d` |
| [compat-upgrade-ios-01.json](./compat-upgrade-ios-01.json) | `iCloud test/b129-governance-upgrade/ios-upgrade-01/receipt.json` | 7479 | `9b30ba7615d6eb719c42fb62e6acaa31823abd8da70a18d241430f78ca770b37` |
| [desktop-services-01.json](./desktop-services-01.json) | `test/b129-production-services/desktop-01/receipt.json` | 8732 | `f409fd667b5aeec60a81df3737525a28f69ac8b3aa4656ca03463ff46e9ec74e` |
| [desktop-services-02.json](./desktop-services-02.json) | `test/b129-production-services/desktop-02/receipt.json` | 18479 | `fe7ed4d5be4d532102e13d428ade077906e26b6011effbc96e1812bc531b0161` |
| [desktop-attachment-rules-01.json](./desktop-attachment-rules-01.json) | `test/b129-attachment-rules/desktop-rules-01/receipt.json` | 5818 | `b55d115690c5783bfbfe10cffc736b8b184e4c636f3b8ade25572a42f56f7e7a` |
| [desktop-reopen-prepare-01.json](./desktop-reopen-prepare-01.json) | `test/b129-reopen/desktop-reopen-01/prepare.json` | 4094 | `fce552dd4f719579cf4bb4ded9e01d9c8b8ef54609ca35f605cb3f6a8bc14975` |
| [desktop-reopen-resume-01.json](./desktop-reopen-resume-01.json) | `test/b129-reopen/desktop-reopen-01/resume.json` | 4037 | `b1bfd29957c1e2600517f27ddffb91e34776ea16fc581e9ea458318dc25a87cc` |
| [wire-deepseek.json](./wire-deepseek.json) | `test/b129-production-services/desktop-02/wire-deepseek.json` | 3483 | `b3e46ec10b7d9b5b7c62c42fec68df0b9ed7321b74ea6965b69dfa48ce7e24ef` |
| [wire-qwen.json](./wire-qwen.json) | `test/b129-production-services/desktop-02/wire-qwen.json` | 2028 | `4ba2bad28ebe214bf0f6608f2e29bf5a2feb3295928792c327322ce63e96c94f` |
| [original-cleanup-ui.json](./original-cleanup-ui.json) | `test/b129-production-services/desktop-02/original-cleanup-ui.json` | 378 | `32ca2999a6a347cf66c35c535992a24994dc312f6871eb1c1638d2009de5c79a` |
| [recovered-missing-materials.json](./recovered-missing-materials.json) | `test/b129-production-services/desktop-02/recovered-missing-materials.json` | 2964 | `6ae48bf5766d38ebc2ecdb289b7d9df5ed4bca7d303f3752c00fcffa3d2050b6` |
| [i10-loaded-identity.json](./i10-loaded-identity.json) | `test/b129-production-services/desktop-02/i10-loaded-identity.json` | 544 | `6bfdf46b479710cdd594e72ca9f51546d22f0b4b9c2dde3e2b741e65073a9baa` |
| [i10-reresolve-recovery.json](./i10-reresolve-recovery.json) | `test/b129-production-services/desktop-02/i10-reresolve-recovery.json` | 5828 | `c833a1c39c5cee986e552e7a592a5d2bb4daf8e194bd911c150b0d925fc807d5` |
| [i10-multi-recovery.json](./i10-multi-recovery.json) | `test/b129-production-services/desktop-02/i10-multi-recovery.json` | 5641 | `c462fc2b10d8c8cfdf032c5d520c2e870d5397b046c7160f58baa23e98fd7533` |
| [i10-multi-save.json](./i10-multi-save.json) | `test/b129-production-services/desktop-02/i10-multi-save.json` | 9061 | `08c8de5b32abfe0db2edd92ca3af591f9edca946b7d1e73ee4f568e213faf266` |
| [i10-multi-save-verified.json](./i10-multi-save-verified.json) | `test/b129-production-services/desktop-02/i10-multi-save-verified.json` | 686 | `1d2c094ecfa575ae144e14241a67ac53a3da7e0903823f7d85da0ff1cd0aa1ed` |
| [i10-multi-reload.json](./i10-multi-reload.json) | `test/b129-production-services/desktop-02/i10-multi-reload.json` | 2418 | `91912bc75357df4a98482bd89cfc7ff96349ccd54310190eaeeb0a9e161d3da7` |
| [final-ui-animation-before-remove.json](./final-ui-animation-before-remove.json) | `test/b129-production-services/desktop-02/final-ui-animation-before-remove.json` | 10667 | `7394df2d6a727aa641a8cbf4a3f9cb6c687c04a2445a2e4370822372f9d64c15` |
| [final-ui-animation-after-remove.json](./final-ui-animation-after-remove.json) | `test/b129-production-services/desktop-02/final-ui-animation-after-remove.json` | 10726 | `7635834593d976a771e81a96e233ba2c2cf380cdd53298c5fc5dd1aed8a8d64e` |
| [final-ui-cache-cleared.json](./final-ui-cache-cleared.json) | `test/b129-production-services/desktop-02/final-ui-cache-cleared.json` | 10735 | `19bd81662400f476bf5c110895967b399f3be07dc126aee961844e4651ee9dfb` |
| [final-ui-cache-rebuilt.json](./final-ui-cache-rebuilt.json) | `test/b129-production-services/desktop-02/final-ui-cache-rebuilt.json` | 11676 | `6bc6b5b772a5a1a4fd7f8c862524a742ecf287cd436e8c4f0a7bdf1bbd802bd5` |
| [final-ui-cleanup-before.json](./final-ui-cleanup-before.json) | `test/b129-production-services/desktop-02/final-ui-cleanup-before.json` | 11677 | `a9a4815fda57ca49a1a95a82dc83c8522e16e8ced42e9b2ce014188784afc726` |
| [final-ui-cleanup-after.json](./final-ui-cleanup-after.json) | `test/b129-production-services/desktop-02/final-ui-cleanup-after.json` | 3713 | `6bf0b859af7798af77dc1d6316e29c2a9a846b550b004f427adb6bf4a0bc73b3` |
| [capability-offline-desktop-01.json](./capability-offline-desktop-01.json) | `test/b129-capability-uidesktop-01.json` | 5496 | `eed7533bb49e150ac575dcaed5e9d84bc62599be69952a06ea267a9529bc6c68` |
