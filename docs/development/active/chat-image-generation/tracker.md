# Chat Image Generation Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-09-19
Work item: B-133
Authority: B-133 唯一执行状态、授权终点、工程 finding、验证证据与后续交付记录。
Product spec: [Product Spec](../../../product/specs/pa-chat-image-generation-product-spec.md)
SDD: [Software Design Document](./sdd.md)

## Current Snapshot

- Current phase: 功能开发及 Desktop / CLI mobile simulator 验收完成；Owner 2026-09-19
  要求先提交并推送远程开发分支，待其反馈移动手动验收通过后再收尾。
  Owner 已授权当前 Codex 在 GLM 额度不足后接手实现；连接、异步
  provider、持久任务、Agent 工具、Chat UI 和 Featured Image 共享接入均已实现。
  `Validated` 仅指本次最低充分证据门通过，不表示已发布或移动真机通过。
- Next action: 交付 `codex/chat-image-generation-b133`，按下方 Mobile Manual Acceptance
  等待 Owner 反馈 F-06/R-12 对应设备结果；确认通过后按本次条件授权进行 B-133
  closeout。有失败则先定位和修复，不提前归档；不追加付费矩阵。
- Blocker / decision needed: 无剩余实施产品决定。R-07 每次选择目标笔记、R-14
  先说明透明像素并等待确认制作白底副本、R-16 删聊天只留图片文件均已落实。
  三次单次 Wan 授权及最新一批最多 2 次 Wan / 8 次文本授权均已用完：合计
  5 次 Wan 成功（4 个 Chat 任务、1 次 Featured Image）；本批恰好 8 次文本请求。
  所有输入为获授权合成素材，无用户笔记/历史聊天/用户图片外发。新付费调用需新授权。
- Last verified behavior: R-17 独立 SecretStorage 槽修复后，真实独立连接参考图与
  Featured Image 生成/插入成功；R-18 新会话身份修复后，Desktop 本地回放单次
  生图完成且普通回复与图片卡并存。最终 lint、production build、全量 290 suites /
  7755 tests 自然 exit 0，源码社区扫描无命中。当前部署 `main.js` SHA-256 为
  `23bcd4e371e0f8354b731ef5b78558242dc681bed0f7042bfe312429a5df37ac`。
  透明确认、连续编辑、跨会话、重载、复制/下载及笔记保存复用对应有效证据；
  14 项 AC 的组合证据与边界见下方 Acceptance Audit，不把平台缺口记为 PASS。
- Delivery tree / stop point: 基线 `96699da81ccb126b3cba267b6197bf0ffa36c941`，开发分支
  `codex/chat-image-generation-b133`；Owner 已授权本次代码/测试及文档提交和远端
  分支推送，按功能与文档分开提交。此阶段停在等待移动反馈；不合并 master、
  建 PR、发布或提前 closeout。部署构建复用此前已通过且未修改的 runtime 输入。
