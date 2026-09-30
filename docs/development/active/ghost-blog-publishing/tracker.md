# Ghost Blog Publishing Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-09-30
Work item: B-153
Authority: 本 track 的唯一执行状态、finding、验证证据与跨会话接续。
Product spec: [Product Spec](../../../product/specs/pa-ghost-blog-publishing-product-spec.md)
Plan: [开发测试方案](./plan.md)
SDD: [实施设计](../../ghost-blog-publishing-design.md)

## Current Snapshot

- Current phase: T01–03产品开发与实际app验收完成，GPT独立接受。最终r27自然exit0，platform/lint/production build、344 suites /8465 tests通过，1471输入前后不变；实际test/test2加载同一构建并完成复验及S04，SHA `8d22614c8758b9f2df2349e6d47ff9f60069dac60f061aa0fed2cc3cce6cedc3`。REQ/AC01–10有获批标准的历史证据；T04来源、体积及Writing等待修复已由实际完整CI接受，当前状态Validated。
- Next action: 本轮CI修复完成。`6facc3b`对应[CI run 36667459680](https://github.com/edonyzpc/personal-assistant/actions/runs/36667459680)的完整validate job为success，包含platform/notices/lint/build/Test/Audit；不将前轮失败或跳过步骤算作PASS。正式closeout与release仍按独立授权执行；真实双桌面同步为非阻塞补验。r26中止gate只作为superseded，r24无有效full gate；不将中断运行计为通过。
- Git delivery: 运行时、测试、依赖与notices共78文件已提交为`dae07050ba890655916f18b8fa6ade74273e0c88`；11份B-153文档随本记录单独提交。交付前实时远端master仍为基线`10635c68913a95e9b25ced7375e21a1030880791`；1102项非文档输入与r27完整gate逐项一致，9个gate外受控符号链接未变化，styles与最终构建一致，无新增未验收输入，复用既有运行时及app证据。推送结果以本次操作回执与实时远端SHA核对为准，不由文档预先宣称成功。
- CI followup delivery: 来源登记`9130f778235060049f6362428d6d83c04fd1db57`、10MiB预算`61e39d1cf1eb003c36e99bf359a38ded093c1fee`及Writing测试等待`6facc3b99dc6ea4207ad2d135d1f2434818ddea3`均按既有授权固定SHA推送至master，并由实时远端核对。最终source SHA的完整CI已通过；本记录与GOV-003另行提交，不改变已验证运行时输入。
- Blocker / decision needed: 无未决核心产品选择或外发授权缺口。Owner明确批准本轮AC08改为同机独立test/test2；真实双桌面同步留作后续补验，不阻塞本轮完成。test2独立配置Ghost凭据，不复制A的本机进度/Chat；先缺完成记录拒绝，再仅复制完成记录与源文件执行新更新。仍使用同一loopback Ghost/图片站点；不将双vault证据称为真实跨设备同步。接收树无node_modules时复用worker中同一exported deployCurrent、指定repositoryRoot完成构建身份验证；无手工跳过检查。外发不含个人vault、真实文章、秘密或无关项目。
- Last verified behavior: 最终r27初始Chat含图片＋双链请求直接成功，无Prepare again；确认前线上不变，更新和恢复均保持原ID/URL/人工排版/未管理字段，本地正文不回写，精确临时稿清理。恢复终态仅Open Ghost editor。test2缺记录时明确提示同步，真实client写入调用0且远端6篇不变；仅复制完成记录后，B改正文、预览并确认，成功更新同一文章并保存自己的完成记录，A正文未变化。
- Planning baseline: `10635c6`；开始本轮时已有 6 份 B-153 文档修改。规划沿用并保留这些修改，未改变运行时代码。
- Delivery tree: 接收树 `/mnt/code/personal-assistant`；隔离实施树 `/home/admin/.codex/worktrees/b153-ghost-publishing/personal-assistant`，基线 `10635c6`。已显式复制并逐字核对 11 份未提交 B-153 文档；原树修改保留，manifest 在本次运行目录 `contract-inputs.json`。
- Evidence availability: 2026-09-30检查时，T01–03原临时目录`/tmp/pa-b153-run-aiw9x3xb`已不存在；下文原始app路径属于历史验收记录，不能声称当前仍可读取或作为新增检查的原始证据。T04各CI补验目录当前可读取；本轮保留来源、预算、测试修复的原始日志和输入hash，并用实际远端完整CI核对最终输入。
- App target: A=`/mnt/code/personal-assistant/test`；经Owner批准新增B=`/tmp/pa-b153-run-aiw9x3xb/test2`。部署先核对CLI路径与实际onload构建。隔离worker树make deploy不等于实际app部署；安全接收核对输入与production assets/provenance，再复用同一deployCurrent指定repositoryRoot和实际destination。B仅复制3份合成源文件及白名单AI设置、生成独立vault ID；Ghost单独配置，未复制本机进度或Chat。不使用个人vault/正式站点作为测试目标。
- Worker identity: 本机 CLI `0.157.1`，profile `pa-glm`，ZAI / `https://open.bigmodel.cn/api/v1` / Responses，请求 `glm-5.3`、reasoning `max`、direct bearer（不读取或输出密钥），服务端实际型号未知。调用覆盖 catalog 为 `/home/admin/.codex/pa-glm-models.json`，sha256 `43648c8a26a33d2dcd61a12a5c64e65d8d310dce0f5de91be7962e0a30236e5c`；选定模型条目与 repo 完全相同。原 profile 的 Mac catalog 路径未修改；显式覆盖 ZAI / glm-5.3 / max，关闭 memories 及两个无关 MCP。认证、只读、scratch 创建/修改与断言 0→1→0 的自然退出已核对，预检全部通过。不可使用 `--ignore-user-config`：实测该参数也跳过 profile，错误路由被拒绝（400），未执行工具；已恢复上述明确路由。
- Owned temporary resources: 本次 `/tmp/pa-b153-run-aiw9x3xb` 保存任务单、events/result/stderr、scratch 及尚不可执行的 T-02 派工草案；上述 managed worktree 保留交付物。GPT 新建 `host-setup/`，含 Ghost 6.65.0 原包、解包后的 `ghost/`、本次依赖/cache 和独立 Node 22.23.1 `runtime/`；未修改系统默认 Node 或 PA package/lock。安装进程均已退出；T-01/r2 继续使用这些资源。GPT 创建 app 本地合成数据库 `pa-b153-t01-aiw9x3xb`，验收后精确删除；仅 test 单窗口重启，前后均 markdown/mobile=false。之后临时启用原生 Web viewer，创建 leaf `b8183556772c23ea`，原 leaf `7fc44d1da800e58e`；原 core 开关=false，恢复信息存 `host-native-preview-state.json`，T-01 app 检查结束后恢复。worker 新建资源随创建记录，未验收前不清理。
- Environment correction for r3: 中止 worker 同时结束了其服务，现由 GPT 持有 Ghost handle `48540`（127.0.0.1:2371）和合成图片 handle `37389`（2372）。原合成配置 mail=direct 已改为 Ghost 实际支持的 `stub` 并重启，避免测试触发邮件发送；健康端点 HTTP 200。仅本次配置变化，不修改 PA 或正式站点。recipe v2 执行快照及输入 hash 在 `host-r3-execution/`；被脚本更新的 5 份 r2 原始证据先精确备份到 `t01/evidence/r2-before-recipe-v2/`（0600），未丢弃。
- T-01 app restoration: `host-t01-restoration.json` 确认 core Web viewer=false、原 leaf 恢复、owned leaf 已移除、唯一合成 IndexedDB 删除成功。成功/错误页截图及所有必要证据保留；Ghost/asset 服务供后续测试复用，不提前清理。T-02 本轮输出限定 `t02/`，任务单 `t02-task.md`；不向 worker 开放 test vault 或秘密目录。
- T-03 app preparation: `t03-app/before-state.json` 与 `before-window.png` 保存实际 test 窗口、三个 leaf、mobile=false、Web viewer=false 的基线。确认目标原不存在后，仅创建 `test/0.unsorted/b153/{Publishing.md,Embedded.md,local-image.png}` 三份合成夹具；原字节/来源 hash 在 `t03-app/owned-fixtures.json`，未部署新插件或发起文章操作。CLI 已在新标签 `83bc0f2118adabcb` 打开合成 Publishing.md；`owned-leaves.json` 仅认领这一 Markdown 标签，随后观测到的其他 core/Chat 标签不归本任务，不清理。直连本机 Ghost/图片端点均 HTTP 200；普通 Python 默认代理请求的 502 是代理路径差异，不是产品结果。
- T-03 interaction method: CUA 浏览器 inventory 首次 fetch failed，刷新又超时，已停止重复重试。用户已允许 Obsidian CLI，Plan 允许 CLI/CDP；实际窗口 `sendInputEvent` 的“更多→New Chat”可信点击、可见菜单、空会话和截图保存在 `t03-app/{input-click-check,new-chat-ui}.json/png`。CLI 再次调用会关闭临时菜单，因此同一次受限脚本分步观察/操作菜单，不能把 API 存在或事件发出当交互成功。原 Chat identity 已保存至 before-state；新会话尚未发送消息，当前只是验证测试操作方法，不是 B-153 新入口通过。
- T-03 native Ghost setup: 已通过实际设置开关启用 test 的 Web viewer，原=false，证据 `webviewer-setting-ui.json`；设置窗口已关闭。创建 owned native leaf `43d5ae86a5b03839`（`admin-leaf.json`）。地址栏原生输入两次均复位，停止该准备路径，改用T-01已验证的native viewer navigate打开本机Ghost；不把此导航当产品UI验收。现有隔离owner凭据仅由本机脚本读入，通过guest原生输入和Sign in按钮登录到 `http://127.0.0.1:2371/ghost/#/`，无错误/密码框；`login-existing-test-owner.json`不含凭据，认证页状态/截图保留。验收后登出本任务测试会话、移除owned leaf、恢复core开关；未创建/发布新文章。

## Work

| ID | Slice | Status | Evidence / stop point |
| --- | --- | --- | --- |
| T-01 | 原生 Ghost 预览、转换与两种存储的最小可行性 | [x] | GPT 接受r3＋Host补验，技术设计Approved；生产schema/权限/恢复由T02–03另行验证 |
| T-02 | 同一 GLM writer 完成导出、受控写入/恢复及 Host/UI 接线 | [x] | K02、实际diff/反例及最终r27完整gate已独立验收；交付文件安全接收 |
| T-03 | 冻结输入、集中完整门禁、Desktop/mobile/独立双vault验收 | [x] | S01–05完成，r27受影响入口/更新/恢复及S04通过，CLI mobile复用未变证据；真实跨设备同步未声称通过 |
| T-04 | master CI第三方来源、打包审计及Writing测试补验 | [x] | notices、10MiB预算及一个Writing测试文件的修复均独立验收；318 tests定向通过。`6facc3b`已固定SHA推送，实际CI `36667459680`完整validate job success，Test和Audit均success |

任务卡和静态验证方法唯一放在 Plan；下面只记录逐项执行结果，避免复制方案。

| Requirement / AC | 实现任务 | 最低充分证据位置 | Result |
| --- | --- | --- | --- |
| B-153/REQ-01 / B-153/AC-01 | T-02 | V-03、S-01 三入口与活动笔记切换 | PASS；r20三入口/歧义＋S05，r27首次名称入口及prepared说明、S04准确路径入口 |
| B-153/REQ-02 / B-153/AC-02 | T-01、T-02 | V-01、S-01/S-02 格式保留与正文不变 | PASS；最终full gate、`r27-update-proof.json`及`s04-update-proof.json` |
| B-153/REQ-03 / B-153/AC-03 | T-01、T-02 | V-01、S-01 真实主题综合夹具 | PASS；T01/实际Ghost可编辑性、`s03-native-render-evidence.json`；recipe/格式实现未变，r27原生检查再次通过 |
| B-153/REQ-04 / B-153/AC-04 | T-02 | V-01/V-03 嵌入、链接及排除 | PASS；r27真实TaskSourceRun图片＋双链及动态权限/revision负例，真实综合夹具准备成功 |
| B-153/REQ-05 / B-153/AC-05 | T-01、T-02 | V-02、S-01 图片转存/复用、凭据边界 | PASS；最终gate及r27首次Chat准备，A/B不同凭据键和独立配置，资源来源/复用检查保留 |
| B-153/REQ-06 / B-153/AC-06 | T-02 | V-01/V-02、S-02 字段三态和稳定 URL | PASS；最终gate＋A更新/恢复及B更新实际ID/URL/未管理字段不变 |
| B-153/REQ-07 / B-153/AC-07 | T-01、T-02 | V-02/V-03、S-01/S-02 原生预览与确认 | PASS；实际两预览入口、人工Publish/no newsletter；r27及S04确认前原文不变、原生检查后显式Confirm |
| B-153/REQ-08 / B-153/AC-08 | T-01、T-02 | V-02、S-02/S-04 重启及独立双vault新更新 | PASS（Owner批准的同机test/test2标准）；真实进程重启＋独立B缺记录拒绝/复制完成记录后新更新。真实跨设备同步未实测 |
| B-153/REQ-09 / B-153/AC-09 | T-02 | V-02/V-03、S-02 变化失效、结果核实 | PASS；最终gate动态权限/来源变化，实际源编辑撤下旧确认、重启重新检查/确认；结果与远端记录一致 |
| B-153/REQ-10 / B-153/AC-10 | T-02 | V-02、S-03 恢复、临时稿精确清理 | PASS；`r27-restore-proof.json`全部真，undo消费、本地源保留、其他稿不动，终态只保留有效编辑器入口 |

S-05 补充桌面限定及移动端普通编辑/布局的兼容证据；不把 mobile 模拟标成 iOS 真机。

## Findings

当前无未决产品选择，下列已确认的 T-01/T-02 缺陷已有修复及对应定向证据。若后续证据要求改变已批准边界，先按
Plan 报告原选择、具体失败、备选及取舍；不自行削减 AC。

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| D-01 | P2（方案） | 生产注入/禁止副作用的验证未具体落位 | 纳入既有 V-01/V-02 及 S-01；不增加 suite 或实站矩阵 | 人工区域、重复库、PA冲突、无全站写入/newsletter由最终gate及S01实测覆盖 | Closed；最终gate＋app |
| D-02 | P2（方案） | 访问范围变化单独确认缺少测试映射 | T-02 与 V-02 明确默认变化不影响旧文、显式变化单独确认 | 最终service/controller负例覆盖原范围保持与显式范围单独确认；未确认零写入 | Closed；最终gate |
| D-03 | P2（方案） | 移动/改名后的成功关联缺少验证 | V-02 增加沿用关联、当前路径准入、不重新 POST | binding/action-context owner覆盖移动/改名沿用关联、不重新POST及历史主文映射 | Closed；最终gate |
| F-01 | P2（可行性） | 真实 native Preview 中 Prism token=0、Mermaid SVG=0、块公式 display=0；loaded/HTTP 200 不能表示完成 | 补 clike 依赖、classic Mermaid bundle、display=true；GPT 检查可见页面与失败输出 | `host-comprehensive-v5-success/failure.json` 与截图；生产检查须识别错误 SVG | Closed，T-01/r3；生产回归留 V-01/03 |
| F-02 | P2 | 原 guard receipt 形状与项目不兼容，读取中撤销未覆盖 | r2 复用 TaskSourceReadGuard、正确调用 closure，新增 await 撤销/主文变化回归 | 实际代码/断言及冻结 probe 的 real-contract 成功 | Closed，r2；Host 最终发送边界仍待 V-03 |
| F-03 | P2 | table cell曾按整行内容找唯一位置，相同图片在两个cell时误报歧义 | r8 按实际 row/cell 顺序映射转义 pipe 与字符位置，核对原生 token 内容；getLines 保留原实现及恢复 | exporter 22 tests：两个相同图片 cell 保留、资源复用、原始第 2 行定位；原容器/引用图片回归保持 | Closed，T-02/r8 |
| F-04 | P2 | shortcut reference image曾退回错误来源 | 原生image规则消费前后记录range，保持实际目标和owner | r7最终20 tests及GPT冻结probe；source=cover.png、resolvedPath=sub/cover.png、owner=sub/B.md，断言未削弱 | Closed，r7 |
| F-05 | P2 | 脚注引用段落丢 link/image、单词定义被吞；嵌套任务父项尾段丢失 | r3 用 footnote parser rule、safe inline 和嵌套 item 边界修复 | 冻结输出有真实 link/image resource、定义 Note、Parent tail；原始 tests/实际断言核对 | Closed，r3；跨来源图片另由 F-04 跟踪 |
| F-06 | P2 | 原公式在 emphasis 后识别，特殊字符丢失 | r2 在解析层保护原表达式 | 实际 inline/display 断言及冻结 probe 保留 `$a*b*c$` 表达式 | Closed，r2；真实渲染仍待 T-03 |
| F-07 | P2 | begin 的 hash 损坏曾被当人工区域 | r4 在有 PA 标记时要求唯一合法 begin/end、kind/version/hash，再验证区域内容 | malformed hash 与 orphan end 均 recipe-region-conflict，正向 roundtrip 保持；真实 fixture/代码核对 | Closed，r4 |
| F-08 | P2 | 原 TS 无 grammar，库复用/初始化混淆 | r2 补实际 TS 文件/SRI，分离加载/初始化能力，不修改复用库的 manual 设置 | 原始下载完整性、实际 recipe diff 和 JS stub 调用断言 | Closed，r2；真实画像/页面仍待 T-03 |
| F-09 | P2 | 纯链接内加粗曾被误报内容变化，且实际 native link 被按文字片段拆开 | r4 收集完整 link children 生成单一 Lexical link，递归统一语义 text；r3 删块/歧义修复保持 | plain/bold 链接均307c4bba，实际节点/断言/冻结 probe 核对 | Closed，r4；真实远端 Lexical/baseline 接线仍待后续 |
| F-10 | P2 | 原系统前缀误拒相邻合法目录 | r2 精确系统路径边界，用户 prefix 原语义不变，fresh marker 仍拒绝 | SourceAccess 实际 diff 与相邻目录/moved/fresh-content tests | Closed，r2 |
| F-11 | P2 | 表格inline无map被loader跳过，显式笔记嵌入变空cell；行内wiki图片曾静默丢失 | r8 以实际字符范围展开 table 嵌入；wiki 图片走原生 image/统一资源管线，残留未解析嵌入报错 | `t02-r8-gpt/logs/exporter-red.log` 2 个有效失败→`export-store-final.log` 全部通过；子笔记正文/图片 owner、前后文字、缺失嵌入拒绝有断言 | Closed，T-02/r8 |
| F-12 | P2 | 人工改动的旧临时稿归属被下一次操作淘汰，再次更新误报其他桌面在途；已完成后的 cleanup_pending 也会阻挡新更新 | 保留仅含未决/放弃清理归属的本机记录；已完成清理任务不占在途发布位置，普通成功终态照常淘汰 | 独立反例 `t02-r8-review/probe.log`；`recovery-r6.log` 覆盖保留/失败清理跨重启连续三次更新及并行清理，不误删旧稿 | Closed，T-02/r8 |
| F-13 | P2 | 远端已成功、完成记录写回失败后，笔记新修改阻挡只读核实及补记录 | validate 区分 candidate/reconcile/completed；实际新写仍验证当前候选，核实/补记录检查当前权限和历史来源准入，允许本地新正文 | `recovery-r6.log`、`t02-r8-context/receipt.md`；未知 PUT→改正文→补记录失败→再次改正文→权限撤销拒绝→恢复权限后成功，始终仅一次 PUT | Closed，T-02/r8 |
| F-14 | P1 | Chat 重试按 UI 回合 ID 读目标，原先却按活动请求 ID 写入；新会话后两者偏移，C 失败重试实际绑定 B | 统一用 UiTurn.id；新会话及 Pagelet handoff 同步清理本次卡片与目标 | `entry-review-red.log` 真实 B/C/C→B/C/B 反例；`entry-review-green-r2.log` 通过，真实 app 重试仍留 T-03 | Closed，T-02/r8 |
| F-15 | P1 | 用户正文中的 PA 曾允许模型以子串 A 定位另一篇笔记，违反明确目标 | locator 必须完整出现；字母、数字、Unicode 名称及路径字符内部的子串拒绝，完整名称/路径/wiki/引用仍允许 | `entry-review-red.log` 目标失败；green-r2 覆盖 PA/另一目录路径拒绝及完整引用通过 | Closed，T-02/r8 |
| F-16 | P2 | 输入中段的 @ 菜单曾提供 blog2ghost，但实际 parser 只承认开头，选中后无工具 | 仅在可形成有效命令的开头提供该菜单项，不改现有 Writing/CreateImage 入口 | red→green-r2 断言中段不展示，开头/数字/IME 保持；真实菜单交互留 S-01 | Closed，T-02/r8 |
| F-17 | P2 | A 完成后保留人工编辑的旧预览，B 无 A 本机 locals 时被误报其他桌面未完成 | 经校验的远端 created_at 严格早于已完成远端版本的 draft 已被新基线取代；保留不动。缺失/同刻/较新仍拒绝。binding 查询必须完整有界，不从前两条推断全体 | `completed-desktop-red-r2.log` 真实 other-desktop 失败→green；client 完整3条/截断101条保护。首轮 red 是 fake factory 未隔离的夹具错误，未算产品反例。独立review核对旧候选仍须原版本+baseline，不因忽略旧稿获得写权限；真实两桌面仍待S-04 | Closed，T-02/r8 |
| F-18 | P2 | 首次 Ghost 手工 Publish 后，本地新正文曾阻断只读检查结果 | refresh 统一使用 reconcile/completed 准入；新写/预览确认仍 candidate 校验 | `manual-publish-red.log`→`manual-publish-green-r2.log` 18 tests；后续59 tests覆盖。新正文下旧预览拒绝、已发布旧版成功记录且零 PUT | Closed，T-02/r8 |
| F-19 | P1 | restore历史来源已不在当前正文时，仅缓存路径准入漏掉最新排除 | 实际读取历史Markdown并记录代次，最终gate重验；快照正文仍是旧版，不要求等于当前来源 | r10真实context 13 tests PASS；主文移除embed、新历史#no-ai拒绝；允许准备后仅历史revision变化使beforeSend拒绝。GPT已核实际读取与断言 | Closed；r27完整gate＋实际恢复 |
| F-20 | P2 | 首次草稿重新准备缺少completed baseline，始终missing-baseline | 仅复用受本机operation校验的previous候选，保持同草稿及重新检查 | r10真实context在两次准备间增加本地段落，旧段远端加粗保留且新段存在；既有service同ID/reprepare断言复用 | Closed；r27完整gate＋既有S01重新准备 |
| F-21 | P2 | 未知首次POST后人工Publish无法核实；r9新增分支又可能接管更新预览且拒绝仅格式差异 | 只限首次create；唯一精确标记/受管语义核实，不重POST；拒绝更新/恢复已发布预览且不改正式target | r11 service25tests及full gate通过；GPT核验create限制、format-only实际baseline、实质改字拒绝、更新预览原target/URL/checksum及绑定不变。相邻save_preview PUT场景另交r12诊断，不将其预判为已修复 | Closed，r11；相邻风险待r12 |
| F-22 | P2 | 主笔记改名后，恢复仍校验旧main路径 | 依据唯一note_uid只映射历史main至当前主笔记，不映射embed/资源 | r10真实context覆盖旧路径被不同UID文件占用且拒绝该路径，恢复仍检查当前New.md；GPT已核最小映射和既有历史依赖排除断言 | Closed；r27完整gate；移动/改名由owner层验证 |
| F-23 | P2 | 恢复卡片仍显示确认更新 | 最小明确restore状态、完成态和确认恢复按钮，沿用人类确认票据 | r9/r10源码及controller/card断言；r27真实Restore previous version→Confirm restore→Previous version restored | Closed；r27 gate＋app |
| F-24 | P1 | 实际Obsidian设置无法保存：SecretStorage ID超出宿主64字符限制 | 将scope/site合并为稳定隔离digest及短前缀，保留本机独立凭据；strict fake模拟真实宿主约束 | r13 strict owner 4tests及full gate通过；`t03-app/ghost-configured-ui.json`真实Save显示Ghost settings saved且密钥框清空；`loaded-build-r13.json`匹配构建 | Closed，r13＋实际app |
| F-25 | P2 | 初次草稿reprepare的save_preview PUT结果未知，随后人工Publish无法核实 | 同样只允许create操作的唯一精确目标经受管语义核实，不接管更新/恢复预览 | r12 service27tests，1项有效目标红灯→全绿；GPT核验原ID、实际格式baseline、实质改字拒绝且POST/PUT均仅一次；r13 full gate通过 | Closed，r13 gate |
| F-26 | P1 | 首次prepare在真实Obsidian中无法加载原生`import(node:fs/path)`，transport/store也有相同宿主风险 | 沿用已有image-file-safety的桌面guard后函数内typed require，不改mobile边界或发送前gate，不新建平台框架 | r14 focused 4suites/56tests及最终344suites/8448tests通过；实际app已创建唯一草稿并打开native Preview。首gate的tsc失败仍保留`gate-failed-tsc/`，不计PASS | Closed，r14 gate＋实际app |
| F-27 | P2 | 默认Ghost主题选择`/content/images/size/w2000/…`响应式封面，原检查器只匹配上传原地址，已加载封面误报image-unavailable | 仅识别已验证的Ghost正整数宽度转换，保持实际currentSrc、同源/路径/query/hash及可见和加载检查 | r20 full gate及真实综合预览passed，随后人工发布及S02/S03预览通过；`s02-ready-before-restart.json/png` | Closed，r20 gate＋app |
| F-28 | P2（未证实） | 首次写note_uid后prepare曾提示来源改变，点Prepare again成功；当时正文未变 | r16未经内容核对就消耗下一modify的尝试被GPT拒绝，r17精确撤除；不放宽真实变更检查 | r14真实新合成笔记一次prepared/preview passed；`f28-native-timing.json`两次自身写入事件均先于promise resolve，无gate-error且观察钩子已还原。原提示未复现、根因未知，有新证据才扩展 | Observation retained；无猜测性修复 |
| F-29 | P2 | 真实点击Open preview in browser仍新增Obsidian Web viewer，未打开系统浏览器 | 使用桌面guard后的显式external opener，保留目标URL与最终权限检查；编辑器动作共用正确入口 | r20 full gate与真实按钮点击；`s01-r20-system-browser.json`、`s01-r20-browser-window.json`只匹配合成文章Chrome标题，确认独立系统浏览器入口 | Closed，r20 gate＋app |
| F-30 | P2 | 当前显示网页时，模型把明确指定的path当成当前笔记而省略locator，Host收到空capturedPath后拒绝、没有卡片 | 明确显式路径/名称必须传locator；仅未命名其他目标的当前笔记请求可省略，不放宽Host解析 | r20实际path入口在活动笔记为First identity probe时正确定位Publishing并复用原operation/post；`s01-path-send.json`与实际prepared卡片/回复。旧失败留`r14-s01-path-*` | Closed，r20 gate＋app |
| F-31 | P2 | 名称入口Host正确prepared并复用草稿，但空sourceRecords的状态被标unknown lineage，下一轮模型只看到result_unknown | 为B153闭合Host状态补严格source-free准入，不发送文章/URL/密钥，不放宽全局unknown边界 | r20真实factory→同请求下一provider请求3状态/3固定错误及负例，owner88tests＋full gate；实际path/name得到prepared/needs_attention原始状态，模型不再误报unknown。额外上传表述另记F32 | Closed，r20 gate＋app |
| F-32 | P2 | 真实prepared回复额外声称没有内容上传，但prepared不说明具体副作用，远端可能已有草稿/媒体 | 仅校正tool/skill/Chat指导，不扩展状态或模型重试 | 最终gate；r27-update-card.json实际回复承认prepared可能已有草稿/媒体副作用，不推定具体上传或正式发布 | Closed；r27 gate＋app |
| F-33 | P2 | 首次人工Publish核实后卡片显示Article updated | completed改为中性Publication verified/已核实发布结果，恢复文案不变 | 最终locale契约/full gate；r27及S04实际成功卡片为Publication verified，恢复仍独立文案 | Closed；r27 gate＋app |
| F-34 | P2 | 初始Chat图片更新被拒绝；r25精确binary准入后，含普通双链仍context-revoked | 保留精确owner/path/revision准入；link receipt单独追踪Markdown/link revision，不能用note-only权限重检图片 | r26准确context-revoked红→绿及动态权限/revision负例；r27首次名称入口、S04首次路径入口直接成功，无重新准备 | Closed；r27 gate＋app |
| F-35 | P2 | 已完成恢复的卡片仍提供Prepare again/Check preview，但对应临时稿已删除且undo已消费 | completed-restore终态仅保留Open Ghost editor，不复活缓存canRestore | 最终controller/full gate；r27-restore-card.json终态按钮精确为Open Ghost editor，undo已消费 | Closed；r27 gate＋app |
| F-36 | P2 | 独立test2缺记录正确拒绝，但提示只说记录缺失/变化，未指引先同步vault | EN/ZH既有sync错误追加先与完成发布的桌面同步、再准备；不改状态或流程 | s04-final-missing-card.json显示先同步指引；forward-only实际client写入0，钩子已恢复，远端6篇逐项不变 | Closed；r27 gate＋app |
| F-37 | P2（CI） | 新打包blog2ghost缺checker来源元数据及notices声明，master CI提前失败 | 沿用项目自编资源的AGPL-3.0-only及来源说明，补两处一致登记；保持检查规则 | `/tmp/pa-b153-ci-notices-echn0pg8`；原检查exit1唯一missing provenance；修复后41 runtime/13 bundled、语法、再生成稳定性与diff检查均exit0，1472输入仅两处许可路径变化；远端CI `36662542981`该步骤success | Closed；本地＋实际CI |
| F-38 | P2（CI / budget） | Audit bundle gzip=3056716，超过既有2988442预算68274字节；同一production产物可本地复现 | 官方browser入口诊断反而增6172 gzip字节；Owner于2026-09-30明确批准提高至10MiB（10485760字节）。只改默认budget和注释，保持原审计逻辑 | 原始audit及CI `36662542981`；前基线2959107、B153新增97609 gzip字节。诊断及预算两目录保留原始证据；实际主接收树audit PASS，显式3056715预算仍exit1、五例tooling PASS；源产物SHA不变。前轮CI `36664860246`的Audit跳过，最终CI `36667459680`实际Audit success | Closed；本地＋实际CI |
| F-39 | P2（CI / test） | CI `36664860246`的chat-view两例失败：未等到Save as a note按钮，第二次streamCalls尚不存在；用户提供准确断言和栈 | 固定8/20次flush改为真实render Promise、既有请求数量及回合完成等待，finally恢复spy/关闭modal/释放版本服务；不改生产行为、原断言或既有时间上限 | `/tmp/pa-b153-ci-writing-mvbkg_zo`；318 tests自然exit0，1472输入仅一个测试变化，GLM自然exit0且PID消失；GPT检查真实diff和原始命令，主接收文件与worker逐字一致。`6facc3b`已推送，CI `36667459680`完整Test及validate job success | Closed；本地＋实际CI |

T-03当前真实app证据：`/tmp/pa-b153-run-aiw9x3xb/t03-app/`。`loaded-build.json`确认r11实际加载指纹；
S-05的`mobile-entry-r2.json`及`mobile-desktop-required-r2.png`为真实输入值核对后点击Ask，显示desktop-only且无用户回合/发布配置，
Writing选中；`mobile-legacy-settings.json`含CreateImage选中/移除、#obsidian-markdown选中、Ghost设置隐藏。
`mobile-edit-r2.json`确认真实键盘编辑后editor和磁盘均改变、撤销后逐字恢复。r1输入焦点失败的输出不是PASS，
误发的单个`@`在本次独立合成Chat内，不是有效发布指令；校正后没有触发发布。CLI mobile模拟不称为iOS真机，
该早期证据时尚无关联；其后关联编辑已补齐，见S-05关联补验，当前已恢复desktop。

## Validation Log

### 最终验收：r27 / S01–05

- GLM r27自然退出0。`t02-r27/gate/result.json`记录`make deploy`自然exit0、1471输入前后不变；
  platform guard、lint、production build/typecheck、344 suites /8465 tests全部通过。DOM源码扫描
  无匹配（exit1），diff check exit0。Jest曾提示退出延迟，但最终自然退出，未使用forceExit。
- GPT独立核对r25的10个增量文件、r27的4个增量文件及原始断言，接收时再次核对全部非文档输入。
  `t03-receive/r27-increment-preflight.json`、`r27-received.json`、`r27-deploy-actual.log`
  对应最终接收与两个实际vault部署；`loaded-build-r27.json`和`test2-loaded-build-r27.json`
  的onload SHA均为`8d22614c8758b9f2df2349e6d47ff9f60069dac60f061aa0fed2cc3cce6cedc3`。
- F34的最终实际入口是新Chat名称请求，工具返回prepared，未点Prepare again；综合夹具图片、嵌入、
  普通双链均经过真实Host路径。`r27-prepared-card.json`、`r27-before-confirm-proof.json`记录原生
  预览通过、正式文仍旧版、仅一篇临时稿；真实Check preview/Confirm update后，
  `r27-update-proof.json`全部通过。模型不再断言没有上传，成功卡片显示Publication verified。
- 实际Restore previous version/Confirm restore后，`r27-restore-proof.json`全部通过：旧lexical精确
  恢复、本地v2正文不变、undo消费、对应临时稿清理、其他5篇不变。`r27-restore-card.json`
  的按钮精确为Open Ghost editor。r20的首次人工Publish、系统浏览器入口、真实进程重启与来源变化
  失效证据，以及r14的CLI mobile证据，对照未变化的相关实现复用；未重跑格式/平台全矩阵。
- S04环境：`test2-owned-setup.json`仅列3份合成源文件和白名单AI配置，独立vault ID；
  `test2-independent-state.json`证明Ghost初始未配置、本机operation数据库尚不存在、完成记录缺失。
  Ghost凭据通过实际Host配置接口单独设置；这是环境准备，不冒称B设置UI验收。A/B数据库名与
  秘密键不同，原始A设置UI验收沿用。未复制A本机进度、Chat或Ghost凭据配置。
- S04缺记录：`s04-final-missing-card.json`明确先同步再准备；`s04-missing-write-proof.json`
  为实际client方法的forward-only观察，写入调用0、钩子已恢复；`s04-final-missing-proof.json`
  核对远端6篇逐项未变。随后`s04-completed-sync.json`只复制A完成记录并核对字节相同。
  `s04-source-b.json`记录B原生编辑器精确追加新段落；B新Chat准确路径入口prepared，原生Check
  preview及Confirm update完成。`s04-update-proof.json`全部真：原ID/URL、人工排版/未管理字段、
  本地新正文均保持，远端含B新内容，B自己的完成记录与实际版本一致，其他稿未动、临时稿清理。
  `s04-completed-card.json`显示Publication verified。A源文件仍等于`r27-local-before.md`。
- Owner已明确批准本轮AC08采用上述同机隔离验证。它证明完成后独立环境发起新更新；不证明
  真实跨设备同步服务的传输、延迟或冲突处理。真实双桌面补验不阻塞本轮Validated。
- 文档更新仅调整获批AC08验证方法和执行记录，不改变运行时门禁；最终`docs-check-final.log`
  为251份Markdown/2977条本地链接检查通过，4条既有Memory文档索引/孤立警告仍为advisory；
  `git-diff-check-final.log`空输出、exit0。`final-delivery-identity.json`核对全部非文档输入仍等于
  最终gate，A/B当前构建资产一致，隔离服务2371/2372/2373均已关闭。

### 资源处置与保留

GLM已结束。`stopped-owned-services.json`记录精确核对并停止本任务Ghost PID83618、图片服务
PID82856，两者已消失。`restored-a-ui.json`验证A原笔记、原Chat指针、Ghost设置、窗口尺寸及
mobile=false/Web viewer=false均已恢复，原AI凭据仍可用；本任务Ghost凭据已删，最终测试构建保留。
`test2-runtime-cleanup.json`记录B专属Ghost/AI凭据已删，B窗口已关闭。创建B时的目录选择辅助挂起
通过重启测试app恢复，随后使用Obsidian自己的vault-open入口；它是环境准备问题，不算产品失败。
移除最后一个测试标签后曾无tab group，已由官方CLI恢复原笔记并核验，未改用户正文。

开发验收止点保留接收树与dirty managed worktree（含共享依赖/当前构建），不force-remove；保留运行目录
`/tmp/pa-b153-run-aiw9x3xb`中仍被引用的原始证据、隔离站数据及test/test2合成验收状态，供交付复核。
这是明确保留，未宣称已删除全部临时文件。开发验收止点尚未commit/push/release；后续master交付已获Owner授权，见Current Snapshot。没有正式Ghost发布或跨桌面在途移交。

### 历次证据

下列“待验收/待修复”描述是当轮止点；当前结果以以上最终验收和REQ/AC表为准。

S-01–03/r20实际验收：`s01-completion-proof.json`确认人工Publish后PA记录与实际published
lexical/version一致；`s01-publish-flow.json`明确Not sent as newsletter，`s01-published-native.json`
记录原生确认。主文章`6abba698d1d4e946a3b8c98d`、URL不变。`s02-confirmation-boundary-proof.json`
记录准备/暂离/重新准备和重启之后、最终确认之前正式文章逐项未变，临时稿含最新v2来源。
`s02-source-invalidated.json`显示再次编辑撤下Confirm update；`s02-abandon-resume-card.json`
与`s02-post-restart-continue.json`记录显式Continue。
`s02-restart-before/after.json`确认main PID 57485→261289、renderer 57541→261334，旧进程消失；
新应用无旧确认，后续Check preview再Confirm。`s02-update-proof.json`核对同ID/URL、未变人工
加粗段落、未管理字段、发布记录和本地源逐字保持，只有对应临时稿`6abbb997d1d4e946a3b8c9a9`
清理，其他5篇不变。`s03-preview-proof.json`恢复预览等于原版且确认前线上仍为v2；
`s03-restoration-proof.json`确认原lexical恢复、本地仍v2、undo消费、对应临时稿
`6abbbb7ad1d4e946a3b8c9bb`清理且其他稿不变。S03功能行为通过，终态多余按钮记F35，
不据此提前关闭全部AC。上述证据只涉及本机隔离合成站点，非正式发布。
`s03-native-render-evidence.json`对实际原生恢复预览只读核对：130字符代码与源逐字一致、18个
高亮token、1个Mermaid SVG、2个公式（其中1个display）、正文两图均已加载；11个实际
渲染资源URL各只加载一次，recipe显示prism/math loaded和mermaid rendered。`s03-open-editor.json`
与`s03-editor-window.json`补实际Open Ghost editor按钮打开系统浏览器合成Ghost管理页。

T-02/r20 GPT独立增量审查：对比实际接收树r14，核对11个非文档文件及原始断言；
`t03-r20-review/code-review.json`和逐文件diff记录已审输入hash，与gate冻结输入一致。
没有通用历史框架修改或忽略来源事件的豁免。`t02-r20/logs/chat-service-owner-final.log`
为1suite/88tests自然exit0。首次完整门禁在测试夹具status类型处tsc失败，完整证据保留
`t02-r20/gate-failed-tsc/`；修正后gate自然exit0，platform/lint/production build及344 suites /8461 tests通过，1471输入前后不变。GPT核对后接收17个文件/资产，`t03-receive/r20-received.json`与`r20-deploy-current.log`记录实际部署；`t03-app/loaded-build-r20.json`确认onload SHA `2018f5d8f80e53beea00b14c6988bb018957a42041e71ec233a8d1faf0ce9b1c`。实际app验收继续。
该轮止点时r21/r22仅在worker树；之后已由r25/r27接收，并按实际影响补验，见最终验收。

S-01 当前实际草稿为 `6abba698d1d4e946a3b8c98d`，复用此目标继续，不盲目再次创建。
`t03-app/s01-code-editable.json/png` 记录原生鼠标打开代码块 Edit 后的 CodeMirror 可编辑原文；
`s01-manual-format.json/png` 记录 DOM Range 选择合成段落、原生 Control+B 改格式，正文逐字不变。
只读 Ghost API 在 `ghost-s01-after-manual-format.json` 核实该段 text/link text 的 format=1，仍为draft；
文章总数5、已发布数1均未增加（唯一已发布项是原测试样例）。这只证明编辑器格式与代码可编辑，
首次发布、完成记录、更新保留格式仍待后续。owned native leaves 及其用途记在
`t03-app/owned-native-s01-leaves.json`，不清理其他窗口或标签。

S-01 名称入口已在当前为另一篇合成笔记时调用name=Publishing，Host定位原路径并复用原post ID；
其用户回复因F-31未通过，不能标整项AC通过。歧义入口已实际列出两个同名路径、请求准确路径，
无prepare_ghost_post调用、无session，Ghost前后保持6篇/1篇published；证据
`s01-ambiguous-send/result.json`、`ghost-after-name-and-ambiguous.json`。只为此case创建的
`0.unsorted/b153/ambiguous/Publishing.md`已精确移除，原主文未动。F-28诊断新增的
`First identity probe.md`和draft `6abbac26d1d4e946a3b8c99d`归本任务，见`owned-f28-post.json`；
留至验收后精确清理，不发布该诊断草稿。

S-05关联补验：`t03-app/mobile-associated-edit.json/png`记录r14实际CLI mobile模式下，原生键盘
编辑进入editor与磁盘，pa_ghost UID/post ID/site不变，原生Undo后文件逐字恢复；该模式下
ghostPublishingIntegration不存在。`dev:mobile off`后只读确认mobile=false且集成恢复。
这补齐普通关联笔记编辑，复用前述真实发布限制提示/设置隐藏/既有action入口证据；没有iOS声明。
第二次mobile reload移除了owned editor leaf `034caf37e2867ea5`，仍保留owned主Preview
`c1893ff306a4b08c`；必要时重新准备Ghost编辑器，不能把旧leaf当现存目标。

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-30 | T-04 / F-37 来源登记风险 | 登记遗漏→两处metadata→`npm run check:third-party-notices`与声明再生成稳定性→41 runtime/13 bundled且exit0、生成字节不变→metadata/import/generator变化时重跑；另node语法与diff检查 | 本地及远端notices PASS；原目标失败exit1，修复及再生成后均exit0 | `/tmp/pa-b153-ci-notices-echn0pg8`的report、repair.diff、原始检查日志及events；GLM自然exit0，GPT逐项核对真实diff、原始命令退出与1472输入，唯一两文件八行，接收文件与worker逐字一致。`9130f77`远端CI `36662542981`的platform/notices/lint/build/Test均success；只剩Audit bundle失败，不能记整job PASS |
| 2026-09-30 | T-04 / F-38 固定体积预算 | gzip超限→一次官方入口/构建贡献比较→若等价缩减则应满足原预算，否则返回数字及Owner决策；功能/资源/门限不自行改动 | 只读调查完成，自然exit0；无生产修改 | `/tmp/pa-b153-ci-size-9roaw4ns`；同参数标准build与既有main SHA完全相同；官方browser候选增6172 gzip字节，未实施；前基线2959107、新增97609。只写本轮诊断，没有通用拆包/lazyload或解析器替换 |
| 2026-09-30 | T-04 / F-38 Owner批准的预算调整 | 明确10MiB授权→只改默认数值及说明→实际bundle默认audit PASS、显式3056715预算拒绝exit1、既有audit tooling五例/语法/diff PASS→其他审计逻辑与产物SHA不变→脚本/相关产物变化时重跑 | 本地全部通过，worker自然exit0；CI Test失败，审计被跳过 | `/tmp/pa-b153-ci-budget-7efacc3z`；Owner直接答复“提高到10MiB”，非2.95MiB建议。默认audit exit0/10485760，负例exit1，五例tooling 1 suite/5 tests PASS；首轮spawnSync EPERM经权限批准后同命令自然通过，不改测试。GPT核对唯一脚本diff、原始退出及输入，并在实际主树audit再次PASS；main/notices/deps未变。`61e39d1`对应CI `36664860246`的platform/notices/lint/build success，Test failure，Audit skipped；不能记整job PASS |
| 2026-09-30 | T-04 / F-39 两项Writing等待 | 用户CI红灯→真实render/request/turn等待及finally清理→`npm test -- --runInBand __tests__/chat-view.test.ts`→保留原正文/版本/按钮/notice/parent断言，整suite自然exit0且唯一测试路径变化→相关测试或runtime/config/deps变更时重跑 | 本地1 suite /318 tests自然exit0，GPT接受；实际完整CI PASS | `/tmp/pa-b153-ci-writing-mvbkg_zo`；原CI失败摘录、task.diff、原始focused日志/events/exit及acceptance.json均保留。同一ZAI/glm-5.3/max自然exit0且PID消失；1472输入仅测试文件变化，SHA `36e9c6f9c6facdeebee9338a9236f855ce9863cf8aa9119fddb5ca090e961583`与主接收树相同，生产源码/产物/预算/notices不变。`6facc3b99dc6ea4207ad2d135d1f2434818ddea3`固定SHA推送并由实时ls-remote确认 |
| 2026-09-30 | T-04 最终完整CI与资源终态 | 远端精确source SHA→原始run/jobs JSON→workflow及validate success、Test和Audit实际success→最终source提交与CI head_sha一致→运行时/测试/配置/依赖变化时失效 | PASS；T04/F37–39关闭 | [CI run 36667459680](https://github.com/edonyzpc/personal-assistant/actions/runs/36667459680) / `6facc3b99dc6ea4207ad2d135d1f2434818ddea3`；`remote-ci-writing-{run,jobs}.json`与`ci-acceptance.json`。本轮四次GLM进程均自然exit0且PID不存在，未改app/vault；诊断基线副本已精确清理，必要日志及含accepted dirty源码/共享依赖的worktree保留，不强制删除。文档补录不改变上述输入 |
| 2026-09-29 | T-02/r11接续 | 旧CLI及worker cwd下gate/Jest/build进程已不存在，11份契约同步、89个修改路径hash，明确F21修订任务 | 已启动，handle `36689`，待交付/验收 | `t02-r11-task.md`、`t02-r11/handoff.json`及events/stderr。同一ZAI/glm-5.3/max上下文，不重复其他已接受修复；实际app仅准备，产品代码未部署 |
| 2026-09-29 | T-02/r10补验、独立F21复核 | action-context owner；GPT实际代码与断言核对；中断gate状态核对 | 13 tests自然exit0，F19/F20/F22覆盖接受；F21未接受，r10 exit1中断 | `t02-r10/logs/action-context-final.log`；`gpt-interruption.json`、`superseded-gates.json`。错误help路径已保留至mistaken-help-gate；build完成但Jest被中断，不声明完整PASS。helper帮助安全性修正仅在任务临时目录，产品修复仍交GLM |
| 2026-09-29 | T-02/r10 接续 | r9终态及PID消失、11份契约同步、89个修改输入hash；同一CLI thread配置 | 已启动，handle `72258`，待交付/验收 | `t02-r10-task.md`、`t02-r10/handoff.json`及events/stderr；worker已确认停止反向red并只补F19/F20/F22，未重做产品调查。GPT仅管理权威文档和实际app准备，不与worker并发写源码 |
| 2026-09-29 | T-02/r9局部修复与验证缺口 | 真实修改和原始focused/type/lint；GPT检查历史权限用例 | 14 suites / 158 tests PASS；tsc首轮2个mock类型错误，修复后PASS；targeted lint PASS；完整gate未跑、未验收 | `t02-r9/logs/`；F20–23有4个有效目标红灯。F19首版仍在当前主文保留embed，未覆盖历史独有来源；worker回造旧实现红灯遇到runner/依赖失败，GPT精确SIGINT停止该路线，旧进程/工具均终态。`gpt-interruption.json`、`interrupted-inputs.json`；r10只修明确验证/身份缺口，不丢弃正确代码 |
| 2026-09-29 | T-02/r9 恢复 GLM 交付 | GPT/完整 gate 终态核实、交接 hash 复验、11 份契约同步、配置路由与 turn_context | 已启动，handle `82594`，待交付/验收 | `t02-r9-task.md`、`t02-r9/{handoff.json,events.jsonl,stderr.log}`；18:12:46 后启动，10:13:04 UTC turn_context 为 glm-5.3/max。保留本机预检，仅修 F-19–23 与必要接线，不开放真实 vault/秘密。无关 Cloudflare MCP 认证及已知配置警告不等于工作任务失败，按实际工具/退出判断 |
| 2026-09-29 | T-03 冻结完整门禁，T-02/r8 输入 | 隔离树 `make deploy`；DOM 源码扫描；`git diff --check` | PASS，make 自然 exit 0；344 suites / 8438 tests；1471 输入不变；DOM 无匹配 exit 1、diff exit 0 | `t03-gpt/r2/{result,inputs-before,inputs-after}.json` 和 `logs/`；构建身份核验后复制至隔离树 test，实际 app 未部署。F-19–23 尚未修复，后续相关修改须重评验证失效，不能将此轮 PASS 当最终验收 |
| 2026-09-29 | T-03 独立只读 gate review | 按personal-assistant-review检查实际service/client/store、context/Host/preview及历史恢复，并做second-layer/邻近维护走查 | review完成，1 P1+3 P2已接受，未自批运行时 | F-19–22；mock的previous参数与真实context漂移属具体维护问题。F17技术不变量核对无新增阻断；模型restore未单独Host语法核验不被误报为契约外P1，最终确认门仍在；主代理另列F23说明缺口。review零写、未重跑任何gate |
| 2026-09-29 | 实际 app 操作通道 | vault=test路径＋Electron窗口能力只读检查 | 可用，不是UI行为PASS | 实际路径仍`/mnt/code/personal-assistant/test`，sendInputEvent/capturePage均true。首次诊断不必要require('obsidian')失败，移除该导入后自然exit0；未改界面/设置/密钥/笔记。后续通过真实窗口输入与截图检查入口，不能直接调用service冒充UI |
| 2026-09-29 | T-03 集中完整 gate | GPT 指定执行者 `make deploy`，冻结1471个非生成仓库输入；原始输出和前后SHA256 | r1自然exit2，停在lint；r2运行中 | `t03-gpt/result.json` 证明r1 inputs未变化；仅unused settings变量，targeted lint修复通过。r2使用独立目录，不覆盖失败证据；隔离树test不是实际app，尚无部署声明。有界独立review只读进行，finding等gate结束后再改 |
| 2026-09-29 | T-02 组合接线 / AC-04、07–09 | 全局 tsc 初轮；修正4处类型后受影响 client/Host/controller/exporter source suites | focused PASS，4 suites / 72 tests，exit 0；全局类型待 build 重验 | `combined-tsc-r1.log` exit 2、`integration-focused-r1.log` exit 0。来源 getter 仅返回scope/basis，现复用 captureRunSourceSelection 的选择 ID，范围改回仍使旧许可失效；没有另加计数器。全局输入已停写，集中完整 gate 代替再单跑 tsc |
| 2026-09-29 | AC-08–10 已完成边界 | service/client 原生loopback及状态用例 | PASS，2 suites / 59 tests，exit 0 | `completed-desktop-green.log`；含F17换独立factory、较新/同刻/缺时间拒绝和F18手工发布核实；后续新增完整binding分页负例由72 tests覆盖 |
| 2026-09-29 | V-03 自动原生预览与Host卡片 | controller/card focused与targeted ESLint | PASS，1 suite / 8 tests，exit 0 | `t02-r8-controller/receipt.md`；auto-check failed/unavailable保留诊断，初始权限撤销不通过，Agent结束后fresh UI ticket存活，单条record文件替换/删除/symlink/mobile边界；尚未真实app |
| 2026-09-29 | V-01/V-03 普通双链与warning | exporter/action-context/snapshot/locales focused及targeted ESLint | PASS，4 suites / 52 tests，exit 0 | `t02-r8-links/results.json`；目标/UID唯一、同站published、来源撤销与记录变化、跨embed同raw歧义；不读取其他笔记正文/发布记录。后续仅metadata类型修正，exporter由72 tests覆盖；最终全部由集中gate重验 |
| 2026-09-29 | V-03 / AC-01 目标准入与重试 | 独立只读 review F-14–16；root 定向红绿回归、targeted ESLint | PASS，3 suites / 12 tests，313 未选中；均自然 exit 0 | `t02-r8-gpt/logs/entry-review-{red,green-r2}.log`、`host-eslint-r3.log`；第一次 green 的一项夹具失败由 prefill 不覆盖原草稿造成，清空输入后复测，不削弱断言。该行含 Host 3 tests、入口 4 tests、Chat 5 tests，不是整套 Chat 通过 |
| 2026-09-29 | V-03 domain 工具与既有 Agent 权限 | prepare tool、ChatService、policy/guard/registry/CreateImage 六 suites；targeted ESLint | PASS，156 tests，自然 exit 0 | `t02-r8-tools/RESULT.md`、`focused-final.log`、18 个输入身份；所有工具参数/输出受控、独立权限、mobile/无 binding 不暴露、finally 精确解绑。旧 chat-service test 的 8 个 lint error 与 HEAD 相同，已有独立 baseline 日志；生产及新测试 targeted lint 通过 |
| 2026-09-29 | V-03 配置 UI / mobile 桌面限定 | Ghost Settings、既有 Settings、locale 三 suites | PASS，247 tests，自然 exit 0 | `t02-r8-settings/results.json`；SecretStorage 通道/失败回滚、初始空密钥、设置销毁与过期控件零写、站点库兼容声明。随后三条显示 key 用 locale 12 tests 复核；不替代真实 Settings 操作 |
| 2026-09-29 | AC-01 技能资源与显式入口 | bundled skill、入口两 suites | PASS，22 tests，自然 exit 0 | `t02-r8-gpt/logs/entry-skill-r2.log`；修正新 skill 必须含 Use when 的既有 catalog grammar 后通过；#skill 不授予副作用权限。入口后续修订由上方 12 tests 覆盖 |
| 2026-09-29 | AC-04、07、09 末端接线缺口 | 普通双链仅解析显式目标的已完成记录；准备草稿后自动 fixed native preview | 实施中 | client owner 更新现有导出/context/snapshot，controller owner 更新卡片；精确文件 revision stamp 只作新鲜度边界，实际记录仍严格读取/校验。不建立同步协议、全库扫描或第二套 watcher。未 passed 不引导首次 Publish，失败可重试 |
| 2026-09-29 | V-02 / AC-08–10 恢复边界 | 独立只读复核两反例→service/store 定向回归 | PASS，2 suites / 24 tests，exit 0 | `t02-r8-review/probe.log` 与 `t02-r8-gpt/logs/recovery-r6.log`；首次修复复测两个夹具引用旧关闭 store 的失败已纠正为当前实例 getter，不改变产品断言。仅针对 T-02 恢复边界，不代替 T-03 最终 review |
| 2026-09-29 | V-03 原生预览适配 | preview owner suite、targeted ESLint、DOM 扫描 | PASS，11 tests；扫描空输出 exit 1 按约定通过 | `t02-r8-preview/results.json`；固定结果判定、native 生命周期、导航/关闭失效及 mobile 零调用；真实页面选择器/主题/渲染仍待 S-01，不从 fake native 推定通过 |
| 2026-09-29 | V-03 Host 来源上下文 | context owner 组合 tests、targeted ESLint | PASS，5 组 tests，均自然 exit 0 | `t02-r8-context/receipt.md`、输入 hash；真实导出/绑定/资源组合，前置 UID、自身属性回写、后发修改、历史路径与权限撤销。实际 app 事件/来源边界接线仍在实施 |
| 2026-09-29 | 新增图片上传 / 配置异步边界 | service/configuration 定向 tests | PASS，2 suites / 19 tests，exit 0 | `t02-r8-gpt/logs/service-config-r4.log`；上传前 pending、已知失败显式重试、unknown 不盲重试，以及配置秘密读取前后平台检查；后续 service 改动由 recovery-r6 覆盖 |
| 2026-09-29 | V-03 集成实施映射 | 显式入口/当前目标固定、domain tool、配置及状态卡→closest owner suites + frozen tsc + T-03 broad/app | 进行中 | root 拥有 plugin/Chat/entry/host-integration；独立 GPT owner 分别 tools、Settings/locales、controller/card，互不写同一文件。工具准入仍需独立核对真实 diff/负例，不能因 UI 存在声称完成 |
| 2026-09-29 | V-01/V-02 核心候选与发布流程 | exporter/store/snapshot/service 四 suites | PASS，47 tests，exit 0 | `t02-r8-gpt/logs/service-tests-r3.log`；覆盖真实 exporter→候选、二进制资源身份保留、字段三态、原生 Lexical 排版、历史恢复/当前人工注入、未知 POST 的 0/1/多结果、PUT 已受理核实、记录补写、四类确认失效与新候选重新确认；服务用可控 client + 实际 store 事务模拟，真实 Ghost 和 Host 接线仍待验证 |
| 2026-09-29 | V-02 最小 note binding / 资源 | 两个独立 GPT owner focused checks 及 ESLint | PASS，binding 6 tests、resources 5 tests，均 exit 0 | `t02-r8-binding/results.json`、`t02-r8-resources/receipt.md`；移动/复制身份、最新属性读写、读取中撤销、实际 bytes SHA-256、站点范围复用、mobile 零读；原文件已冻结，主代理读接口与实现；不表示实际 app 通过 |
| 2026-09-29 | 配置 / 凭据边界 | Ghost configuration + 既有 settings 两 suites | PASS，231 tests，exit 0 | `t02-r8-gpt/logs/configuration-tests.log`；3 个 Ghost 用例，228 个既有设置回归；密钥仅 SecretStorage、配置保存失败回滚、旧连接失效、mobile 无秘密访问。随后补异步后平台复核，待本轮最终 focused 检查纳入；未接入设置 UI |
| 2026-09-29 | V-01/V-02；T-02/r8 GPT 临时实施 | exporter + store 两个 focused source suites、targeted ESLint；输入 SHA-256 固定 | PASS，2 suites / 28 tests，均自然 exit 0 | `t02-r8-gpt/export-store-result.json` 及 logs；真实 exporter manifest→schema、IndexedDB 跨实例/提交失败、实际临时文件原子替换失败、损坏记录/已占用文件拒绝。首次组合测试曾有测试断言误放位置，修回后重跑，不算产品失败；未做完整 service/Host 集成 |
| 2026-09-29 | V-02 网络边界；T-02/r8 GPT 独立客户端子任务 | client/desktop transport focused suite、targeted ESLint、空白检查 | PASS，1 suite / 36 tests，均自然 exit 0；待整体验收 | `t02-r8-client/results.json` 和原始日志。实际 loopback 覆盖最终发送准入、无 Admin 重定向、外链无凭据、unknown/409 分类；未调用真实 Ghost 或 app。`tiers` 关系尚无传输支持，service 必须明确拒绝不能等价预览的状态，不能静默降为 public |
| 2026-09-29 | 规划输入 | 源码接线与现有 suite 只读核对；CLI help/version/vault path | 已核对 | 接线与测试组见 Plan；没有 GLM、真实 Ghost、部署或 mobile 行为通过声明 |
| 2026-09-29 | 全部 REQ/AC 的规划覆盖 | 独立只读方案复核及 GPT 核对 | 完成 | D-01–03 已补齐最低证据；未增加 suite、实站或设备矩阵，运行时 AC 仍未验证 |
| 2026-09-29 | 文档契约 | `npm run test:docs -- --runInBand`，当前规划树；Jest/ts-jest/TypeScript 使用 lockfile 对应版本的临时依赖 | PASS，exit 0 | 2 suites / 58 tests，7.167 s；未运行插件 build、运行时 tests 或 smoke |
| 2026-09-29 | 文档结构与格式 | `npm run docs:check`；`git diff --check`，当前规划树 | PASS，exit 0 | 251 Markdown / 2977 本地链接；4 条已有 episodic-memory 文档 advisory 与本项无关；本轮只新增规划与入口文档 |
| 2026-09-29 | GLM 本机能力 | auth / read / scratch-r2 独立 CLI 预检；Node 22.22.1、npm 10.9.4 | PASS，三个进程均自然 exit 0 | 本次运行目录 `auth-*`、`read-*`、`scratch-r2-*`；GPT 核对实际工具事件与文件，scratch 初次路径/patch 错误由 worker 修正，之后正确断言 exit 0、故意错误断言 exit 1、恢复 exit 0。首个 scratch 的 ignore-user-config 路由失败不算通过证据 |
| 2026-09-29 | 实际 app 目标 | CLI vault path / plugin / 有界 eval | 已核对 | `/mnt/code/personal-assistant/test`；PA enabled / 2.9.2；mobile=false、activeView=markdown、IndexedDB 可用；webviewer enabled 检查为 false，T-01 核验 core 开关。未改 app 状态或部署 |
| 2026-09-29 | T-01 派工 | 已验证 profile + 显式 ZAI/model/catalog，限定任务单 | 未启动 | 自动审批拒绝，理由为私有代码/文档向 ZAI 外发缺具体授权；已问 Owner，不绕过、不替换模型。前述预检仍有效 |
| 2026-09-29 | T-01 授权与执行 | Owner 明确允许限定内容向已配置 ZAI / glm-5.3 外发；复核 profile/catalog 未变后重新派工 | 运行中 | 原自动审批阻塞已解除；shell handle `71082`、CLI thread 见 Current Snapshot。不重做有效预检，不将进程启动当可行性或 AC 通过 |
| 2026-09-29 | T-01 环境校正 | Ghost 6.65.0 原包下载/解包；临时 Node 22.23.1；仅本次 Ghost `npm install --omit=dev --legacy-peer-deps` | 环境准备完成，均 exit 0 | `host-setup/pack.json` / `runtime-install.log` / `install-r2.log`；1364 Ghost 依赖。原包要求 Node ^22.23.1、CLI ^1.29.1，旧 CLI 不适用；Ghost 旧 bookshelf/knex peer 声明使普通 npm ERESOLVE。此次使用生成的 package-lock，未声称复现随包 pnpm-lock；不涉及 PA 依赖变更，仍需实际运行验证 |
| 2026-09-29 | T-01/r2 接续 | 旧 worker 有界中止、PID 消失检查；同 thread 恢复，新增获准 network_access | 运行中 | `t01-interrupted-processes.json` 与 `t01-r2-task.md`；网络能力须由 worker 实测；Obsidian 子进程不可用时由 GPT 主会话补 app，不冒称已验证 |
| 2026-09-29 | T-01 本机 store 可行性 / AC-08 的前提 | GPT 固定 IndexedDB 合成探针、close/open、`obsidian vault=test restart` 后读回 | PASS，仅技术探针 | `host-idb-probe-r4.log`、`host-before-restart.log`、`host-after-restart.log`；主进程 12803→57485，renderer 12895→57541，记录一致、confirmation=null。此前 Snap sandbox `/proc/cgroup` 失败已分离，使用获准正常桌面执行。未验证生产 schema/恢复流程，也不代表 AC-08 全通过 |
| 2026-09-29 | T-01 真实 Ghost 原生预览前提 / AC-03、07 的部分证据 | GPT 在 native webviewer 打开最小 Ghost draft Preview；固定页面诊断及 guest 截图 | PASS，仅最小段落/代码 | `host-minimal-preview-check.json`、`host-minimal-preview.png`；真实 URL 匹配、段落可见、代码 130 字符精确匹配；guest 中 require/process/app 均 undefined。当前宿主启用方式是 core wrapper 的 `enable()`，有 webview.executeJavaScript/capturePage；CLI 长异步返回不可靠，固定探针将脱敏结果写本机文件。综合格式、失败返回和生产 UI 尚未验证 |
| 2026-09-29 | T-01 综合 Ghost 原生 Preview | GPT 固定页面探针与 guest 截图 | FAIL（F-01） | `host-comprehensive-success.json/png`：URL/hash 正确，图片 160×80/120×60、代码原文、4 行表格通过；高亮/Mermaid/display math 未通过。r2 的异步 CLI 空输出不代表未执行；已停止重复调试 |
| 2026-09-29 | T-01/r3 数据范围 | 自动审批拒绝仍含整个 test vault 的旧目录授权；缩小至核验过的合成 public 目录后接续 | 接续获准，运行中 | `t01-r3-task.md`；worker 不读取个人 vault、owner/API 秘密或旧含 token 的原始证据，不执行需秘密的 API。`t01-r3-public/` 初始 6 文件检查无 JWT/key/Preview token 字面值；原始本机证据保留到验收，生产日志仍须脱敏 |
| 2026-09-29 | T-01/r3 GLM 交付 | 真实 diff、recipe/static、Lexical、完成记录、依赖检查及 r3 最终退出 | PASS，仅可行性；worker exit 0 | `t01-r3-public/t01-report.md`、对应 probe/result/log；固定 5 个 package 元数据及 8 个 CDN SRI。scratch 检查不是生产 SourceAccess 接线或完整 schema 通过，T-02 必须实现并补 owner tests |
| 2026-09-29 | T-01/r3 GPT 集中验收 | 执行冻结的 recipe v2 API 脚本，native 导航与页面固定诊断、截图；实际源码/负例复核 | T-01 通过，SDD Approved | `host-r3-execution/input-manifest.json`（脚本 SHA256 735c4bbc…6243）、API exit 0、`recipe-final-identity.json` 证明最后模块抽取的 head/foot 逐字相同；`host-comprehensive-v5-*`。成功：130 字符代码/18 tokens、两图 160×80/120×60、1 个有效 Mermaid、2 数学/1 display、无错误。失败：缺图加载失败、Mermaid error SVG + failed。诊断未读取凭据，网页无 Host globals；前期隐藏/error 视图和错误导航结果未计为 PASS |
| 2026-09-29 | T-02/r1 派工 | 更新的 SDD/Plan/Tracker 逐字同步及 SHA256 核对；同一 GLM 上下文 | 运行中，未验收 | `t02/contract-inputs.json`、`t02-task.md`、`t02/events.jsonl`/stderr/result；仅本轮无秘密输出目录，禁止 test vault/秘密读取与真实 API；允许隔离树依赖准备，停在 K-02 |
| 2026-09-29 | T-02/r1 局部检查 | 原始 events 核对 focused、类型、targeted ESLint、notices、依赖 dry-run | 命令 PASS，K-02 未通过 | focused 3 suites/27 tests、exporter 7 tests、tsc-final-3、notices 41 runtime/12 bundled、npm ci dry-run 均自然 exit 0；worker 收尾中的后续检查需等最终退出。没有 broad/build/deploy |
| 2026-09-29 | T-02/K-02 独立验收 | 先核实际 diff/断言，再核报告；GPT esbuild 打包临时合成探针 | 发现 F-02–10，退回修复 | `/tmp/pa-b153-run-aiw9x3xb/gpt-k02-probe.cjs`、`gpt-k02-probe-results.json`；诊断进程 exit 0 表示成功收集失败案例，不代表产品通过。r2 任务另纠正 uid/ID 写回时序、下载与上传凭据、transport 实证、真实恢复 schema；产品边界未变 |
| 2026-09-29 | T-02/r1 最终退出 / r2 接续 | r1 handle `14982` 自然 exit 0；最终事件与 K-02 报告核对；同 thread 限定 fix 派工 | r1 未验收；r2 运行中 | 最终 focused 3 suites/28 tests（`focused-final-3.log`）、tsc-final-5、eslint-targeted-final-3、diff-check-3 均 exit 0；report SHA256 `fd68ded9b9e5eded9d584ea6da7d6f15f9019ca9e043c3f4ebd3ccb0cfe34e2a`。修订任务 `t02-r2-task.md` 与无秘密复现/输入身份在 `t02-r2/`，handle `22479`；worker 已读取实际输入，无真实站点/vault 扩权 |
| 2026-09-29 | K-02 transport 环境前提 | GPT 在实际 Obsidian test vault 对本机 Ghost 同一 site GET 比较 renderer fetch 与 Node http，仅使用无效合成令牌 | renderer 不可用；Node 基础读取可用 | `host-k02-transport-check.js/json`：origin=app://obsidian.md、mobile=false、renderer Failed to fetch、Node HTTP 200且无重定向。没有读取响应正文/密钥、没有创建或修改文章，也不证明鉴权/写入/重定向边界。生产不能直接采用未经 app 验证的 renderer fetch；r2 报告后固定最小桌面 transport 并补实现负例 |
| 2026-09-29 | K-02 transport 技术选择 | SDD §5 固定桌面按需 Node http/https、Admin 3xx 不自动跟随，图片下载无凭据、Admin 上传带站点鉴权 | 设计已校正，运行时待实施 | 主树文档与隔离树逐字一致，`t02-r2/transport-contract-input.json`；`gpt-docs-check-transport.log` 与 diff-check exit 0。不扩大产品范围、不增加代理服务；实际鉴权/取消/未知结果/重定向由后续 V-02/V-03 证明 |
| 2026-09-29 | T-02/r2 最终交付 | handle `22479` 自然 exit 0，原始检查事件、代码、断言、报告核对 | 局部 checks PASS；K-02 未通过 | focused 3 suites/37 tests、tsc-fourth、eslint-third、notices 41 runtime/12 bundled、release-script tooling 18 tests、diff-check 均 exit 0；report SHA256 `461ca10dead31f05af239aa914cd9b252a83afe43735e340561bab5eb925533b`。notices 改为识别本地 LICENSE-MIT.txt，未放松必需文本规则 |
| 2026-09-29 | T-02/r2 GPT 冻结复核 | 17 个相关文件在 probe 前后 SHA256 相同，真实闭包 guard 的独立内容/语义反例 | 保留 F-02/06/08/10；F-03/04/05/07/09 未关闭 | `t02-r2/gpt-final-inputs.json`、`gpt-final-recheck-results.json`、`gpt-final-probe.log`；孤立 end 另由 `t02-r3/orphan-region-result.json` 记录。旧 boolean guard probe 的 TypeError 不用于评价运行时；诊断 exit 0 不代表所有case通过 |
| 2026-09-29 | T-02/r3 接续 | 同一 CLI thread，正式限定修订任务与合成反例 | 运行中，handle `54322` | `t02-r3-task.md`、`t02-r3/events.jsonl`/stderr/result。复用未变依赖/notices/SourceAccess 证据，只修实际剩余内容问题；仍停 K-02，无真实 API/app/Git 操作 |
| 2026-09-29 | T-02/r3 最终退出 | handle `54322` 自然 exit 0；先核实际代码、断言与原始检查，再核报告 | 局部 checks PASS，K-02 未通过 | focused 2 suites/27 tests、tsc-second、eslint-initial、diff-check 均 exit 0；report SHA256 `48c0776ad469f9df345caabadfeed1c68f47932cd3bf0ed53120d880b66a63a5`。初次 orphan 测试正则未实际删除 begin，属于 fixture 红灯，不能算产品目标失败；后续正确 fixture 与 GPT 孤立 end probe 通过 |
| 2026-09-29 | T-02/r3 GPT 独立复核 | probe 前后 17 文件及 worker 终态相同；按实际代码风险补共用路径反例 | 接受 F-05；F-03/04/07/09 未关闭 | `gpt-r3-acceptance/{inputs,terminal-identity,results}.json`、probe.cjs/log；转义混合漏展开、代码 # 截断、脚注嵌入图 owner 错误、link 内纯加粗误冲突、损坏 hash 未拒绝。诊断自然 exit 0 仅表示收集完成，未扩大产品范围或实站矩阵 |
| 2026-09-29 | T-02/r4 接续 | 同一 writer 正式限定修订任务；要求共用解析修正并复用已过检查 | 运行中，handle `72786` | `t02-r4-task.md` 与 `t02-r4/events.jsonl`/stderr/result；已复制 4 份无秘密合成证据。旧 worker 已结束，无并发写入；仍无真实 API/app/Git 操作 |
| 2026-09-29 | T-02/r4 最终退出 | handle `72786` 自然 exit 0；核实际代码、断言与原始命令退出 | owner checks PASS，K-02 未通过 | exporter 20 tests、tsc-initial、eslint-initial、diff-check 均 exit 0；report SHA256 `6a82e62a86257a7c0248c1592da350c050f5e28d83ca3b98ef4954af9126aa02`。已派发五个反例输出正确；未 full/build/deploy/app |
| 2026-09-29 | T-02/r4 GPT 独立复核 | probe 前后及 worker 终态 18 文件一致，含新增 source-position helper | 接受 F-04/07/09；F-03 仍未关闭 | `gpt-r4-acceptance/{inputs,terminal-identity,results}.json`、probe.cjs/log。确认两处普通格式回归；当前手写转义/entity 反推未落实 r4 已指定的原始 token 范围，r5 明确停止该路线。r4 worker 曾覆写 r3 的可重建 module cache，原始结果/输入清单仍完整，旧 cache 不作证据 |
| 2026-09-29 | T-02/r5 接续 | 同一 writer，限定两处剩余回归及共用位置机制校正 | 运行中，handle `28276` | `t02-r5-task.md` 与 `t02-r5/events.jsonl`/stderr/result；旧进程已终止。GPT 已将 probe 的所有输出路径改到本轮 owned 目录并核对；不再依赖 worker 临时替换路径 |
| 2026-09-29 | T-02/r5 最终退出 | handle `28276` 自然 exit 0；真实代码/关键断言、原始命令退出及报告核对 | owner checks PASS，K-02 未通过 | exporter-final 20 tests、tsc-second、eslint-initial、diff-check 均 exit 0；report SHA256 `5209dd1bcd31cfd3f2834e7a548d65a44914a4d4c8b6dda535f5ea6ab5b92684`。原始两例先有目标红灯；修复过程中 image 转移漏输出导致的7项旧回归已修，未弱化断言 |
| 2026-09-29 | T-02/r5 GPT 独立复核 | probe 前后及 worker 终态 19 文件相同；直接核对新 parser/位置机制 | 接受 raw token 方向与既有两例修复；F-03/04 未关闭 | `gpt-r5-acceptance/{inputs,terminal-identity,results}.json`、probe.cjs/log；多行blockquote正文被损坏、shortcut reference图错误来源。只补实际新机制未覆盖的普通输入，无新产品语法范围或实站矩阵 |
| 2026-09-29 | T-02/r6 技术校正与派工 | 本地15.0.2 exports/types确认无独立image导出，Ruler有internal __rules__ name/fn及at；仅领域helper允许所需原规则薄包装 | 运行中，handle `97157` | `t02-r6-task.md` 与 `t02-r6/events.jsonl`/stderr/result；固定版本、规则存在检测，禁止函数.name识别/复制完整parser/新增依赖。原始范围与容器映射共用，生产兼容仍留T-03 build/app；旧进程已结束，所有probe输出已指向本轮owned目录 |
| 2026-09-29 | T-02/r6 中途独立诊断与路线纠正 | 实际代码仍用lineContentStart前缀正则；GPT定向probe前后输入稳定，表格/多行list明确失败 | GPT中断r6，非成功交付 | 仅向输出路径精确匹配的worker PID126027发送SIGINT；handle97157终态exit1，最后file_change已完成。`gpt-r6-interim/`保存诊断；没有因观察超时重启，没有删除/回滚正确代码 |
| 2026-09-29 | T-02/r6 停止后核对 | 19文件冻结，独立probe前后相同，确认实际残留输入 | 保留正确native image wrapper；F-03未关闭 | `gpt-r6-acceptance/{inputs,results}.json`、probe.cjs/log。blockquote/ref-image已正确，table与同item多行list仍报错；无r6最终owner/type/full gate通过声明 |
| 2026-09-29 | T-02/r7 接续 | 已确认旧worker终态，修订任务明确StateBlock数据、禁止手写前缀识别 | 运行中，handle `56586` | `t02-r7-task.md`、`t02-r7/events.jsonl`/stderr/result；三份合成证据与所有输出已定位本轮目录。仅修当前位置机制与现有测试，无新增依赖/suite/实站矩阵 |
| 2026-09-29 | T-02/r7 检查与退出 | 原始events核对最终exporter、tsc-second、eslint-initial、git-diff-check | 检查均exit 0；worker额度错误exit 1 | exporter-final 1 suite/20 tests；`t02-r7/logs/`与worker-final-inputs.json。ZAI最终turn.failed为5小时额度耗尽，非测试失败、GPT中断或成功交付；result/k02-report未生成，不在重置前重复启动 |
| 2026-09-29 | T-02/r7 GPT验收 | 19文件probe前后冻结，worker记录的8个最终输入全部相同；原31例加3个实际代码遗漏反例 | F-04关闭；F-03残留、F-11待修，K-02未通过 | `gpt-r7-acceptance/{inputs,terminal-identity,results,table-token-results}.json`及两份probe/log；原31例无异常，表格/多行list/嵌套task恢复。新反例准确确认两处内容丢失和重复图误拒绝；不是扩展主题/设备矩阵 |
| 2026-09-29 | T-02/r8 调度与验证映射 | Owner授权GPT接手至GLM额度恢复；F-03/F-11→共享token/cell定位→exporter owner、tsc、targeted ESLint、diff→嵌入正文/图片与owner保持，缺失仍拒绝 | 执行中 | `t02-r8-gpt/`；只在上述输入改变或具体失败时重跑，不重复依赖/notices/SourceAccess未变证据。GLM已退出，无双writer；恢复交接必须包括GPT实际改动 |

后续每条证据记：任务/修订、命令与 cwd、自然退出、suite 数或实际交互、相关源码/测试/
fixture/config/依赖身份、原始日志位置；适用时记录构建/部署和站点。可以复用同一条
证据覆盖多个 AC，不为每行重跑。GPT 验收卡沿用仓库 GLM 任务模板。

## Closeout Readiness

- [x] 所有 REQ/AC 与实际行为一致，required gate 和 GPT review 完成。
- [x] 已证实P0/P1/P2 finding已修复；F28未复现观察保留且无猜测性豁免，未验证项未冒充通过。
- [x] 原始证据和交付物已安全接收，临时服务与app状态已处置，保留项及理由见上。
- [ ] 获得 closeout 授权后吸收稳定结果，过程文件默认 delete-after-absorption；仅保留仍被引用的独有证据。
