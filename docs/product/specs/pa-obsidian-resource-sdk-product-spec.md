# Obsidian Resource SDK Product Spec

Document status: Current
Updated: 2026-10-14
Work item: B-174
Decision: [DEC-064](../decisions/dec-064-obsidian-resource-sdk.md)
Authority: Owner确认的产品范围、行为与边界。2026-10-13授权开发测试，2026-10-14进一步授权完整复核、closeout与本地master提交。Current表示本地验收合同，不代表发布；接口与接线见Current Architecture。

## Problem And Product Outcome

PA 应能完成日常 Obsidian 管理，并让 Agent 以代码组合读取、自定义算法和真实操作。
用户不必替 Agent 拼凑固定流程；执行结果可核实、资源有保护、变更可查看，恢复能力不夸大。
这延续“安静且可信”：减少手动整理，同时不让失控脚本拖住主线程或把未确认结果当作成功。

## Requirements And Acceptance

| Requirement | 产品行为 | Acceptance |
| --- | --- | --- |
| B-174/REQ-01 | 保留独立计算，新增 Obsidian 内部可组合执行；Agent 算法在 QuickJS Worker，宿主只执行具体接口 | B-174/AC-01：脚本可组合读取→自定义计算→真实操作；现有 execute_code 仍无宿主 I/O；无 raw app/DOM/OS shell/任意宿主回调 |
| B-174/REQ-02 | 完整资源枚举、文本原文及二进制字节读取；区分目录、文件、空、缺失、范围受限与部分结果 | B-174/AC-02：Markdown/Canvas/Bases/附件及空目录场景表达准确；分页/续读覆盖可见；字节往返一致，资源失败不伪装完整 |
| B-174/REQ-03 | 检查元数据、链接与解析目标，区分缓存、保存文本、编辑器来源 | B-174/AC-03：缓存过期/未知、未解析链接、未保存 buffer 如实返回；不以当前 stat 冒充缓存源版本、不引入第二个索引 |
| B-174/REQ-04 | 文本 create/replace、mkdir、原生 move/rename、trash 共用 Operations；覆盖已确认的文本、目录和附件相应操作 | B-174/AC-04：冲突不覆盖，同路径换对象不误写，move 真改路径，mkdir 只记录实际新建目录，trash 不永久删/不级联附件与引用者；部分效果、review 与实际 Undo 能力准确 |
| B-174/REQ-05 | 读取明确 workspace/editor 上下文、打开资源、按快照编辑原 editor | B-174/AC-05：编辑器身份/版本变化不误写另一个 pane；保存文本与 buffer 分开，打开/编辑效果可确认，不以 UI 变化冒称磁盘已保存 |
| B-174/REQ-06 | 工具及 SDK 职责清楚，沿现有发现机制；Agent 自主安排目标、工具与步骤 | B-174/AC-06：native/compat 均能发现所需能力，合法未加载调用仍按权限准入；无重复 rename/time/list_tools、新 loader、固定调用序列或强制 Skill |
| B-174/REQ-07 | 参数、权限/来源、身份/版本、资源、取消和生命周期由原 Host/owner 承担 | B-174/AC-07：动态子调用不能绕过最终执行链；错误参数/被排除来源在读取或首效果前拒绝；真实在途与字节有界，完成后可继续，不设累计任务额度 |
| B-174/REQ-08 | 结果、来源与效果独立于脚本 return 保留；跨脚本可复用有效读取事实 | B-174/AC-08：取消/异常/未 await 后仍可查已发生或未确认效果；下一轮与历史不丢合法事实；凭证不依赖旧 Worker、不授予权限，不自动重放未知效果 |
| B-174/REQ-09 | apply 按已有授权直接执行；preview 全入口零效果，读取真实宿主状态 | B-174/AC-09：preview create 后真实 read 仍不存在；workspace/既有工具不能绕过预览；apply 重新检查，不执行旧预览票据，无自动事务回滚 |
| B-174/REQ-10 | 保持现有平台/安装/数据边界；本轮为核心 SDK，第三方插件仅有扩展接入方式 | B-174/AC-10：三文件安装、最低版本兼容与必要 desktop/mobile 证据可核对；卸载/reload 无遗留任务；无新权限、任意网络/插件执行、持久脚本状态或虚构全平台通过 |

