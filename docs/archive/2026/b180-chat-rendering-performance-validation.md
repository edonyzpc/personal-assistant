# B-180 Chat 渲染性能验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-18
Work item: B-180

本页仅保留独有性能、最终验收及证据复用边界；当前实现由
[DEC-070](../../product/decisions/dec-070-chat-rendering-lifecycle-performance.md)及
[Product Spec](../../product/specs/pa-chat-rendering-performance-product-spec.md)持有。

## 授权与处置

Owner 确认四项 PA 侧优化，授权设计、按修订方案开发测试及两个真实 P2 的最小修复；
2026-10-18 明确要求“收尾 b-180，然后将代码修改提交到 master 分支”。本范围没有未完成项
或未解决设计偏离。表格流式子树复用继续是 DEC-069 的条件性候选，未纳入本轮。

GPT 负责设计、文档、独立验收与 App；GLM 经单独配置的 pa-glm / ZAI CLI 完成源码、
测试及自查，独立 GPT reviewer 定向复核。仅修改既有 `chat-view.ts` 和 Chat suite，
没有新增调度框架、数据迁移、设置或 provider 工作。worker managed worktree 已归档。

稳定约束已吸收进当前 Spec/Decision 和 focused tests；Active 入口及 Home/SDD/Tracker
删除，处置见 [Disposition Log](../disposition-log.md)。原未提交过程包及终态记录另存于
`/private/tmp/pa-b180-closeout-20261018/`，不声称旧 Git 保存完整过程，也不将临时文件作为
运行依赖。推送、版本和发布不属于本次授权。

## 输入与确定性验证

实施前基线为 master `4f1801949857637d6aaeb35b71558f19116fd1e6`。
原四项优化验收时源码 SHA-256 为
`65aa38d419057e0ce0dea9ef8b631f381deb381991fe360d1a80846c4e034bf2`；
两个 P2 窄修后的最终源码为
`784b142f0e62a88988355f37c18929eaa6bd9732242a27cb814bb36de767d770`，测试文件为
`b43bc940b911cd10f05ec9efe724f011667b09d44824d3d44595edb70ab9293a`。
收尾时源码/测试逐字不变，复用下述结果，只运行文档及差量检查。

| 范围 | 结果与证据边界 |
| --- | --- |
| 原四项完整 gate | 完整原 lint 规则、生产 build（含 TS/Tailwind）通过；398 suites / 9734 tests，285.793s，延迟退出提示后进程自然 exit 0，未 forceExit |
| lint 环境 | 未改的 1.6MB `share-card-paper-data.ts` 导致默认 Node 864KB 栈下 ESLint parser 溢出；同文件诊断后仅临时增至 4096KB，完整 scope/规则通过，无永久配置更改 |
| F-09/F-10 最终差量 | 两项有效目标红灯后，两个新增回归绿色；Chat、表格兼容、Operations review session 共 3 suites / 457 tests、独立 TS、完整 lint、生产 build 通过；并非最终输入重新跑过 9734 项 |
| 回归内容 | 轮 DOM/owner 保留、连续删除/实时转历史/尾轮/失败终态、受控慢 Promise 和有界在途、批次间 sourcePath、图片登记/删除竞态、真实状态栏变化、静态 Mermaid 尾部观察及迟到尺寸/暂停/清理；复用既有兼容和流式调度覆盖 |
| 源码扫描与部署 | community DOM `rg` 无匹配 / exit 1；`make deploy-current` 资产身份和复制通过，精确部署 repo-local test 后 reload；部署命令没有运行测试 |
| 收尾 | 当前契约与紧凑证据替代过程包，330 Markdown / 4243 local links、处置及空白检查通过；未重复 build、App 或性能样本 |

早期类型错误和错误夹具均在接受前纠正：canonical 消息缺失、首批 8 个任务误当成
8 次原生调用，以及若干不符合真实触发时序的用例不算产品红灯。CLI 主动中断的轮次
不算成功交付；所有有效绿色来自后续自然退出的同范围执行，没有放松正确断言。

## 性能对照及限制

环境为 Obsidian 1.14.4 / PA 2.10.10、repo-local `test`，桌面 1458×949 CSS px、DPR 2，
正文约 716px。真实 ChatHistoryManager 配内存 store 和合成 service；不调用 provider，
不改真实历史或笔记。10 轮包含 10 条短 user、8 条约 3k 字符 assistant 正文和 2 条约
30k 字符表格。已预热，以下每项各一个有效样本，不是分位数或固定提速比例。

