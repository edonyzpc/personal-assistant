# B-179 Chat 表格显示兼容验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-18
Work item: B-179

本页保留独有诊断、验证与性能证据，不作为当前实现或执行状态权威。
稳定规则由 [DEC-069](../../product/decisions/dec-069-chat-markdown-table-display-compatibility.md)
及 [Product Spec](../../product/specs/pa-chat-markdown-table-display-product-spec.md)持有。

## 授权与处置

Owner 确认结构识别、显示副本补空行、继续原生渲染，并要求分析三处性能成本；随后授权
按 B-179 完成开发测试。2026-10-18 追加三线独立审查后，Owner 澄清任务编号并明确确认
“是，收尾并提交 B-179”。没有推送或发布授权。

接收基线为 master `d0e6ae609a6dfa9ab280d24ac0fdc76432e493d6`。GPT-6 负责设计、文档、
独立验收与 App；GLM 经独立 pa-glm / ZAI CLI 完成4份 source/tests，交付及 R2 修订均自然退出。
追加功能、设计/性能、测试范围三线审查及主控复核无 P0/P1/P2；没有过度设计或需删除的测试。
worker 独立 TS 与后续 build、两次 focused Chat 检查有少量覆盖重叠，后续可合并安排。

最终约束吸收至当前 Spec/Decision 和 focused tests；Home/SDD/Tracker 及 Active 入口删除，
见 [Disposition Log](../disposition-log.md)。未提交过程原文和终态 Tracker 保存在本机
`/private/tmp/pa-b179-closeout-9q3p567w/`，不声称旧 Git 保存完整过程包。
无本范围未完成项；稳定 DOM/尾部构建是未来条件性候选，沿 DEC-069 的启动条件另行决定。

## 根因与已修边界

原 Anthelion 回复的普通段落与表头之间没有空行；同一次原生内存对照中，原输入为
0 table，只在显示输入增加一个空行即为1张表、3个表头、7个数据行。markdown-it 能识别
原结构，证明此边界的解析兼容差异，不证明模型输出必然非法或所有表格都需要前置空行。
仓库及后续验证仅使用合成内容，没有复制私人会话正文或向 Anthelion 部署。

正式实现仅在 Chat 实际渲染入口派生显示副本。独立审查曾发现孤立 CR 与 LF 混合时，
parser 行号与原文偏移不同，可能把空行插入表头/分隔行之间；R2 改为非目标孤立 CR
原样透传，并增加一个回归后关闭。未扩大换行支持或增添通用解析机制。

## 确定性验证与证据复用

| 范围 | 结果 | 限制或处置 |
| --- | --- | --- |
| helper 与 Chat 接线 | 14项 helper 回归；新增2项集成检查 renderer 显示副本、原始 copy/history、Mermaid fallback；既有调度/owner/取消/迟到/关闭回归复用 | Jest renderer mock 不证明真实原生表格 DOM |
| 平台、lint、build | 平台 guard 553个TS文件；完整 lint、production build（含TS/Tailwind）通过 | 未改动的1,635,504字节 paper data 文件使默认 lint parser 栈溢出；同文件诊断后仅将 Node 栈增至8192，全 lint scope/规则不变 |
| 完整 Jest | 398 suites / 9726 tests 合并覆盖通过 | 首次完整运行397 suites通过；Ghost套件45项因127.0.0.1监听 EPERM失败，只对该53项套件在允许监听的环境补验并全部通过；没有重跑全仓或弱化断言 |
| 源码扫描与部署 | community DOM rg无匹配；`make deploy-current` 验证当前资产并部署精确 test vault，随后 reload | 构建/部署身份不替代测试，未执行外部Community扫描或发布 |
| 文档与差异 | 实施完成时329 Markdown / 4235 local links；收尾327 Markdown / 4217 local links通过，差异无whitespace问题 | 收尾不改source/tests，不重复runtime门禁 |

完整 Jest 首轮在通用异步清理提示后自然 exit1，失败来自上述端口限制；定向补验自然exit0，
没有 forceExit。原始日志在 `/private/tmp/pa-b179-dev-20261018/`：`markdown-table-compat-r2.log`、
`chat-view-table-compat*.log`、`lint-full-stack.log`、`build.log`、`test-all.log`、
`ghost-client-unsandboxed.log`、`deploy-current.log`。本页已吸收结论，临时路径不承诺永久保留。

## 已部署 App 交互

环境为 repo-local `test`、Obsidian 1.14.4、PA 2.10.10。使用实际 Chat onOpen/发送/累计
stream callback/final/停止/复制/历史恢复链；临时合成数据源代替 provider，独立内存 store
承载真实 history manager。它证明实际 App 渲染与 manager 保存恢复，不是模型评测或磁盘重启耐久性证明。

