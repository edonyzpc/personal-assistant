# PA Agent Essential Capabilities SDD

Document status: Approved
Updated: 2026-09-15
Work item: B-140
Authority: GPT-6 负责源码核对、接口与阶段设计；尚未完成的设计不得作为 worker 隐式实现授权。
Product spec: [Product Spec](../../../product/specs/pa-agent-essential-capabilities-product-spec.md)
Plan: [Plan](./plan.md)
Tracker: [Tracker](./tracker.md)

## Current Source Baseline

源码基线 `d274f5ee`，与 Discovery 调查的 `fa23af5c` 相比仅增加规划文档。已核对：

- `chat-tool-factories.ts`、`chat-tool-types.ts`、`chat-tool-guards.ts`、`chat-tool-constants.ts`、`chat-tool-execution-helpers.ts` 分工现存；`chat-tools.ts` 仅 exports。`ChatToolName` 位于 `chat-types.ts`。
- `resolveTaskSourceReadPlans` 在读取前按工具显式制定 source plan；未知工具返回 `unplanned_tool`。`TaskSourceNoteIdentities` 使用 run-local 真实文件身份；权限不由工具参数授予。
- `TaskSourceReadGuard` 提供 `isCurrent/isPathAllowed`，异步读取后必须重验。现有 `readVaultFile` 可把缺失 cachedRead 变为空文本，新增读取不得复用这一成功空值语义。
- `createPathFilteredHost` 包装官方 vault 与 metadata 访问；新增工具须继续相交路径规则，不能从未过滤 host 绕过。
- `MemoryGovernanceCoordinator`、`SerializedProfileGovernancePort`、`getMemoryControlCenterSnapshot/runMemoryControlCenterAction`、提取器 `getVaultInsightsSnapshot/getVaultInsightsStatus`、`SavedInsightStore` 现存。Ledger 状态只有 active/archived/promoted，Later 属于 Review。

## Public API And Necessary Composition

本机锁定声明为 `obsidian@1.12.3`，manifest 最低 App `1.11.4`。下列 @since 来自安装包 `obsidian.d.ts`，不是最低版本实机测试：

| 能力 | 公开 API / 已有封装 | 版本证据与必要组合 |
| --- | --- | --- |
| 文件定位 | getAbstractFileByPath；getFileByPath | getFileByPath @since 1.5.7；优先复用现有已过滤 getAbstractFileByPath，新增方法不越过 wrapper |
| 正文读取 | Vault.cachedRead；写前既有 Vault.read/process | cachedRead/read @since 0.9.7；返回整串，无范围 I/O；PA 补读取前 size gate、输出切片与前后身份核对 |
| 正文/属性分区 | getFrontMatterInfo | @since 1.5.7；使用本次读取文本，不使用可能过期的 cache position 切割 |
| 属性/查询 | getMarkdownFiles、TFile stat、MetadataCache.getFileCache、getAllTags | T-04使用：getMarkdownFiles @since 0.9.7、getFileCache @since 0.9.21；getAllTags 为 public但本机声明未标@since，未据此捏造首次支持版本；未知缓存不能解释成字段不存在，最低App实机仍未验证 |
| 结构/链接 | CachedMetadata、getFirstLinkpathDest、resolvedLinks | 缓存充分时不重做 Markdown 解析；反向查询过滤许可路径；不用私有 backlinks/search API |
| 当前笔记 | MarkdownView / Editor | 复用当前 wrapper；磁盘读取与未保存 editor 明确分开，Pagelet anchor 不改变 |

不新增依赖、全库持久索引、通用 parser、fs/Adapter 或任意查询执行器。字面多次匹配属于官方分词 search helper 不覆盖的必要组合。保留 Operations 的 Vault.process 原子预览/expectedBefore/Undo，不为换 API 改承诺。

## T-03 Read Contract — Approved Slice, Proposed Interfaces

接口 `createReadNoteTool` 位于 `chat-tool-factories.ts`；类型、校验、常量沿现有拆分职责。测试放在 `__tests__/read-note-tool.test.ts`，来源 read plan 回归复用/扩展现有 suite。

- 输入：`path` 必填；`part: body | properties` 初次读取默认 body，续读省略时继承 cursor.part，显式不同 part 则拒绝；`startLine`（1-based）、`endLine`（inclusive）成对可选；`maxChars` 可选且受常量上限；续读使用返回的 `cursor`，不得同时更换范围参数。properties 不接收行范围，也不能由生成器偷偷给其游标加行范围。仅 `.md` 许可路径。
- 输出保留 `ChatToolResult`：content 包含 `path`、`part`、`contentKind`、`text`、`sourceVersion`、实际 `range`、`truncated`、`complete` 和可选 `nextCursor`。body 返回去除 frontmatter 的正文；properties 返回本次文本中的原始 frontmatter 内容，准确命名 raw properties，不能声称已解析对象。`complete` 表示所请求范围已读取完，另用 `endOfPart` 区分是否到整份 body/properties 末尾；不可把选定小范围完成说成全文完成。
- 行号以原文件为基准；范围交集超出正文不伪造内容。超长单行也可继续，cursor 包含下一字符偏移，range 必须反映部分行，不能跳过剩余字符。Unicode 不切断 surrogate pair，落在 surrogate 内部的 cursor 不是有效断点。CRLF 保留一致定位；包括换行中间与 EOF 空片，range 起止不能倒置。预算试探不能反复重扫整份正文；本次有界行位置可复用，不新增持久缓存。
- budget 常量在 source；复用现有 300 KB 读取风险量级与 6000 字符结果预算，序列化元信息也计入，不无限放大。`maxChars` 限制返回正文字符，不能扩大完整 content 的 JSON 预算。工具自身选择切点后一起生成 range/cursor/complete，再检查实际 JSON 长度；不加入旧 V1A 通用任意字符串裁剪，否则会破坏 cursor/版本/定位。元信息或下一完整 Unicode 字符无法容纳时明确 unavailable，不能无限返回无进展游标。无法证明 size 可读时返回明确 unavailable；读后仍核对字节数，处理 stat 过期，不声称消除了文件在 stat 后变大的 I/O 窗口。
- 对同一路径捕获真实 file object、mtime/size 的原值，读取前后、异步 hash 后及返回前重验 guard/lookup/stat。工具实例内用 content-free WeakMap 关联真实文件对象与带实例唯一前缀的 identity；不保存正文或持久游标服务，实例销毁即失效。新实例/同路径替换对象不能接受旧 cursor，常规同一实例续读继续有效。
- sourceVersion 使用现有 `computeContentHash` 检测内容版本，不能把 SHA-1 当作签名。cursor 只含路径/part/原范围/字符偏移/文件 identity/版本，不作为权限；所谓不合法 cursor 指结构、边界、身份或版本不符。修改为其它有效偏移不赋予新权限，等价显式范围选择；无需引入签名服务。续读仍重新检查权限并重读文件、核对版本，不返回混合内容。
- 缺失 API、读取抛错、非法路径、超限、过期 cursor 不返回成功空文。真空文件可以成功，但明确为空。路径拒绝发生在 lookup/stat/cache/body 前，避免泄露。
- `resolveTaskSourceReadPlans` 新增 read_note 的固定路径计划，名称识别与 export 一致；不要在本切片扩大 runtime provider definitions。可见来源经 `result.sources` 进入 capability-adapter，不能只写普通 sourceRecords（会被 adapter 丢弃），也不能拿 metadata dependency 当正文证据。sourceVersion 此时只在 content；可信历史/入模/重试完整接线由 T-07 验收，T-03 不自报全 AC-05 通过。
- `read_note` 读取已保存 vault 内容；当前 editor 使用既有 get_current_note_context，T-07 澄清身份。不得因活动 note 切换让按路径读取换目标，Pagelet 继续独立 frozen anchor。

## Remaining Design Boundaries

T-03/T-04 按下列已批准接口交付；T-05 搜索/结构与 T-06 暴露/设置按各自明确接口批准后派工。T-08～13 的治理显式意图、持久化 admission、旧记录使用效力、Saved Insight/Later 路由需要源码细化及负例；不把既有方法名称当成这些流程已经可直接复用的证明。尚未批准这些未完成的接口设计。

### T-04 Query Interface — Approved Slice

Proposed `createQueryNotesTool` 沿现有工具模块职责，复用 getMarkdownFiles/TFile/getFileCache。查询仅使用许可文件的元数据，不读正文、不以 metadata cache 缺失推断字段不存在。固定路径/目录参数先规范化，不允许越界；过滤逻辑是模型显式条件的执行，不是宿主问题分类。