| 观察项 | 实施前 | 实施后 | 结论 |
| --- | --- | --- | --- |
| 删除末轮后剩余 18 条原生调用 | 18 | 0 | 剩余 DOM/buffer/owner 身份不变；store 9 轮、history/DOM/owner 各 18 |
| 20 条恢复的真实帧采样 | 第一帧已发起/完成全部 20 条 | 依次 5、8、13、18、20 | 每帧完整历史数据均为 20，显示确实分批 |
| 恢复原生同步合计 / 单次最大 | 59.0 / 26.5ms | 69.2 / 36.4ms | 单次原生不可抢占，本样本没有构建耗时收益 |
| 首次原生到完成后两帧 | 174.0ms | 243.6ms | 总窗口变长，不能声称吞吐或纯布局提升 |
| 固定约 5 秒 Mermaid scrollTo | 89（SVG 后 100ms 外 81） | 3（SVG 后 100ms 外 0） | 只证明主动工作次数减少；真实 SVG 与查看器可用，不换算 CPU 收益 |

相邻 rAF timestamp 最大间隔仍有 83.7ms；它不是回调实际进入时间，也不能把浏览器及
其他工作的重叠长任务全部归因于 PA。两帧窗口含调度/浏览器工作，不是纯 layout 或首个
可交互时间。基线单条约 30k 表格原生同步 24.8ms、两帧窗口 66.8ms，证明残余成本存在。

状态栏定向断言确认已知正文新增/移除的子树查询为 0；真实替换/挂载/样式/尺寸处理保留。
App 回调同步合计约 1.0→0.4ms，量级很小且含其他记录，不视为主要瓶颈或普遍收益。

## 部署交互与最终两项修复

- 桌面受控恢复中，9 次原生已发起、4 个完成门保留时，实际 Ask 仍收到逐字一致的全部
  20 条历史。释放后旧消息先于新问答，history/DOM/owner 各 22、store 11 轮；新回复与
  持久原文一致。上滚位置 3154 未被拉回；New Chat 后释放旧结果仍为 0，不回流旧 buffer。
- 实际 Copy 保留 30024 字符逐字一致；表格、fenced code、链接、snippet embed、PNG
  可用，点击链接打开正确测试笔记。Mermaid SVG 与放大查看器实际可用。
- 官方 mobile 模式沿用桌面 viewport，实际恢复、菜单删除、上滚及关闭通过：剩余
  18 条节点/owner 保留、原生增量 0，关闭 owner 0。这不是 iPhone 硬件证据；最终窄修
  只补受影响桌面交互，没有重复无关 mobile 矩阵。
- F-09：完成 Operations A 后完成普通 B，再实际 More → Delete → 确认删除 B。A 正文、
  原节点/buffer/两个 owner 保留，失效卡及 session 为 0；定向回归另确认原生增量 0 和
  已展开 diff 只卸载一次。全会话 discard 与 Clear/New 等待持久写入的既有时序保持。
- F-10：A 上滚距底 2094px 且旧意图已超时后，通过实际 History 选择 B。完整数据 20、
  首批已提交正文 5、4 个原生完成门 pending 时，出现正常 auto scrollTo(3146)，首批正文
  可见。B 再上滚至 1247.5 后释放，history/DOM/buffer/owner 均 20、scrollTop 仍为
  1247.5，新增 scrollTo 为 0，errors/logs 为空。

F-10 临时步骤曾把 gap≤80 当作持续对齐保证；复核撤回该加严判据：80px 是用户滚动
意图阈值。初始实际 top3145.5 对应正常 scrollTo3146，后续空壳使 bottom3240、gap94.5，
不表示旧暂停仍生效。原始值保留，以新会话恢复跟随、新暂停受尊重判断，无新增修复或测试。

首次交互因 CUA `noWindowsAvailable`/旧画面停在删除前，记为未完成；Owner 保持窗口
可见后重新完成两条交互。初次 WIP gate 也保留为失败历史，完成后恢复 Validated 才自然
消除。夹具清理均 cleaned true、errors 空、fixtureRemaining false；最终恢复
`2026-05-01.md` / leaf `40b132e1e7ec0bf8`，debug/mobile false、hooks 空，保留用户已有
另一 Chat，无合成笔记。Mermaid 信任仅在 Owner 允许的 test 库启用。

原始日志位于 `/private/tmp/pa-b180-dev-20261018/`、
`/private/tmp/pa-b180-followup-20261018/`；包括 `accepted-test-all.log`、
`related-suites.log`、`f09-app-after.json`、`f10-app-initial.json`、`f10-app-after.json` 及
对应 cleanup。临时原始文件不承诺永久可读；本页已保留结论、输入和限制。
