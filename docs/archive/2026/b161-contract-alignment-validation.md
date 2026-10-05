# B-161 Contract Alignment — Final Validation

Document status: Archived
Delivery status: Closed
Closed: 2026-10-05
Work item: B-161
Authority: 本次合同对齐的历史验收与限制；[DEC-051](../../product/decisions/dec-051-proportionate-confirmation-and-contract-alignment.md)、[Product Spec](../../product/specs/pa-contract-alignment-product-spec.md)、[Command architecture](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract) 与 [Share Card architecture](../../architecture/share-card-architecture.md) 承接当前行为。

Owner 于 2026-10-05 明确要求 closeout 所有实际已完成开发任务。T-00–T-07、全部 12 项 REQ/AC 与确认 finding 已完成，原设置及临时资源恢复，开发范围 Closed。B-158/B-160 于同日合同清理留下的源码限制移除由本包接续完成；整体移除 Host、B-119/B-112、B-159/F-24 专项不在范围内。

## Requirement Evidence

| Requirement / AC | 最低充分最终证据 |
| --- | --- |
| B-161/REQ-01 / B-161/AC-01 | 三来源显式发现无篇数确认；同名图片 r2 合理澄清；取消/权限回归，无 Host 语义正则 |
| B-161/REQ-02 / B-161/AC-02 | 桌面真实直接修改、分析/仅预览/引用不写、Undo；F13 移动同请求状态及 completed/undone 历史；F15 原状态回答重放 |
| B-161/REQ-03 / B-161/AC-03 | 唯一笔记无控件的真实来源捕获/专用提炼/一次生成交付；同名先问；来源 scope、选区冲突、撤权与不重放回归 |
| B-161/REQ-04 / B-161/AC-04 | 普通 Chat 纯正文；显式 Writing 有真实 ready/versionId；复用 writing-context-run/runtime |
| B-161/REQ-05 / B-161/AC-05 | 既有 Ghost controller/tool/service 版本与 unknown 契约门；未正式生产发布 |
| B-161/REQ-06 / B-161/AC-06 | notes/web/combined 真实 runtime/domain、派生 lineage、撤权与有限历史保存 |
| B-161/REQ-07 / B-161/AC-07 | T05 228 tests；桌面 54,702 字符/77 页完整正文及全部 PNG；取消、移动翻页/关闭 |
| B-161/REQ-08 / B-161/AC-08 | 自动池耗尽/存储故障下 explicit 与本地入口回归；实际发现/Maintenance/Graph 的 automaticPoolAccesses=0 |
| B-161/REQ-09 / B-161/AC-09 | 自动 12/36、启动计次、缓存/拒绝不计、lease 回滚、reload/fail-closed 与混合历史保留 |
| B-161/REQ-10 / B-161/AC-10 | 当前统一发现入口与最小生产删除闭包独立核对；旧 Review/Quiet Recall 未复活，兼容端口及历史保留 |
| B-161/REQ-11 / B-161/AC-11 | 超旧任意容量、101 项持久事实/Undo、33 项 provider 投影、同参真实重读及原恢复/权限回归 |
| B-161/REQ-12 / B-161/AC-12 | 35 份 predecessor 文档接续、独立语义核对、最终 docs/diff 门，原失败结果不改判 |

## Engineering Acceptance

原始证据目录为 `/private/tmp/pa-b161-RY9CfG`，本次核实下列最终门日志、导出验证和环境恢复记录仍可读取，原始文件保留。

- `make-deploy-r3.log`：lint/build 通过，Jest 374/376 suites、8927/8962 tests 通过。Ghost loopback EPERM 与旧 prompt 断言失败保留；`t07-failed-suites-recheck.log` 在支持环境为 2 suites/68 PASS，复用其他未变结果。结论是组合证据通过，不能写成一次全量全绿或首次 make deploy 成功。
- 后续 F13 focused 5 suites/572 PASS、fixture 6 PASS/typecheck；F14 guidance 19 PASS；F15 guidance 3 PASS及 source lint。最终 `t07-final-build-r2.log`/`t07-final-deploy-r2.log` 自然 exit 0、部署 repo test。仅末次指导文字改变，复用未变实现与领域证据；部署身份不等于重新测试。
- GPT 负责产品/authority 与独立验收；GLM 额度阻塞后的 GPT 接管切片不称为 GLM 交付。实现者之外的只读 reviewers 验收；F13 历史绑定/状态不可见、F14 歧义选源/误抄 ID、F15 unknown 误判及重提邀请均闭合，保留原失败适用范围。

## Model And App Evidence

- Desktop 真实模型明确修改直接显示 Changes applied，原生 Undo 逐字恢复；仅预览和引用指令不写。普通 Chat 与显式 Writing 路径分别通过；不能因 Writing stream finalText 为空而忽略实际持久作品。
- 唯一笔记实际来源快照→专用提炼→provider→本地 PNG 完成。桌面同名误选与错误状态 ID 是保留的失败；修正后 mobile r2 对两候选先询问，`imageRequests=[]`。r1 含不存在 currentNote 的批次被拒绝，不算选源 PASS。真实付费图片仅桌面两次，不推算总体成功率。
- 三来源显式发现通过，同次 run 的四模型轮/四工具不计为四次自动任务；Maintenance 8 proposals、Graph 4 items，均只读，没有启用 AI 增强。
- Share Card 桌面 77/77 PNG 保存，正文合并 46,474 非空白字符，与预期 SHA256 `bfa23a0ed4d433859cc480a3c3bb79d4afbe34face17d07bf10bdbbfc4387ef5` 相同；首/中/末 PNG 均 1080×1440。取消停止分页/导出并释放 renderer、prototype，未写 PNG。Mobile simulator 77 页预览/翻页/关闭释放通过，复用桌面完整保存证据。
- F13 mobile 直接修改后同请求 `get_operations_status` 可见，history completed/revision1；Undo 后 undone/revision3 且原文恢复。
- F15 两次 unknown 为 POST 前注入，不是真实 provider 故障。初次将 unknown 说成失败及首轮 postfix 主动询问重提均保留为 FAIL。最终 `unknown-status-replay-request.json` 仅替换原请求的一条 planner 指导；真实模型结果说明受理/费用未知、无重提建议或工具调用，非作者逐字段复核接受。只证明该回答重放，未重开 F-24，也未重复 App 查询或构造成功率统计。
- `app-environment-restored.json`：原 mobile=false/debug=false、Memory/后台设置和两项学习偏好一致，自有资源 remaining=[]、pluginReady=true。全部专属历史/合成路径清理，原接口恢复。

## Delivery And Disposition

此前已授权本地 master 交付：`17bbdfb0`（Pagelet/旧管线）、`3ddd7889`（Operations/图片来源）、`f3d7e85a`（Share Card）；配套合同为 `125f9b52`。本次不新增 Git 动作，不声称远程 CI、push、iPhone 真机或生产发布。

稳定行为/职责吸收至当前合同、架构和 focused tests；Feature Home/SDD/Tracker 删除，完整原过程可从 `125f9b52` 恢复。无本包未完成开发项。原 [B-159/F-24](../../backlog.md#已延期的产品与工程工作) 的 model FAIL/Host anti-replay PASS 仍分别保留，不因本包窄指导修正而关闭。