- App deployment target: 已部署 repo-local `test/`；iCloud/真实设备目标未触及。
- Delivery constraints: Owner 最新要求已写入 [SDD §14](./sdd.md#14-lean-delivery-constraints)：
  不过度设计、不过度测试，默认 Obsidian Desktop + CLI mobile simulator；仅具体移动
  强相关依赖/已知风险触发最小真机补测。[讨论追溯表](./sdd.md#13-discussion-detail-traceability)
  连接十项决定、细节、负例与 REQ/AC，后续验收复用组合证据。
- Temporary resources: GLM 预检日志留在 `/tmp/pa-b133-glm-preflight.Rm6EA0/`；
  Desktop/模拟截图、回放 JSON 和检查日志保留在 `/tmp/pa-b133-*` 供验收追溯；
  本轮 reload/native-reply 隔离任务及会话已删除，临时 provider/SSE/文件选择器
  替身已恢复并随插件重载销毁，独立图片密钥空槽及原 inherit-chat/Featured 默认已恢复。
  R-16 隔离会话已删除，合成本地测试图
  `test/pa-images/img_e4eb5b4f74bd4b55bf63570756aea0fd.png` 按“只留图片文件”
  暂留作验收证据；真实连续编辑新原图为
  `test/pa-images/img_cb811579905f445eb9a7fccdb17eb3dd.png`。最新合成蝴蝶原图及
  Featured 验收笔记/纸鹤原图保留供复核，详见日志。test vault 已部署新构建，
  mobile/debug 模式已关闭。未创建 worktree 或外部服务。

## Work

以下是依赖明确的交付拆分；Owner 已授权本轮实施。T-01/T-02 为必要接口与平台方案检查点，
优先复用已验证事实，不要求每项独立 spike。
其余在同一连续交付上下文中按依赖推进，不人为每个动作新建 worker。

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-00 | 全量设计追溯 | 决策、规格、SDD、索引与文档检查 | [x] Done | Validation Log；仅文档完成 |
| T-01 | B-133/REQ-02 / B-133/AC-02；B-133/REQ-05 / B-133/AC-05 | Wan 接口能力与统一连接、配置迁移设计 | [x] Validated | 北京 DashScope 真实文字/参考/编辑均成功；外部主动添加合成图经自然语言规划、独立密钥与连接生成蝴蝶；vault picker/粘贴及精确引用聚焦通过。R-17 SecretStorage 写读、独立模式切换 Chat provider 与配置迁移通过；其他区域/账号未实测 |
| T-02 | B-133/REQ-04 / B-133/AC-04；B-133/REQ-14 / B-133/AC-14 | 编辑保真副本、复制与设备下载；优先 Desktop/CLI mobile simulator | [~] Desktop validated, mobile bridge open | Desktop 真实图片可放大、复制后粘回 Chat、原文件下载 hash 一致；R-14 透明输入先停再确认，Desktop 点击与白底副本实际像素通过，simulator 按钮可达；F-06 真机桥接待验 |
| T-03 | B-133/REQ-03 / B-133/AC-03；B-133/REQ-10 / B-133/AC-10；B-133/REQ-11 / B-133/AC-11 | 任务/版本持久化、迁移、幂等与恢复 | [x] Validated | 存储/服务聚焦覆盖确切父版本、幂等、失效链接/本地补链与迁移；真实旧版本编辑 parent 正确。2026-09-19 Desktop 实际 plugin reload 覆盖 prepared、submitting 无 ID、saving、stopped 及 running 既有真实 ID 查询恢复；原件/版本恢复且无新生成。复用组合证据，不要求进程崩溃矩阵 |
| T-04 | B-133/REQ-01 / B-133/AC-01；B-133/REQ-08 / B-133/AC-08 | 内置工具、输入意图、卡片、并行文字轮与会话切换 | [x] Validated | 显式入口与自然语言规划、真实 Chat Edit / 参考图 Wan 链路、负例不生成；在途 Desktop New Chat/History 的草稿/焦点/卡片归属通过。R-18 两入口回归及修复后原生 SSE 本地回放证明正文与卡片并存 |
| T-05 | B-133/REQ-07 / B-133/AC-07；B-133/REQ-09 / B-133/AC-09；B-133/REQ-13 / B-133/AC-13 | 预算、取消、来源再验证与错误恢复 | [x] Validated | 子请求预算/去重/部分成功、受理未知、来源失效、停止/下载/导入竞态聚焦及最终 full gate 通过；Desktop 暂停后 Stop 无提交，真实 provider 状态/原件相符。未实测远端 PENDING 取消，不声称远端成功或免费 |
| T-06 | B-133/REQ-06 / B-133/AC-06；B-133/REQ-12 / B-133/AC-12 | Featured Image 共享接入回归、原件与笔记保存生命周期 | [x] Validated | 设置/迁移回归，Desktop 选笔记/迁移/去重/清缓存/删聊天只留文件均通过；2026-09-19 合成笔记真实 Featured 生成与 callout 插入通过，原默认已恢复 |
| T-07 | 全部 REQ/AC | 冻结输入、必要集成检查、最小授权 provider 案例、Desktop/CLI mobile simulator 与独立审阅 | [x] Validated within recorded platform boundary | 最终 290 suites / 7755 tests、lint/build、当前部署、Desktop/模拟器与独立审阅通过；AC-14 允许明确保留的 F-06/R-12 移动证据未冒充通过；未执行 Git/发布或 closeout |

## Acceptance Audit

2026-09-19 按 Product Spec 原 AC 与 SDD §10/14 核对；下表使用组合证据，未降低
产品要求，也不把所有输入×入口×连接的付费排列作为新增门禁。自动化结果均被最终
当前源码 full gate 覆盖；实际交互、真实 provider 和平台限制分别记录。

| AC | 结论与最低充分证据 | 明确边界 |
| --- | --- | --- |
| B-133/AC-01 | 通过：显式入口/真实 Chat 编辑、自然语言实际 create_image 规划与生成；文字负例无图片任务、歧义先询问；R-18 回放补齐普通正文与卡片共存 | 真实负例的正文受隔离脚本影响，详情见日志；不把本地 SSE 当作真实模型回复质量 |
| B-133/AC-02 | 通过：真实纯文字、主动外部文件参考、既有 vault 图片编辑；picker/粘贴注册与发送精确 ref 回归 | 不重复每种添加方式到 Wan 的付费组合 |
| B-133/AC-03 | 通过：本地新版本/确切 parent 回归、真实从较早生成版本编辑；R-14 未确认无 POST、确认全尺寸白底 PNG、旧原图 hash 不变 | 编辑语义与输入身份通过，不承诺像素级完全保留 |
| B-133/AC-04 | Desktop 通过：逐图操作绑定、放大、复制后粘回为图片、下载原文件 hash 相同；模拟器按钮可达 | 移动分享/剪贴板未验，保留 F-06 |
| B-133/AC-05 | 通过：继承与独立连接真实调用；独立 SecretStorage 合法且隔离；切换聊天服务商与不兼容提示有应用/聚焦证据 | 只对已测北京 DashScope 账号主张真实可用 |
| B-133/AC-06 | 通过：旧配置/密钥/模型/数量/路径回归，合成笔记真实 Featured 单图生成和插入；Chat 与 Featured 使用同一独立连接 | 不扩大 Featured 为重启自动插入 |
| B-133/AC-07 | 通过：默认/明确数量、分别描述子请求、同 operation 去重、禁止隐式重试、部分成功回归及真实单图链路 | 多子请求未新增付费验收；最低矩阵以预算/故障注入为证据 |
| B-133/AC-08 | 通过：后台下一文字轮回归；实际在途切换 New Chat/History 后原卡更新、新草稿/焦点不变；R-18 身份守卫 | Desktop 使用本地在途 provider，真实生成能力另有证据 |
| B-133/AC-09 | 通过：真实受理/完成/本地保存一致；Stop 与下载/导入竞态、暂停未提交 Stop、PENDING-only 取消契约 | 未做真实远端取消实验，不声称点击停止保证免费 |
| B-133/AC-10 | 通过：prepared/submitting 无 ID/saving/stopped 实际 reload；running 既有真实 ID 查询恢复；过期/改连接/本地补链回归 | running 快照的远端已完成；不宣称 OS 崩溃或移动挂起已测 |
| B-133/AC-11 | 通过：历史重开读本地原件、临时 URL 过期补链、来源/model/prompt/parent 版本持久化 | 不承诺跨设备聊天同步 |
| B-133/AC-12 | 通过：每次选笔记、附件迁移/去重、失败重试回归；Desktop 清缓存/删除聊天后元数据消失、文件和正式笔记保留 | 合成原件/笔记为验收证据保留 |
| B-133/AC-13 | 通过：首次说明、精确引用和撤回 guard、物理 submit 前校验及日志边界；真实授权调用隔离素材且不追加生成 | 真实用户素材/其他费用不从此次授权推导 |
| B-133/AC-14 | 通用验收通过且必要移动证据明确保留：Desktop、CLI mobile simulator、Featured 回归完成 | F-06 分享/剪贴板、R-12 移动 fetch 待可用设备；仅补受影响动作，不扩大整套平台矩阵 |

独立只读验收复核未发现阻止上述结论的剩余实现缺陷。真实多子请求、其他区域/
账号、真实远端取消和旧插件 UI 回退均属于已声明的证据边界；不据此增加无风险依据的扩测。

## Validation Planning And Reuse

[SDD Test Matrix](./sdd.md#10-requirement-and-test-matrix) 为每个 REQ/AC 映射最低充分
证据、通过条件及重跑触发。每个 slice 在本表/验证日志补实际命令、输入和自然退出。
共享 gate 只由一个执行者对冻结输入运行一次；补测仅针对未覆盖或失效的证据。
遵守 [精简交付约束](./sdd.md#14-lean-delivery-constraints)：不按讨论表行数堆测试，
不为未证实风险扩大矩阵，不重复已有有效检查。新增抽象须说明当前需求与现有能力缺口。

默认以 Obsidian Desktop + CLI mobile simulator 完成通用逻辑、布局和适用交互验证。
追加真机前在此记录一行 `具体移动依赖/已知风险 → 现有证据不足原因 → 最小设备案例
→ 通过条件`。没有具体触发理由不新增真机 gate；必要设备缺失只标受影响 AC 的缺口。
Desktop、simulator、real device 证据分开标注，不将模拟验证称为真机通过。

当前需追加的移动专属证据是 F-06：`navigator.share({files})` 与
`navigator.clipboard.write([ClipboardItem])` 设备桥接 → CLI mobile simulator
不提供真实系统保存/图片剪贴板流程 → 一张合成图的下载/取消/复制粘贴各一次 →
保存的原文件与 Chat 结果一致、粘贴得到图片、取消不提示成功。其他 Chat 布局/入口继续只用 Desktop+
CLI mobile simulator，除非出现新的具体平台风险。
R-12 另保留移动网络栈差异：manual-redirect `fetch` 的真实 CORS/Blob 行为 →
Desktop 200/cors 不能证明 WKWebView → 在相应移动设备下载一张已生成且 locator
仍有效的合成原图 → 正确保存原字节且跳转不被自动接受；不为补测自动重新付费生成。

| 范围 / 风险 | 本轮变化 | 最低充分命令 / 证据 | 通过条件 | 重跑 / 扩展触发 |
| --- | --- | --- | --- | --- |
| AC-10 插件重载断点 | test vault 隔离任务夹具：prepared、submitting 无 ID、saving 已有原件 hash、stopped；冻结连接身份故意不匹配，禁止任何 provider 调用 | 当前构建 plugin reload，读取持久状态/版本/原文件；复用已保存合成图，不生成新图 | 分别变为 not_submitted、submission_unknown、completed、stopped；saving 从本地 hash 补链版本，原任务/原图不变；清理隔离元数据 | 恢复/存储路径改变；不宣称 running 的真实远端查询已测 |
| AC-10 running 查询恢复 | 隔离 running 快照引用第三次已成功的真实 Wan task ID；无新生成、无新图片输入 | plugin reload 后仅查询既有 ID、读回/去重保存已有合成结果，核对 task/version/asset | 恢复到 completed，沿用相同 provider ID 和原件 hash；清理隔离元数据 | 恢复/查询/结果保存改变；远端结果已过期则记录限制，不重新生成 |
| AC-01/02/05/06 剩余真实路径（Owner 已授权） | 新 Chat 主动添加既有合成纸鹤 PNG，自然语言生成白底水彩蝴蝶，独立 Wan 连接；合成纸鹤文字笔记运行 Featured Image | 最多 2 次 Wan 生成、各 1 张；最多 8 次文本模型物理请求，含写 prompt/配图讨论/歧义负例；仅必要系统/工具提示和合成素材，隔离 Memory/用户历史/真实笔记 | 自然语言工具选择及图片可见、独立连接正确；负例不生图；Featured 原路径/插入正确；失败不追加生成 | 2026-09-19 新授权；不沿用前三次授权，不建立所有入口×连接×素材的付费组合矩阵 |
| R-17 / AC-05 真实 SecretStorage 准入 | 独立图片密钥 scope 复用既有 ID 归一化/长度限制 | 凭据兼容 7 项（含正常/超长 ID 的实际 helper）、连接/设置 237 项、lint/build、`deploy-current` 与实际 test vault 写入/读回 | ID 合法且与 Chat 槽隔离；Chat 密钥不变，真实独立凭据可用 | 仅此局部修复不重复全部恢复/图像处理用例；最后冻结实现后共享 gate 统一执行 |
| AC-01 原生回复集成 | 先修正测试脚本误删 native writing 字段导致的空正文；其后回放暴露 R-18，按下一行实施局部修复 | 当前 Desktop 构建本地 SSE 回放 create_image→普通确认回复，本地 provider 回传既有合成原件；保留真实 Chat 原生回复字段，禁止外网 | 实际请求 schema 含 create_image，单次本地任务 completed、图片卡与普通正文同时可见；清理夹具/桩 | 只补被测试隔离影响的集成证据，不再调用付费模型或重复整个矩阵 |
| R-18 / AC-01 新会话原生回复 | 会话 ID 在建立 writing host 前预留；允许同轮 null→确切预留 ID 的持久化，其他切换仍失效 | 自然语言/显式两入口的 ChatView 回归 + conversation persistence；当前构建本地 SSE/provider 回放；修复后统一最终共享 gate | 新会话生图后 writing host 仍 current、正文与图片卡并存；视图结束失效，不接受其他会话 ID | 仅本缺陷使前一轮 full gate 对最终源码失效；已成功的真实 provider 素材无需重发 |
| 文档链接、生命周期和权威追溯 | 五个新设计/契约文件及必要索引接续 | `npm run docs:check` | 无新增链接/契约错误；既有 advisory 分开报告 | 文档再改后重跑 |
| 文档规范回归 | Decision/Spec/Active Package 接续 | `npm run test:docs -- --runInBand` | 两个指定 suite 实际运行且自然退出成功 | 相关文档或 checker 输入变化 |
| 格式与越界 | runtime、settings、docs 改动 | `git diff --check`、diff/status 审阅 | 无 whitespace 错误，无密钥进入源码/记录 | 任何后续编辑 |
| runtime/source | Wan、存储、任务服务、Agent、Chat UI | 对应 focused source + Local Validation Gate | 行为断言通过，source scan 结果检查 | 相关源/测试改变 |
| 共享集成/app | Chat 与 Featured、CSS/持久化 | lint/build/test:all；合格部署与真实交互 | 当前输入身份、自然退出、实际加载 build 可核对 | shared runtime/迁移变化 |
| R-14 / AC-03 | 透明输入确认、保真副本 | input/service/store 聚焦 + Desktop 本地 stub 实际点击；CLI mobile simulator 布局 | 未确认无 POST，确认后仅一次提交且 PNG alpha 全 255，原图 hash 不变；按钮可达 | 输入处理/确认状态/卡片变化或真实 Wan 连续编辑证据补齐 |
| R-16 / AC-12 | 删聊天只留图片文件 | Memory/IDB/manager 聚焦 + Desktop 隔离合成会话可见清空、重载与文件检查 | 任务、版本、操作键、提示词引用不可读，原文件仍在；无迟到重建 | 删除/存储/恢复路径变化 |
| AC-01 / AC-08 在途会话归属 | 隔离合成任务的当前实例本地 provider 桩，不外发 | Desktop 预填 `@CreateImage` 合成文字并实际点击发送，在任务 running 时点击 New Chat、留未发送草稿，再释放本地桩完成并点击 History 返回原 Chat；CLI 核对任务/文件身份 | 仅一次 submit，旧图卡只在原会话更新，新会话无卡且草稿/焦点不变；合成任务清理后再插件重载 | 输入/订阅/会话切换路径变化；桩不能跨插件重载，重启恢复沿用既有聚焦证据 |
| AC-01 / AC-03 真实连续编辑 | Owner 新授权的单次合成图片调用；来源 `version_08e3f3c1d90f4928b06b657c487c2c5a_output_0`，文字“保持蓝色纸鹤主体，将背景改为淡黄色水彩纸” | Desktop 原生成卡点击 Edit → Chat 发送 → 透明输入暂停 → 实际点击确认；Chat 回复本地桩、Wan submit 临时一次性护栏；核对任务/父版本/输入调整/本地文件与原图哈希 | 确认前 Wan submit 0，确认后至多 1；成功时子任务 `parentVersionId` 指向原版本且引用原 output，`inputWhiteBackgroundApplied=true`，输出原件落盘、旧原图 hash 不变 | 这次授权仅一张合成图；若接口失败，不自动再试第二次；不得外发用户笔记/历史聊天/用户图片 |

真实 provider 合成素材调用与真实笔记外发的授权分别核对，不能由设计/实施授权推导。

## Findings

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| R-17 | P2 runtime | 独立图片凭据 ID 使用 `:image`，实际 Obsidian SecretStorage 拒绝，导致独立模式无法配置 | 图片 scope 在既有 `getVaultApiTokenId` 归一化/长度限制前加入；沿用原 Chat 密钥 ID，不迁移无效且无法写入的旧槽 | 凭据兼容 7/7、连接/设置 237/237、实际 SecretStorage 写入/读回；独立模式真实参考图及 Featured Image 各单张成功；最终 full Jest 290 suites / 7755 tests 自然退出 | Fixed |
| R-18 | P2 runtime | 首轮图片提交建立持久会话后，原生回复 host 仍绑定 null 会话，下一轮报 Writing context unavailable | 将预留会话身份绑定到原生回复 host，仅允许同轮持久化该 ID；既有父版本和来源失效守卫保留 | 自然语言/显式入口 focused 294/294；修复后实际 Desktop 回放 calls=2、submits=1、task completed，普通正文和图片卡同时可见；关闭视图失效回归、独立复核及最终 full gate 通过 | Fixed；无新增付费调用 |
| F-01 | 待验证风险 | 异步端点/区域/账号能力及取消条件 | 北京 DashScope 真实合成文字与合成图副本编辑均受理、查询 SUCCEEDED、OSS 结果下载与本地原件/版本落盘；取消仍仅按官方 PENDING 契约/聚焦测试 | text task `08e3f3c1d90f4928b06b657c487c2c5a`；edit task `0cc041da-8718-4d7f-8d23-239a1ed594ae`；未验证其他账号/区域或真实取消 | Closed for tested connection |
| F-02 | 待验证风险 | IDB 迁移与旧版回退 | Chat IDB v3 保留 v2 旧记录；Obsidian Desktop 独立临时库分别实测旧版打开 `VersionError`、连接阻塞后可重试、升级中断为 `AbortError` 且原记录可恢复；三库均删除；损坏/不可写见 R-13 | 存储聚焦 49/49；旧插件 UI 的实际回退仍未实测，不冒充支持降版直接使用 v3 库 | Partial, compatibility limit explicit |
| F-03 | 待验证风险 | 复制/下载与恢复是否涉及移动专用依赖或已知差异 | Desktop CDP 点击：剪贴板 `image/png`、粘回 Chat 草稿 ready；下载到 `/tmp/pa-b133-download/` 与 vault 原件 7,350,605 B、SHA-256 完全一致；移动差异独立 F-06 | Desktop 通过；移动系统桥接不从 Desktop 推断 | Closed for Desktop |
| F-04 | 待验证风险 | 后台卡片和现有 turn 配对/恢复 | stableMessageId 投影、无持久 turn 的受理任务重开、在途跨会话及草稿/焦点已通过；补充 Desktop plugin reload 后 running 快照查询既有真实 Wan ID、结果去重保存/版本恢复 | Desktop/CLI 状态与 `/tmp/pa-b133-live-card*.png`、`/tmp/pa-b133-cross-*.png`；2026-09-19 reload 日志；隔离任务已清理。不是操作系统杀进程或移动挂起证据 | Closed for Desktop lifecycle |
| F-05 | 待验证风险 | 白底 JPEG 副本不适用于全部编辑信息 | 按 R-14：透明输入先暂停说明、用户按任务确认后才制作白底全尺寸 PNG 并继续，来源当前性在发出前复核 | 原结果 2048×2048 PNG；此前单独获授权的验证副本与本次正式 Chat 编辑输入均 alpha 全 255、8,056,826 B；本次真实 Wan 连续编辑返回 SUCCEEDED、原版本 parent 正确，原文件哈希不变；simulator 按钮可达 | Closed for tested path |
| F-06 | 需设备证据 | 移动下载/复制分别依赖系统 `navigator.share({files})` 与 `ClipboardItem`，模拟器无法证明原生保存和图片剪贴板 | 在可用真实移动设备上用一张已保存合成图做下载/取消/复制粘贴；核对文件与图片内容，取消不得报成功 | 当前 Linux 环境 USB 清单无 iPhone、无 Mac iCloud test vault/iPhone Mirroring；只保留 Desktop/CLI simulator 证据，未部署 iCloud/未宣称真机通过 | Blocked by device environment |
| R-01 | P2 design | 已登记但未提交的任务重启没有出口 | 明确 durable submitting 先于 POST；prepared 恢复显示未提交并允许继续首次提交 | service 未提交恢复/继续回归及 2026-09-19 实际 reload 断点通过 | Fixed and validated |
| R-02 | P2 design | operationId 未明确绑定用户请求，重复 tool call 可能收费 | 用户请求/子请求稳定身份、事务登记与共享数量预算；变更 tool-call ID 不新增任务 | 工具/服务重复调用及子请求预算回归、最终 full gate 通过 | Fixed and validated |
| R-03 | P2 runtime | Stop 与下载/导入并发可产生无任务归属原件 | 下载后导入前复核 Stop；导入已经发生则将原件继续关联 stopped 任务 | `image-generation-service` 两个竞态用例通过 | Fixed |
| R-04 | P2 runtime | saved 原件的 version 写失败后过期/改连接无法本地恢复 | 在 provider 查询与时效门槛前补写本地 version；读取旧输出也可按需补写 | 过期且连接缺失的本地恢复用例通过 | Fixed |
| R-05 | P2 runtime | 同消息多个明确子请求共用一个 operationId | tool 按明确 subrequestIndex 去重；宿主绑定每个子请求身份并共用用户明确数量预算，不凭 tool-call ID 增费 | 工具双子请求/重复槽位用例及最终 full gate 通过；真实多子请求未测，按 AC-07 最低矩阵复用预算与单图 provider 证据 | Fixed; minimum evidence satisfied |
| R-06 | P2 UI | 真实图片缩略图溢出预览按钮并覆盖复制/下载 | 卡片预览按钮按内容增高，图片与操作行分离 | Desktop 和 CLI mobile simulator 几何无重叠、截图核对 | Fixed |
| R-07 | Product/implementation gap | AC-12 要求生成图显式保存到笔记并迁移正式附件 | Owner 选择每次点击后选择目标笔记；生成卡片复用 `promoteToNote`，笔记原文以 `vault.process` 插入嵌入链接，同一目标重试去重；正文中的链接提及不误判为已插入 | 聚焦 54/54；Desktop 卡片选择 test note 插图、重复保存、迁移后读回原图；清缓存后笔记与正式附件在；隔离合成会话曾引用该正式附件，删除后 owners 1→0 且文件、笔记不变；mobile simulator 控件可达。保留真实 Wan 任务会话供后续验收 | Fixed for save lifecycle |
| R-08 | P2 source boundary | 删除消息后的任务虽抑制卡片，先前仍会将已保存图片加入下一轮 Agent 可用引用 | 构建引用白名单时跳过 `deliverySuppressed`，显式 parent 也再次拒绝；不影响已存在文件或预算去重 | `chat-view` 聚焦 275/275、tsc、lint/build、`deploy-current`；未外发新素材 | Fixed |
| R-09 | P2 UX | 不兼容连接在 Chat 入口落到“回答未完成”，任务卡暴露内部恢复码，无法解释连接/凭据/过期状态 | 明确的连接/凭据提示和本地化恢复原因；自然语言工具也区分连接不可用/超量与未知受理 | Chat/工具聚焦 282/282，再补工具 7/7、tsc、lint/build、`deploy-current`；Desktop stub 入口显示 Settings 指引且任务数未增加 | Fixed |
| R-10 | P2 count | Chat 识别“一张猫，一张狗”为两张，service 却要求文字含“二/两张”并拒绝已明确数量 | service 同时接受逐一列明的张数，仍限制总量 4 且不擅自扩批 | service/工具聚焦 16/16、修正测试类型后 build、`deploy-current`、plugin reload 通过 | Fixed |
| R-11 | P2 crash recovery | 原图导入已完成、任务 `assetRef` 尚未写入时崩溃；远端结果过期或连接改变后无法补链 | 导入前持久化下载结果 hash；启动时以同 hash 的 Chat 资产记录定位原图，核验文件后补写任务引用与版本；不发第二次生成 | service/存储聚焦 18/18，过期且无连接案例中 Provider POST/query 均为 0；tsc/lint/build/`deploy-current`/插件重载通过，已有 completed 任务仍显示一张图 | Fixed |
| R-12 | P2 result download boundary | `requestUrl` 公共 API 无重定向控制/最终 URL，原实现无法兑现 SDD 对结果跳转的限制 | 结果下载改用 `fetch` manual redirect + 省略 credentials；状态/最终 URL/大小不符即拒绝，不回退到自动跳转读取 | [Obsidian RequestUrlParam](https://docs.obsidian.md/Reference/TypeScript%20API/RequestUrlParam)；已有合成 OSS URL 在 Desktop 只读查询下 manual fetch 为 200/cors/image/png；聚焦正常/跳转 11/11、lint/build/部署/重载通过。移动实际网络仍未验证 | Fixed for Desktop, mobile evidence open |
| R-13 | P2 store isolation | 一条损坏任务/版本记录令整批列表、无关写入或删除失败，阻断正常任务恢复 | IDB 列表跳过且保留损坏原记录；新操作仍检查原始 operationId 冲突，版本写入遇同输出损坏记录失败关闭，删除受影响会话前必须能安全停止其任务；IDB 不可打开不接受临时任务 | 存储/历史聚焦 49/49、lint/build/`deploy-current`/plugin reload 通过；其他正常记录可读写、受影响身份拒绝覆盖，原真实 completed 图仍在 | Fixed |
| R-14 | Product/implementation gap | 两次真实 Wan 结果均为视觉实底但 alpha 252–255，旧输入处理立即拒绝，使“修改这张”无法继续 | Owner 最终选择先说明透明像素问题，由用户确认制作白底副本后继续；任务预检暂停，无确认不 POST，确认后制作全尺寸 PNG 副本，原件不动；暂停时可停止且显示 Wan 未收到请求。同日较早“自动制作并告知”已被明确纠正 | 聚焦 input/service + Desktop 实际确认：确认前 stub 0 POST、重载仍待确认；确认后 1 POST，2048×2048 PNG alpha min 255，原文件 SHA-256 不变；另一次隔离暂停任务 Desktop 点击 Stop 后 `stopped_before_submit` 且无 provider ID，simulator 停止/确认按钮均可达。新增获授权真实 Chat 编辑在确认前 submit 0、确认后唯一 submit 1、Wan SUCCEEDED、父版本与原文件核对通过 | Fixed; real provider path validated |
| R-15 | P2 distinct output routing | 显式 `@CreateImage 一张猫、一张狗` 先把合并描述按 n=2 发送，可能得到两张混合主题候选，未实现 SDD 的分别描述子请求 | 显式分别描述交由 Agent 拟定各项 prompt、count=1/subrequestIndex；宿主维持总量/重复发送约束，未完成时报告受理数；同主题“生成两张”仍单次 n=2 | Chat/工具/服务聚焦 299/299 及最终 full gate 通过；实际自然语言工具规划与单图 Wan 另有证据。未追加真实 Wan 多子请求；SDD 最低矩阵不要求这一付费组合 | Fixed; minimum evidence satisfied |
| R-16 | Product/data boundary | 删除聊天时旧实现停止交付但保留 `userPrompt`、`submittedPrompt`、`inputRefs` 与版本 | Owner 选择只留图片文件；删除对应任务、版本、操作绑定及私有提示词/引用，不删 vault 原图和正式附件；撤回部分轮次仅删被撤回任务，迟到回调不得重建 | Memory/IDB/service/manager 聚焦及迟到回调测试通过；Desktop 可见清空隔离会话后任务/版本/操作键/会话为 null，图片文件仍在；重载复核一致，其他真实任务仍保留 | Fixed |

## Validation Log

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-19 | 最终 lint / 文档 / 部署身份 | `npm run lint`；`npm run docs:check`；`npm run test:docs -- --runInBand`；`git diff --check`；`make deploy-current` | 全部自然 exit 0；文档 218 Markdown / 1905 links、仅 4 条既有 episodic-memory advisory；文档契约 2 suites / 58 tests；部署构建身份一致 | `/tmp/pa-b133-r18-final-lint.log`、`/tmp/pa-b133-final-docs.log`、`/tmp/pa-b133-final-doc-tests.log`。full gate 后仅 Tracker 证据/状态更新，runtime/build 未变；已补跑受影响文档契约，不重复 runtime full gate |
| 2026-09-19 | R-18 当前源码最终共享 gate | `npm test -- --runInBand __tests__/chat-view.test.ts __tests__/conversation-persistence.test.ts`；production build；`npm run test:all -- --runInBand`；community source scan；`git diff --check` | focused 2 suites / 294 tests；最终全量 290 suites / 7755 tests，343.703s，均自然 exit 0；build exit 0，source scan 无匹配 exit 1；diff 无错误 | `/tmp/pa-b133-r18-{focused,build,final-tests}.log`；Jest 曾输出退出延迟提示，随后自行 exit 0，未使用 forceExit。初次 build 发现新增测试事件缺 messageId，补齐后重新 build/focused/full 全部通过；运行期间源码/测试/配置冻结 |
| 2026-09-19 | R-18 Desktop 原生回复集成与清理 | 当前构建 `deploy-current`/plugin reload；实际 More→New Chat→Send；本地 SSE 与 provider 仅回传已有合成原件，保留 native writing 字段；截图/任务/正文检查 | calls=2、submits=1；task `3fa05308f37c414abdf9885c1f4dc7e0` completed；普通确认正文与 Image ready 卡片并存，schema 包含 create_image；无外部请求 | `/tmp/pa-b133-native-after-fix.{json,png}`；对照旧代码回放 calls=1 后 Writing context unavailable。隔离会话 `ece56cdf-2669-421f-bcbc-9b44a10e379a` 及任务/版本已删除，原 4 个真实 Chat 任务仍 completed；替身/临时设置恢复后 reload，dev:errors 无错误、mobile off、debug 未连接 |
| 2026-09-19 | 最终只读验收与范围收敛 | 独立 agent 复核 R-17/R-18 实际源码及新增回归，再对 Product Spec 14 AC / SDD 最低矩阵 / Tracker 组合证据核对 | 无剩余阻止通用开发与 Desktop/模拟器验收的实质缺陷；R-18 只放行同轮 null→确切预留 ID，父版本与来源守卫未放宽 | F-06/R-12 移动证据明确保留，真实取消/多子请求/其他区域不冒充已测；不因覆盖排列扩大付费或平台矩阵。此行是只读审阅，不替代上行实际测试 |
| 2026-09-19 | AC-01/02/05 自然语言、外部文件、独立连接 | 新 Chat 实际 More→New Chat、Add images→From Files；CDP 文件选择唯一既有白底合成纸鹤 PNG；预填授权 prompt 后实际 Send。真实 deepseek-v4.1-flash 规划 create_image，临时 Wan 护栏至多一次 submit；Memory/历史/其他来源隔离 | 2 次文本请求后调用 reference/count=1；task `b285f448a48b4d6a92e68b2bb61fa3ab`、Wan `26194927-73ee-4c93-9809-768133b69218` completed，冻结连接 dedicated-wan，唯一输入 `img_130db62260bc4d539537538cc722b5c6`；输出 `pa-images/img_15036119862e4ab481779d142dc1fb7b.png` 2048×2048，SHA-256 `6cb61185…d110fec`，视觉为白底蓝色水彩蝴蝶 | `/tmp/pa-b133-natural-reference.png`、`/tmp/pa-b133-batch-evidence.json`。初始隔离脚本删除了 native writing 字段，故本行证明实际规划→Wan→图片卡，不证明原生文字回复集成；该缺口由 R-18 本地回放单独处理，不重复付费生图 |
| 2026-09-19 | AC-06 Featured Image 实际插入 | 打开仅含“蓝色纸鹤，白色背景，水彩风格”的 `B-133 Featured Synthetic Validation.md`，执行现有命令打开选项，原默认数量 2 改为此次 1，实际点击 Save and generate；独立图片连接 | 1 次文本描述请求、1 次 Wan 生成；生成 `test/b964e39e-f23c-4238-9595-2ee0a4ecbfcb_0.png`，SHA-256 `24d2f4eb…21e1d5`，原有 Featured Images callout 插入正确，合成正文仍在；截图可见原图 | `/tmp/pa-b133-featured-inserted.png`；本批结束已恢复原数量 2、模型/路径、原 inherit-chat 连接与原独立密钥空槽。该图片及合成笔记保留供复核 |
| 2026-09-19 | AC-01 文字负例与调用边界 | 真实文本模型：写 prompt、不生成的配图讨论、歧义“有张图就好了”；本批硬限制最多 8 文本 / 2 Wan；只放行已授权合成内容，其他来源工具拒绝 | 总计恰好 8 文本请求、Chat 与 Featured 各 1 次 Wan；负例未创建图片任务，最终仍只有 4 个 Chat 真实生成任务。歧义回复询问主体/风格/用途；最后配图讨论重查因模型选择被隔离的 writing-context 工具，需要下一轮，达到 8 次上限后主动停止 | 前两负例受测试脚本误删 native writing 字段影响，UI 正文为空；响应长度探针确认讨论返回 1089 字符/stop/无工具调用。修正脚本后歧义正文正常，但包含受来源隔离影响的能力不可用说明，不据此修改产品或宣称全部真实回复质量通过。原生集成用无外发回放补证，所有临时设置/桩已恢复 |
| 2026-09-19 | R-17 与共享 gate（R-18 修复前） | 凭据兼容 focused、连接/设置 focused、lint、production build、`deploy-current`、`npm run test:all -- --runInBand` | 7/7 + 237/237；lint/build exit 0；全量 290 suites / 7753 tests，自然 exit 0，344.288s | 日志 `/tmp/pa-b133-r17-{build,lint}.log`、`/tmp/pa-b133-final-tests.log`。初次新增长 ID 用例被旧 helper mock 干扰，改用实际归一化 helper 后通过；随后 R-18 修改 ChatView，故此全量结果不能作为最终源码 gate |
| 2026-09-19 | AC-10 / F-04 插件重载恢复 | Obsidian 1.14.2 当前构建，隔离会话 `b133_reload_validation_20260919` 建立 prepared/submitting/saving/stopped 断点；前四项故意使用失配连接防止外发。随后单独加入 running 快照，指向既有真实 Wan ID `7fcb2aeb-9ce9-44bb-bb30-a14616c87d47`，plugin reload 查询该任务并恢复保存 | prepared→not_submitted、submitting 无 ID→submission_unknown、stopped 不变；saving 按原件 hash 补回 asset/version→completed；running 查询既有 ID→completed，结果去重复用 `img_cb811579905f445eb9a7fccdb17eb3dd`，version 数 1；未执行新生成，三次授权计数不变 | 实际插件 reload，非整应用/操作系统崩溃；running 快照对应的远端任务已完成，不声称重启时远端仍在生成。隔离会话/5 task/version 已删；原三任务仍 completed，原图及新图 SHA-256 分别仍 `3c1b43d0…c7cd2fb59c` / `0610cb89…7ca4eb3`；`dev:errors` 无错误。临时 JS 留 `/tmp/pa-b133-reload-{setup,running,cleanup}.js` 供追溯，无运行时桩 |
| 2026-09-19 | 文档授权一致性 | SDD §12 与讨论追溯去除初稿“尚未授权实施”陈述，统一引用 Tracker 的实际授权；不改变产品范围或验证要求 | 修复文档内部矛盾；本轮无 runtime/source/test 改动 | 文档命令见本轮执行输出；复用已通过 runtime 290 suites / 7751 tests，不重复 full gate |
| 2026-09-18 | R-14/R-16 决定修订与最终共享门禁 | `npm run docs:check`；`npm test -- --runInBand` 聚焦 input/service/store/history；`make deploy`（平台 guard、lint、production build、full Jest、部署）；`git diff --check`、community source scan | 文档检查无新增问题；聚焦 66/66；最终 `make deploy` 290 suites / 7751 tests，全部自然 exit 0；diff/source scan 无问题 | 首次 full gate 因旧 IDB 测试替身缺 `getAllKeys` 失败 4 项；补齐后聚焦通过。其后修复损坏记录键清理并主动中止混合输入运行，再对最终代码完整重跑通过；未用 `--forceExit` |
| 2026-09-18 | R-14 / AC-03 透明输入按任务确认 | Obsidian 1.14.2 `test/` 当前构建；合成蓝纸鹤 2048×2048 PNG；本地 stub（不联网）；Desktop 实际窗口点击；CLI mobile simulator 截图与按钮矩形 | 未确认任务 `prepared`/重载后 `not_submitted`，stub 0 submit；确认后唯一 submit 输入 PNG 2048×2048、min alpha 255，任务 completed，原纸鹤 SHA-256 仍为 `3c1b43d0…c7cd2fb59c`；Desktop/模拟器说明和按钮可见 | `/tmp/pa-b133-r14-awaiting-confirmation-visible.png`、`/tmp/pa-b133-r14-mobile-simulator-visible.png`、`/tmp/pa-b133-r14-confirmed-local-result.png`；先前真实 Wan 编辑仅用单次授权手工白底副本，正式确认后真实 Wan 端到端仍待新授权 |
| 2026-09-18 | R-16 / AC-12 删聊天只留图片文件 | 同一隔离合成会话在 Desktop 点 More chat actions → Clear Chat → 确认；IDB/文件与重载复查；`dev:errors`/console | 会话、任务 `15332c39…565fa`、`b133_synthetic_operation`、生成版本均消失；`pa-images/img_e4eb5b4f74bd4b55bf63570756aea0fd.png` 仍存在，hash `b43fae07…fd57c8855`；其他两个真实任务不变；重载后相同，无 app 错误 | 这张由本地 stub/Canvas 生成的测试原件作为保留证据留在 test vault；不代表真实 provider 再调用。模拟器已关闭，debug 已关闭，临时 provider stub 已恢复并随重载销毁 |
| 2026-09-18 | R-14 暂停后停止的真实性 | 新增暂停态 Stop 与 `stopped_before_submit`；`npm test -- --runInBand` 聚焦 input/service/chat-view 297/297，tsc/source scan/diff check；对最终运行时代码重新执行 `make deploy` | 最终 `make deploy` lint/build/290 suites、7751 tests 自然 exit 0；Obsidian 1.14.2 Desktop 实际点击暂停任务 Stop，持久任务为 stopped、`providerTaskId` 空，卡片说明 Wan 未收到请求；CLI mobile simulator 两按钮可达且不重叠 | `/tmp/pa-b133-r14-stop-mobile-simulator.png`、`/tmp/pa-b133-r14-stopped-before-submit.png`；隔离拒绝会话已删除，mobile/debug 关闭，未新增付费调用。此前一轮全量运行因发现错误收费文案而主动中止，不计 PASS |
| 2026-09-18 | AC-01 / AC-08 在途任务跨会话 | 当前生产构建 `make deploy-current` + plugin reload；Obsidian 1.14.2 Desktop 将合成文字预填到 Chat，实际点击 Send → New Chat → History；当前插件实例本地 provider/download/Chat 回复桩，0 外网；CLI 读取任务/焦点/草稿/版本与 `dev:errors` | 任务有合成 provider ID 且 running 时切至新 Chat；释放桩后 completed、新 Chat 无原卡，未发送草稿 `draft stays here` 且焦点仍在输入框；返回原 Chat 显示已保存图片，版本对应原任务；submit 仅 1 次、结果归属正确 | `/tmp/pa-b133-cross-running-original.png`、`/tmp/pa-b133-cross-history.png`、`/tmp/pa-b133-cross-completed-original.png`；由于系统中文输入法干扰，文本由 Chat API 预填，Send/切换/返回均为真实窗口点击，不能声称物理键入已验。桩恢复、隔离会话/任务删除后才插件重载，重载无孤任务/错误，原合成 fixture 未变；不证明真实 Wan 或在途插件重启 |
| 2026-09-18 | AC-01 / AC-03 / R-14 获授权真实连续编辑 | Obsidian 1.14.2 `test/`；原生成版本 `version_08e3f3c1…output_0` 的卡片实际点击 Edit、合成文字预填后实际点击 Send/首次说明 Create image/R-14 Confirm；Chat 回复本地桩阻断文本模型/Memory 外发；Wan provider 临时单次 submit 护栏，提交前核对唯一原图引用、确切 prompt、2048×2048 PNG min alpha 255；完成后读 task/version/asset/文件哈希、可见卡片和 plugin reload | 确认前 task `prepared`、`transparent_input_needs_confirmation`、Wan submit 0；确认后唯一 submit 1，Wan task `7fcb2aeb-9ce9-44bb-bb30-a14616c87d47` SUCCEEDED；新 task `d1bab61fbe744233a0aa279686009103` completed、`approved/applied=true`，新 version 的 parent 指向原生成 version，input ref 为原图，输出 2048×2048 PNG `pa-images/img_cb811579905f445eb9a7fccdb17eb3dd.png` SHA-256 `0610cb89…7ca4eb3`；原图 SHA-256 仍 `3c1b43d0…c7cd2fb59c`，重载后卡片/版本仍在，app 无错误 | `/tmp/pa-b133-paid-edit-awaiting-r14.png`、`/tmp/pa-b133-paid-edit-completed-card.png`；新图视觉为蓝纸鹤/淡黄色水彩纸。Wan 仅收到本次合成文字及白底副本，不读取/发送用户笔记、历史聊天或用户图片；临时护栏/Chat 桩已恢复，授权次数用尽。此案例不证明自然语言 Agent 工具规划、独立图片连接或移动系统桥接 |
| 2026-09-18 | 全量设计 | 源码及既有对话证据核查 | 完成静态核查 | `96699da`；不是 B-133 实现或 live provider 验证 |
| 2026-09-18 | 文档初稿 | `npm run docs:check` | PASS，exit 0 | 最新交付约束修订前；218 Markdown / 1895 links；4 条既有 episodic-memory 索引/可达性 advisory，无新增错误 |
| 2026-09-18 | 文档初稿契约 | `npm run test:docs -- --runInBand` | PASS，exit 0 | 最新交付约束修订前；2 suites / 58 tests，自然退出 |
| 2026-09-18 | 文档格式 | `git diff --check` | PASS，exit 0 | docs-only；没有 runtime/provider/app 测试 |
| 2026-09-18 | 全量设计 | 独立只读审阅十项选择与设计一致性 | R-01/R-02 已在文档修订 | 产品选择映射准确；这不是运行时修复/验收证据 |
| 2026-09-18 | 讨论细节与交付约束 | 第二次只读覆盖核对与文档修订 | 十项已选范围无遗漏；细节补齐 | SDD §13 共 28 项追溯；补明发送才执行、无固定额外优化轮、未完成图不暗排队；§14 承接最新 Owner 约束 |
| 2026-09-18 | 最新约束修订 | `npm run docs:check`；`npm run test:docs -- --runInBand` | PASS，均自然 exit 0 | 218 Markdown / 1902 links，仍仅 4 条既有 advisory；2 suites / 58 tests；仅检查结果日志随后补记 |
| 2026-09-18 | 追溯与格式 | 一次性只读映射核对；新增文件 whitespace 扫描；`git diff --check` | PASS | 10 项选择、28 行细节、14 组 REQ/AC 均有映射；未新增机械测试文件或 runtime 改动 |
| 2026-09-18 | 实施执行者预检 | `codex exec --profile pa-glm` 合成无工具提示 | FAILED，服务端额度上限 | 使用当前机器 catalog 路径覆盖后实际请求 `glm-5.3`，额度提示 2026-09-20 12:24:23 重置；不继续同因重试。Owner 随后明确授权当前 Codex 接手实现；预检日志保留在 `/tmp/pa-b133-glm-preflight.Rm6EA0/` |
| 2026-09-18 | T-01 静态接口核查 | 阿里云 Wan2.7 及异步任务官方文档 | 部分证据 | 异步 POST 需要 `X-DashScope-Async: enable`，返回任务 ID 后可 GET 查询；取消仅限 `PENDING`。账号/区域和真实生成未验证 |
| 2026-09-18 | T-01/T-03/T-05 | `npm test -- --runInBand __tests__/wan-image-provider.test.ts __tests__/image-generation-service.test.ts` | PASS，2 suites / 10 tests，自然 exit 0 | durable claim 先于 POST、未知受理不重发、未提交恢复、结果文件/版本记录、部分结果保留；无 live provider |
| 2026-09-18 | T-03 | `npm test -- --runInBand __tests__/chat-image-generation-store.test.ts __tests__/chat-history-store.test.ts` | PASS，2 suites / 46 tests，自然 exit 0 | IDB v3 / 旧存储路径、operation 去重、版本约束、删单条消息停止对应任务 |
| 2026-09-18 | T-01/T-06 | `npm test -- --runInBand __tests__/image-generation-service.test.ts __tests__/image-generation-connection.test.ts __tests__/wan-image-provider.test.ts __tests__/featured-image-options-modal.test.ts __tests__/settings.test.ts` | PASS，5 suites / 252 tests，自然 exit 0 | 连接与 Featured 设置/选项回归；之后服务少量修订已由对应 focused suites 补跑；共享 gate 未执行 |
| 2026-09-18 | 全部本地代码 | `make deploy` | PASS，exit 0 | platform guards 409 TS 文件、lint、生产 build、`test:all` 289 suites / 7722 tests，自然退出并经 `deploy-current` 验证复制到 `test/`；首次 lint 报 2 项已修正并对最终输入完整重跑 |
| 2026-09-18 | DOM 社区规则 / 文档 | `rg` source scan；`git diff --check`；`npm run docs:check`；`npm run test:docs -- --runInBand` | PASS | scan 无匹配（exit 1）；diff 无 whitespace；docs 218 文件/1902 links，4 条既有 advisory；docs suites 2/58 |
| 2026-09-18 | T-04/T-07 Desktop | Obsidian 1.14.2 `test/`；plugin reload/open Chat；CLI `eval` 输入 `@Cre` 与候选点击；截图 `/tmp/pa-b133-{desktop,intent}.png` | 部分通过 | 候选、单次意图 DOM 与截图可见；未触发 Wan。窗口交互工具连续两次超时，不能记真实点击 UI PASS |
| 2026-09-18 | T-02/T-07 mobile simulator | `obsidian vault=test dev:mobile on`、打开 Chat、CLI 输入候选/移除标记、DOM geometry 与截图 `/tmp/pa-b133-mobile-{chat,intent}.png`，末尾 `dev:debug off` / `dev:mobile off` | 部分通过 | 输入与操作可达、无截断；模拟不证明原生剪贴板/系统文件分享；无 console/error，已恢复调试状态 |
| 2026-09-18 | R-03/R-04/R-05 | 复核后 `npm test -- --runInBand __tests__/image-generation-service.test.ts __tests__/b133-create-image-tool.test.ts`，`npx tsc -noEmit -skipLibCheck` | PASS，2 suites / 12 tests，tsc exit 0 | Stop 两个边界、本地 version 恢复、子请求去重；共享 gate 随后覆盖最终输入 |
| 2026-09-18 | 全部本地代码（扩大 allowlist 前） | `make deploy`、source community scan、`git diff --check` | PASS，全部自然 exit 0 | platform guards 409、lint、生产 build、289 suites / 7726 tests、test vault 部署；scan 无命中（exit 1）；Jest open-handle 提示后正常退出 |
| 2026-09-18 | Owner 一次合成调用 | Obsidian test vault 固定 operationId `b133_synthetic_paid_one`，仅文字“蓝色纸鹤，白色背景，水彩风格”、1 张、inputRefs=[]；任务状态和只读 provider 查询 | 受理并 SUCCEEDED；初次保存失败 | 返回 bucket 域名 `dashscope-7c2c.oss-accelerate.aliyuncs.com` 被过窄白名单拒绝，任务 partial；未新发 POST。官方 [OSS 加速域名文档](https://www.alibabacloud.com/help/en/oss/user-guide/transfer-acceleration) 证实 bucket 域名格式 |
| 2026-09-18 | 真实 Wan 结果落盘 | 扩大受限 OSS allowlist 后 `image-generation-service` 8/8、lint/build、`make deploy-current`；plugin reload 恢复同一任务 | PASS，无新生成请求 | task completed，7,350,605 B PNG 原件 `test/pa-images/img_792bf0bb098c41939c40af5c52d141cb.png`，version assetRef 匹配；合成图视觉核对蓝色纸鹤/水彩/白底 |
| 2026-09-18 | 真实结果 Chat 卡片 | 为该验证任务写入合成 history turn，Chat 重开；CLI DOM/截图 `/tmp/pa-b133-live-card.png` | 部分通过 | 卡片挂在对应 assistant 消息，有预览、复制、下载、编辑按钮；CLI/截图不能证明真实窗口点击或系统剪贴板成功；发现并修正 R-06 |
| 2026-09-18 | R-06 卡片布局 | CSS 修正后 build / `make deploy-current` / plugin reload；Desktop 几何；CLI mobile simulator 截图 `/tmp/pa-b133-live-card-mobile.png`，结束 `dev:mobile off` | PASS for layout | image bottom < actions top，两端无按钮遮挡；模拟证据不证明移动系统分享/复制 |
| 2026-09-18 | Desktop 图片操作 | Obsidian test vault 已保存真实合成图；CLI DOM 触发预览与“修改这张”；CDP 真实鼠标/键盘事件触发复制、粘回 Chat、下载；结束清除草稿并恢复下载行为 | PASS for Desktop tested operations | 预览 modal 出现；编辑 intent 显示；系统 clipboard `image/png`，粘贴草稿 ready；下载 PNG SHA-256 与 `test/pa-images/img_792bf0bb098c41939c40af5c52d141cb.png` 相同：`3c1b43d092dcdd9b27bb25447ff44b99e48cfb7641a59f5bed74f0f7cd2fb59c`。移动真机不由此覆盖 |
| 2026-09-18 | F-06 设备预检 | `obsidian-ios-real-device-smoke` 指引；`uname -s`、`lsusb` 和 iOS 控制工具可用性 | BLOCKED before deployment | 当前为 Linux，USB 只有摄像头/QEMU 设备、无 iPhone；没有 iCloud test vault/镜像/Inspector 目标。未使用模拟结果替代真机系统分享/剪贴板证据 |
| 2026-09-18 | R-08 删除来源边界 | `npm test -- --runInBand __tests__/chat-view.test.ts`；`npx tsc -noEmit -skipLibCheck`；`git diff --check` | PASS，275/275，均 exit 0 | 抑制任务不进可用引用；这是最后一次生产 build/部署之后的源码增量，需在最终输入状态补共享 gate |
| 2026-09-18 | R-08/R-09 聚焦复核 | `npm test -- --runInBand __tests__/chat-view.test.ts __tests__/b133-create-image-tool.test.ts`；`npx tsc -noEmit -skipLibCheck`；`git diff --check` | PASS，282/282，均 exit 0 | 已删除图片不再给下一轮生成；不兼容连接得到具体提示，工具不会将明确未准入混同未知收费提交。最终 build/部署仍待新输入状态 |
| 2026-09-18 | R-08/R-09 当前部署 | 增量工具 7/7、`npm run lint`、`npm run build`、`make deploy-current`、plugin reload；Desktop 以本地 submit stub 发出 `@CreateImage` 测试错误 | PASS for narrow delta | UI 显示“Set up a compatible Wan image connection in Settings first.”；测试后恢复原方法并清空草稿，原合成会话仍只有一个任务。先前全量 gate 未对增量重跑，因只改来源过滤/错误说明而复用不相关套件 |
| 2026-09-18 | R-10 明确多图识别 | `npm test -- --runInBand __tests__/image-generation-service.test.ts __tests__/b133-create-image-tool.test.ts`；`npm run build`；`make deploy-current`；plugin reload；`git diff --check` | PASS，16/16、build/deploy/reload 均 exit 0 | “一张猫，一张狗”不会在已确认总数为 2 时被 service 错拒；首次 build 发现测试 mock 参数类型错误，修正后聚焦 9/9 与生产 build 自然通过。test vault 插件加载且原合成任务仍 completed、无新错误 |
| 2026-09-18 | R-11 保存断点 | `npm test -- --runInBand __tests__/image-generation-service.test.ts __tests__/chat-image-generation-store.test.ts`；`npx tsc -noEmit -skipLibCheck`；`npm run lint`；`npm run build`；`make deploy-current`；Obsidian `plugin:reload`/`eval`/`dev:errors`；`git diff --check`；社区源码扫描 | PASS，18/18、tsc/lint/build/deploy/reload/diff exit 0；源码扫描 exit 1 无匹配；app 无错误 | 模拟文件已登记而任务未关联、旧结果已过期且连接不可用：仅本地核验原图并补写版本，Provider query/submit 均未调用。首次 tsc 发现测试 mock 参数类型，修正后自然通过；test vault 原真实 completed 任务重载后仍一张图，不将该观察误写为崩溃断点 app 重现 |
| 2026-09-18 | R-12 结果跳转边界 | Obsidian Desktop `fetch` manual 读取已有合成任务 OSS URL；`npm test -- --runInBand __tests__/image-generation-service.test.ts`；`npm run lint`；`npm run build`；`make deploy-current`；Obsidian plugin reload / task eval / `dev:errors`；`git diff --check`；社区源码扫描 | Desktop 只读请求 200/cors/image/png、`response.url` 与请求一致且 `redirected=false`；聚焦 11/11、lint/build/deploy/reload/diff exit 0；app 无错误、原任务 completed/1 输出 | 未提交新的生成 POST；跳转响应在单元测试中拒绝且不导入。首次 tsc 因测试 mock 参数类型失败，修正后 build 所含 tsc 自然通过。Desktop CORS 成功不代表移动网络栈；测试用窗口临时变量已清理 |
| 2026-09-18 | AC-08/AC-11 已完成结果归属 | Obsidian test vault 原合成会话 → 独立合成空会话 → 原会话重开；逐次 CLI DOM 查卡片、taskId 与预览 | PASS for completed result and history reopen | 原会话卡片 1 / 空会话 0 / 原会话卡片 1，taskId 一致且本地预览可用。临时空会话删除；不证明进行中跨会话、历史裁剪或外部图片 URL 失效案例 |
| 2026-09-18 | F-02 旧版回退语义 | Obsidian Desktop 独立随机名 IDB：写入 v2 记录、升级 v3、再按 v2 打开、按 v3 读取、删除探针库 | PASS for database semantics | 旧版打开 `VersionError`，v2 标记仍为 `v2-data`，仅独立探针库已删除；不证明旧插件 UI 正常显示或所有迁移故障场景 |
| 2026-09-18 | F-02 阻塞/升级中断 | Obsidian Desktop 两个独立随机名 IDB；以真实 `IndexedDbChatHistoryStore` 打开阻塞库、关闭旧连接后重试；另在 v3 升级事务中主动 abort 后重新初始化 | PASS for database/runtime semantics | 阻塞时拒绝并说明，旧连接关闭后 v3 重试打开；中断为 `AbortError`，v2 标记 `v2-data` 在重新升级后保留。两个探针库已删除，窗口临时变量已清理；不证明真实旧插件 UI 回退 |
| 2026-09-18 | R-13 损坏/不可写记录 | `npm test -- --runInBand __tests__/chat-image-generation-store.test.ts __tests__/chat-history-store.test.ts`；`npm run lint`；`npm run build`；`make deploy-current`；Obsidian plugin reload / task eval / `dev:errors`；`git diff --check`；社区源码扫描 | PASS，2 suites / 49 tests、lint/build/deploy/reload/diff 自然 exit 0；源码扫描 exit 1 无匹配；app 无错误 | 一条损坏任务/版本不遮蔽无关记录；冲突身份不复用，受影响会话删除失败关闭且损坏记录保留；IDB 打开失败不接受内存临时任务。初始测试假库事务回滚会替换 Map，修正夹具引用后自然通过；首次 tsc 因测试工厂类型失败，修正后 build 所含 tsc 自然通过。真实 completed 任务重载后仍一张图 |
| 2026-09-18 | 第二次授权与 R-14 输入预检 | 原 completed 任务/版本/操作键/会话只读核对；本地 PNG 尺寸/alpha 检查；Obsidian Canvas 仅内存白底副本 | 输入来源有效、操作键未占用 | 原图 2048×2048、alpha 252–255，按当前代码会拒绝编辑；副本 8,056,826 B、alpha 全 255，原文件未改。Owner 已单独授权这次白底副本测试，正式产品处理策略另待选择 |
| 2026-09-18 | Owner 授权的一次合成图编辑 | Obsidian test vault 将白底副本导入 `pa-images/img_130db62260bc4d539537538cc722b5c6.png`、资产 verify；固定 operationId `b133_synthetic_edit_paid_one`、`edit`、1 张、仅该副本引用与合成文字；服务登记、真实 Wan task 查询与本地结果/版本核对；原图视觉检查 | PASS for image-to-image endpoint and local save | Wan task `0cc041da-8718-4d7f-8d23-239a1ed594ae` SUCCEEDED；结果 `pa-images/img_1e5cd66fed164cb1ad30fd1dc232f348.png`，2048×2048 PNG、7,327,523 B、SHA-256 `281bce64349e0ba29ca79b6751ee5b46876ea274be1d4dc2b4a21e4593a1b800`；视觉为蓝色纸鹤/淡黄色水彩纸；输入副本 SHA-256 `8e23fbe53ec22ff7e80c5a99c5e813ac3f9b6b3cc19b05fde3369ac04b95a531`，旧原图未改。版本记录有 1 个输入引用且与输出原件 hash 一致；因副本不是旧输出 ref，parentVersionId 为空，不证明 AC-03 旧版本连续编辑；无用户笔记/聊天历史/用户图片外发。测试窗口临时变量已清理，副本留作该任务来源 |
| 2026-09-18 | R-07 生成图保存到笔记 | `npm test -- --runInBand __tests__/chat-image-assets.test.ts __tests__/chat-view.test.ts` 分别 54/54、276/276；`npm run lint`、`npm run build`、`npm run docs:check`、`git diff --check`、社区源码扫描；`make deploy-current` / plugin reload；Desktop 卡片点保存→选择 `B133 Save Test.md`→读回笔记/附件→重复选择→卡片读回原图；`dev:mobile on` 按钮与选择器几何/可达性，最后 `dev:mobile off` | PASS for this save interaction；所有命令自然 exit 0，源码扫描 exit 1 无匹配，app 无 console error | 笔记原文保留并只含一条 `![[img_792bf0bb098c41939c40af5c52d141cb.png]]`；原图正式附件路径为 vault 根部同名文件，卡片迁移后仍读得 7,350,605 B PNG；笔记写入中断/重试与笔记消失见聚焦测试。mobile simulator 证明按钮/选择器可达，不是原生设备证明；测试笔记与正式附件保留作为验收证据，窗口临时变量清理、mobile 模式恢复关闭。初次单测因 TFile fixture 缺 `extension` 失败，修正夹具后通过；未新增付费调用 |
| 2026-09-18 | AC-12 正式附件清缓存 | Desktop test vault 对已迁移的纸鹤正式附件执行 `imageAssetService.clearCache()`，随后 CLI 读笔记与附件文件状态 | PASS for clear-cache case | `B133 Save Test.md` 原文与唯一图片嵌入仍在，正式 PNG 仍为 7,350,605 B；测试窗口变量已清理。未删除保留真实 Wan 任务的合成会话，删除会话案例仍待隔离验证 |
| 2026-09-18 | AC-03 编辑父版本本地链路与 R-07 去重边界 | `npm test -- --runInBand __tests__/image-generation-service.test.ts __tests__/chat-image-assets.test.ts`（分别聚焦执行）；服务以本地 provider/input stub 从已保存版本发起编辑，资产 verify/read 使用确切 ref，核对提交参考图和新版本 parent；笔记用正文提及同一链接作去重负例；lint/build/docs check/diff check、`make deploy-current`、plugin reload / CLI task/file 状态 / `dev:errors` | PASS，服务 12/12、资产 54/54，最终 lint/build/docs/deploy/reload/diff 自然 exit 0，app 两任务卡仍在、正式附件 7,350,605 B、无错误 | 证明本地身份、版本记录与去重边界；不证明真实 Wan 从旧版本连续编辑或用户实际 UI 发送，后者仍受 R-14 透明结果策略限制。初次 build 因新测试 mock 参数类型失败，修正后测试及 build 自然通过；未新增付费调用 |
| 2026-09-18 | AC-12 删除聊天保留正式附件 | Obsidian Desktop test vault 创建隔离会话 `b133_note_delete_check`，仅引用先前已保存到笔记的合成纸鹤正式附件；经 ChatHistoryManager 删除会话，核对所有权、源类型、笔记与文件 | PASS for formal-attachment retention | 删除前 asset turn owners 1，删除后 0；会话不存在、turn 数 0；asset 仍为 `vault_reference`，vault 根部原 PNG 7,350,605 B，`B133 Save Test.md` 的嵌入仍在；`dev:errors` 无错误。隔离会话已删除，窗口探针变量清理，真实 Wan 任务会话保持不变；无外发、无付费调用 |
| 2026-09-18 | AC-10 持久 running 任务恢复 | 本地服务测试预置已 claim 且有 providerTaskId 的 running 任务，创建新 ImageGenerationService 后 `recover()`；`npm test -- --runInBand __tests__/image-generation-service.test.ts`、`npx tsc -noEmit -skipLibCheck` | PASS，13/13、tsc 自然 exit 0 | provider 仅收到 `query('wan_existing')`，submit 0 次，任务保持 running；轮询 timer 测试结束清理。只证明本地恢复调用链，不冒充已完成 app 重启或真实 provider 在途任务案例 |
| 2026-09-18 | AC-01 显式 Chat 入口本地链路 | ChatView 聚焦测试输入 `@CreateImage 蓝色纸鹤，白色背景`，图片服务与 Chat 回复均为本地 stub；`npm test -- --runInBand __tests__/chat-view.test.ts`、`npx tsc -noEmit -skipLibCheck` | PASS，277/277、tsc 自然 exit 0 | 会话先持久化，图片 submit 恰一次，operation `generate`、count 1、正确描述和空引用，之后才进入 Chat 回复；证明 UI 接线，不证明真实入口到 Wan 端到端付费请求。已有两次授权的合成 Wan 调用均由服务层发起，无新付费调用 |
| 2026-09-18 | R-15 分别描述多图路由 | Chat/工具/服务聚焦 `npm test -- --runInBand __tests__/chat-view.test.ts __tests__/b133-create-image-tool.test.ts __tests__/image-generation-service.test.ts`；lint/build/`make deploy-current`/plugin reload、Desktop task/card 状态与 `dev:errors`、源码扫描和 `git diff --check` | PASS，3 suites / 299 tests，lint/build/deploy/reload/diff 自然 exit 0；源码扫描 exit 1 无匹配；app 两张历史任务卡仍在、无错误 | “一张蓝色猫、一张红色狗”不预先合并发送；Agent 分别提交 count=1，operationId 第 2 项带稳定 `-sub2`，第三项拒绝；合并 n=2 被拒；Agent 未提交时显示 0/2 而不谎称完成。仅本地 stub，尚未用真实 Wan/Chat Agent 验证多子请求；无新付费调用 |
| 2026-09-18 | R-15 未受理时草稿恢复 | `npm test -- --runInBand __tests__/chat-view.test.ts`；`git diff --check` | PASS，279/279、diff 自然 exit 0 | 新增 0/2 失败路径的草稿断言：输入描述和生图意图恢复。测试夹具的 `value` setter 原会错误触发 `input`，与真实 textarea 不符；按既有草稿测试模拟原生程序赋值后通过。仅测试/Tracker 变化，无生产源码改动或新增付费调用 |
| 2026-09-18 | AC-08 后台任务与新文字轮 | 本地 `imageGenerationService` 桩维持 running，再以订阅事件完成旧任务；`npm test -- --runInBand __tests__/chat-view.test.ts`、`npx tsc -noEmit -skipLibCheck`、`git diff --check` | PASS，280/280、tsc/diff 自然 exit 0 | 旧图任务只 submit 一次；其未完成时新文字轮启动，完成事件更新原 assistant 内的任务卡，不进入新回复也不改新草稿。此为本地 UI 链路证据，不冒充真实 Wan 进行中/跨会话 app 操作；未新增付费调用 |
| 2026-09-18 | AC-10 受理后 Chat 失败重开 | Chat UI 桩在已持久化 running 图片任务后令文字回复失败；同一 Chat store 的 turn 数为 0，关闭并重开 view，再从持久任务表取卡；`npm test -- --runInBand __tests__/chat-view.test.ts`、`npx tsc -noEmit -skipLibCheck`、`npm run docs:check`、`npm run test:docs -- --runInBand`、`git diff --check` | PASS，Chat 281/281、文档契约 58/58，tsc/docs/diff 自然 exit 0；docs check 仅 4 个既有 advisory | 原会话有任务记录但没有持久 Chat turn；重开后卡片和原 prompt 可见。证明持久任务投影的本地链路，不证明真实进程重启/query 或 provider 在途；实现与 SDD §5 统一为 stableMessageId 关联，无冗余消息 taskRefs；未新增付费调用 |
| 2026-09-18 | AC-05 独立图片连接运行时解析 | 已打开的 Obsidian Desktop test vault 用 CLI `eval` 在内存中暂设 `dedicated-wan` 与 OpenAI Chat provider，读取 `getImageGenerationConnection()`，`finally` 恢复原三项设置 | PASS，mode=`dedicated-wan`、图片 base URL 仍为国内 DashScope、credentialSlot 与独立图片槽一致、revision 未变，原设置恢复；CLI 自然 exit 0 | 不读取 token、不写设置文件、不调用 provider；证明已部署插件的连接解析，不能替代独立密钥与 Wan 真实请求验收 |
| 2026-09-18 | AC-02 明确参考图身份 | Chat 草稿登记单张现有图片并选 `reference`，用户输入 `@CreateImage` 后本地图片服务接收精确 ref；`npm test -- --runInBand __tests__/chat-view.test.ts`、`npx tsc -noEmit -skipLibCheck`、`git diff --check` | PASS，Chat 282/282，tsc/diff 自然 exit 0 | 图片任务得到 `operation=reference`、count 1 与所选唯一 `inputRefs`，Chat 请求图像列表也只有该图片；不证明外部添加/vault picker 的真实 UI 或 Wan 图片端点，未新增付费调用 |
| 2026-09-18 | AC-02 vault 选图入口 | Obsidian Desktop test vault Chat 点击 Add images → From vault → 已有纸鹤正式附件；CLI 读取实际 composer 状态，再点击移除，检查 `dev:errors` | PASS，现有原图作为 ready 草稿、ref 的 assetId 与 hash 有效；移除后图数 0、输入空、无 console error；各 CLI 自然 exit 0 | 只验证 vault 选择与草稿来源，未点击发送、不读取用户笔记、不外发图片；前述 Desktop 剪贴板粘回草稿另覆盖主动添加来源入口，但两者都不等同真实 Wan 输入生成 |

## Mobile Manual Acceptance

Owner 2026-09-19 指定由其手动验收并反馈，确认通过后才收尾。本清单是验证步骤，
不是已执行设备证据。目标是补 F-06 系统文件分享/图片剪贴板及 R-12 移动网络下载；
共享逻辑复用 Desktop 和 source 结果，不重跑整套功能或付费组合。

### Build And Device Identity

1. 从远程 `codex/chat-image-generation-b133` 取本次交付，记录 `git rev-parse HEAD`；
   功能提交为 `458b713`，其后的本次交付提交仅含设计、验收文档。不得以插件显示版本号
   代替提交/构建身份：这次是开发分支，没有发布新的 beta 或 stable 版本。
2. iPhone/iPad 通过 Mac 的 iCloud **test** vault 安装：在无未保存改动的对应检出中执行
   `git fetch origin codex/chat-image-generation-b133`，检出本次交付提交；新检出或依赖
   尚未安装时先 `npm ci`，然后 `npm run build`、`make deploy-icloud-current`。
   此处复用相同源码/测试/依赖已通过的完整门禁，仅重建当前机器产物；该命令本身不跑测试。
   若有本地源码/依赖改动，不能沿用本次证据，应先确认差异并补相关检查。
3. 默认 iCloud 目标为 Mac 下的
   `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian/plugins/personal-assistant/`。
   路径不同须以 `ICLOUD_PLUGIN_DIR` 指定实际测试库插件目录。Android 或非 iCloud 场景
   将当前构建的 `main.js`、`manifest.json`、`styles.css` 放入实际测试库的对应插件目录。
   不复制 Linux 的聊天数据库或密钥槽，不以普通附件同步推导 Chat 历史同步。
4. 等待插件文件同步完毕，再在手机测试库禁用/启用 PA 或彻底重开 Obsidian；核对
   `@CreateImage` 候选和图片连接设置出现。记录设备、OS、Obsidian 版本及所用提交。
   需要确认构建时，核对手机收到的三个文件与本次 `dist` 的字节/哈希；Mac 与 Linux
   重建产物不要求哈希互同。测试库中只放合成素材；手机单独配置可用凭据，勿反馈密钥。

### One Image, Five Checks

本设备 Chat/任务按本地保存，另一设备生成的卡片不会随 vault 文件自动同步。
为同时覆盖手机实际接收 provider 结果，首选在手机新 Chat 创建一张合成图：
`@CreateImage 生成一张蓝色纸鹤，白色背景，水彩风格。`
首次说明应与实际图片连接一致。此操作可能使用图片和文字模型额度；只提交一次，
失败先反馈阶段和提示，不反复点“重新生成”。后续步骤复用这一张结果，不再生成。
若本手机已有当前构建创建并保存的合成结果，可复用；仅有同步来的 PNG 不能证明 R-12。

| ID / 缺口 | 手动操作 | 通过条件 / 应反馈的失败 |
| --- | --- | --- |
| M-01 / R-12、AC-01/04 | 手机实际输入标记和描述，发送一次；保持 Obsidian 前台到结果保存，点图放大再返回 | 出现一张可用图片、普通回复与结果卡共存；状态从请求/生成进入已保存；放大可查看，按钮不被键盘/图片挡住。若提示远端完成但下载/保存失败，记录原文和网络类型，不重新生成 |
| M-02 / F-06 分享导出 | 点击该图“下载”，在系统分享面板选择“存储到文件”（Android 选择对应文件保存动作），到测试目录打开导出的文件 | 得到实际图片文件而非 URL/文本；图像正确，格式/尺寸与 vault 原件一致。优先文件保存而非照片库，避免系统重编码；取导出文件和对应 `pa-images` 原图的 SHA-256 比较才算字节一致，未比对则明确标“未核对原字节” |
| M-03 / F-06 取消 | 再点“下载”，打开系统面板后取消，不保存 | 不显示保存成功/失败误报，不增加文件，不重新生图；原卡仍可操作 |
| M-04 / F-06 剪贴板 | 点“复制图片”，回 Chat 输入区长按粘贴，不发送；如无法粘贴，再在系统备忘录尝试一次用于定位 | 复制得到图片内容：Chat 出现图片草稿缩略图，而不是路径/Base64/链接文字；无未成功却提示已复制。分别反馈 Chat 与备忘录结果，最后移除未发送草稿；外部 App 成功不自动代表 Chat 粘贴通过 |
| M-05 / 本机持久结果 | 记住该聊天，彻底关闭再打开 Obsidian，在本手机历史中重开；可短暂断网后再放大查看原图，结束恢复网络 | 已保存图仍可用，不出现新的生成任务/收费动作；重开后复制/下载仍有正确目标。此项不要求在生成中强杀、反复后台切换或跨设备恢复 |

M-02 可在导出文件回到 Mac 后对选定两文件执行
`shasum -a 256 "原图路径" "导出图片路径"`，两行摘要应一致（文件名可以不同）。
找不到对应原图时先反馈导出文件名、格式/尺寸/大小和截图，不猜测通过、不重新生成。
如果系统分享或 ClipboardItem 不可用，应如实记录失败，不用“复制链接”替代；根据实际
设备结果修复或讨论产品偏差，不能静默缩减 AC。只验所用设备，不外推其他 OS。

### Feedback And Exit

按以下格式反馈即可，截图/录屏只需覆盖异常或关键结果，不收集个人内容：

```text
设备 / OS / Obsidian：
交付提交 / 安装与重载方式：
M-01 生成、保存、放大：通过 / 失败（停在哪一步、提示原文）
M-02 存储到文件：通过 / 失败；原图与导出 SHA-256：一致 / 未核对 / 不一致
M-03 取消：通过 / 失败
M-04 复制后粘贴：Chat 通过/失败；备忘录（如测）通过/失败
M-05 本机重开历史：通过 / 失败
其他异常、截图或录屏：
```

Owner 反馈后由主 agent 核对证据；有失败先修复并仅补受影响验证。达到当前设备的
上述通过条件后，执行已获条件授权的 B-133 文档收尾。其他平台未测事实仍保留，
这项条件授权不自动授权 master 集成或 release。

## Closeout Readiness

- [x] 全部 REQ/AC 已按当前最低充分矩阵核对，平台缺口分开保留，见 Acceptance Audit。
- [x] SDD §13 讨论细节/负例已有对应组合证据，设计建议没有冒充已确认选择。
- [x] 新增抽象和扩测具有当前依据；共享 gate 仅随真实变更重跑；真机案例有具体依赖理由。
- [x] F-01–F-05 与新增 P0/P1/P2 设计/实现问题已处置；F-06/R-12 的移动证据仍明确未过。
- [x] 验收临时任务/替身及设置已恢复；合成结果和原始日志保留供复核。
- [ ] 当前架构/使用指南与实际行为一致，未承诺未验证平台功能。
- [ ] 剩余事项进入 Backlog，产品与 runtime 完成边界诚实。
- [ ] 获得 closeout 授权后，稳定结果吸收入契约，过程文件默认删除。
- [ ] 仅确有独有价值的迁移/provider/平台证据按需归档；Git/release 另行授权。
