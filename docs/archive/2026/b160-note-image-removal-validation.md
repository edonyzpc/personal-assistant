# B-160 Note Image Removal — Final Validation

Document status: Archived
Delivery status: Closed
Closed: 2026-10-05
Work item: B-160
Authority: 原联合删除交付的历史验收与限制；当前行为由 [DEC-050](../../product/decisions/dec-050-note-image-removal-and-undo.md)、[Product Spec](../../product/specs/pa-note-image-removal-product-spec.md) 和 [Operations architecture](../../architecture/pa-agent-architecture-plan.md#operations-agent-providers) 承接。

Owner 于 2026-10-05 明确要求 closeout 所有实际已完成开发任务。P0–P3、T-01–06 与 F-01–21 已完成独立验收，原开发范围 Closed。后续明确请求直接执行与容量规则撤销由 [B-161](./b161-contract-alignment-validation.md) 实施并验收；不将 B-160 原二次确认与额度基线改写成新合同已经通过。

## Requirement Evidence

| Requirement / AC | 原范围最终证据 |
| --- | --- |
| B-160/REQ-01 / B-160/AC-01 | 真实 remove_note_image 工具、不可变目标及 native-shaped prepare；正常桌面与真实模型 mobile simulator 联合删除 |
| B-160/REQ-02 / B-160/AC-02 | 完整共享引用 scan、incomplete 负例、整批首笔零写；compact/full 冲突可见且禁确认 |
| B-160/REQ-03 / B-160/AC-03 | 原来源/身份/版本/撤权及只预览零写；keep 附件 hash 不变、delete 经原生 Trash，重复执行不新增效果；直接执行 successor 另见 B-161 |
| B-160/REQ-04 / B-160/AC-04 | partial/unknown 原 ID 状态查询、有限效果投影与原文/原字节 Undo；无自动重删 |
| B-160/REQ-05 / B-160/AC-05 | 临时快照、共享 owner/lifetime、碰撞、撤权、TTL、部分恢复 checkpoint 与原子原文比较回归 |
| B-160/REQ-06 / B-160/AC-06 | 真实 History 重载有限事实不变、旧 owner unavailable/false Undo；最终资源清理及模式恢复 |

## Final Validation And Original Failures

- 最终 `root-final-all-tests.log`：378 suites / 9012 tests 全部 PASS，252.38 秒、自然 exit 0；复用同输入 lint/production build，`root-final-deploy-current.log` 实际部署 repo test。不是重复运行所有前序门。
- Desktop 真实来源/Runtime/Host/Vault 链验证联合删除、keep、共享冲突、partial/unknown、Undo 与重载。早期 `metadataCache.parseLinktext` 适配错误修为官方 module export；共享列表与 unknown 遮盖已知 note 效果两项真实 UI 缺陷均修复。
- 获准配置 qwen/deepseek-v4-pro 的 CLI mobile simulator 验收为 6 turns / 16 provider 请求，`create_image=0`。正常删除与 Undo、共享禁确认、partial/unknown 两次只读 `get_operations_status` 通过，无新提案或删除。故障分别为一次 no-op 与原生 Trash 成功后丢响应，不冒称真实平台/provider 故障。
- `ui-final-reload-history.json.txt`：原生 reload 后三轮历史有限事实一致，两原 intent owner 不可用且不复活 Confirm/Undo。`mobile-real-final.json.txt`：四 intent 最终 undone/cancelled，原文与 269-byte PNG 原 SHA256 `8c7090dfe0168a35c4105632e384b11dddcca6a8004328c660f6c63f7077e451` 恢复。
- `mobile-real-restored.json.txt`：app.isMobile/body=false，自有句柄与 fixture 根无残留，Memory 恢复原 started=true；Debug 初态 unknown 且未改变。仅 repo test，无 iCloud/iPhone 真机或生产发布声明。
- 早期 GLM 工具报告未完成、退出/fixture/类型失败、loopback EPERM、摘要合法分块使旧 one-shot mock 失效的原结果仍是历史失败，不计为 PASS。最终修正未放宽生产预算、来源保护或正确断言；曾被停止的失败 Jest 也不记作自然成功。

## Provenance And Disposition

最终日志与公开合成 app 证据位于 `/private/tmp/pa-b160-resume-BlLyTc`，本次核对上述最终日志及模式恢复文件仍可读，不删除原证据。旧 `/private/tmp/pa-b160-BXdiaU` 已不可见；从 CLI rollout 提取的片段不是原完整日志。完整过程包已进入 Git 历史，可从 closeout 前提交 `125f9b52` 恢复。

GLM 实施至 R7 额度阻塞后按已有授权停止，GPT 接管；不同只读 attachment/history reviewers 独立验收。共享回答“确认后重新提交”被判为非必修措辞限制，原回答保留，不推定一般模型成功率。无原范围未完成开发项；iOS 专有能力并未涉及，不制造真机补验任务。

稳定行为吸收至当前合同、架构与 focused tests，Feature Home/Plan/SDD/Tracker 删除。本次仅文档 closeout，不授予或执行新的 commit、push、release。