- 桌面1458×949：缺空行回复实时显示1表、3表头、7数据行；代码内竖线保持代码，代表性
  嵌入正常，实际点击内部链接打开正确测试笔记。完成、停止后实际 Copy 均逐字等于原文；
  history/store及关闭重开一致，没有额外stream请求。
- 实际700→705行累计更新末行正确，滚动及输入框可用；Stop的signal已abort，已显示内容保留。
- 官方移动模拟器390×844：真实Ask、Stop、More→Copy、历史重开及代码/嵌入通过；
  body scrollWidth=390、表宽约244.98，无页面横向溢出。不是iPhone硬件或原生触摸证据。
- 两端fixture日志为空，dev:errors无错误；关闭owner分别6→0、2→0。临时Chat、store、
  方法包装、observer和性能界面均移除，debug/mobile关闭，1458×949和原笔记恢复；
  fixture/perf global=false、Chat leaves=0、modal=0，factory恢复。原诊断先导出再清理。

原始记录与截图在上述目录的 `desktop-*.txt`、`mobile-*.txt`、`desktop-table.png`、
`mobile-table.png`、`final-runtime-state.txt`；仅含合成数据。

## 性能对照与后续路线

桌面Apple M5 Pro、Electron39.7.0/Chrome142、1458×949、DPR2；原生阶段对照正文区766×420，
使用 Chat CSS。最终helper包含HTML保护及孤立CR透传，采用短表/大表×两条等内容路径×6次
轮换，共24次稳态对照另1次warmup；无追加矩阵或常驻benchmark框架。单位ms，中位数：

| 输入 / 路径 | 兼容处理 | 原生构建 | 提交 | 至后续两帧 |
| --- | --- | --- | --- | --- |
| 7行 / 已正确源文 | 不调用helper | 1.25 | 0.10 | 16.65 |
| 7行 / 最终兼容 | 0.05 | 1.15 | 0.10 | 16.60 |
| 3万字符 / 已正确源文 | 不调用helper | 36.40 | 2.90 | 101.65 |
| 3万字符 / 最终兼容 | 1.50 | 36.65 | 3.25 | 105.15 |

两路均为1表，短表8 tr、大表706 tr。0.05为偶数样本中位数，不承诺微秒精度或统计显著性；
CJS首次加载不作为生产bundle冷启动承诺。原始数据为 `perf-final-results.json` 和
`perf-final-summary.json`；该分段对照不冒充完整Chat handler。

完整Chat单次观察：700/705行的chunk→owner为4.4/3.6ms，owner→提交前48.7/44.6ms，
发布及后处理观察0.7/5.6ms，至后续两帧143.5/147.5ms；7行加代码/嵌入对应
0.9/3.4/0.1/15.0ms。第一段含helper/buffer/Mermaid准备，第二段含原生渲染与guard，
第三段含owner卸载/链接/后处理/mutation通知；后续帧含调度/样式/布局，差值不是纯布局，
也不是首字延迟或总体分位数。没有mobile性能结论。

此前同环境700→705行定向原型先完整原生构建，再改变发布方式，各6次轮换：

| 发布方式 | 原生构建 | 至后续两帧 |
| --- | --- | --- |
| 整表替换、自然列宽 | 34.95 | 104.75 |
| 整表替换、固定列宽100% | 35.75 | 118.10 |
| 自然列宽、保留700行追加5行 | 35.75 | 45.50 |

三路有序单元格矩阵相同，自然列宽两路表宽约331.57px、高约18711px；固定列宽改为708px。
替换/固定两路LoAF样式布局中位数56.70/57.15ms；保留行路径没有归属的>50ms LoAF，
不表示没有掉帧。首次整表textContent比较因行间空白误报，改成有序单元格矩阵并保留失败证据。
原型同时保留新旧owner直至结束，只证明纯数据发布方向的潜力，未证明生产生命周期安全。

可重建夹具为三列“位置/原文/改为”，第i行为“第i段/原来的合成内容i/**调整后的内容i**”；
先1…700再701…705，原文29817/30032字符，三种发布方式轮换起点。原脚本和结果在
`/private/tmp/pa-table-perf-20261018.DzkbbY/`，含 `causal-initial-failure.json`、
`causal-v2.cjs`、`causal-results.json` 与 `causal-summary.json`。

结论：兼容处理是小部分新增成本；全文原生构建及发布后布局仍存在。保留现有32ms、
单任务合并和首末态，调度没有已确认缺陷。稳定DOM优先作为后续候选，须先证明可变末行、
结构回退、owner/后处理/清理；若仍受全文构建限制，再单独评估尾部原生构建。
本次没有实施这些候选，也没有用固定列宽或延长冷却掩盖单次成本。
