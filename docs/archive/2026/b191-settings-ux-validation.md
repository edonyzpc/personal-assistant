# B-191 Settings UX — Final Validation

Document status: Archived
Delivery status: Closed
Closed: 2026-10-29
Work item: B-191
Authority: 已完成范围的历史验收与证据限制，不作为当前实现或执行权限来源。
Current contracts: [DEC-076](../../product/decisions/dec-076-settings-ux-and-adaptive-graph.md)、
[Product Spec](../../product/specs/pa-settings-ux-product-spec.md)、
[Settings Current Status](../../architecture/settings-status.md)。

## Outcome And Disposition

REQ/AC-01–08、F-01–21均已完成。Owner于2026-10-29授权收尾、提交master及推送，
不包含版本发布。Policy model与有效偏好保留，仅退出手动图谱宽高；没有新增设置框架、
领域权限或模型测试矩阵。GPT负责设计与独立验收，已配置pa-glm/ZAI的glm-5.3 CLI负责
实现与定向测试；服务端实际型号未单独核实。三个只读审查方向及修订后复核无剩余问题。

稳定规则吸收入上述契约与回归测试，Home／Plan／SDD／Tracker删除；保留本紧凑证据
和[已确认预览](./b191-settings-ux-preview.html)。预览是布局基线，不是运行界面；便携HTML
与收尾前副本逐字一致，SHA-256：`0327724610becab62062cd0dace08176754a0da54304d123d5e15f35f68623ed`。
无未完成实现项需要转入Backlog；处置见[Disposition Log](../disposition-log.md)。

## Requirement And Evidence

| Requirement / AC | 验收证据 |
| --- | --- |
| 01 四组与摘要 | settings回归及部署后四组／真实摘要观察；首次默认与重开尊重既有折叠偏好，重复标题与未来占位已移除。 |
| 02 连接配置 | Settings／persistence／Ghost回归；桌面Policy与高级连接、图片连接、Ghost兼容选项可达；无被动AI密钥读取或新增网络探测。 |
| 03 有效偏好 | Pagelet／settings回归；角色关闭再恢复保值，快速捕获三目标、统计、图片默认设置可达，独立控制不联动。 |
| 04 Memory | snapshot／权限／管理断言保持精确claim/event；实际暂停状态、3条遗忘标记、管理和恢复确认取消可见，无真实清理。 |
| 05 来源范围 | 来源草稿／权限队列覆盖显式保存、失败与后续编辑；桌面及mobile实际保存临时排除并恢复，生成策略编辑零提交／不取消准备。 |
| 06 自适应图谱 | 实际ViewResize几何及迁移回归；桌面普通／窄窗口图谱不越界，深度保存不resize，旧宽高无运行效果且下一次正常保存精确移除。 |
| 07 内部详情 | 共享editor／真实persistence队列保护字段patch、二次Save与失败重试；Back／精确目标／晚到结果回归和真实界面通过，不丢邻区草稿、不复活已离开详情。 |
| 08 双语双端 | locale对齐、桌面zh/en与mobile simulator en390／zh/en320、桌面200%、键盘／主题路径；移动文字输入16px、主要操作44px、320px无横向溢出。 |

## Automated Validation And Reuse

- 初始定向回归及独立修订按受影响输入推进；完整`make bin`最后一次运行的platform、
  lint、production build通过，397 suites中396通过，9574 tests中9573通过。
  唯一失败为Chat旧Clear cache文案断言，I5修正后chat suite448项自然exit0。
  这是有效证据组合，不能表述为一次完整命令全绿。
- I6只删除重复标题并修双语图谱说明，2 suites／232 tests和build通过；I7只修移动
  字号，production build及部署后尺寸观察通过，复用其他未变输入证据。
- I8修复Memory迟到导航并移动原图谱断言，先以两个有效RED证明抢焦点／替换详情，
  后2 suites／232 tests通过。I8b恢复失败按钮，settings220项、lint和build通过。
  I8c只校准已有失败用例的首轮输入，分别真实覆盖ok:false／rejection，2项通过、
  218项跳过；最终TypeScript／diff通过，生产源码未变，graph14项及其他证据复用。
  一次eslint在未改文件的堆栈溢出经原样重跑通过，未改源码迎合工具错误。
- Follow-up仅新增4个竞态／失败回归，图谱断言前移未新增用例；同一请求的失败与
  retry输入分开，第二轮受控Promise均settle。DOM注入扫描无匹配（exit1为PASS）。
- 收尾只吸收和处置文档，运行docs:check与diff检查；docs suites既有57项及其脚本／
  fixture／配置未变，复用原证据。不重复产品全量、模型、CI或真实iPhone测试。

## Deployed Interaction And Boundaries

Obsidian1.15.0，目标为原checkout的repo-local test vault。各次`deploy-current`
核验生产资产身份后复制并reload；CLI只准备／读取状态，入口与交互由原生UI操作。

- 桌面图谱：1458×949窗口中rect为550×500；深度2→3保存后尺寸不变，再恢复2。
  480×700窗口中rect为x16/y100/w384/h500。仅关闭本次创建的graph leaf。
- 来源排除临时加入不存在目录，Save前已提交值未变，Save后生效，再由UI恢复。
  其他来源范围保持；合法来源epoch推进和退役resizeStyle的正常保存投影未回滚。
- I8b部署后的受控UI记录不写真实Memory或请求provider。Pause use→Back→来源详情，
  释放迟到成功后仍为source-scope、焦点Back；待定位快照→Back→概览，释放缺失目标
  后详情仍null、焦点Open。原生观察无跳页／抢焦点；同详情重进及失败按钮由定向测试覆盖。
- 环境恢复验证：临时方法和记录移除，mobile/debug false、language null、原折叠JSON、
  Dog source、Chat空草稿、Settings关闭；无捕获错误。先前双端观察后主题、zoom和窗口
  边界亦恢复。后续仅导航逻辑改变，未重复双语／双端布局矩阵。

未运行真实provider请求、真实iPhone或发布验收；本范围没有对应行为变化或新增门禁。
开发完成、已部署test vault、Git交付与版本发布是不同结论。

## Local Evidence Provenance

原始日志与终态过程副本保留本机，不纳入插件，也不假定其他环境可直接访问：

- `/private/tmp/pa-b191-glm-20261028/`：I1–I7、完整门禁、chat修正、双端交互与恢复记录。
- `/private/tmp/pa-b191-review-followup-20261028/`：I8–I8c的RED、focused／retry／calibrated测试、lint／build／类型、部署和app状态。
- `/private/tmp/pa-b191-closeout-r2q4b9or/`：收尾前两checkout清单与副本、终态Tracker、同步白名单和最终文档／Git记录。
- 本机visualizations的`b191-runtime/`：已观察的桌面／mobile截图；截图文件本身不替代真实交互证据。