- 输入提供可选 path、folder、tags、有限个指定属性条件（exists/equals/contains）、date、sort、limit、cursor；条件按 AND。标签去除可选前导 # 后不区分大小写精确匹配，不隐式包含子标签；equals 区分 JSON 标量类型，exists 检查属性键存在（包含 null），contains 对字符串为字面子串、对标量数组为严格成员匹配。sort 为 path/ctime/mtime 和 asc/desc，次序以规范路径确定性打破平局，未知字段不能当作 0。
- 日期分 timestamp 与 calendar-date 两种显式语义：ctime/mtime 用带 UTC offset 的 ISO 起止时间；指定属性可选择带 offset 的 timestamp，或严格 YYYY-MM-DD 的 calendar-date 值。calendar-date 是记录自身的日期标签，不凭空推成某时区写作时刻。两类均半开区间，不接收含糊 locale date，不跨字段回退；返回实际字段、边界和口径。用户指定优先，其余由主 Agent 决定并说明；不确定则提问。
- 返回 matches、实际排序/过滤条件、已扫描许可数、匹配计数的 exact/lower-bound/unknown 身份、cache未知与扫描覆盖、nextCursor。计数和属性都在许可范围，不回传禁止文件数量；未扫描/缓存未知不声称全库无结果。
- 有界扫描和分页使用来源/过滤/排序版本绑定；metadata参与筛选或排序的变化须使旧游标失效，不能只检查最后一条匹配。查询超出扫描预算可以诚实返回部分覆盖并要求缩窄，不能把部分匹配总数说成全量；结果分页不得静默重复/遗漏。
- 可见匹配通过 sources，已扫描元数据的依赖按现有 host-only metadata dependency 路径记录，使计数/聚合不会在相关来源撤销后继续充当有效事实。不另建持久扫描/索引服务。

每页重建限定候选集的 canonical projection：规范查询/排序、全部许可候选 identity/path、实际参与条件/排序的 stat/tag/property 值和 unknown 状态（包括非匹配项）。cursor 绑定该摘要、查询、实例和 nextIndex，不存正文/metadata；hash后再次核对 projection/身份，变化即失败。只取实际所需元数据字段，投影字节数与候选数受 source 常量限制，不能为了 hash 无界序列化任意 frontmatter。

查询私有identity采用固定JSON编码字节长度的ASCII实例前缀与固定宽度序号，序号溢出须失败，不能扩位；仍由现有实例内WeakMap关联真实文件对象。生产与纯重验共用完整snapshot预算append规则，包含false/false预留、包装、逗号与identity开销；纯重验以等字节占位identity计算预算，实际持久metadata指纹仍排除identity。保持权限/静态条件过滤、路径排序、最多500候选及遇首个无法append候选即停止的原顺序；不扩大128000上限，也不新增持久身份/预算数组。只在查询确需tags/property等cache字段时读取metadata；相应公开API缺失应不可用，不能伪造成功unknown快照。不为未交付的中间态可变identity证据添加兼容分支，回归使用规范producer输出。

扫描超 cap 或关键 cache 未就绪时只返回明确部分覆盖/lower-bound，不能生成声称稳定全量分页的 cursor；要求缩窄或缓存就绪后重查。完整且可判定的范围才排序分页。`getMarkdownFiles` 仍是官方全库列表 API，有界的是元数据评估/投影/输出，不声称所有 vault 访问均有界。

2026-09-15 T-03 source 已验收，GPT 根据查询/标签/adapter 源码与独立只读 review 固定以下接口补充：

- `path` 精确匹配 Markdown 路径；`folder` 递归包含后代文件、按 slash 边界，空字符串表示根目录；两者同时提供为 AND。tags 为 all-of。属性条件为 `{ key, operator, value? }`，exists 不需 value。`date` 为 `{ field: ctime | mtime | property, property?, kind: timestamp | calendar-date, from, to }`；property 字段必须提供属性名，其余不得夹带；ctime/mtime 只接受 timestamp；真实日期与 `from < to` 均须验证。
- 每页重复完整条件，默认 path asc。cursor 仅绑定规范查询摘要、候选快照摘要、工具实例与 nextIndex；改变 limit 可以，改变查询或排序必须重查。不存在的许可路径可 exact zero；read plan 统一使用 scopedVaultPlan，由 reader 同时执行条件和真实 source guard，不提前要求固定文件已注册。
- AND 中任一确定 false 即 nonmatch，不把无关的 cache unknown 升为 unknown；仅因未知而不能判断匹配或排序的项影响完整性。cache 已有且属性缺失是确定 nonmatch；日期属性存在但不可解析为 unknown，不猜测。只按路径查询不要求无关 cache 就绪。
- 只输出完整 match 的 path/title 和所用 stat 字段，不复制任意 frontmatter。参数、指定字段投影、候选数和页大小均有 source 常量上限；查询回显也计入输出预算。查询初始界限为候选 500、投影 128000 UTF-8 bytes、条件和标签各 8、页默认 10 最大 20；实现的数值 authority 留在源码。
- 6000 字符预算指 provider-facing content 的 JSON，隐藏依赖独立保留。页按真实装入条数推进；完整首条或必要元信息放不下时明确 unavailable，不截路径、不跳过条目、不返回不前进的 cursor。禁止为满足输出预算删除来源依赖。
- 部分覆盖无 cursor；返回确定匹配的 path asc 子集、lower-bound 与缩窄或稍后重查指引，明确实际排序不同于请求的全量时间排名。所需 API 缺失返回 unavailable，不能沿旧 getMarkdownFiles 的缺失 API 空数组 fallback 声称 exact zero。

`TaskSourceRun.isTaskSourceProducingTool` 仍为旧名称名单，新工具的可信结果/context处理必须纳入 T-07，不能只加 source read plan 就称完整来源链通过。

### T-05 Approved Search And Structure Design

本节接口经 GPT 源码核对与只读 review 后批准，沿用完整 T-05 范围。已核对现有 `findSnippetMatch` 每文件只取首个命中，且 `normalizeSearchText` 先小写/NFKC 再以转换后的 index 切原文，可造成错位；validator/prepare 还会 trim 或截短 query。`inspect` 在可读时无条件整文读取，`buildNoteStructureSummary` 总调用 parser 并将 regex 标签/链接合入 cache；反链先扫描全表再截输出。

搜索沿 `search_vault_snippets`，保留旧 reader 可安全读取的字段并增加定位/coverage，不另设工具：

- 输入保留 query/scope/limit，增加 `part: body | properties | all`（默认 all，保持旧搜索覆盖）、`caseSensitive`（默认 false）和 cursor。query 必须非空且含非空白字符，保留用户原始首尾空格，超长显式拒绝；prepare 不得提前 trim/截短。字面匹配，无 NFKC，默认 Unicode 不区分大小写，可用严格转义 query 后的固定 `giu` RegExp 保留原文 offset，不接受用户正则语法；同一区间按不重叠顺序推进。
- body/properties 复用本次文本的 `getFrontMatterInfo` 分区，all 分别搜索再按原文件位置合并；禁止跨分区匹配，snippet 上下文也限定在命中分区。结果保留 path/title/line/snippet，新增实际 part、sourceVersion 和原文件 UTF-16 半开 offset/1-based line/column range。正文只读已保存文件，包含 CRLF/Unicode/跨行短语的原始定位。
- 页内多次命中按规范 path、原文件 offset 排序。每页在既有文件/总字节预算内重建全搜索快照（含无命中文件 object identity/stat/content hash），cursor 绑定查询、scope/part/case 及 snapshot/实例/nextIndex。limit 可改变，相关正文同 stat 变化仍使旧页失效。异步读取/hash后与最终返回前重验文件集合、identity/stat/guard；这不是跨多文件原子存储快照，不能宣称所有文件同时点一致。
- 命中较密时只保留当前页及判断下一页所需的完整 match，不把整个范围的每次命中都物化成对象数组；匹配计数可在已有字节预算内线性累计。一次构建本文件行位置，避免每次命中从正文开头重新扫描。
- 有界范围内全部搜索完成才生成稳定命中续页。扫描超限/大文件跳过为 partial，无全量 cursor，指引缩窄 scope 或用 read_note 查看具体大文件；不会自动跨扫描预算拼接不同批次。此处“继续”指已明确覆盖范围内的全部命中可分页，不添加无限范围后台扫描。所有实际搜索来源含无命中项保留隐藏依赖。
- 分页未结束与扫描不足独立：cursor/page 标识还有命中，coverage 标识已扫描范围。旧 runtime 对 truncated/unavailableSources 有整体 partial/unavailable 推断，T-05 必须同步这个局部结果解释消费者，避免正常分页被说成跳过文件，也不能把局部结构缺失说成整工具不可用。旧历史结果继续按旧格式安全读取。
- 沿用现有扫描预算，size 未知或读取 API 缺失明确不可用，不把失败当空文本；采用 T-03 的读取前后字节/身份/权限检查。工具自己打包完整 match 与 cursor 并限制 content JSON 预算，移除本工具旧通用 trim 的破坏性裁剪路径；元信息/首个 match 不能容纳则明确失败，不返回无进展 cursor。调用内索引只保存有界定位/摘要，不增加持久索引。

结构沿现有 inspect API 与历史输出，优先公开 cache 的 headings/tags/frontmatter/links/embeds/listItems/sections/blocks。`CachedMetadata` 的可选字段在已存在的 cache 中可为空，不能把所有缺字段都当作需要全文解析。cache 对象缺失与确知空结构分开：

