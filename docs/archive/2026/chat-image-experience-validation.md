# Chat Image Experience — Validation Evidence

Document status: Archived
Updated: 2026-09-07
Work item: B-129
Final disposition: Closed — 用户明确授权 closeout；仅关闭本次兼容体验优化。
Authority: 图片输入与保存体验的独有历史证据，不承担当前实现或发布状态。

当前行为由 [Product Spec](../../product/specs/pa-multimodal-chat-product-spec.md)、
[Architecture](../../architecture/multimodal-chat-architecture.md) 和
[使用指南](../../guides/multimodal-chat-user-guide.md) 承担。
这是 [Astra 工作流试点](./astra-feature-workflow-optimization-validation.md) 的
实际产品样本；[B-129 首版证据](./b129-multimodal-chat-validation.md) 只作历史对照，
没有为补计时重新运行首版矩阵。

## Scope And Acceptance

2026-09-07 用户指出粘贴图片后输入框下图片与按钮杂乱，并要求简化保存路径体验。
交付两个切片：composer 内紧凑缩略图、按需详情及移除；保存时分开标题和文件夹，
默认仍为根目录，图片选择和完整保存细节按需展开。原图、处理副本、正式附件、
同步、显式保存、固定版本、风格授权和失败恢复均沿用 DEC-030。

本次变化对应 B-129/REQ-01、B-129/REQ-03、B-129/REQ-04、B-129/REQ-10、
B-129/REQ-11 及 B-129/AC-01、B-129/AC-03、B-129/AC-04、B-129/AC-10、B-129/AC-11；
其他契约边界继承不变，不将完整 ID 映射当作重跑全部首版验收的依据。
用户在部署和复核后明确反馈 **“手动复制粘贴符合预期”**，仅证明粘贴体验的
用户验收。保存依据以下实际 UI 和自动化证据，不写成用户亲自验收保存。

## Final Inputs And Gate

执行树为 `codex/astra-feature-workflow-optimization-b115` 的
`6d418ba6953f5201eff8d4534c4506c580eb3785` 加本轮 UI、测试、样式改动。
测试环境为 macOS、Node v22.22.3、npm 10.9.8；使用原仓库 `test/` vault，
Obsidian 1.14.0（installer 1.12.7）。主仓库和 IME 工作树未被本轮源码覆盖。

| Evidence | Final recorded result |
| --- | --- |
| `git diff -- src __tests__ package.json package-lock.json` SHA-256 | `638a5fb1e560ca30d3cd531fc03bdbde55374f8ad354b3747808839170d5757b`（相对上述基线的未提交 diff） |
| 新 `__tests__/writing-save-modal.test.ts` SHA-256 | `c4aaaa403ddf0ceab864994e4046171769c8a034ecf2bfb2011988c8e8d5ec77` |
| `/usr/bin/time -p make bin` | 平台/Lint、Build（含 TS/Tailwind）、239 suites / 6233 tests PASS；Jest 103.105 s、real 167.90 s；原 session 94054 自然 exit 0 |
| 退出与补充检查 | 有 Jest 退出等待 warning，随后自然退出；没有 kill/forceExit。Community DOM scan 无匹配（exit 1 = PASS），diff check PASS |
| `deploy-current.mjs` 复制到原 test vault 的绝对目标 | 当前输入和四个产物检查通过，exit 0、real 0.10 s；没有新建第二个同名 vault |
| main.js SHA-256（构建、部署、加载一致） | `e339209d3d48d1b91d18d5f054e0e24070fc6f89095e184c7208ccbddeaa3158` |
| styles.css SHA-256（构建与部署一致） | `4ba8ec8527c3e7802805af73f91b2aec76768302235689426c72ee3077ece2bc` |
| 实际加载 | `getLoadedPluginBuildIdentity()`：`identitySource=plugin-onload-cached-main-js`、`blocker=null`、上述 main.js SHA；`capturedAtPluginLoad=2026-09-07T13:33:46.581Z` |

完整 gate 原日志是本机会话产物
`/private/tmp/pa-chat-image-post-smoke-gate-20260907.log`；路径用于历史定位，
不承诺临时文件长期存在。closeout 前重新核对上述源码 diff、新测试和产物 hash
均未改变；文档收口不使该运行时证据失效。远端 CI 和 master 集成另行核实，
这些本地结果不冒充远端 gate 或发布。

## Observed Desktop Behavior

| Interaction | Actual observation and boundary |
| --- | --- |
| Copy/paste | Preview 打开已有合成 PNG，Cmd+A/C 后在 Chat 原输入中 Cmd+V，逐步粘贴至 8 图；每项预览 84×84、移除按钮 44×44，集中在 composer 内。没有发送消息 |
| 详情与移除 | 键盘进入缩略图，Enter 打开、Escape 关闭并还原焦点；打开原图后详情关闭。移除后 textarea 焦点与原文字保留，被移除项原图仍存在 |
| 错误可见性 | 8 项时错误卡宽 248px、完整可见，说明 clientHeight=scrollHeight=82，输入焦点保留；移除后恢复可用。此次通过现有 vault picker 导入故意损坏夹具，不能据此声称系统文件选择器通过 |
| 保存预览 | 根目录默认、位置与选图折叠；默认全图，勾选可使计数 0/1；返回编辑保留标题和焦点。根目录和指定目录预览都未创建目标笔记/目录 |
| 明确确认 | 保存两份独立测试笔记，completed receipt、固定正文和正式图片正确；没有覆盖首份。使用目标笔记附件规则，原图/输出 hash 相符 |
| 打开笔记 | 修复后 Open note 导航到目标，modalCount=0；导航失败和 RecoveryList 兄弟入口由 focused 测试验证，不声称设备故障注入 |
| 诊断和清理 | `dev:errors` 最终 No errors captured；debug off、mobile disabled。临时草稿/文字和本轮库内损坏夹具已清理 |

