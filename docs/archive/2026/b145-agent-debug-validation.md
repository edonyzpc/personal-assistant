# B-145 PA Agent Debug View 本地验证

Document status: Historical
Date: 2026-09-23
Work item: B-145
Authority: 已完成的本地实现与验收证据；不等于 beta 发布、BRAT 安装或 iOS 真机证明。
Current contract: [DEC-041](../../product/decisions/dec-041-agent-debug-view-and-local-history.md) / [Product Spec](../../product/specs/pa-agent-debug-view-product-spec.md) / [Architecture](../../architecture/pa-agent-debug-view.md)

## 结果与可复核证据

B-145/REQ-01～10、AC-01～10 的 T-00～T-06 在本地完成。代码/测试由签名
提交 `66133dda` 保留；完整设计、阶段 finding 和逐轮原始验证记录由签名提交
`44b59318` 的 Tracker、Plan、SDD 保留。本页只保存 closeout 后仍有用的
证据与边界，不再承担执行状态。

| 范围 | 本地结果 |
| --- | --- |
| 数据和安全 | 白名单正文/Prompt、会话 reasoning、凭据/附件过滤、30 天/容量预算、旧 Run 淘汰、跨 vault 隔离、异常 owner 屏障均由 store/service/projection 回归覆盖；真实 IDB reload 后历史可读、reasoning 不恢复。 |
| 删除和恢复 | Chat 删除同事务 outbox、Memory claim/legacy Forget、设置与来源撤销、待写/迟到写入屏障及重载恢复有故障点回归。真实任务测试笔记撤销后对应 Prompt 块不可读；自建测试 Chat 删除后 Debug Run 和 pending outbox 均为 0，重载后未复活。 |
| 运行观察 | 实际 Obsidian test vault 中 Debug 关闭、后台采集、实时查看三态 Chat 正常；开启时记录真实 Prompt、usage、`declare_source_scope`、`read_note` 和结果。一次生成中取消在 Chat 为 cancelled、Run 为 cancelled，usage 未知而非 0；底层节点取消分类补丁有 focused 回归，未再次付费重复同一取消请求。 |
| 桌面与模拟移动 UI | 部署后真实点击发送旁 Debug，打开/复用 tab、浏览 Run/Turn 轨迹及下方详情，关闭态按钮隐藏。Obsidian CLI mobile simulator 393px 测到抽屉收起、原 Chat leaf 保留、详情可交互、无横向溢出和错误缓冲；模拟器中未调用 provider。 |
| 性能与资源 | 三态轻量实际功能观察及有界队列/预算/失败隔离回归通过；没有新增业务模型请求或工具副作用的证据。未把少量网络时延样本称作 Debug 的延迟开销或跨设备 p95。 |
| 冻结门 | `npm run lint`、`npm run build`、`npm run docs:check`、`npm run test:docs -- --runInBand`、`npm run test:all -- --runInBand --detectOpenHandles`、`git diff --check`、DOM 源码扫描通过；全量 322 suites / 8174 tests 自然 exit 0，文档 2 suites / 58 tests。`make deploy-current` 后 `dist/main.js` 与 test vault 插件 SHA-256 同为 `de918e2bc4ffbc6afbae0994c4710eb63d7aa15b365b090ef95f43ca2f83989b`，插件加载且无 captured errors。 |

文档检查有四项本任务前即存在的 episodic-memory 索引/可达性 advisory，
没有新增 B-145 错误。最终测试 vault 已清除本任务 Debug Run 和测试 Chat，
恢复 `debug=false`、`memoryEnabled=true`、`dev:mobile off`，窗口恢复桌面尺寸。
真机 USB 当时不可用；Owner 随后明确移动优先使用 CLI mobile simulator，
且仅有具体 iOS 系统专有风险才触发真机。本轮未发现此类风险，因此不声称
iPhone 实际触摸、WKWebView 存储/进程回收或 BRAT 移动安装通过。发布与安装
必须各自从其实际产物和目标环境独立核验。