- 有充分 cache 且无任务文字、callout 详情或显式 includeContentChars 需求时，不读取正文；基本 headings/tags/links/embeds 直接取 cache，不合并 regex 第二套事实。
- task 状态与位置用 listItems；公开定义空格为未完成，其它 task 字符为完成。任务文字才读取当前正文并按 cache 位置投影。callout 候选来自 sections 的 callout/blockquote 与可能包含嵌套引用的 list 区域；只有候选详情或 cache 缺失时才读。不能把全部 blockquote 都认作 callout。
- 读取返回整串是官方 API 限制，必要文本投影不等于分段 I/O。缓存位置与读回文本的相关结构校验不一致时明确 unavailable/retry，不混合失效 cache 与新文本；API 无公开 cache 版本，不能仅以相同 object 或 mtime 宣称缓存已验证同步。
- cache 缺失时可沿已有有界 parser 补官方未提供的必要结构，必须排除 fenced code/frontmatter；不重写完整 parser。cache 充分时该 fallback 不运行。详细属性解析若有必要使用公开 parseYaml，不自行解析 YAML。
- 反链按许可 source 做有界评估，保留已评估 nonmatch 依赖，输出截短与扫描不完整分开说明；需要解析时可用 getFirstLinkpathDest，先确认来源许可和链接语法，解析后检查规范目标路径许可再读取目标事实；`[[Target]]`、`[[#Heading]]` 不是可直接交路径 allowlist 的路径。不为此切片强行新增解析、不调用私有 backlinks API。基本属性/正文片段/来源输出预算继续受既有合同约束。

T-05 最低回归包括旧 Unicode 位置反例、同文件多页、跨分区/跨行、大小写/空白字面语义、同 stat 正文变化、禁止源零读、预算 partial 无死循环；结构包括 cache 充分零额外读取、任务非 x 状态、fence/YAML 伪结构、cache 缺失/错位、反链部分覆盖与依赖。源码证明无法保持这些边界时由 GPT 修订设计，worker 不自行降低覆盖承诺。

T-05/r3 校正：集合变化检查区分全体许可 path/identity 与预算内实际评估的 stat/content，不因 401 项稳定集合与 400 项评估长度不同而失败，不读取 cap 外事实。公开 Vault 实例方法保留 receiver。结构投影优先利用公开位置的 col/offset，合法容器、字面尾部 `#` 与 callout 完整类型/折叠标记不能被窄正则误读；frontmatter absent 也参与同步校验。公开 API 没有 cache 同步版本，验证已有 cache 项不能证明未漏新增项；实际读取正文而无法证明结构全集同步时明确 partial 及局限，不称完整/确知无结果。已知失配仍 unavailable/retry，不能用 partial 发布明知错误的事实；cache-only 仍保留零正文 I/O 的公开 cache 路径。不为此新建完整 Markdown parser 或缓存索引。

### T-06 Source-Verified Connection Map

该映射固定后续改动范围，不表示已派工或已完成。runtime 当前已传 `classification: { items: [] }`，不能把现有未调用 classifier 当作本项刚移除的行为。

- `pa-agent-runtime.ts`：构造期 `operationsRuntimeAvailable` 和 provider 注册、每轮 `operationsActionsEligible`、`OperationsTurnPolicyEngine.isEnabled`、首轮 `availableSemanticToolNames`、exportFilter/includeActions、staging executor 必须一致撤销 legacy 开关。真实 controller/入口条件仍保留。2026-09-15 复核发现前轮漏读：当前已在 initial snapshot 前 await `capability_preload`，model.stream 中加载仅是后备分支；复用 preload 后的 registry 构建可用集合，不新增加载流程。
- `pa-agent-control-policy.ts`：首轮按实际基础集合与明确 allow/block 相交，不按 required 分类或 Memory 结果开放。`deriveSameSourceFollowUpAgentControlSnapshot` 不再将列表替换为 snippets-only。`pa-agent-required-capability-policy.ts` 的 same-source followup 可保留观察说明，不修改能力准入；保留真实完成性、重复、错误和预算控制。
- `preserveOperationsActionsInControlSnapshot` 不可借取消旧门把后续明确禁止项重新补回。`createOperationsAcknowledgementControlSnapshot` 的 staged 后确认回执属于写入生命周期控制，保留。
- `operations/operations-tool-provider.ts` 的 load 仍检查 `context.settings.operationsAgentEnabled`；需纳入 T-06 明确文件范围，去掉该独立门。保留四写 `requiresConfirmation=true`、禁止 capability 直接 execute 与 controller 逐次确认。
- `plugin.ts` 的 `isOperationsAgentEnabled` 为 AI host、Chat host、OperationsService/Pagelet 共用；撤销旧设置执行含义，但不能授予 Pagelet 普通发现写入。`settings.ts` 删除旧开关 UI；保留 raw `operationsAgentEnabled` 为兼容/回滚字段，不回填用户值，保留 proactive-save、audit content/retention 独立偏好。
- `chat-tool-factories.ts` 的 `prepareCurrentNoteContextArguments` 实际调用 `shouldUseFullCurrentNoteContext` 覆写模型 mode；移除此调用及误导描述，合法参数校验/兼容别名不变。是否删除旧 helper/export 由实际消费者决定。
- `pa-agent-host-tools.ts` 的 schema、source guard、显式 allow/block、scope、timeout/cancel/deadline 保留。`skip-memory` 不因取消规划门而失效，四写仍经预览/expectedBefore/确认/Undo，来源物理dispatch重验不移除。

T-06 回归至少覆盖 provider.load(false)、真实 runtime 首轮 schemas/definitions、controller可用/不可用、显式 blocked tools、Memory结果有/无和后续调用、四写 staging/确认/取消/Undo。settings 变动另有 App UI 入口验收，source测试不能替代。

2026-09-15 源码复核后的策略补充：

- 构造期注册、每轮 export/staging 共用本地资格判断：实际 controller 存在，调用方未明确 allowWrite=false、未明确排除 local-filesystem-write permission、未指定只读 runKind。只补缺省 Chat staging 策略，不覆盖显式限制。OperationsTurnPolicyEngine 的四写白名单与 super.canExport/canExecute 保留。
- Pagelet 普通发现使用独立 `PolicyEngine({runKind: review, allowWrite:false})` 与读 registry，继续独立；Review 的 previewRenderer/writeAction 流程不能因 controller 存在被改成 Chat Operations。
- 首轮使用批准基础工具名单与现有 preload 后真正可导出 definitions 相交；不把所有 additional provider 能力自动纳入。schemas/definitions 保持同一 exportFilter，provider 不可用时不宣称可调用。
- 显式 blocked 始终优先，后续 Memory 结果不扩大 allowed 集合；移除四写特殊补回。现有 initial snapshot 还会把全部 meta tools 并入显式 allowlist，修改时区分必要 host-only source declaration 与 Skills/图片/写作上下文普通能力，不能以取消规划门为由忽略明确限制。确认回执保留现有专用 acknowledgement：`toolMode: normal`、空 allowlist、`answer-ready`，不改成通用 finalization。

T-06 接口细化已根据当前源码与独立只读 review 核对：

- 批准的首轮基础集合为 `search_memory`、`get_current_note_context`、`query_notes`、`read_note`、现有 metadata/recent/outline/inspect/canvas/snippets/tags 七个工具以及可用的 `webSearch`。在 runtime 的 core 注册点加入已验收 query/read；preload 后与 `listDefinitions` 的实际可导出集合相交。四写另受 Operations 资格约束，不通过旧 support-tools 门开放基础读取。T-07 仍验证新接线的完整来源与真实 App。
- `load_skill`、图片解析与写作上下文只在本轮实际存在时加入；有明确 allowlist 时这些普通能力必须相交。`declare_source_scope` 是必要宿主边界控制，可单独保留，但明确 blocked 仍优先。不新增外部 runtime options 接口来模拟当前不存在的调用方限制，利用现有 snapshot、policyOptions 与 executor 接缝验证。
- Chat Operations 缺省策略仅对 controller 存在且 runKind 缺省或 `chat-with-actions` 的场景补齐；显式 `chat` 保持只读，显式 `review` 保留 Review 专用路径，不自动变为 Chat 四写。`allowWrite:false` 或显式 action permission 列表排除本地写时不补权。PolicyEngine 的平台、许可与实际执行检查保持。
- Plugin getter 撤销 raw legacy 设置的执行含义，保留宿主生命周期/可用性检查及 service/session 的真实不可用 fail-closed。不得将所有旧 disabled 测试一律反转；provider.load(settings.false) 与宿主不可用是不同事实。持久化原值不迁移为 true，独立审计/建议偏好不变。
- 最小回归复用 `operations-agent-runtime` 的 `operationsRuntimeFixture` 捕获首个 `bindTools` 和 provider input，证明实际 schema/definitions/调用一致；复用 control-policy、operations-service/controller、Pagelet runtime、Review write-action 测试分别覆盖 blocked、生命周期、预览与普通发现隔离。仅 registry 常量名单不能替代首轮执行证据。

### T-07 Source Integration Findings To Resolve

以下是 GPT 已核对的接线风险，尚非完整 T-07 实现批准；准确接口在 T-05/T-06 source 验收后固定：

