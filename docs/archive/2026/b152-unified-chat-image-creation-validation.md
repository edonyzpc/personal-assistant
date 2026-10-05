# B-152 Unified Chat Image Creation — Final Validation

Document status: Archived
Delivery status: Closed
Closed date: 2026-10-05
Work item: B-152
Authority: 已完成开发的历史验收与证据边界；当前行为以 [DEC-044](../../product/decisions/dec-044-unified-chat-image-creation.md)、[Product Spec](../../product/specs/pa-unified-chat-image-creation-product-spec.md) 和[图片架构](../../architecture/chat-image-generation-architecture.md)为准。

## Final Acceptance

2026-09-29，GPT 核对实际 diff、GLM 原始结果、冻结输入与应用交互后接受 T-01–03；已确认 F-01–10 均解决。2026-10-05 用户授权 closeout，过程包完成信息吸收后删除。本次仅整理记录，没有新增模型调用、部署、Git 交付或版本发布。

| Requirement / AC | 最后有效证据与范围 |
| --- | --- |
| B-152/REQ-01–03、05–06 / B-152/AC-01–03、05–06 | Desktop 实际执行 `@CreateImage` 与 Featured command；选区在焦点转入 Chat 后保持，切到 B 仍绑定 A，来源预览不含选区外标记。数量摘要、移除来源、保护已有草稿、Save to note 与 Regenerate 通过。CLI mobile simulator 实际操作来源/选项与两个入口，约 450 CSS px 内控件可达。 |
| B-152/REQ-04、07 / B-152/AC-04、07 | 原 Featured 模板精确提取为 3565 chars；前置原问题提交移除，专用准备后唯一提交。source/count/connection/attachment、取消迟到调用、长期 receipt、保存目标及再生成来源保护有定向与全量回归；真实 POST 与准备结果及 task.submittedPrompt 一致。 |
| B-152/REQ-08 / B-152/AC-08；全部 REQ/AC | R-07 全量 329 suites / 8257 tests 自然退出 0；复用未变输入的 R-06 lint/build，deploy-current 验证并部署。902 个冻结输入前后相同，四项 dist/安装资产 hash 一致；main.js SHA-256 为 `c85e12e58587a2e615215f63b7da4f7e9430cc2fc94428752f1ffbc97a155597`。diff check 通过，DOM 扫描无匹配。 |

文档门历史结果为 248 Markdown / 2952 本地链接通过，4 条既有 Memory advisory；完整 Jest 已覆盖当时文档契约。这些结果属于对应冻结输入，不替代后续源码的验证。

## Live Model Evidence And Limits

旧 Backlog B-005 的 Wan 2.7 live provider smoke 已由此获准统一入口及下列实际请求承接；
原 Featured 同步链已退役，不再保留“真实生成未调用”的待办，不扩大为其他模型/地区认证。

- 配置的 qwen / deepseek-v4-pro 完成两次专用文字准备。全文走完整 Chat 链；选区使用同一真实 host helper 与 UI 捕获的 snapshot，不声称第二次完整 Chat/Wan 链。
- 一次 Wan 请求：`wan2.7-image`、2K、n=1，任务 `36342a6cb5bd4867b48aee3dab95b226` 完成。准备结果、POST text 与 submittedPrompt 一致，区别于用户原始补充。
- 结果为 2048×2048，SHA-256 `1615e9d5da0a58a3d381c47057efe9f499214d6df458fd512888b2156d7730e3`；人物、屏幕及错位影子可见，但横向要求未控制画幅，屏幕仍有代码状文字。第一份提炼含开场说明并原样提交，不承诺严格比例、零文字或模型每次效果。
- 保存前全部三份合成夹具 hash 不变；实际保存后只向选定 `b152-save-target.md` 插入图片，附件落在原配置 `9.src/`，其余笔记保持。切到其他笔记后 Regenerate 复用原描述和全文 promptOrigin，累计仍为两次准备/一次 Wan，没有再次付费。
- Simulator 的中文使用粘贴，IME 防误发由源码测试覆盖；未验证真机键盘、全部设备、其他模型或地区。没有私人 vault 材料外发。

## Failures, Evidence Availability And Disposition

R-01 两个目标回归为 RED，R-02 对应 GREEN；后续 receipt、再生成、连接与附件问题经独立审查修复。R-06 `make deploy` 自然退出 2：8254 pass / 3 fail，未部署；旧日期夹具超过 90 天保留期，R-07 只统一测试消费时钟，保留生产规则与断言后完整通过。早期局部绿灯、额度中断和无效测试选择均未算最终 PASS。

验收时观察钩子、临时设置、debug/mobile 与原会话已恢复，managed worktree 已可恢复归档；无剩余实施或产品决定。2026-10-05 只读复核发现原 `/private/tmp/pa-b152-20260929-vECgqK` 目录已不存在，因此本文件保留原 Tracker 的历史验收摘要，不能声称原日志仍可读取。`test/9.src/img_c6f772d4cd064d2f9ad8a0b72fcce931.png` 仍存在；本次未改动该付费结果或 test vault。

原 README、Tracker、SDD 默认 delete-after-absorption；当前图片架构保有运行契约。本档保留原始付费验收范围、失败与效果限制，不能作为当前执行状态或发布证明。
