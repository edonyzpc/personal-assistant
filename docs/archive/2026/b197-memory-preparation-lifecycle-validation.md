# B-197 Memory Preparation Lifecycle — Final Validation

Document status: Archived
Updated: 2026-11-14
Work item: B-197
Authority: 历史验收与处置证据；当前行为由 [DEC-080](../../product/decisions/dec-080-memory-preparation-lifecycle.md)、[Product Spec](../../product/specs/pa-memory-preparation-lifecycle-product-spec.md) 和当前架构承担。

## Scope And Closure

Owner 选择确认后后台准备，授权必要开发与验收；2026-11-14 明确要求完成 B-197 收尾、提交并推送远程 master，不包含 tag 或版本发布。

原开发基线 `07e638c2825a3fdf62a96d4182b63ac0ae49a5c0`；Linux 检查点 `34353ba13f64df9b31ec7f72ce1e8fbb962960b5` 已含主要实现。Mac 增量仅恢复原阶段文字、使用真实文件数及调整对应既有测试。AC-01–06 已满足，F01–17 已关闭，无本切片剩余阻塞项。

| Contract | Delivered behavior | Retained protection |
| --- | --- | --- |
| AC-01 | 确认移出短检索预算，批准后Manager后台运行，Chat按事实立即继续 | [真实跨层调用回归](../../../__tests__/memory-preparation-cross-layer.test.ts)；31秒等待使用fake timers |
| AC-02 | attempt/正常回答结束不取消；稳定owner、真实Stop、每消费者与shared语义保留 | [Manager tests](../../../__tests__/memory-manager.test.ts)：后台、旧同步、first-use两参数、多消费者 |
| AC-03 | 批准后重验来源/配置；restricted只读，缺owner不阻断Ready；Pagelet兼容 | task-source/Host/runtime回归；规范准备中事实保留来源撤回与不可用安全约束 |
| AC-04 | active优先，旧plan不能覆盖新Ready；关闭不重弹，显式重看，重复命令复用 | [Chat races](../../../__tests__/chat-view.test.ts)、Manager通知/复用与实际UI操作 |
| AC-05 | 真实文件计数，当前可用性与最近结果分开，五类结果及单次终态 | Manager、[Status projection](../../../__tests__/plugin-record-note.test.ts)、受控成功/失败与原阶段展示 |
| AC-06 | durable admission后才成功；失败补偿、旧run隔离、笔记不变 | 既有VSS准入/回滚、跨层单次admission及真实Prepare成功 |

F14 同时恢复合法旧Memory在lexical/refresh期间可读，full rebuild仍不得读取未准入副本。独立边界、生命周期与测试适度性复核无新增P0/P1/P2，也无必须继续整改的过度设计/测试；复用既有Manager/队列/端口，没有持久任务台账、暂停框架或索引迁移。该判断不等于全项目优化或量化性能收益。

## Validation And Evidence Reuse

| Date / environment | Inputs and check | Observed result / limits |
| --- | --- | --- |
| 2026-11-13 / Linux | 最终冻结platform、完整lint、生产build、`npm run test:all -- --runInBand --testTimeout=15000` | 自然exit0；405/405 suites、9940/9940 tests，零失败/跳过；build含tsc/Tailwind/bundle。原日志`/tmp/b197-validation/`是Linux历史本机证据，不是Mac前置依赖 |
| 2026-11-14 / Mac | 仅Manager格式化和对应测试改变；Manager suite、相关文件eslint、生产build | 74/74、lint/build自然exit0。未变的来源/生命周期/持久化输入复用Linux全量证据，没有声称Mac重新跑全量；日志`/private/tmp/b197-mac-validation/` |
| 2026-11-14 / Mac | docs、diff、DOM注入扫描 | docs/diff通过；runtime style/innerHTML/outerHTML扫描无匹配（exit1为PASS）。收尾文档门单独执行，不为过程文档删除重跑插件构建 |
| 2026-11-14 / Obsidian1.15.1 | `make deploy-current`校验生产资产并部署test，reload3.0.6；真实确认、Chat/Status、通知和命令面板 | 桌面及CLI mobile 729×949链路通过；索引外部边界受控，不冒充真实provider/存储实现或iPhone硬件 |