- Chat `capability-adapter` 从 sources 重建可见 SourceRecord，目前仅保留特定隐藏依赖，content 内 `sourceVersion` 不自动成为可信版本。`task-source-run` 的 transcript/history 投影主要检查 identity/scope，持久化有效性检查的 identity/mtime/size 也不能证明先前观察对应当前正文/metadata；MemoryEvidenceRegistry 和 WritingContextRun 仅保护各自领域。新工具需要内容无关、可持久化的可信版本证据，并覆盖 query 的 nonmatch 与候选集合；不得放开任意 legacy metadata。
- 现有答案/摘要的物理 dispatch hook 已连到真实 fetch/SDK retry，但 `ai-utils`/`obsidian-fetch` 的 `onProviderRequestStart` 当前是同步回调。T-07 必须选择可证明的同步失效信号或令现有 hook 可等待有界重验；仅在 prepareModelInput 异步 hash 不足以防止 SDK backoff 后重发失效 body。失效的已序列化输入须拒绝发送，沿现有 canonical fallback 重新准备。
- 同一结构化 snippets/query 结果中 A 失效、B 有效时，应保留可明确映射的 B，撤销旧 cursor、exact count/完整性承诺并同步 sources。自由文本摘要没有安全分区时不可仅删来源芯片。新工具名须进入 task-producing/context reader；history 按路径去重时不能吞掉不同版本。摘要现有 prompt/sourceRecords 指纹可复用，前提是版本投影先刷新。
- Chat 最小回归复用 `b129-multimodal-runtime` 的真实 SDK 429 答案/摘要两条路径，加入同对象同 stat 正文/metadata 变化与同一结果 A+B；复用 context-summary-projection、pa-agent-history/chat-history-store 和 host-tools 的撤销/迟到异步恢复负例。独立只读 review 已核对稳定消费者；不能将尚在修改的 T-05 producer 中间态当作验收输入。
- Pagelet 独立 registry、read allowlist、vault evidence 集合均需接入 query/read；新路径读取 anchor 时绑定 `request.anchor`，不能通过 active workspace 重新选择目标。现有 `createAnchorBoundCurrentNoteTool` 与 `createAnchorBoundInspectNoteTool` 已采用 frozen anchor；保留其身份及失效规则，复用通用分区/定位/预算 helper，不复制新 reader。
- `createProvenanceCapturingExecutor` 当前逐条 sourceRecord 调用 `captureSourceMaterial`；query 的隐藏聚合依赖可能有数百条，不能由该路径将 metadata-only 查询变成全库正文 I/O，也不能把隐藏 nonmatch 依赖加入可引用或洞察支持来源。需要区分查询投影有效性和已展示正文证据，再接入现有撤销检查。
- Pagelet `pagelet-agent-quality-gate`、`lead-driven-policy`、`pagelet-native-model` 现按工具名字认定 content evidence。新 `read_note(part=properties)`、snippets 属性命中及 query 候选不能仅凭工具名升级为正文证据；同理不可因捕获服务后来读取了完整文本就声称模型已读正文。接线须按真实结果分区/内容事实，保留现有结构证据的适用局限。
- 现有 Pagelet 来源快照使用 `hashPageletContent`，通用 read_note 使用 `computeContentHash`，算法与长度不同；不能直接比较不兼容 hash，或把工具执行后另一次读取的 hash 当成工具实际观察版本。需要在明确版本语义下核对工具返回与后续捕获，继承每次物理 dispatch/retry 的检验。
- 最小补验包括：切换活动笔记仍读取 frozen anchor、anchor 内容变更不能混合；query 的新增/未展示候选与属性变更使关联观察失效且不读正文；properties-only 与隐藏依赖不满足正文支撑；已有有效独立观察在另一个来源撤销后仍可用。真实 App 验证仍为 P1 退出条件。

#### T-07 Approved Physical Dispatch Preparation

源码与独立只读 review 支持以下窄接口方案；这里只批准 transport 接缝，完整读取版本证据格式和投影仍须随后定稿：

- 保留 `onProviderRequestStart: () => void` 的同步最终准入语义，向现有 ProviderRequestOptions/ObsidianFetchControl 增加 `prepareProviderRequest?: (signal?: AbortSignal | null) => void | Promise<void>`。校验已经序列化的输入，不能在该 hook 偷换请求 body；失效时拒绝，由现有上层 fallback 重新投影。
- native 与 Obsidian wrapper 的选择条件均包含 prepare-only 配置。native 每次实际 fetch 内 await prepare；Obsidian 无 scope 分支也执行，放在 body normalization 后。答案和摘要两处模型 options 都须转发，不因模型创建时曾准备过而跳过真实重试。
- ProviderRequestScope 顺序为：等待 detached → 检查取消 → await prepare → 检查取消和新 detached → 必要时重新等待并重新 prepare → 同步 onStart、取消检查、dispatch。prepare 与普通并行请求不进入 detached 集合，不替换现有调度器，不移除不同 scope 隔离。
- prepare 使用物理请求 signal，等待需能被取消及时中断；拒绝/取消不触发 onStart、真实 dispatch 或物理请求 diagnostic，迟到 resolve 不恢复该请求。现有同步 onStart 保留最后 source/admission/通知检查。
- 最小验证复用 obsidian-fetch 的 drain/barrier/并行测试，并补 scoped/unscoped prepare 取消、拒绝零请求、新 barrier 后重新准备；AIUtils/SDK transport fixture 验证 prepare-only、native 实际降级 Obsidian、429 每次物理尝试；runtime 答案和摘要各有真实 forwarding 证据。

#### T-07 Approved Observation Evidence Boundary

独立 review 与 GPT 源码核对确认以下持久化与投影边界。具体类型沿现有模块实现，不建立新日志、store 或索引：

- 增加专用、无正文的 `VaultObservationEvidence`，从工具 producer 经 capability 双向 adapter 到 host canonical metadata 显式传递。证据只能来自受信任的宿主执行结果，不能从普通 observation 文本或模型 metadata 重建；严格 reader/clone 校验版本、类型、长度和嵌套字段。
- 最小证据包含 schemaVersion、工具/观察身份、对应输出项绑定、依赖类型、hash 算法与规范化版本、实际 coverage。read/snippets 绑定实际输出分区/范围与所读版本；query 绑定规范查询、许可范围、候选集合及实际相关 metadata 投影，含 nonmatch 与空集合。成功 exact 0 也是材料观察，不能因 sources 为空而跳过重验；错误、取消和纯状态不伪造材料证据。
- query 分页快照中的 WeakMap identity 仅适用于当前实例；持久版本 fingerprint 与实例身份分开。重开按路径与当前内容/metadata 重验，不声称 hash 证明跨进程对象身份。旧 cursor 仍遵守原实例失效规则。inspect 的 cache-only 证据覆盖实际结构/metadata 依赖，不为生成证据强制读正文。
- `ChatHistoryManager.serializeTurn` 不保存完整 canonical tool messages，`rebuildCanonicalTurn` 恢复为空 messages。因此从 canonical 严格提取的证据须作为现有 persisted turn 的附加数组持久化，并恢复至 canonical 顶层；保留观察身份，不按 source path 去重。无需持久化工具正文或创建第二套会话存储。
- 新嵌套证据不能依赖现有浅 metadata clone。context/history clone 与 tool/history summary 当前性判定都要覆盖证据身份；版本变化时同步刷新 prompt、sources、证据和摘要，不能复用只匹配旧 prompt/sourceRecords 的摘要。
- 本轮结构化结果按明确输出项绑定保留有效 B、撤销失效 A，并移除已失效的 cursor、exact count、完整排序/coverage 承诺。自由文本答案或摘要无法可靠分割时整体撤回该条派生消息，保留其他独立有效消息；不能仅删除 A 来源芯片后继续发送含 A 内容的原答案。此保留粒度不允许取消结构化 A+B 的选择性保留要求。
- 新 `read_note/query_notes` 成功观察强制新证据；复用旧名称的 snippets/inspect 同时保留宿主写入的新版合同标记。新版标记下缺失或 malformed 证据 fail closed；旧记录保持明确 legacy 来源检查，不能伪称已取得新版本证明。
- `prepareModelInput` 使用重验结果进行结构化投影；物理 prepare 只验证已序列化投影，发现过期即拒绝，上层再投影。最小验证覆盖空查询后新增匹配、nonmatch metadata 变化、重开证据恢复、同路径不同观察、深克隆、摘要失效、结构化 A+B 及独立历史 B 保留，不重复建立通用 evidence registry。

2026-09-15 调用点补充：`snapshotHistory` 会重新构造只含 role/content/images/memoryMetadata 的消息，不直接保留 canonicalTurn；因此 `readChatHistoryTurnMetadata`/`extractCanonicalTurnMetadata` 必须转递专用观察证据，history snapshot 的证据不能仅存在原 canonical 顶层。`ChatHistoryManager`/store 的 metadata clone 与反序列化同样须严格传递。`buildProviderInput` 当前从 input.transcript 克隆 taskTranscript，而真实 projection 另有 sourceToolMessages/history.sourceMessages；物理证据绑定应取实际序列化投影，不能用已被预算排除的累积观察并集代替。同步 source scope 检查保持，异步版本读取接入已批准的准备 hook，不将全部原同步调用方机械改成 Promise。

#### T-07 Approved Async Preparation Connection