## Scope And Non-goals

核心 SDK 方法及便利入口的技术清单在 [Architecture](../../architecture/obsidian-resource-sdk.md#工具与-sdk-职责)，不另复制逐方法参数。
文件类型不是权限凭证：普通 vault 内容服从现有 Data Boundary、来源范围与写入授权；`.obsidian`/插件配置、vault 外部路径等不因“通用文件”自动获得访问权。
来源选择约束读取已有笔记；Web 来源下可按已有写入授权新建目录和文本，并打开、必要验证及撤销本任务可信创建且仍为同一对象的输出。输出范围、碰撞和外部替换检查保持，不因此开放原有私人笔记读取。

不包括：OS shell、主线程运行 Agent JS、任意 npm/模块下载、插件安装/启用、通用第三方插件 API、跨 vault、完整虚拟 Obsidian、跨文件事务、永久删除、二进制 create/replace、PDF/OCR/媒体理解及新的网页正文抓取服务。现有图像/网络能力保持各自合同。

## User Flow And States

Agent 可以直接调用日常工具，也可调用脚本完成组合任务；没有必经脚本、预览、加载或确认步骤。
写入沿现有 review/Undo；缺少必要能力时保留已完成部分，由 Agent 根据真实工具结果正常收尾。
未注册、当前不可用、输入可修正、对象/版本变化、资源限制和效果未知应可区分；它们不是 Host 对任务完成度的裁决。

脚本状态与操作状态分别呈现。脚本取消后，已开始的宿主调用可能继续完成；恢复查询不启动新效果。
Undo 有效性由具体 owner 决定。Owner 在 [DEC-064](../decisions/dec-064-obsidian-resource-sdk.md) 明确批准两项限制：2026-10-13 桌面 mkdir 保留创建、preview、review 和准确效果说明，安全 Undo 暂不可用；2026-10-14 已授权且安全原生回收可用时，仅文件/备份容量不足仍允许回收，明确本次 PA Undo 不可用并说明容量原因。AC-04 采用这两项例外，其余恢复要求保持。实际验证与未覆盖环境见[验证记录](../../archive/2026/b174-obsidian-resource-sdk-validation.md)，不预先接受其他降级。

## Trust, Data And Authority

- 来源身份、读取快照与结果依赖共用 TaskSourceRun 体系；脚本不能伪造清除来源或自行声明写权限。
- 2026-10-14 Owner要求完整修复六项过严约束：跨用户轮历史按其原来源及当前边界保留；运行期resourceRef过期不自动撤销已交付回答，也不恢复旧ref的执行资格。暂时并发字节不足应背压等待；部分Undo续恢复保留已恢复对象上的用户增量；通用资源接受合法ZWNJ原名；Skill语法指导按需使用。
- 运算在本机执行；送给模型的输入/输出、现有能力的网络请求及成本仍依原 provider/source 合同。不会因“本机计算”宣称整项任务不向模型发送内容。
- 文件 refs、快照和字节缓存仅在现有运行/会话生命周期内；历史只沿原历史与有限效果事实路径保存，不新增正文/附件备份平台。
- 已支持的明确写入不增加常规确认；真实边界变化和不可逆效果保持原要求。

## Open Decisions

暂无未定产品选择。若后续证明必须改变能力、恢复、数据或兼容性承诺，按 DEC-064 提交具体选择。

## Implementation And Validation

- [Architecture：职责、接口与接线](../../architecture/obsidian-resource-sdk.md)
- [B-174 验证与边界](../../archive/2026/b174-obsidian-resource-sdk-validation.md)
- [统一职责契约](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)

已交付核心SDK范围A；通用第三方插件、二进制写入及媒体理解仍非本项范围。Git签名、推送、CI及发布各以实际receipt为准。
