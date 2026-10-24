# B-163 Lean Ghost Publishing — Final Validation

Document status: Archived
Delivery status: Closed
Closed date: 2026-10-24
Work item: B-163
Authority: 精简 Ghost 发布及固定封面 caption 修订的历史验收；当前行为以 [DEC-053](../../product/decisions/dec-053-lean-ghost-publishing.md)、[Product Spec](../../product/specs/pa-ghost-blog-publishing-product-spec.md) 与 [完整设计](../../development/ghost-blog-publishing-design.md) 为准。

## Accepted Scope

T-01～T-06 已完成；F-01～F-07 全部 Fixed，2026-10-19 caption 修订完成独立验收。
2026-10-24 用户授权整理完成的 active 记录、直接归档；原已完成包在吸收后删除。
本次文档收尾未调用模型、操作应用/测试 vault、部署、提交、推送或发布。
历史实现提交 `48585cea`，caption 修订提交 `fb3f9b1e`；不据此推定新的远端或发布状态。

| Requirement / acceptance | 历史有效证据 |
| --- | --- |
| REQ-01、REQ-02、REQ-12 / AC-01、AC-09 | binding/host/service 回归：仅 GHOST_ID、无 ID/精确不存在才新建、非法字段/查询失败停止、旧字段忽略、成功回写及失败保留；部署运行新文实际回写通过。 |
| REQ-04、REQ-05 / AC-02、AC-08 | metadata/snapshot/resources/export/wiki-links 定向与全量覆盖完整受管内容、缺失清空/生成、运营字段保持、综合转换和普通双链；caption 追加验证见后文。 |
| REQ-03、REQ-08、REQ-09 / AC-03、AC-06 | service/action-context/workflow 覆盖 draft 同 ID 保存、published 隔离预览、固定候选与原 ID 确认、指针复用和 exact 清理；未知写入不重放。 |
| REQ-07、REQ-10 / AC-05、AC-07 | task-source/prepare-tool/result-facts/host 覆盖真实权限与身份、无关变更、取消、成功/失败/未知分离；B-157 适配后离线 55 tests PASS。 |
| REQ-06、REQ-11 / AC-04 | controller/preview 回归与部署 test vault 真实预览/后台/确认按钮、快速双击；预览 uuid 与正式 post ID 正确，无 probe/ticket 门禁。 |

## 2026-10-06–07 Implementation And UI Validation

内容、领域、UI 与 Host 分工交付；GLM 周限额后 GPT 接管，独立 GPT 只读交叉审查实际
差量与定向证据，无剩余 must-fix。lint 首轮无用 import、build 首轮 mock 类型问题修正后
通过；社区 DOM 源码扫描 exit 1 无匹配。

全量首轮 **377 suites / 8,969 tests：376 suites / 8,915 tests PASS、1 suite / 54 tests FAIL**，
自然 exit 1。唯一 B-157 beforeAll bundle 仍引用旧 GhostOperationStore；只修适配工具及
直接测试，离线 1 suite / 55 tests PASS、自然 exit 0，另一 GPT 复核无 must-fix。
生产输入未变，复用其余 376 suites，不把结果冒称新的一轮全量全绿。
历史 docs:check 266 Markdown / 3,491 links、文档契约 2 suites / 58 tests 与 diff check PASS。

`make deploy-current` 核对构建后部署 repo-local test，重载 PA 2.10.3 / Obsidian 1.14.4。
真实 Host/controller/service/client、Vault 与本机合成 Ghost 验证：新文 POST 回写 GHOST_ID、
同 ID draft PUT、published 独立 preview 不改原文、准备后修改来源仍提交固定候选、exact DELETE。
首次 CUA/CLI 显示旧画面，原生按钮验收曾 BLOCKED；没有把直接 session.run 当按钮通过。

窗口置前和 AX Raise 恢复后，经真实 Ask/按钮补验：首次 Open preview 打开 uuid URL，
Edit in Ghost 定位正式 ID，两次导航后仍只一次 POST；published 预览是隔离 draft，原文未改。
候选准备后编辑合成 note，确认按钮 clickCount=2：原 ID PUT **仅一次**，仍 published，
正文为固定候选，准确 preview 已 DELETE；第二击进入完成后的后台入口，没有重复提交。
可见 Article updated、正确原 ID 后台 URL，errors=[]。独立 GPT 逐组核对完成性。