- 主要准备点在 loop `prepareModelInput`：Memory/writingContext 异步投影后，对本轮 transcript 与 history 做一次有界 Vault 版本准备，返回无正文、不可变的证据验证快照；然后发布 note handles、同步后续策略。同步 scope 检查继续实时执行，缺少对应版本准备不是通过。
- `snapshotHistory`、canonical build/preview 与 `buildProviderInput` 消费同一次已验证 history 投影，不能从原 history 再恢复撤回材料。`prepareCanonicalProviderInput` 的现有 prepareForProviderRetry 包含新准备，所有后续异步工作完成后、同步 build 前再次检查输入/快照身份。
- `invokeForSource` 的摘要模型构建后，单独准备实际摘要 source/history。摘要快照独立，不覆盖主请求快照；变化仍走既有确定性投影降级。不能只重验 tool source 而漏 history 摘要。
- `buildProviderInput` 捕获实际 projection.sourceToolMessages/history.sourceMessages 的证据；物理 prepare 只核对这份已序列化投影。同步 onStart 再查 scope、输入绑定与 epoch；不得从另一个并行摘要/请求的准备结果借用准入。
- 整组 A+B 开始前捕获 `host.getMemoryEvidenceEpoch`，最后一个读取/hash 后比较；变化则丢弃整组结果，最多重新准备一次，持续变化失败关闭。不能逐文件标成功后忽略后续 await 中发生的变化。缺少真实 epoch 能力时，新证据路径明确 unavailable，不以固定默认值证明一致。
- GPT 已核对 Plugin 在 metadata changed/resolved 及 Vault create/modify/rename/delete 的同步部分推进该 epoch，先于 await/自写跳过；Chat/Pagelet host 均映射对应 surface 的 epoch。epoch 仅封闭事件可见的异步窗口，内容hash/规范metadata投影识别同stat变化；不将其描述为磁盘原子快照，也不复用 Memory 专属读取权限。

#### T-07 Approved Evidence Fields And Revalidation Port

2026-09-15 GPT根据实际producer快照、输出预算与双向adapter源码，并结合独立只读review，固定以下字段合同。类型名可按现有模块命名；字段含义、分区坐标与失效粒度不可由worker自行替换。

`VaultObservationEvidence` 为封闭discriminated union：共同字段为 `schemaVersion:1`、宿主生成且跨历史保留的 `observationId`、四工具之一的 `tool`、`fingerprint:{algorithm:"sha1",canonicalizationVersion:1}`、宿主解析的 `scope:{allowedPaths:string[]|null,excludedPaths:string[]}`、该工具封闭类型的 `coverage`、`items`，query/snippets另有必需的 `aggregate`。scope记录当时的任务读取边界，不枚举整个Vault或替代当前DataBoundary；重验始终与当前许可相交。hash用于内容当前性，不是模型可授予的权限凭证。

传递字段固定为宿主结果的 `vaultObservationEvidence` 与 `vaultObservationContractVersion:1`；由双向capability adapter显式传至canonical tool metadata。成功新read/query本身要求新合同，复用旧名snippets/inspect依该宿主标记区别legacy。历史turn的 `vaultObservationEvidence` 为数组，且保留同名合同版本标记；`ChatTurnMemoryMetadata`、canonical顶层和既有store序列化显式转递。严格解析失败、证据数组缺失或预算超限时不能静默删字段再按legacy放行：保留宿主的新合同要求/无效状态并撤回受影响派生材料。标记只来自受信任宿主结果和既有持久化链，不从模型普通metadata或promptText提升；错误/纯状态不标为成功材料。多个观察仍按observationId保存，模型provider投影不暴露这些宿主证据字段。

| Tool | 每项输出绑定 | 每项依赖 |
| --- | --- | --- |
| read_note | `kind:"read-result"`、`outputDigest`；单项 | `path`、`contentHash`、`part`、既有ReadNoteRange（offset相对所选分区） |
| query_notes | `kind:"query-match"`、`index`、`outputDigest` | `path`、`metadataDigest`；依envelope规范query重建相关投影 |
| search_vault_snippets | `kind:"snippet-match"`、`index`、`outputDigest` | `path`、`contentHash`、实际part、既有VaultSnippetRange（文件绝对offset） |
| inspect_obsidian_note | `kind:"inspect-result"`、`outputDigest`；结构作为一整项 | `path`、`cacheProjectionDigest`、`linkFactsDigest`、`bodyRead`及仅实际读正文时的`bodyHash` |

`outputDigest`绑定最终预算裁剪后实际输出的完整该项（含path/title/匹配文本等），证据自身不复制正文；不接受任意JSON Pointer。投影裁掉A并保留B后，必须同步重新绑定实际数组位置与输出digest，不能留下旧index。既有registry还能裁剪inspect结果：应在producer返回前复用同一预算函数完成裁剪并生成绑定，使adapter裁剪幂等；若后续仍发生内容变更则拒绝该新合同结果，不能沿用旧绑定。不要把证据生成推迟为再次读取笔记。

coverage复用真实输出的有限字段：read为`{complete,truncated,endOfPart}`三个boolean；query、snippets、inspect分别为既有QueryNotesCoverage、VaultSnippetCoverage、InspectNoteCoverage，inspect的新合同成功结果必须提供coverage。ReadNoteRange的行号沿现有从1开始的原文行号，不使用0；offset仍相对所选分区。工具顶层结果持有单个envelope，content/observation内不放宿主证据；canonical工具metadata也为单个envelope，只有历史turn顶层/turn memoryMetadata使用数组。测试正例须使用完整合法envelope，不能用缺字段/错层级/非法行号模拟有效材料。

历史严格解析失败须保留新合同要求并阻止受影响内容再次入模；不要求整个会话序列化抛错。通过既有metadata持久化该不可用状态，使正常用户消息仍可保存与重开，不能静默退回legacy。测试应断言重开后的marker与实际投影撤回，不能把throw作为唯一符合方式。

query aggregate固定为 `kind:"query"`、去掉limit/cursor的规范 `query`、`candidateSetDigest`、`metadataSetDigest`、`evaluatedCandidates`、`completeCandidateSet`、`projectionComplete`。候选digest覆盖历史scope与静态path/folder条件下的当前许可路径集合；metadata digest覆盖全部实际评估候选（含nonmatch/unknown）的规范相关投影，移除WeakMap实例identity。完整空集合也生成两项digest；partial同样生成其实际评估范围与可保留项的证据，不能只在现有complete分支生成。

snippets aggregate固定为 `kind:"snippets"`、`query`、可选 `scope`、`part`、`caseSensitive`、`candidateSetDigest`、`scannedVersionDigest`、`evaluatedCandidates`。scanned digest覆盖实际扫描的path、read/unknown-size/skipped-size状态和已有内容版本，不能只覆盖本页matches。候选集合与预算内事实读取仍分开，cap外不能因此增加stat/body读取。inspect的linkFactsDigest包含实际扫描域及相关resolved/unresolved事实，能发现新增入链；只hash旧backlink列表不足。其cache投影仅取本次实际使用的有界字段，不遍历整份缓存或为cache-only生成证据而读正文。

aggregate变化只撤销旧exact总数、cursor、完整排序/coverage与原扫描统计承诺；独立重验有效的B仍保留，计数至多重算为保留项lower-bound。无有效项且原exact0已经失效时撤回该材料观察，不保留“未找到”的断言。自由文本历史答案仍按前述整条派生消息撤回规则处理。

“撤销”作用于实际送入模型的观察JSON：仅保留有效matches、其lower-bound计数与明确partial说明，不保留旧sort、page/hasMore、scannedFiles/scannedBytes/consideredFiles、coverage计数和原cursor；不能把未知hasMore改成true或把旧数字改成0。可保留`coverage:{state:"partial"}`作为投影说明，它不是重新执行原工具后的完整输出。body-free证据仍保存原观察的有界依赖以重验有效项，不因此向模型恢复旧统计。物理准入依据该次固定投影实际承载的承诺：原生partial工具结果仍可能包含扫描事实或cursor，不能仅凭原coverage为partial便跳过aggregate重验；已明确撤除聚合字段的仅保留项投影才可只绑定项。

专用重验端口注入TaskSourceRun：`revalidateVaultObservation(evidence,{signal,isPathAllowed})` 异步返回同一 `observationId`、`validItemIndexes`、`aggregateCurrent`。复用producer的纯规范投影/hash helper与公开host API，不重新execute工具、不生成cursor；缺失API/权限/非法证据返回明确不可用或失败，不能构造成功空值。整组epoch封口、取消与payload绑定由前述prepare流程负责，单项回调结果不能独立授予dispatch。持久化重开按path+指纹验证，当前实例cursor继续保留identity校验。

严格reader先按字段/长度有界验证，再序列化：hash固定40位小写hex；observationId最多256字符；scope两个数组各最多500项，null表示全Vault边界，不展开全库；query字段复用现有规范query的全部上限。query path沿既有1024上限，其余输出path不得超过该工具现有JSON输出预算；不把query的path上限额外强加给原已支持的read路径。items最多read/inspect各1、query20、snippets10；拒绝未知字段、重复index、非法范围和非安全整数。新增证据自身限制为单envelope 128000 UTF-8 bytes、单turn最多64个envelope且合计512000 bytes；这些限制在源码集中定义。超限不截断依赖后继续声称有效，应撤回受影响材料及派生消息并保留明确不可用标记。严格clone/持久化和历史选择均执行限制，不能通过多个合法envelope绕过总量预算；这些host-only证据不扩大模型上下文预算。

#### T-07 Approved Pagelet Physical Projection Connection

