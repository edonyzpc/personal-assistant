# B-187 Pagelet Chat Continuation 最终验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-24
Work item: B-187

本页保留独有应用反例、最终验证与证据限制；当前行为与接线责任由
[DEC-072](../../product/decisions/dec-072-pagelet-chat-continuation.md)和
[Product Spec](../../product/specs/pagelet-chat-continuation-product-spec.md)持有。

## 授权与处置

Owner 于 2026-10-23 收敛产品范围并授权设计，随后明确按 B-187 方案完成开发测试；
2026-10-24 仅授权本项本地 master 提交，排除 B-188 与 B-124 排期差量。本地实现提交
为 `9aadf76d`。本轮另获清理项目临时文件与已完成 active 记录的授权，不包含新提交或推送。

T-00～T-04 与五组 REQ/AC 已完成，核心与精确返回均纳入；F-02～F-07 全部解决，
没有本范围未完成项转入 Backlog。稳定规则吸收至当前 Spec，Feature Home、SDD 和 Tracker
删除；处置见 [Disposition Log](../disposition-log.md)。原包与终态 Tracker 留在
`/private/tmp/pa-project-cleanup-20261024/recent/`，Git 可恢复原已提交过程，不能代替本轮
未提交的收尾记录。清理不新增产品选择，不推进 B-182/B-183。

实施基线为 master `d48bc8a2`。实际 writer 为 GLM，经现有 pa-glm／ZAI、配置模型
glm-5.3 完成限定源码与 focused；不声称服务端实际型号。GPT 持有权威文档、独立接收、
统一门禁及真实应用验收。B-188 后续并行输入不属于本项最后构建输入。

## 必要检查与真实修复

| 范围 | 已取得证据与限制 |
| --- | --- |
| 初轮与导航修复 | 3 suites / 919 tests PASS；R2 Chat 446 PASS。F-02 修复 URL fragment 被去除，F-03 修复已有 Markdown leaf 未 reveal；真实目标红灯、调用顺序断言和独立复核保留 |
| 类型／完整门禁 | 首次 production build 暴露真实类型错误，R3 修复后 2 suites / 550 PASS、完整 TS exit 0。R3 full Jest 为 409 suites / 9882 tests PASS、自然 exit 0；build 和 deploy-current exit 0 |
| lint 环境 | 原 make deploy 因未改动的大纸纹常量触发默认 Node 栈溢出而 exit 2；同配置用 `node --stack-size=8192` 执行 full lint 通过。不修改源码／配置，不把原命令记为 PASS |
| F-05 阅读连续性 | 真实“来源展开→切笔记→从 Chat 返回”曾保留正文节点／scrollTop，但来源收起。复用现有 disclosure 后的 reading position capture，保留零布局拒绝采样；R4 105 tests、独立复核、lint/build/deploy 和同一原生触发复测通过 |
| F-06 窄来源按钮 | 350.5px 侧栏中按钮 nowrap 超过附件。局部换行修复后按钮198.84px宽／48.59px高；历史附件263px宽且scrollWidth同值，无横向溢出。未新增字面CSS测试 |
| F-07 真实 Remove | 无历史空白会话 Remove 后曾未恢复通用空态；早退前刷新修复。目标红灯 exit 1，最终 Chat 447 PASS／exit 0；独立复核、lint/build/deploy及真实 Remove 后三个问题恢复，编辑草稿逐字保留 |
| 文档／源码边界 | 最终 docs:check 348 Markdown／4427 links、diff check通过；src DOM/style扫描零匹配exit 1为PASS。原WIP冲突失败保留，不修改checker或抹去失败 |

9882项是 R3 冻结输入的完整运行；R4 的105项、R5的447项与各自 build/deploy 按受影响
输入补验。不声称对 R5 或后来混合 B-188 的当前源码重新完整运行全套。首轮 fixture／
mock 错误按真实契约修正，未修改正确产品行为以满足错误断言。

## 已部署桌面交互

环境为 repo-local `test/`、Obsidian 1.14.4，mobile off、debugger detached。使用已有
`obsidian-operations/snippet-smoke.md` 与 `note-structure-smoke.md` 的快照和内存合成发现。

- 真实讨论按钮→编辑→来源／原笔记导航→已有页复用→键盘辅助返回通过。多个候选能
  回到第二条同一内容；关闭 Detail 后留在 Chat 展开附件全文，不重建旧页。
- 附件3749／3749字符可读，320px限高；同一候选 sameNode=true、scrollTop2236.5保持。
  修复后无新增滚动的“展开来源→笔记→返回”仍 expanded=true／chipsHidden=false，
  位置2640与sourcesExpanded=[true]保留。草稿与原标签保留，没有误建文件或重复标签。
- 一次主动发送使用配置 qwen／DashScope、模型名 deepseek-v4-pro，要求只回复“已收到”
  且不调用工具；实际回复符合。已接受历史附件阅读、导航、草稿及 R4 reload 后恢复通过，
  未再次采样。不声称服务端型号、发现质量或全系统零后台请求。
- 最后 R5 部署后实际 Remove：pending=null、attachmentHidden=true、history=0、
  streaming=false、empty=true，通用问题恢复；fresh dev:errors为空。

F-01 仅为产品口径澄清：导航自身不主动发起或依赖模型调用，原生切页触发的既有后台
发现仍按用户设置运行；没有新增抑制机制，也不以该文档修订代替应用验收。

## 恢复与证据边界

原 Chat route、空白草稿／会话指针、active leaf与640.5px侧栏已恢复；关闭本轮临时
Detail／笔记标签并清除内存探针。mobile=false、debugger detached，GLM进程自然退出。
真实已接受会话 `fd129405-5a47-4655-afb5-501b4632247c` 当时保留；原 fences leaf重载后
为空，相关fixture只在测试库trash可见，未还原或改写。本次文档清理不操作测试库。

原始日志／截图在 `/private/tmp/pa-b187-20261023-MVc7bq/`；收尾只读复核了 full-tests
自然exit 0与9882总数、R5红绿退出码和447总数、build/deploy退出码及真实Remove记录。
没有新增运行测试、设备观察、CI或发布结论；窄桌面侧栏不是物理iPhone或移动端证明。