真实 Chat/card/Host/client 下游已运行，Chat stream 与 metadata 是本地确定性替身，
Ghost 是 loopback 合成服务；**不证明真实 AI 决策、Ghost 鉴权/主题或线上发布**。
原始 Chat 来源失效的首个具体事件仍未确定，不因后续门禁修正补写完整因果结论。

## Confirmed Findings

- F-01：首次未知写入保留已建立 operation ID 与效果事实，避免误报 not_started。
- F-02/F-03：同路径文件替换由 TFile 身份拒绝；确认逐 Markdown 依赖复查当前内容权限，
  `#no-ai` 撤权拒绝，普通编辑仍用固定候选、metadata 只生成一次。
- F-04：新文成功回写正式 ID 后，预览与后台入口沿用可信 ID，真实接线回归通过。
- F-05：关闭 Chat 保留保存事实、撤销旧确认。
- F-06：draft 被人工 Publish 后必须建立不同于正式 ID 的隔离 preview，不能复用原文作临时稿。
- F-07：本地关联失败后再遇 GET 失败，仍保留可信 draft ID；后续同步不重复 POST。

以上均有定向回归和独立复核，非凭收尾标记推断已修。

## 2026-10-19 Caption Revision

Owner 明确要求有可用封面即自动加入固定 PA caption，不依赖本机生成记录或生成哈希。
exporter 决定字段、resource 保留读取/身份边界、snapshot 固定 payload；未新增来源账本。
新预期在旧实现 5/112 FAIL，修订后 3 suites / 112 tests PASS；补充缺失/不可读边界后
action-context 46 tests PASS。另一 GPT 只读审查 8 源码/3 测试/4 契约文档，无 P0/P1/P2。

本轮 `make deploy` 自然 exit 0：lint、production build/type-check、**398 suites / 9,746 tests
全量 PASS**，部署 test；全 src DOM 扫描无匹配，diff check PASS。此结论只覆盖该轮输入，
不把 10 月 6 日失败首轮改写为 PASS。最终 docs:check 330 Markdown / 4,243 links PASS；
首轮因两个 Tracker 同为 Now 的文档门失败，在必需验收完成并如实标 Validated 后通过。

10 月 19 日部署构建 main.js SHA-256 `1b00a773c337a347b46a22a18a92257b20d7cd04b765ddd8f26b3f658d20f922`，
test PA 3.0.0 / Obsidian 1.14.4 安装资产与 dist 一致。普通封面及字节已变化的封面均无题图
声明，真实 controller/client 的 candidate、draft POST 和 GET readback 均含 caption。
本机合成服务共两次 POST draft、两次上传、两次 GET，无真实 AI/Ghost 或线上请求。
首轮探针未落结果未计 PASS；修正探针清理/落盘后验证通过。
本轮未重新点击按钮，未改动交互复用 10 月 6–7 日历史 UI 证据。

## Environment, Limits And Disposition

10 月 6–7 日恢复配置、metadata、Chat stream、viewer/debug/mobile=false，ownedServers=[]、
smokeActive=false，临时网页 tab 关闭；旧画面误操作曾给 Dog 插入两字符，按准确前缀撤销。
合成笔记及独立测试 Chat 当时保留。10 月 19 日图片、笔记、目录及本地服务全部清理，
CLI debug 由原 off 临时 on 后恢复，mobile/settings.debug 与 controller/session/config 引用保持。
2026-10-24 整理时，`test/B163-smoke-20261006` 与 `test/B163-smoke-ui-20261006` 的四份
合成夹具由清理主流程按原路径和逐文件 SHA-256 核对后迁入本地忽略归档
`local-archive/2026-10-24/test-vault-development-artifacts.tar.gz`，原测试库夹具移除；
不据此推定历史测试 Chat 会话已删除。

未部署 anthelion、未更新生产 Ghost；跨设备/重启续接不在产品范围，真实服务或设备证据
限制不是未完成本轮任务。未来只有新请求或具体失败才另启验证。

2026-10-24 只读复核时 `/tmp/pa-b163-full.log`、B-157 定向日志、ui-evidence.json、
ui-cleanup.json 与 `/tmp/pa-ghost-caption-20261019-0jk1LH/` 均不可用。本档据原 Tracker
保存历史证据，不宣称重新读到原始日志。原包与终态 Tracker 本轮备份于
`/private/tmp/pa-project-cleanup-20261024/query-ghost/`。稳定职责吸收到完整设计，
README、SDD、Tracker 采用 delete-after-absorption；无延期项。