Pagelet不经过Chat的TaskSourceRun composition：实际接缝是runtime的 `dependencies.createModel(context)`、Plugin的 `createPageletNativeModel` adapter及native model自身的prompt压缩。为复用同一专用验证器而不改造整个Loop，向 `PageletAgentModelContext`/native options加入宿主回调 `bindVaultObservationProjection(transcript)`，返回该实际投影独有的 `{prepare(signal),assertCurrent()}`。Plugin显式转递；runtime用当前host/许可/frozen anchor构造回调。prepare执行上述有界整组版本重验，assertCurrent同步检查同一binding与epoch；不是model可调用的新工具。

native model在现有prepareForProviderRetry和本地prompt投影之后绑定实际transcript，模型options中的 `prepareProviderRequest`/同步onStart调用该binding，再通知既有 `notifyProviderRequestStarted`。invoke fallback重新准备和绑定自己的实际输入；每次物理prepare持有该次binding，await后不能使用另一个投影更新后的可变状态借用准入。保留ProviderRequestScope的detached等待/取消和既有Loop deadline，不在Pagelet另建调度器。新合同材料存在而回调缺失时明确失败关闭；没有新合同材料的旧路径保持原边界。

实际fallback目前复用同一chain，需在Pagelet native本地为stream与fallback invoke各建独立attempt：各自model hooks、只赋值一次的最终投影binding与chain，未绑定前hook拒发。可用本地runnable wrapper令既有streamWithInvokeFallback的stream委托初始chain、invoke委托fallback专属chain，不改Loop或通用调度。两个attempt共用既有ProviderRequestScope，但不共享可变currentBinding。model构建后仍运行prepareForProviderRetry；prepare同时受物理signal和该providerInput的turn生命周期约束，不能只使用context的request.signal。每次onStart按binding.assertCurrent→原notify执行，不能提前去重notify，因为Loop在首次通知判断之前还会检查每次请求deadline。增加旧stream binding迟到时不能借用fallback B、新prepare取消/超时零dispatch的实际native回归。

现有 `projectPageletTranscriptForPrompt` 会把工具JSON压成自由文本或直接截断。对新合同四工具的结构化观察按完整观察作为预算单位保留或隐藏；不得把自由文本摘要重新hash成“模型读过完整原项”的绑定。共享source重验先完成A/B选择性投影，Pagelet预算随后决定哪些完整观察进入请求。隐藏观察不进入physical binding，也不作为模型已读正文的质量依据。已保留观察的正文支撑仍要求实际非空body分区/片段，properties-only或query metadata不能升级；旧工具压缩策略不顺手重构。增加真实native model预算/重试测试，证明隐藏材料不进入请求或正文支撑、已保留B仍可用，atomic预算选择不替代来源失效的A/B选择性保留要求。

### T-08 Approved Read Slice

P1已验收。以下既有调查边界定为T08只读切片；不涉及D2尚待决定的治理动作。具体TypeScript字段命名可按现有类型作兼容细化，不能改变以下闭合语义：

- 三个Chat工具固定为`get_memory_status`、`query_memories`、`get_memory_usage`；在主Agent首轮注册且与执行名单一致。关闭Memory不隐藏状态入口，handler仅给无内容状态/管理导航；普通Pagelet发现不获得这三个管理入口。
- `AiServiceHost`新增可选窄`MemoryManagementReadPort`，提供状态、查询、使用记录读取和`prepareObservation`。缺port/未就绪明确unavailable。Plugin通过现有Control Center/治理缓存/已有历史读取实现，不初始化、迁移、refresh、重建、学习或写入。必要adapter保持单一职责，不新增通用registry或日志store。
- status输入为空对象；query只接受有界文本或准确item ID、现有lifecycle筛选及limit/cursor；usage默认当前run，历史查询显式绑定conversationId/turnId。沿已有tool schema/output budget，游标绑定本次许可结果身份，变化后失效；host只读回调提供当前run真实上下文记录，不把模型提供的使用声明当证据。
- 结果仅投影必要产品状态、真实ID/实体种类、可披露文本、authority/scope/effect/lifecycle/时间和许可来源、真实详情target；治理revision及旧实体指纹分别表达。集合先按Memory开关/来源许可和查询条件过滤，再计数/分页；无法确定的领域说明unknown/partial。paused可管理但不升级个性化；forgotten不恢复正文。
- 宿主证据固定`purpose=memory_management`，只承载上述状态/条目/历史身份及有界指纹，不嵌完整本地管理快照、函数或模型授权字段。每次prepare通过同一port重新核对当前cache sequence/target、分区、开关、边界及实际领域记录。status/empty/count/cursor也绑定相关查询身份；有效B可保留，失效聚合不继续称exact。沿T07既有clone/history/summary与物理dispatch接缝接入专用管理证据，不伪装文件路径或search_memory召回。
- usage保留`writing generation snapshot`、`context record`、`unknown`的证据区别；只有现存物理写作快照可说明对应生成的dispatch快照，contextUsed/trace只说明选择/上下文记录。历史使用不因当前revision改变而重写，已忘记/不许可详情须撤回；无记录不推断因果。复用现有会话lifetime和写作版本身份，不加使用日志。
- 先通过真实registry/host/投影接缝建立最小合同测试，再实施；新能力缺失须表现为明确业务断言失败而非导入错误。负例覆盖关闭/未就绪零副作用、许可先过滤、不同身份、不恢复paused、usage等级/历史删除窗口、修订/边界变化后的物理发送撤回。既有T07时序测试可复用，仅补新管理证据消费者缺口；完整gate与真实动作/详情导航仍由T10统一执行。

T08 r2验收校正（2026-09-16，恢复上述合同而非新增功能）：证据必须绑定实际query/usage请求与读取结果，含筛选、limit、cursor及当前run回调；query允许无筛选的有界分页列举，保持provider schema与执行一致。持久证据只放闭合可序列化身份；当前物理发送的宿主有效性guard可作为准备结果的非序列化内部字段，必须在onProviderRequestStart再次同步检查，答案/摘要/SDK重试均适用。历史assistant/摘要与新toolResult都必须消费管理证据，缺port或无效新合同不能按旧无证据历史放行；独立条目B保留与聚合exact撤回同时成立。历史usage身份来自原版本/会话，当前revision变化本身不撤销过去的事实；所有分支仍撤回已忘记/不许可详情。status读取真实学习开关，独立表达停止新学习与使用已有理解；不能原样输出未按许可过滤的索引数量，unknown/blocked领域不声称complete。query保留ControlCenter已有supportedActions及真实item target，不新增执行权限或详情页面。

P1 等待期间已完成下列只读接口调查，供 T-08 定稿；不提前派发 P2 实现：

- `Plugin.getMemoryControlCenterSnapshot()` 是现有聚合入口：MemoryManager.getStatusSnapshot、scheduler 克隆快照、治理视图；scheduler 不在时 Profile 使用 existing-reader，只读现存 DB，意外 upgrade 中止。Type-C 未加载报告 not_loaded。新 host adapter 复用这些只读入口，不调用 ensureReadyForChat、syncMemoryExtractionRuntime、scheduler 初始化/提取/refresh，不开启 includeVaultInsightsInPrompt。
- `get_memory_status` 只返回状态/数量/降级原因；`query_memories` 投影真实 items 的身份、authority、effect、lifecycle、时间与许可来源，过滤分页有界。Control Center 是管理视图，不是 provider-ready 内容：Memory off 或来源不许可时仍可能含 label/provenance，不能直接整体入模。主开关关闭时遵守现有合同，只解释状态与管理入口；关闭学习与暂停单条使用分别表达。迁移确认 token 等管理快照字段不暴露。
- `get_memory_usage` 限定当前 run 或明确指定现存 conversation/turn；历史用已初始化 ChatHistoryManager.getTurns，不为查询 initialize/write schema。普通 Chat 的 governedMemoryTrace/contextUsed 早于实际 dispatch，仅可报告已选择/上下文记录，不能证明因果或每次请求均发送。没有记录返回 unknown，不从当前条目反推历史。
- 写作有更强证据：runtime 在 writingRequest 下从最终投影建立 preparedWritingGeneration，物理 onProviderRequestStart 重验后才固定 writingGeneration；stream-bridge 随 artifact/recovery 交付，WritingVersionService.get 或 writingRecovery.generationInput 可只读恢复。identified Personal 的 `{claimId, revisionId}` 证明该次写作生成记录包含相应版本；只代表对应输出最近一次 dispatch 快照，不是完整请求日志、服务端确认或因果证明。Insights 仅 none/unknown，task 文件版本仅 current_process path/mtime/size，不夸大可恢复强度。
- 优先使用该写作快照，缺失时降级 contextUsed，再无则 unknown；不能以当前 claim 内容替换历史 revision。无需新增持久日志。最小测试接缝为 plugin-record-note 的现有只读/开关测试、profile-store-existing-reader、memory-control-center、pa-agent-history/chat-history-manager 与 WritingVersion/history-store 的恢复合同。

T-08 接线准备补充：