测试库保留 `t05-image-experience-20260907/` 中的
`T05 图片体验验收 20260907.md`、`T05 图片体验复核 20260907.md`，以及正式附件、
receipt 和按原契约保留的原图。原插件四个文件备份位于
`/private/tmp/pa-chat-image-vault-before-20260907-qfcvcul1`。
临时截图前缀 `/private/tmp/pa-t05-desktop-`，包括 composer、save-preview、
error-fixed、save-open-fixed 的 `20260907.png`；这里只保存观察摘要，
不声称这些临时截图已经永久归档。

## Review Findings And Cost Classification

六项 P2 已修复并独立复核：R-01 预览时表单 hidden 被 CSS 覆盖；R-02 未完成保存
恢复缺少确切正文；R-03 原图打开后详情遮挡；R-04 移除后焦点丢失；R-05 多图错误
项被挤出视口/说明挤压及同批早期失败可见性；R-06 打开笔记后保存与父层弹窗遮挡。
职责仍为 ComposerDraft 持有状态、renderer 持有预览资源、ChatView 管理详情，
WritingSaveModal 复用原路径校验与 action/receipt；关闭或迟到结果释放自身资源。

| Recorded command / stage | Raw runner values and rerun reason |
| --- | --- |
| `npm test -- --runInBand __tests__/chat-view.test.ts __tests__/composer-draft.test.ts` 初轮 | Jest 0.435 s / exit 1（新测试 TS1005，Chat suite 未跑）；1.438 s / exit 1（旧布局断言）；0.743 s / exit 0（219 tests） |
| 同命令 R-03/R-04 | R-03 0.837 s / exit 1（新选择器文案错误）→0.712 s / exit 0（222 tests）；R-04 0.968 s / exit 0（222 tests） |
| 同命令 R-05 | 0.953 s（224 PASS）；0.988 s / exit 1（226 PASS、1 FAIL，关闭后测试引用被清空）；修正夹具引用后 0.759 s / exit 0（227 PASS） |
| `/usr/bin/time -p npm test -- --runInBand __tests__/writing-save-modal.test.ts __tests__/writing-save-action.test.ts` | 初轮 23 PASS，Jest 0.542 s / real 0.82 s；R-02 后 23 PASS，0.315 s / 0.60 s；R-06 25 PASS，0.396 s / 0.78 s；补恢复入口后 26 PASS，0.345 s / 0.60 s；均自然 exit 0 |
| 首轮 `make bin` | 平台/Lint 通过；新测试 mock/构造签名引发 6 个 TS2554，Build 失败、exit 2、real 11.14 s；未进入 Jest |
| 测试类型修复后 build/full | build 自然 exit 0、real 8.28 s；`test:all -- --runInBand` 自然 exit 0、239 suites / 6225 tests、Jest 101.206 s / real 122.36 s；复用未变的平台/Lint |
| 文档 checker | 初轮 28 个完整 Spec ID 缺失；补本次/继承映射后通过。具体缺失组成和适配耗时未知，不将 28 项直接等同无关范围 |
| 实机修复后完整 gate | R-04–R-06 改变源码/测试/CSS，旧 6225 tests 输入失效；重新冻结后取得上节 6233 tests 结果，属于必要重跑 |
| UI 工具/环境 | 首次 Preview `getApp` wall time 701.6445 s；属于工具等待。早期文件对话框误选旧目录后取消并分步选图，返工独立耗时未知 |

源 session `01a07a4d-4685-7a91-ad51-5ce82859aafd` 的试点 turn_context
（2026-09-07T05:44:11.836Z）为 `gpt-6-astra / ultra`，两个实现者和审查未传
模型 override；子任务逐轮实际设置未另行采集。实现、review、测试编写、锁屏和
人工等待的分项耗时未知；并行命令不相加为端到端成本，不推算提速比例或模型因果。

## Limits And Disposition

- Codex App 被 Computer Use 明确拒绝，未取得 Agent 直接交互对照；没有绕过。
  仅当用户要求逐项对照且参考可访问时再采集，不据此倒填通过。
- 故意损坏 PNG 在系统选择器中无法提交，即使 All Files 仍禁用 Open，原因未知。
  仅当正常受支持图片也稳定复现，或用户明确要求诊断该入口时，再排查；vault picker
  的错误呈现验证不替代系统选择器验证。
- 本轮没有 Chat/provider 调用、模型调整、iCloud 或真实 iOS，也没有重跑旧格式
  矩阵；partial/导航失败恢复来自 focused 测试。相关输入/生命周期再变更或出现
  新的实机症状时按风险补证，不推定所有设备与失败组合已验证。
- 稳定行为和回归已由当前契约与测试承担；Active README/Tracker 在用户授权
  closeout 后 deleted-after-absorption，不保留整套过程日志。
  未决诊断与治理候选仅按 [Backlog](../../backlog.md#触发型评估) 的条件重启。
- closeout 关闭本次交付；Git push、master 集成及远端 CI 结果以实际执行为准，
  不产生 tag 或 release。