本机 GLM 是窄修源码/test writer；其 Jest 因 Node 父目录查询被隔离环境拒绝而未启动。协调停止后退出130并确认无相关进程，GPT完成独立diff验收与缺失检查，不计完整GLM成功。接入预检通过，自动记忆/技能/插件/hooks/MCP关闭，必要项目材料限定至既有pa-glm/ZAI；服务端实际型号未知。原证据`/private/tmp/b197-glm-mac-preflight-1794585478/`。

### Controlled App Branches

- 桌面：批准前零效果，批准后立即answer-now/preparationState=running、rebuilds=1；短attempt结束仍active且未abort。Status/查看仍shared=false、consumer=1；关闭后writing11/30不重弹，重看最新阶段。实际Prepare/Update只复用；完成后单次成功终态，Ready与Completed30/30可重看。
- CLI mobile：旧Memory在refresh期间仍use-memory，refreshes=1/rebuilds=0；观察不取得shared，关闭后writing13/30不重弹，重看最新阶段。重复Update仅复用；受控失败只一条终态，Status将Ready与Failed分开，保留已处理13/30。
- 桌面初轮唯一TypeError来自临时VSS漏叶切换接口；仅补夹具空接口后重验该动作，无错误，未改产品代码。mobile无捕获错误。临时对象、配置检查方法、窗口、模式和草稿已恢复。

### Real Prepare And Published Package Comparison

Owner 随后要求实际执行一次Prepare。经正式设置、命令面板和真实确认，对仓库`test/`的13篇笔记使用原配置OpenAI `text-embedding-3-small`完成真实rebuild：12.13秒、13/13、failed=0、dirty=0、indexedDocumentCount=13，终态completed/Ready。Status显示75个内部片段、persistent storage和Completed，无捕获错误。笔记未改写，未使用私人vault；保留真实已准备索引与Memory开启状态，debug/mobile恢复off。原证据`/private/tmp/b197-real-prepare-demo/`。

Owner 再要求以已发布正式版核对外观。实际下载并加载 [GitHub 3.0.6](https://github.com/edonyzpc/personal-assistant/releases/tag/3.0.6) 的安装附件，以相同受控进度比较：原卡片、三点动画、标题和单行正文一致，发布与当前styles.css整文件相同（SHA-256 `d81597795d88eb044c6e9d3cb17f2b241762ca86f92b3b6ba664db3dae7cf73d`）。改变的是阶段文字恢复及片段数改为文件数，不能称为卡片布局回滚。比较未重复调用AI；开发包三份资产按原hash恢复，真实13篇Memory仍Ready。原截图与恢复证据`/private/tmp/b197-release-306-compare/`。

## Residual Observation

既有Memory diagnostics卡片在本机右缘可裁切，准备进度卡完整，状态/结果及操作可辨。该非阻塞观察转入 [T-014](../../backlog.md#触发型评估)：Owner单独要求优化、相关布局变化或裁切妨碍辨认/操作时启动；本轮不重设计诊断卡，也不宣称全产品视觉无缺陷。

## Artifact Disposition

稳定设计已由 [SQLite/WASM architecture](../../architecture/vss-sqlite-wasm-architecture.md)、[Refresh / progress contract](../../architecture/vss-embedding-refresh.md#进度事件与用户反馈)、当前产品契约和focused tests承接。Active Home/Tracker/SDD吸收后删除并移出Active Registry，仅保留本页紧凑历史证据；未提交过程原文和终态Tracker保留本机副本，不声称旧Git保存了全部Mac过程。

必要本机日志、截图和短夹具保留供核对，不进入Git，也不是后续运行依赖。本页不承担新的执行状态或发布证明。