- `AiServiceHost` 当前没有 Control Center 查询端口，新增窄可选只读 port；Plugin adapter 从当前实例取 live 状态，缺端口报告 unavailable，不能回落为自动初始化。不要把完整管理快照作为 tool JSON。既有 `MemoryControlCenterItem` 有真实 id/claimId、authority/effect/lifecycle/provenance，但没有 activeRevisionId；后续来源重验和过期动作需要从当前治理 state 显式补上版本身份，不能用 updatedAt 假装 revision。
- `getMemoryControlCenterSnapshot` 的 `durable` 数量和 `toMemoryControlCenterItem` label/provenance 是本地管理视图，未按 provider 许可过滤。Agent 查询必须在 host 侧复用当前 `isGovernedMemoryRevisionAllowed`/Data Boundary，先过滤再计算匹配数量；不得让来源不许可的 label、path、计数从新入口泄漏。主 Memory 关闭只返回无内容状态与管理入口。暂停使用的记录可以作为用户明确管理查询的对象，但不能因查询而恢复其个性化效力。
- 分页/筛选基于已许可、确定的只读投影，保留真实 scope/effect 与状态；缺失/未加载和空结果分开。查询证据与治理背景使用证据区分，尤其 paused/stale/forget_pending 不能从管理观察升级为 future_answers。forgotten marker 不回填 label/provenance 或旧历史内容。
- 详情导航已有 `ChatContextUsedItem.memoryClaimId` → `ChatView.host.openMemorySettings(targetId)` → `Plugin.settingTab.openGroup("memory-personalization", targetId)`。复用该目标导航，不编造不存在的 obsidian URL 或第二套管理页面；未找到 target 的既有行为回到管理区。T-10 仍实际点击验证入口，不以 tool JSON 含 id 代替可达性。

2026-09-15 T07实施期间的独立只读核对，供T08接口定稿（不提前实施P2）：

- `getMemoryGraphTopologyEpoch`只组合Vault变更与Data Boundary身份，不包含治理commit/修订/暂停。现有writing-style host已经要求`state.commitSequence >= deviceMemoryCacheRefreshTargetSequence`；repository提交订阅同步推进target，异步缓存稍后追赶。管理查询复用这个准入门，缓存未追上时明确unavailable；不能调用含队列/GC工作的refresh来满足只读查询。
- `isGovernedMemoryRevisionAllowed`可复用provenance许可检查；`getMemoryExtractionPromptContext.isSourceCurrent`还强制active，不能直接拿它授权paused管理观察。管理结果中的effect仅为被查询记录的字段，不写入governedMemoryTrace/userProfile，不宣称该查询证明后续个性化使用。
- 当前MemoryEvidenceRegistry只承载search_memory，路径型TaskSourceRun也不能以claimId伪装笔记来源。拟增加窄`MemoryManagementReadPort`（status/query/usage与专用prepareObservation），证据固定purpose=memory_management，沿T07已经验收后可复用的准备/实际dispatch/history位置显式接入；不扩展通用registry/store，不把管理读取变为语义召回。具体闭合字段与接线在P1验收后定稿。
- status即使没有claim也要绑定实际公开状态；query绑定许可后的条目/相关修订、管理投影和查询集合，覆盖empty/nonmatch/count。独立有效B保留；聚合过期撤销exact/cursor等承诺。持久重验不能要求全局commitSequence永远等于旧值，避免无关治理修改清空全部历史；进程内准备则检查sequence/target、分区、开关与边界，封闭提交到缓存刷新的窗口。
- usage绑定原conversation/turn、writing version/recovery/trace的记录身份与证据等级；当前activeRevisionId变化不使过去使用记录自动变假，但已忘记/不可披露详情须撤回，不能用当前内容替换历史revision。无可靠记录时unknown；状态计数无法按当前来源许可过滤时也不暴露原管理总数。
- 这些只读入口仍涉及跨重开持久化、权限及物理重试，因此T08按reproduce→implement检查点固定负例，再连续实施；保留T10完整App出口。不会借此提前实现D2待定的治理动作。

T08条目身份补充调查：现有Control Center合并多种不同实体，并非每项都有治理claim/revision。`memory-control-center.ts`产生固定`vault-insights`聚合项、`user-profile:<profileRecordId或key>`与`confirmed:<record.id>`旧记录；Plugin再以治理records替换已迁移部分，并按projectionLinks去重profile，同时加入无label/provenance的pendingForget项。新只读port必须保持这些真实身份的区别：治理项取真实claim/revision，旧profile/confirmed/派生聚合项取各自已存在记录与有界内容指纹，不伪造activeRevisionId、claimId或可执行治理目标。只读查询不能为获得统一身份触发迁移；其状态/覆盖须说明未就绪领域，不能把缺治理版本误称所有旧数据已被忘记。具体字段仍在P1验收后随T08闭合接口定稿。

T08历史使用查询的现有生命周期接缝：`ChatHistoryManager.getTurns` 在 `isAvailable()` 为false时直接返回空数组，所以host须先判断可用性，未初始化/初始化失败不能冒充已查询且没有记录，也不能为查询调用initialize。读取前可复用只读 `captureSourceLifetime(conversationId)`；它捕获当前epoch/revision，并在删除/裁剪/变更进行中拒绝准入。`WritingVersionService.get` 只验证服务未关闭、克隆及正文hash，不能单独封闭同一conversation在其await期间被删除的窗口；usage读取应同时保持manager/versions实例身份，读前捕获会话lifetime，读后及物理发送前重验。对应最小回归为未就绪零初始化/零写、读写作版本期间删除对应turn或conversation后撤回；跨重开仍重新读取原记录及内容身份，不把进程内epoch当持久记录身份，也不另建日志或lifetime registry。此为源码设计依据，尚未执行T08回归。

### T-09 Admission Preparation

D2已于2026-09-16由用户确定：明确指令直接保存，仅歧义或风险时确认。以下历史调查中的待定确认接缝按此选择细化；不把正常明确动作统一改为确认卡，也不以模型confirmed字段替代真实用户请求。主Agent负责语义判断，host负责请求来源/生命周期、目标版本、确定风险与实际持久化约束；不引入关键词路由器。自动Type-A语义receipt仍只用于其既有治理证据，不能伪装成直接用户动作。

#### D2接入边界（2026-09-16）

- 增加一个固定名称`manage_memory`领域工具与窄`MemoryActionPort`，覆盖remember/correct/pause_use/resume_use/apply_device_wide/limit_to_current_vault/forget/retry_forget/undo_recent_change。新增`memory-management`权限仅允许此固定工具、Memory来源边界和真实host port，不放开其它非写作框架工具；不标成read-only，也不套用会强制每次确认的笔记四写流程。缺少依赖时诚实不可用。
- runtime以现有runId、source-user身份、原始本轮prompt及取消/lifetime建立调用内用户请求上下文，经既有executor传至工具。模型仅提供动作参数与有界原话，不能指定host身份或提交confirmed/approved。host校验原话来自本轮原始用户消息、run仍有效、参数未漂移；这只证明来源和绑定，不能将子串命中宣称为语义授权。主Agent判断整个顶层用户请求，分析/翻译引文与笔记伪指令不能作为执行理由；T10须有真实模型负例，不能用mock断言冒充这项语义证据。不新增关键词判定器或独立意图模型调用。
- 精确动作身份包含host生成的本轮用户请求/消息身份及动作、目标、范围；另绑定完整规范参数fingerprint。身份不以content本身去重，也不跨不同用户轮次全局去重。同身份同参数重放原结果，同身份不同参数拒绝；已被后续纠正/忘记的动作不能重放旧写入。复用admissionKey、现有queue/envelope与lineage；仅保留必要无正文绑定字段，不新建通用receipt存储/服务。
- 显式remember使用新`explicit_user_instruction` admission origin，沿现有风险policy和同一repository事务；origin/envelope解析与恢复需同步兼容。它不得伪装type_a或自动candidate，不接受自动语义receipt作为显式权限。低风险明确动作直接持久化；prior-review生成既有待审条目并返回详情入口，模型没有confirm工具。显式动作的authority/confirmationStrength如实标记，保留既有可撤销机制；Forget不创建带内容Undo。
- Profile目标复用既有profileKey/profileRecordId及事务expectedTargetState，同自动提取串行竞争；纠正沿已完成的expectedRevisionId接线。使用本轮host lifetime和真实最终commit guard，学习关闭不阻断明确动作，不修改学习/Memory开关。
- Chat传递既有host user-message身份及conversation身份。首轮必要时在既有ConversationPersistence/manager内预留ID，并让最终写入复用同一ID；不为此增加空会话持久化、后台服务或新日志。尚未写入的会话不能宣称已有可恢复历史；取消前后以实际事务是否提交区分，不用UI结束推断回滚。
- 复用Plugin当前actionPolicy、scope/DataBoundary、Forget/device-scope确认和Review确认入口；通过结构化结果映射applied/pending/needs_confirmation/cancelled/failed，不解析本地化文案。canonical提交与投影完成分开，pending不得报applied。返回必要claim/revision/event/queue身份与既有detailTarget，详情路由在T10集成，不新增第二套管理界面。
- 验证按T09原映射：真实runtime工具入口、explicit origin直存与风险待审、非用户来源/无host上下文/伪确认拒绝、精确重试、目标竞争与取消/失败/投影pending。当前reproduce先固定已有函数的入口与origin业务缺口，不能把其红灯当其余不变量已覆盖；后续实现补齐这些必要负例，完整gate和真实App留T10。

P1 等待期间只读核对的后续设计输入；不提前派发治理实现，也不改变现有 admission authority：

