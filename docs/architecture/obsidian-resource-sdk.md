# Obsidian Resource SDK

Document status: Current
Updated: 2026-10-14
Work item: B-174
Authority: 已实现的核心 SDK 接线与数据合同；产品范围由 [DEC-064](../product/decisions/dec-064-obsidian-resource-sdk.md) 和 [Product Spec](../product/specs/pa-obsidian-resource-sdk-product-spec.md) 持有。

## 结构与职责

`execute_obsidian_code` 在一次性 QuickJS/WASM Worker 内执行 async JavaScript body。
`execute_code` 保持纯计算；两者复用 Worker、VM 和绝对期限。Agent 决定算法、目标、
顺序和合理并发，宿主只执行已经注册且获准的具体方法。没有 raw App、DOM、Node、
任意宿主回调、任意模块安装或通用网络对象。

沿用 [Command Architecture Contract](./pa-agent-architecture-plan.md#command-architecture-contract)：

| Owner | 实际输入、判断与输出 |
| --- | --- |
| Agent | 根据用户目标选择代码、工具、参数和恢复方式；不签发权限、对象身份或效果回执 |
| CapabilityRegistry / dispatcher | 当前能力绑定、schema/validator、权限、preview 与参数准备；未加载 schema 不等于没有执行权 |
| TaskSourceRun | 具体 child 参数到达后解析目标、动态 read plan、当前来源/对象检查及结果 lineage；不预先猜测脚本未来目标 |
| ObsidianCodeRuntime | Host 生成 child 身份与父关联，保留可信 owner 结果；管理 Worker、实际在途和字节背压 |
| Operations / 其他领域 owner | 原生效果、状态、审阅和可用恢复；图片、Ghost 等保持自身权限、成本、来源和确认合同 |

每个 child 沿原 final executor 的 preflight、checkpoint、prepareBatch、再次 checkpoint、
execute 路径。准备结果绑定精确子批次，不以 turn 全局槽承接并发结果。父 Worker
不占它等待的 child permit；取消后已经开始的 owner 调用占用保留到真实结束。

主要接线在 [SDK runtime](../../src/ai-services/independent-computation/obsidian-code-runtime.ts)、
[SDK reads/context](../../src/ai-services/independent-computation/obsidian-resource-sdk.ts)、
[Operations effects](../../src/ai-services/operations/operations-resource-effects.ts)、
[TaskSourceRun](../../src/ai-services/task-source-run.ts)。不引入第二套 registry、权限、
计划、事务、效果账本或 vault 索引。

## 工具与 SDK 职责

模型可见入口为 `execute_obsidian_code({code, mode})`、`list_vault_entries`、
`vault_create_folder`、`vault_trash`；后三者分别复用 list、mkdir、trash。
其余既有 query/read/search/create/append/process/frontmatter/move 工具保持原接口。
SDK 方法标为同一 registry 的 `sdkOnly` 能力，不逐一复制成顶层工具。

guest 根对象为 `obsidian`。全部方法返回 Promise；以下表格省略该前缀。
精确参数/schema/validator 由 [读取定义](../../src/ai-services/independent-computation/obsidian-sdk-tool-definitions.ts)
与 [Operations provider](../../src/ai-services/operations/operations-tool-provider.ts) 同源维护。

| 方法 | 当前职责与关键边界 |
| --- | --- |
| `vault.list({target,recursive?,cursor?})` | 枚举真实文件/目录与空目录；默认直接子项，明确覆盖/续页，过滤排除项；不改变已有 query_notes 的完整查询合同 |
| `vault.readText({target,cursor?})` | 已保存原文、readRef/sourceVersion 和 UTF-16 范围；保留 frontmatter/换行，支持普通文本、Canvas/Bases；不冒称 editor buffer |
| `vault.readBinary({target,cursor?})` | guest 得到实际 Uint8Array，offset/length/total 以字节计；不是 opaque handle 或媒体理解 |
| `metadata.inspect({target,fields?,cursor?})` | 宿主缓存结构/属性等及其来源；未知缓存版本与空、不适用分别表达 |
| `metadata.links({target,direction,cursor?})` | incoming/outgoing、已解析与未解析链接、范围与缓存覆盖；不自建链接图 |
| `metadata.resolveLink({source,link})` | 由 MetadataCache 按源上下文解析，保留有意义的 subpath/alias；排除目标不泄露 |
| `vault.createText({path,text})` | 创建新文本，不覆盖、不隐式建父目录；不擅自修复内容格式 |
| `vault.replaceText({target,expectedVersion,text})` | 完整文本条件写回；版本绑定同对象与读取快照，mtime/size 不能单独证明未变；是否收齐正文由 Agent 决定 |
| `vault.mkdir({path,parents?})` | 显式创建目录；只记录实际新建层级，已有目录 no-change，同名文件冲突 |
| `vault.move({source,to})` | 同 vault 原生移动/重命名；不覆盖、不暗建父级，核对目录完整范围；引用更新交 FileManager/宿主设置 |
| `vault.trash({target,recursive?})` | 安全原生回收；非空目录需 recursive，完整范围仍须获准；不永久删除、不级联附件/引用者 |
| `workspace.getContext({viewId?,includeText?,cursor?})` | 一个实际 view/editor/file 的无损 buffer/selection 与 snapshot；无 editor 明确不适用 |
| `workspace.open({target,position?})` | 宿主打开及可得定位事实；是 UI 效果，不表示保存或内容理解，不伪造 Undo |
| `workspace.applyEdits({snapshotId,edits})` | 对原 editor 的同一快照坐标提交一次 transaction；不随焦点转向别的 pane，不冒称已落盘 |
| `operations.getStatus({intentId})` | 原 owner 可见 intent 的实际状态、操作及 Undo 可用性；只查询、不重放 |
| `operations.undo({receiptId})` | 原 owner 的会话内有效反向操作；身份、当前范围、碰撞及具体恢复资源仍需有效 |

`tools.<name>(args)` 调用当前绑定且获准的既有能力，保持其原结果格式。
`load_tools` 只影响后续 provider 请求披露；不安装、不授权，也不产生嵌套 Agent/Worker。
指导按当前 registry 实例生成；Skill 只提供按需语法帮助，没有必经 Skill 或固定工具顺序。
固定 `markdownit`、`jsyaml` 在 guest 内可用，版本与许可见 package/THIRD_PARTY_NOTICES；
没有任意 import 或运行时下载。

## 数据与身份合同

`ResourceTarget` 必须且只能是 `{path}` 或 `{resourceRef}`。path 在本次准入时解析
当前对象；ref 指向先前观察的同一原生对象，移动后可跟随当前路径，但不能在同路径
重建后绑定另一对象。一次新的 path 查询可以发现新对象，旧 ref/version 不因此复活。
引用、快照和 cursor 由 Host 持有，不是授权凭证，也不依赖原 Worker 存活。

所有 `obsidian.*` 返回 `SdkResult<T>`：成功为 `{ok:true,value}`；失败为
`{ok:false,value?,error:{code,message,executionState?,recovery?}}`。
失败中的 value 只能保留已准入观察/真实部分效果。`ok` 不替代领域状态；JS 程序异常、
无法回包或 Worker 终止不保证有结果，也不证明没有效果。`tools.*` 不套第二层包装。

文本读取返回 path/resourceRef/readRef/sourceVersion、text、`range:{start,end,total}`、
coverage 与可得 nextCursor。range 是原快照全文的零基 UTF-16 半开区间，不归一化
换行/Unicode，续页不切断代理对或 CRLF；binary 使用明确 byte codec 和字节范围。
cursor 绑定原查询、对象与版本，不能混用到新查询或新对象。

三种事实保持独立：vault.readText 是保存文本，workspace snapshot 是实际 editor buffer，
metadata 是缓存观察。缓存没有可证明的文本版本时返回 unknown，不能当作写回凭证，
也不强制等待刷新。全文 replace 的 expectedVersion 来自原保存文本 sourceVersion。

editor snapshot 绑定真实 leaf/view/editor/file；原生 CRLF 规范化后的 buffer 才是坐标
依据。`edits:{from,to,text}[]` 全部基于同一原快照，范围合法且非重叠；同位插入和
邻接插入需先合并以消除顺序歧义，边界不能切开代理对或 CRLF。焦点变化不改变目标，
关闭/替换或 buffer 漂移拒绝提交。编辑与 Undo 都在实际事务前复核当前文件路径，
允许范围内同对象移动不被一概拒绝；移动到排除范围不以旧 receipt 路径放行。

通用路径接受长路径、合法 ZWJ Emoji 和 ZWNJ 原名；保护目录比较单独折叠连接字符。
路径穿越、危险控制字符、保护目录及 vault 外路径仍拒绝；宿主文件系统限制如实报告。

## 来源与效果连续性

Host 为 child 生成调用身份，合并父输入及本 guest 已收到的来源；不信任 guest 自报
无依赖，也不做逐值污点追踪。来源上下文进入实际领域 owner，含图片等持久任务的
后续提交/交付检查。原 owner 先保留真实效果，再向仍活跃的 Worker 回包。

父交付前再次检查当前来源及动态聚合 lineage。合法自身 create/move 的 graph 变化
不等于撤权；配置撤销、排除和取消仍阻止未获准正文。对象/版本变化使旧执行目标
失效，不自动撤销已经接受且权限仍有效的历史读取快照。

跨用户轮的 SDK 回答按原来源和当前边界投影；新 runtime 没有旧 resourceRef 不代表
用户撤销回答，也不恢复旧 ref 的执行资格。Web 来源可按既有写授权新建输出，并
打开、验证和撤销本任务可信创建且仍为同一对象/内容的输出；不会开放既有私人笔记
或没有可证明来源的 metadata。

子效果经原工具名、调用身份和 owner 事实核验后进入父结果、下一 provider 输入、
历史和 Debug 子事件；guest 返回同名 JSON 不能签发回执，不追加模型未发起的孤立
toolResult。intent、operation、receipt、resource/read ref 各保留原含义。
Operations、图片和 Ghost 仍使用各自已有查询/历史路径，不虚构新的通用状态服务。

## 效果、预览与恢复

父 preview 不被 child 的 apply 参数提升。读取真实宿主状态；有 preview 的 owner
返回预览，无 preview 的效果明确未执行。create 后的 read 不会看到虚拟新文件。
apply 重新核对当下事实；无跨文件自动回滚、额外常规确认或必经预览。

| 效果 | 恢复合同 |
| --- | --- |
| 文本 create/replace | 原会话 before/expectedAfter/receipt；同路径换对象、碰撞、撤权和后续编辑不被覆盖 |
| 原生 move | 复核同对象、当前路径、目录成员/范围及目的冲突后原生移回；不读取/冻结正文，正常正文编辑不妨碍路径恢复；引用仍由宿主处理 |
| mkdir | 桌面创建/preview/review 保留，安全 Undo 暂不可用；移动端使用公开非递归路径并报告实际结果。不得用 recursive 或 Node/fs 绕过 |
| trash | 公开 Vault.trash 避开永久删除设置；容量可用时会话内 byte/tree 快照经公开创建 API 恢复为新对象。仅容量不足仍允许安全回收，准确说明 PA Undo 不可用且无可执行 receipt |
| 部分 trash Undo | 再次恢复只填缺失目标，保留已恢复对象上的用户编辑和无关新增内容；同对象、父目录、碰撞与权限仍检查，不放宽 move 的目录成员合同 |
| editor | 原 editor 必须仍有效且 buffer 等于 expectedAfter；通过明确反向 transaction 恢复 before，不猜测原生 undo 栈顶，不覆盖后续用户编辑 |

两项 Undo 例外的用户依据见 [DEC-064](../product/decisions/dec-064-obsidian-resource-sdk.md)。
读取错误、权限失效不能冒充容量不足。Undo 能力与实际完成事实独立；owner 关闭、
过期或 reload 后不能许诺仍可恢复，也不能将已成功效果改成未执行。

## 资源、生命周期与安装

沿用 QuickJS 堆/栈/中断与父绝对期限，不由 child 重置期限。guest 发送前和 Host
入口控制真实在途与字节；单请求超过限额返回可纠正错误，暂被其他调用占用时等待。
排队只序列化一次，释放后继续，不设置累计文件/调用次数配额。具体值在源码 owner。

Vault.read/readBinary 仍是完整原生读取，传输分页不等于磁盘分段 I/O；内存预算
覆盖读取、快照、编码和结果构造。不能安全读取时报告限制，不截断后声称完整。
Worker termination 无法抢占已经进入宿主的同步原生 API。

Stop/throw/return/unload 结束 RPC 接纳并释放 Worker、timer、listener、Blob URL。
已开始的宿主工作继续按 owner 返回真实完成/失败/未知；迟到正文不回旧 Worker，
必要时查询原操作，不自动重跑脚本。没有持久 guest 状态或跨 reload Undo。

Worker、WASM、固定库全部内嵌；安装仍仅需 main.js、manifest.json、styles.css，
最低 App 仍为 manifest 的 1.11.4。没有新设置、provider、网络下载或持久备份目录。
后续具体插件适配通过同一 registry 的明确数据接口和 owner 接入，不开放实例反射。
回退撤回新入口、保留纯计算与旧工具；不得通过隐藏入口抹去已经发生的效果。

实际验证、已批准限制及未覆盖平台见 [B-174 验证记录](../archive/2026/b174-obsidian-resource-sdk-validation.md)。
