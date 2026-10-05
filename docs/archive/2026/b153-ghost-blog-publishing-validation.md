# B-153 Ghost Blog Publishing — Final Validation

Document status: Archived
Delivery status: Closed
Closed date: 2026-10-05
Work item: B-153
Authority: 已完成开发的历史验收、迁移及限制；当前行为以 [DEC-045](../../product/decisions/dec-045-ghost-blog-publishing.md)、[Product Spec](../../product/specs/pa-ghost-blog-publishing-product-spec.md)、[实施设计](../../development/ghost-blog-publishing-design.md)和[Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)为准。

## Accepted Slices And Validation

T-01–07 的开发验收完成；各轮证据只覆盖当时输入。T-08 已由 [B-158](./b158-agent-command-contract-validation.md)接续，不在 B-153 重开。2026-10-05 用户授权 closeout；本次整理没有执行 Ghost 写入、模型调用、部署、Git 推送或发版。

| Slice / Requirement / AC | 最后有效证据与实际范围 |
| --- | --- |
| T-01–03；B-153/REQ-01–10 / B-153/AC-01–10 | r27 `make deploy` 自然退出 0，344 suites / 8465 tests、lint/production build/typecheck 通过；1471 个输入不变，接收后的 test/test2 均加载 main.js SHA-256 `8d22614c8758b9f2df2349e6d47ff9f60069dac60f061aa0fed2cc3cce6cedc3`。原生准备/预览/确认更新/恢复通过，确认前正式文保持旧版，更新与恢复保留 ID/URL、人工排版、未管理字段与本地源正文，精确清理临时稿；恢复终态只保留 Open Ghost editor。 |
| T-03；B-153/REQ-08 / B-153/AC-08 | Owner 明确批准同机独立 test/test2：分别配置凭据，不复制进行中记录/Chat；缺完成记录时实际 client 写入 0、远端六篇不变。只复制完成记录后，B 编辑来源并发起新更新成功，原 ID/URL 与 A 源正文保持，B 写自己的完成记录。证明独立环境新更新，不证明真实跨设备同步的传输、延迟或冲突。 |
| T-04；CI 交付补验 | 来源登记、10 MiB bundle 预算和 Writing 测试等待修复分别验收；最终 `6facc3b` 的 [CI 36667459680](https://github.com/edonyzpc/personal-assistant/actions/runs/36667459680)完整 validate 为 success，platform/notices/lint/build/Test/Audit 实际通过。 |
| T-05；B-153/REQ-11–13 / B-153/AC-11–13 | gate-r7 自然退出 0，351 suites / 8539 tests、lint/build/typecheck 与 test 部署通过，1124 输入不变。真实 test/本机官方 Ghost 6.65.0 合成草稿验证顶部题图、清理正文、独立摘要/SEO与四列卡片；原生宽/中/窄卡片实际为 730/592/314 px，按钮、键盘、禁用与无溢出通过。 |
| T-06；B-153/REQ-14–16 / B-153/AC-14–16 | 最终 gate 自然退出 0，351 suites / 8562 tests、lint/build/typecheck、部署通过，1127 输入不变；test main.js SHA-256 `417638107e7de7a1a88f3c311ad21ccc845105c7df3d736a61c53017cd1cac20`。真实 Properties 四项为 Text；旧对象明确准备后迁移且 UID/ID 不变，无额外 POST/AI。同一草稿两次明确 slug-only PUT，ID 不变，其余字段与本地正文保持，重载后可核实；已发布 URL 保护由源码回归覆盖。F06-01–07 全部关闭。 |
| T-07；密钥状态与当前笔记窄修 | GLM r3 四个 focused suites / 21 tests 自然退出 0，GPT 独立验收。make deploy 的 lint/build 通过，363 suites 中 362 通过，Ghost client 因 sandbox 回环监听 EPERM 失败；只补该 suite 39/39 自然退出 0，合并覆盖 363 suites / 8895 tests，未把原 exit 2 写成 PASS。deploy-current 验证并部署 repo test；真实设置页 configured/missing/unavailable、留空保存/删除/重开通过，真实 Host 在 controller.prepare 前截获，未发 Ghost HTTP 或 AI 请求。 |

历史文档与 diff/DOM 门通过，4 条既有 Memory advisory保留。T-05/T-06 runtime/tests/styles/locales 39 文件签名提交 `dbb24ad7af7e2a6f20a321224ea80b8163cda283`；2026-10-04 本地密钥提示提交为 `81a8a352`，入口迁移由 `a7d1bddd` 承接。Git 和发布事实依对应操作回执，不从本次文档收尾推定新的外部交付。

## Retained Failures And Limits

- T-01–03 的多轮 K-02 返修、中断 gate、额度失败均未算 PASS；最终 r27 与 CI 补验取代它们。r26 的来源红灯先修再验证，未用放宽权限消除失败。F-01–27、29–39 的已确认问题关闭。
- F-28：首次写 note_uid 后曾提示来源变化，Prepare again 成功；后续新合成笔记一次成功，两次自身写入事件均先于 Promise resolve，未复现、根因未知。GPT 拒绝并撤除“忽略下一次 modify”猜测性修复。只有新证据复现才重新定位，不能把观察记为已修缺陷。
- T-05 的 AI 仅接收 299 字符准入合成正文，4 次元数据调用中两次不合规被拒绝并保留旧稿，第四次成功；第三次失效结果有捕获，第二次原始错误细节未留，原模型全文未留存。T-06 一次真实文字 AI 同时给出摘要、SEO 与英文 slug，随后准备/重载复用，无新增调用。不承诺每次模型输出可用。
- Chat 工具选择使用受控输入或 hook，Host/controller/source/client/provider/card 等下游为真实路径；不证明普通 Agent 决策全流程。原生预览与系统浏览器分别验证，不混为同一证据。
- mobile 只验证桌面限定、关联笔记普通编辑和既有入口布局，使用 CLI simulator；未验证 iOS 真机或移动发布。应用站点是本机合成 Ghost，未更新 anthelion、正式站点或生产文章。真实双桌面同步补验保持非阻塞，出现同步失败或用户要求时单独启动。

## Evidence Availability And Disposition

验收时原会话/配置/SecretStorage facade、debug/mobile、Web viewer 与原数据库恢复；合成夹具可恢复移除、精确任务数据库/凭据及 owned 服务回收，managed worktree 可恢复归档。2026-10-05 只读复核发现 T-01–03 `/tmp/pa-b153-run-aiw9x3xb`、T-05/T-06 临时证据目录与 T-07 `/private/tmp/pa-ghost-key-fix-rbZOCI` 均已不存在。本档据原 Tracker 保存历史验收摘要，不宣称临时原始结果仍可读取；用户目录下的 `blog2ghost-wide.png`、`blog2ghost-medium.png`、`blog2ghost-narrow.png` 持久截图仍存在，本次未动。

README、Tracker、Plan 在稳定结果吸收后 delete-after-absorption；Draft agent-entry-proposal 的当前有效职责由 B-158 承接，旧词面权限规则不恢复。当前实施设计保有行为、网络、存储、兼容和回滚契约，本档只保留独有历史证据与限制。