- 明确记住沿本轮 Chat 的 host 证据 → Plugin 串行动作 → 现有 `MemoryAdmissionCoordinator`/repository 事务 → 原投影恢复 → 读取 committed claim/revision/effect。不得通过自动提取器模拟用户动作，或把 `profileGovernancePort.mutate` 当权威写入入口。现有 candidate adapter 强制 `pa_inference`，模型 metadata.confirmed 不能提升 authority；现有 type_a/memory_candidate origin 也不能假冒直接用户动作。
- `locateChatMemoryQuote` 已可由 host 定位 messageId/conversationId/contentHash/quote span，但合法用户来源不等于明确持久化许可。新动作必须另外绑定实际用户选择、确认内容/范围及当前 run lifetime，不新增关键词意图路由器；确切确认接缝在 T-09 派工前固定。笔记伪指令、用户仅要求分析引文均不授予持久化许可。
- 幂等复用 admissionKey 与 source/rule lineage，绑定 host action/request identity、规范内容/范围 fingerprint、目标 claimId/activeRevisionId 或确定 absent 状态；同动作重试复用结果，同 identity 不同内容拒绝。不是全文语义去重。Profile 类对象复用原 profileKey/profileRecordId 才能与提取 batch 命中同一 target，不能新增独立 claim 后声称已解决双份记录。
- Admission 已在事务中比较 Type-A expectedTargetState，并防止低 authority 覆盖 explicit_user/user_correction，可复用。普通 `Plugin.correctGovernedMemory` 当前不传 coordinator 已支持的 expectedRevisionId，且 coordinator.correct 的 isCurrent 只在 builder 内检查；T-09 需将目标版本和取消/来源 lifetime 接到真实 repository commit guard。旧目标不得覆盖等候期间产生的新修订。
- canonical commit 成功与 Profile outbox 派生完成分开报告，pending/失败不冒充完整生效。关闭学习不能阻断真实显式动作，也不能通过显式动作启动学习或打开 Memory 使用开关；既有 policy 要求 prior review 的情况继续返回该结果。Forget/suppression/无内容Undo保持既有合同。
- 最小回归接缝：memory-admission-coordinator 的提交/同源重放/suppression、plugin-record-note 的伪 explicit 与 stale batch、memory-governance-coordinator 的 correction lineage 与提交前撤销、profile-governance-port 的最新快照串行写与失败不推进缓存。实际动作 UI 与再次查询仍为 T-10 gate。

### T-11 / T-12 Existing Insight Paths — Preparation

P1实施期间的GPT只读源码核对，供P3定稿；没有提前派发P3实现：

- `MemoryExtractionScheduler.getVaultInsightsSnapshot()`只克隆已有snapshot与边界，`getVaultInsightsStatus()`区分disabled/not_loaded/ready/stale_boundary/error。查询不可调用`setIncludeVaultInsightsInPrompt(true)`，该setter会启动刷新循环；Plugin现有`readMemoryControlCenterVaultInsights`提供状态/边界映射，保持未加载与无结果分开。
- `SavedInsightStore`构造、snapshot/list只做内存规范化/克隆，不触发persist；现有Plugin `getSavedInsightStore`从已加载settings取items。查询须沿当前Data Boundary过滤后才返回text、sourceRefs及数量。旧`collectPageletProviderAllowedSavedInsights`专供Quiet Recall，仅取active且至少一个来源、逐条读源正文；不能直接用于需要archived/user-authored记录的完整Ledger管理查询，也不能把其mtime/size检查当作旧观察hash的有效性证明。
- Ledger状态只有active/archived/promoted，influencePolicy固定weak-only；Later是Review动作，不能新增虚构Ledger状态。`ReviewQueueStore.create`已有按type/claim/scope/路径去重，但不是host动作ID和内容版本绑定；同源路径的不同版本不能由这项通用去重证明幂等。T12按明确用户选择生成`evidence_insight`与`user_kept_for_later`等既有合法Review语义，确切映射在派发前固定，不能路由到memory_candidate或自动promotion。
- `SavedInsightStore.create`每次生成新ID并写入；replayRef现为普通保存字段，未提供重复动作保护。新增动作须绑定宿主生成的身份、精确内容/范围/来源版本，同身份不同内容拒绝；稳定重复返回原持久条目，不能复制一条。归档/恢复同样绑定真实目标，避免迟到动作覆盖新状态。
- Store在`await persist`后才更新items并返回ok，但Plugin `persistPaSettingsSlice`在排队后发现unloading会返回false且不抛错，调用者当前可能把未写入当成功。T12需对实际Ledger/Review接缝补卸载/取消/队列等待/持久失败回归，确保成功对应真实保存；具体最小commit guard接线待批准，不能仅在调用前检查一次。
- `saveQuietRecallAsInsight`还有quietRecall.enabled门与accept feedback副作用，不能作为通用Chat保存入口整体复用。通用保存复用Ledger领域存储、必要来源校验和显式用户动作；不得连带改变画像、学习、笔记或默认后台发现。`pa-review-tool-provider`实际是review Markdown写入能力，不是Ledger存储接口；现有Review写作流程按原WAF保留。

## Lifecycle, Compatibility And Rollback

T11只读接缝补充（2026-09-16，仍待P2验收后派发）：Type-C已有`VaultInsightsSourceReceipt`及Plugin `captureVaultInsightsSourceValidity`；receipt覆盖生成时全部许可Markdown输入，含文件身份/ctime/mtime/size与边界，不能只重验输出里的representativePaths。`getVaultInsightsStatus=ready`只证明snapshot与当前boundary一致，不单独证明原始输入未变化；新工具须同时区分snapshot状态与来源有效性，查询不能调用setter启动刷新。`SavedInsightStore.list`是克隆只读，现有`PersistedSourceRef`的contentHash/excerptHash均可缺失；mtime/size不能证明原保存hash仍相符。T11投影要如实保留保存时间、origin/status/weak-only和来源核验强度，不把缺hash推断为当前依据已验证；正文查证沿P1工具完成，不为查询新增扫描或索引。

复用当前调用取消/deadline、来源撤销、上下文预算与每次物理 dispatch 检查。cursor 无后台服务/持久状态，无新定时器。旧工具结果 reader 与已有设置原值保留。修复或回滚不得复活忘记内容，不覆盖用户新修正；新结果没有可信 provenance 时 fail closed。

## Test Matrix

| Requirement / AC | Minimum evidence | App / integration completion |
| --- | --- | --- |
| B-140/REQ-01、B-140/REQ-11、B-140/REQ-12 / B-140/AC-01、B-140/AC-11、B-140/AC-12 | runtime/control policy/四写与旧结果回归 | T-07/T-14 多起点与确认/取消/Undo |
| B-140/REQ-02、B-140/REQ-03 / B-140/AC-02、B-140/AC-03 | query/read/search、日期字段、稳定续页、长文后半段 | T-07 真实日期与正文任务 |
| B-140/REQ-04、B-140/REQ-10 / B-140/AC-04、B-140/AC-05 | source guard/read plans、revocation/context/provider retry | T-07/T-13 anchor 与实际 dispatch |
| B-140/REQ-05、B-140/REQ-07 / B-140/AC-06 | read model/status/usage，无维护副作用 | T-10 查询与解释 |
| B-140/REQ-06 / B-140/AC-07、B-140/AC-08 | admission/governance/持久化、重复/过期/forget | T-10 实际治理和再次查询 |
| B-140/REQ-08、B-140/REQ-09 / B-140/AC-09、B-140/AC-10 | snapshot/Ledger/Review/Pagelet，无选择无副作用 | T-13 保存/回查/忽略/无洞察 |
| B-140/REQ-13 / B-140/AC-14 | API 版本、cache/raw 一致、I/O、写入原子性 | T-07/T-14 API 与实际 App |
| B-140/REQ-05、B-140/REQ-06、B-140/REQ-07、B-140/REQ-08、B-140/REQ-09、B-140/REQ-10、B-140/REQ-11、B-140/REQ-12 / B-140/AC-13 | 最终冻结输入全量 gate 与逐项证据 | T-14 三主线全项验收 |

## Open Design Findings And Approval

2026-09-14 GPT 根据源码与独立只读 review 确认 T-03/T-04 设计，2026-09-15 两项 source 已验收，T-05 已批准并派发。T-06 上述接口细化经源码和只读 review 核对，依赖 T-05 source 验收后按既定 reproduce → implement 检查点派工；不能将 missing export/import 当作目标行为红灯。尚未细化的 T-07～13 接口仍需任务前设计。用户已授权整体开发；各切片按同一契约完成设计后继续，不重复索取实施许可。

### T09独立底层切片（2026-09-16）

T08源码验收后，先固定既有纠正的expectedRevisionId与repository最终commit guard不变量。此切片不选择新Chat记住/纠正提案的授权交互，不改silent admission或引入新持久化入口；D2仍待用户选择。先以真实repository边界及既有Plugin fixture复现，核对负例后最小接线修复。完整T09动作及T10 App验收仍保留。

已有纠正的目标版本以用户编辑时展示的真实revision为准；不能在提交或排队后重新读取最新revision并将其冒充原目标。Pagelet与Control Center沿既有动作入口传递只读投影中的版本身份，由coordinator事务比较；这是AC07过期目标约束的接线，不改变D2新提案的保存交互。缺少可证明目标版本时返回失败/要求刷新，不按ID静默覆盖最新修订。先在真实Plugin/repository fixture固定旧记录被更新后再次提交的负例；版本元数据不写入legacy持久记录，不建立新版本服务。
