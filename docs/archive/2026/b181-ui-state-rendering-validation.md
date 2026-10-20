# B-181 UI 状态与局部刷新验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-20
Work item: B-181

仅保留最终验收、实际交互及证据复用边界；当前行为由
[DEC-071](../../product/decisions/dec-071-pa-ui-state-rendering.md)、
[Product Spec](../../product/specs/pa-ui-state-rendering-product-spec.md)和
[实现契约](../../architecture/pa-ui-state-rendering.md)持有。

## 授权、范围与处置

Owner 授权 Operations 内部 Diff 窄修、完整 S1/S2/S3 开发测试，审查后明确暂缓两项恢复策略，
要求补齐菜单能力并按实际精简重复状态和无价值恢复槽。2026-10-20 明确要求收尾并提交到远程
master。本包以这些边界关闭，不将暂缓项记为修复或全部 AC 无条件通过。

- [B-182/B-183](../../backlog.md#已延期的产品与工程工作)：Pagelet 跨关闭/重启阅读恢复；
  Chat 附件/父版本异步核验期间新滚动与旧快照的优先策略。Owner 认为需先讨论产品边界/恢复策略，
  本轮保持现状，原 REQ/AC 目标保留。
- [T-012](../../backlog.md#触发型评估)：iPhone 验证后置，iPad 未验证；桌面窄宽不冒充物理设备。

GLM 在 pa-glm / ZAI 独立树完成前期限定实现；5 小时额度 reset 超过一小时后 GPT 接管，后续
不因额度恢复切回。接管后的跨模块/恢复实现均经未参与实现的 GPT reviewer 复核；本轮最终
文件范围和原始输入也独立核对，无代码交付阻塞。无新增 provider、计费或笔记写入能力。

稳定设计吸收至当前契约与源码/测试；Active Home/SDD/Tracker 和已吸收原型快照从仓库移除，
只保留本紧凑验证记录。原过程包（含终态 Tracker/原型）保存在本机
`/private/tmp/b181-closeout-20261020/`，不声称旧 Git 保存未提交原文，也不把临时路径作为运行依赖。
处置见 [Disposition Log](../disposition-log.md)，其他开发 track 不变。
旧 worker worktree 仍含未提交的早期草稿，予以保留，不强制删除或把草稿推入master。

## 确定性验证及输入复用

实施基线 master `e2a1a050e948bbd52d3e3c2b69e9d39d6bd42f24`。
Zustand 5.0.15、React Virtual 3.14.21/core 3.19.6 和开发依赖 jsdom 26.1.0 锁定，
旧 package entries 未升级；相应 npm ci dry-run 通过。

| 输入/边界 | 结果 |
| --- | --- |
| Operations 窄修 | 真实 React 状态红绿回归、saved/editor 身份及既有 action/Undo 合同；399 suites/9747 tests、build、全 lint、scan、diff 通过 |
| S1 任务壳/正文 bridge | focused 3 suites/444 tests；阶段 full 401 suites/9769 tests、build/TypeScript/Tailwind、全 lint、scan、diff 通过；覆盖 held 不阻塞终态持久化、撤权/删除、跨消息选区和 Mermaid 暂停/晚结果 |
| S2 恢复 | 阶段 full 404 suites/9800 tests、build/TypeScript/Tailwind、全 lint、scan、diff 通过；目标红绿修复删除后旧 history、启动待定槽、同毫秒顺序、保存失败路由及晚 missing-active 清理 |
| S3 最终列表/阅读 | full 405 suites/9807 tests，328.911s，自然 exit0；build/TypeScript/Tailwind、全 lint、scan、diff 通过；实际隐藏返回失败后仅修测量范围/语义采样，独立复核关闭 |
| 审查后菜单/精简 | 菜单 3 条及空槽 1 条目标 red→green；最终 Chat/local 451/451，加未变输入的 native/image/Operations 42/42，共5 suites/493 tests；build、全 lint、scan、diff 通过。不是最终输入重跑9807项 |
| 测试质量 | 选区独立从未held状态触发；失败root旁健康root同节点/展开/动作保持；Operations按身份关系而非字符串格式断言。只增加4条有效回归，没有扩大矩阵 |

全 lint 沿用原规则与全范围，仅临时使用 Node `--stack-size=8192` 解决未改大文件 parser 栈溢出。
DOM/style source scan 无匹配 exit1 为通过。完整 Jest 的既有延迟退出提示后均自然退出0，未
forceExit。S2 首轮 Ghost loopback EPERM 是沙箱环境失败；同输入沙箱外定向53项及后续full通过，
未弱化产品断言。原失败轮次没有改记成功。

## 实际 Obsidian 交互

环境：Obsidian 1.14.4、repo-local `test`，每次由 make deploy-current 核对对应当前构建后 reload。
使用合成服务/历史，只把真实点击、DOM、几何和宿主操作算作 app 证据，不声称新执行真实
provider/SDK 效果矩阵。

- Operations：同组模型 first→second，actual/preview 内部展开、上下文及节点保持；隐藏/重新打开
  沿用既有默认收起语义。真实权限、效果和 Undo owner 未变。
- S1：实际 Details/Response text/正文说明展开，24段可见正文期间输入下一草稿；同任务/其他
  任务刷新后节点、展开、草稿和焦点保留。终态 controller 清空、真实持久记录为 final，正文仍held；
  实际「查看最新」显示最终表格/Mermaid。popout重绑Document，后增菜单动作可用。
- S2：8turn合成历史，真实输入、滚动、正常关闭后无route新view重开及CLI正常restart；slot、
  `message:b181-s2-assistant-2`、offset -592.375、scrollTop2475.5 恢复，focus=BODY。
  restart后新主进程/旧fixture消失已核对；不扩展为异常强杀保证。
- S3：实际同row5增高约476px后后行重排，无重叠；root349px下完整长词/来源路径换行且无
  水平溢出。隐藏确认零布局后让上方row4增高，返回仍saved-5，offset -259.5547→-259.8047，
  scrollTop2481→3623.5，原root/native/list节点保留，恢复结束。可滚过36项到Memory后方区域；
  移到新窗口后外部root/native保持、内部virtualizer重建，saved-34→saved-29滚动/几何正常。
- 审查后菜单：真实打开Composer/Memory后Ctrl+Tab切走，25ms/6ms关闭，返回不重开；草稿
  未改、焦点BODY，新错误0，证明隐藏处理已执行。

临时 fixture/global/观察器/leaf/恢复槽清理已核对；原markdown leaf `40b132e1e7ec0bf8`、原Chat及
业务active pointer保留，debugger=false/mobile=false。未创建fixture笔记或调用provider。
原始阶段日志在 `/private/tmp/b181-full-20261020/`，审查后日志在
`/private/tmp/b181-followup-20261020/`；临时原始文件不保证永久可读，本页保留必要结论和限制。

## 收尾与集成边界

收尾前独立核对冻结输入：除已审查的8项followup外，S1/S2/S3源码/测试hash保持；Operations
窄修另有独立门槛。未改运行代码，收尾只更新文档。
远程master同期新增Ghost固定封面说明提交 `fb3f9b1e`，与B-181没有文件重叠，已快进保留；
合并输入的检查单独记录，不把旧全量结果扩张成组合输入全量通过。Git提交/推送结果以实际
receipt为准，本收尾不含版本发布。

组合输入重新生产build（含TypeScript/Tailwind）通过；Ghost action-context/export/snapshot与
Chat plugin integration共4 suites/125 tests、0.904s、自然exit0。收尾文档检查334 Markdown/
4300本地链接及diff check通过；只改文档不重复既有app交互。输入清单与收尾日志保存在
`/private/tmp/b181-closeout-20261020/`。
