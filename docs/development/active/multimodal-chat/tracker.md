# Multimodal Chat Development Tracker

Document status: Current
Delivery status: Validated
Updated: 2026-09-06
Work item: B-129
Authority: B-129 的唯一执行状态、任务、评审处置及验证证据。
Product spec: [Multimodal Chat Product Spec](../../../product/specs/pa-multimodal-chat-product-spec.md)
Plan: [Delivery Plan](./plan.md)
SDD: [Software Design](./sdd.md)
P5 evidence: [生产原始回执与验收边界](./p5-evidence/evidence.md)

## Current Snapshot

- Current phase: 首版 P1–P5 开发与限定验证完成，Delivery status 为 Validated。I-15 缓存恢复窄修后 main 为 `327f06e05c89e7997c826a70cc6b6d97876c993cc908f4312644bd9a35521d0b`，iOS 于 `14:40:44.977Z`、Desktop 于 `14:41:10.958Z` 实际加载；最终 iOS 重载于 `14:43:44.871Z`，同会话两图仍正常显示。I-15 suite 25 tests、TS/scoped lint、独立 review、build/双部署通过，复用 aa9cb 的 238 suites / 6202 tests 完整基线，不声称新 SHA 再次全量。I-14 布局实机通过，styles 保持 `a5998eba0c6fd0f027eb1e68f2d2d132f955a0daa6c9ad94d642fd7b863c50b2`；最终 Community 源码扫描 exit 1/no matches 为通过。
- Next action: 无剩余首版开发或限定验收必做项。本轮不再新增模型请求、矩阵或辅助框架；未进行归档、提交、推送或发布。当前 test Chat/Policy 均保留用户指定的阿里云百炼 qwen3.8-max，探针 fetch/设置已恢复，独立 fixture 已卸载。
- Convergence rule: 复用与窄修无关的已过验证，不因 SHA 小范围变化重测全部路径，不安装旧版本或穷举每种入口。以下明确边界不是新增执行任务。
- Blocker / decision needed: 无。验证不承诺远程模型质量；自动 V1 是真实 Chat UI + 本地 SDK，风格 remember/pause 是生产服务调用，未冒充全部治理 UI 点击。旧兼容资料证据不足时两端均安全拒绝，未声称当前旧库已升级；最低 1.11.4 仍为官方/源码证据，未安装实测。自动提取保持关闭、consent paused。
- Last verified behavior: iOS 真实 Chat→Writing versions 显示 AI draft/关联两图→默认全选→Preview→Save exact→打开新笔记 JPEG+PNG 可见。8 项核对通过：所选正文、原图、正式附件 hash 一致，移除草稿的合成 HEIC 原件仍在。最终重载后 `14:44:20.951Z` 回执证明 PNG 320×180、HEIC 640×480 均解码可见。此前 Desktop 保存/恢复、自动 V1 与最小风格服务闭环继续有效，见 [P5 证据](./p5-evidence/evidence.md)；P0 基线 master `42859863` 与[证据范围](./p0-evidence/technical-feasibility-20260906/README.md)不变。
- Authority: 用户于 2026-09-06 明确要求“按照方案设计和sdd任务设计，完成b-129的特性开发所有任务”，授权现有首版范围 P1–P5 的实现、测试、review、修复及 Desktop/真实 iOS 测试 vault 验证；已延期 T-16 不重新扩大到首版。提交、推送、发布及功能归档仍单独处理。

## Work

Status markers: `[ ] Todo`, `[~] In progress`, `[x] Done`, `[-] Deferred/Cancelled`。
表中 owner 是实施责任边界，不表示已经启动或分配了执行 agent。
T-03～T-13 的完成指实现与服务验收；实际 UI 证据与明确范围由 T-14 汇总，不将服务回执冒充全部 UI 点击。

| ID | Requirement / AC | Slice / owner / dependency | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-00 | 全部 REQ/AC 的规划映射 | SDD、Plan、Tracker 与文档路由；设计负责人 | [x] | 15 组 REQ/AC 在 Tracker/SDD 完整对应；文档检查见下；不包含运行时实现 |
| T-01 | B-129/REQ-04 / B-129/AC-04；B-129/REQ-15 / B-129/AC-15 | P0：B-128 基线、G-01 原件/静态格式、HEIC 转换及动画/外部 SVG 恢复；集成/图片负责人 | [x] | 两端 Files 原 HEIC hash 一致；Desktop Finder 粘贴一致，Photos 转码按既有 unverified_import 恢复；两端各 22 个有效格式案例及独立像素/元数据检查通过。iOS 粘贴具体路径未证实，生产入口/转换生命周期由 T-04/14 验收；见最终证据索引 |
| T-02 | B-129/REQ-05 / B-129/AC-05；B-129/REQ-15 / B-129/AC-15 | P0：G-03 资源参数校准；图片负责人；依赖格式处理路径 | [x] | 两端资源/质量阶梯、真实 IDB 满额/LRU/重开、取消/超时/注入配额失败及最终配置的单张和 8 张 48 MP 串行转换通过；两段真实 iOS 内存 timeline 已记录。实施策略引用 SDD 本地处理，不把页内存采样冒称设备精确峰值或生产集成验收 |
| T-03 | B-129/REQ-04 / B-129/AC-04；B-129/REQ-06 / B-129/AC-06 | P0 G-02 → P1：稳定锚点、目录设置、三类同步；图片/保存负责人 | [x] | P0 G-02 与生产回归、Desktop 四种附件规则及 iOS 相对附件目录 1/1 通过。三类同步说明与实际排除分别核对；目录解析或关闭提示不表示已完成同步排除 |
| T-P0-04 | B-129/REQ-03 / B-129/AC-03；B-129/REQ-09 / B-129/AC-09 | P0 G-04a：最小消息/SDK、最终答复 versioned JSON envelope 原型与 master 接点；runtime；仅依赖基线核对及合成图/答复 | [x] | 真实 bindTools 后 observer + 离线 wire/stream/invoke，19 个原型检查通过；共同接点和 completion metadata 已定位；不代表 P2/P3 集成验收 |
| T-P0-05 | B-129/REQ-12 / B-129/AC-12；B-129/REQ-13 / B-129/AC-13 | P0 G-05a：合成版本/revision、schema/旧 writer、静态治理资格与动态场景原型；Memory；不依赖 P3 | [x] | 43 个检查通过，含确切正文、静态/动态资格、双准入接点及累计共享预算边界；两端真实临时 IDB v1→v2 保留文本、旧连接收到 versionchange 并关闭、旧 writer 得到 VersionError。生产迁移与 P4 完整治理由 T-05/T-12 及 I-09 单独承接 |
| T-04 | B-129/REQ-01 / B-129/AC-01；B-129/REQ-04 / B-129/AC-04；B-129/REQ-07 / B-129/AC-07 | P1：asset/store/processor/composer、pending import 先登记后写、统一草稿占用谓词；图片负责人+单一 UI 整合者；依赖 T-01–03 | [x] | 两端 PNG/HEIC 原图 hash、preview/provider 生产服务通过；Desktop 实际导入/移除及旧图/双图材料保留，iOS Files 实际选中 HEIC 并显示 preview。Photos 交付边界复用 P0 与恢复测试；I-14 布局及其他实际 UI 余项归 T-14，不穷举入口 |
| T-05 | B-129/REQ-05 / B-129/AC-05 | P1：引用、导入中断恢复、迁移、prune、LRU/lease、取消与手动清理；history/图片负责人；依赖 T-04 | [x] | Desktop 故障注入后真实重载恢复、缓存清理重建及删除合成聊天后原件/正式文件保留通过；两端服务核对原件缺失不复活缓存。LRU/lease/迁移复用现有源码与 P0 证据；已知引用始终仅限 PA 范围 |
| T-06 | B-129/REQ-01 / B-129/AC-01；B-129/REQ-02 / B-129/AC-02 | P2：模型能力、异步导入与 next-draft 恢复；runtime/UI；依赖 T-04 | [x] | P2/Chat 回归覆盖能力分类、纯图/Pagelet 草稿保护、错误与迟到恢复；Desktop 实际纯图发送及真实 SDK 离线 400 后相同文字/图片保留已观察。复用这些证据，不要求模型/入口逐设备重复；可见提示等 UI 余项归 T-14 |
| T-07 | B-129/REQ-03 / B-129/AC-03；B-129/REQ-07 / B-129/AC-07；B-129/REQ-14 / B-129/AC-14 | P2 G-04b：历史重看、B-128 request/fallback/预算/边界；runtime；依赖 T-P0-04、T-05/06；图片聊天启用前 T-11 通过 | [x] | 真实 AIUtils→SDK→bindTools 回归覆盖工具续轮/压缩/重试/最终来源准入，I-07 失效 retry 已补；Desktop 旧图与双图引用/重载、iOS 生产图片服务通过。共享排除与来源边界复用源码回归，不把 wire 入口冒充 provider 理解，也不另开移动工具矩阵 |
| T-08 | B-129/REQ-08 / B-129/AC-08；B-129/REQ-09 / B-129/AC-09；B-129/REQ-10 / B-129/AC-10 | P3：最终答复 envelope、provider 完成证据、host schema/bridge、不可变文案版本/正文/来源；写作/runtime/UI；依赖 T-P0-04、T-07 | [x] | 完成/非法/中断/围栏协议复用源码与 SDK 回归；真实 Chat UI 的一次本地 SDK 回复已自动产生持久 V1，无 recovery，生成前后风格记录为 0。两端版本/历史服务及 Desktop 复制/编辑/回选/保存通过；本地回复不证明真实 provider 质量，参考详情 UI 余项归 T-14 |
| T-09 | B-129/REQ-10 / B-129/AC-10；B-129/REQ-11 / B-129/AC-11 | P3：host 保存预览、正式附件和 note；保存/UI；依赖 T-03/08/11b | [x] | Desktop 真实双图默认保存、回选旧版、JPEG+PNG 显示与重载 hash 保留；iOS 生产正式附件/精确正文及相对规则通过。初次 checker 误报与修正回执成对保留；服务验收完成，移动保存 UI 余项归 T-14 |
| T-10 | B-129/REQ-11 / B-129/AC-11 | P3：receipt、partial recovery/并发；保存/history；依赖 T-09 | [x] | 两端真实 note-create 后取消/重试保持正文、附件路径/hash；Desktop 跨真实重载保留 partial/version/turn，并由全局未完成保存 UI 继续完成。并发故障复用 focused 回归，不再重复移动故障矩阵 |
| T-11 | B-129/REQ-12 / B-129/AC-12；B-129/REQ-14 / B-129/AC-14 | P2 启用前：host 聊天 provenance、提取及 governed/legacy 准入保护；Memory；依赖 T-P0-05、T-04 消息接口，不依赖 T-08 | [x] | 提取与双准入源码回归覆盖普通表达/写作/AI 草稿/局部修改/显式授权；实际 Chat 自动版本保留 host provenance、未自动建立风格，随后仅显式服务动作建立 revision。自动提取当时关闭，不能把宿主 0 风格记录冒充开启提取的完整实测；该隔离由既有正反回归覆盖 |
| T-11b | B-129/REQ-12 / B-129/AC-12；B-129/REQ-14 / B-129/AC-14 | P3 保存启用前：生成笔记 provenance 与来源资格；Memory/保存；依赖 T-08、T-11 | [x] | 生成笔记/持久化边界 4 suites / 220 tests 保留；首次 create 写 pa_writing，共享源码检查覆盖编辑/损坏不降格。两端保存服务与 Desktop AI draft/Edited by you、origin/adoption/textHash 相互补足，不以单一 UI 字段替代准入回归 |
| T-12 | B-129/REQ-13 / B-129/AC-13 | P4 G-05b：typed 样例、静态治理资格、持久化/迁移/撤销/恢复/更正；Memory；依赖 T-P0-05、T-08/11/11b | [x] | P4 完整治理分支与 I-09 成功/拒绝路径复用源码回归及独立复核；两端宿主安全拒绝保持旧资料，实际现有版本 remember/pause 生产服务通过并保留授权/版本/hash。未声称真实旧库已升级，或已点击全部治理 UI；UI 余项归 T-14 |
| T-13 | B-129/REQ-08 / B-129/AC-08；B-129/REQ-13 / B-129/AC-13；B-129/REQ-14 / B-129/AC-14 | P4：动态场景匹配、预算/投影、查看/取消/恢复/更正入口；Memory/UI；依赖 T-07/12 | [x] | P4/请求回归覆盖异场景、当前要求优先、共享预算及 pause/correct/Forget 后失效；本轮 2 次真实生产 ChatService/SDK 本地请求证明同场景注入精确 revision，pause 后无注入，均正常 stop/自动 artifact。未更换来源 reader 或直接写 IDB，不冒充远程模型质量或治理 UI 点击 |
| T-14 | B-129/REQ-01 / B-129/AC-01；B-129/REQ-15 / B-129/AC-15 | P5：Desktop 与真实 iOS 最小完整路径；集成负责人；依赖所有功能 slice | [x] | Desktop 双图/恢复/保存/重载、实际 Chat 自动 V1、两端生产服务及风格最小服务闭环通过。iOS 真实 Files、布局修复、双图版本默认全选/预览/精确保存/打开笔记均已观察；I-15 修后最终重载两图解码正常，8 项保存/原件核对通过。未穷举的入口、远程质量及治理 UI 点击作为 Snapshot 验证边界保留 |
| T-15 | 全部 REQ/AC 与验证策略 | P5：独立分线 review、修复、full gate、使用指南/当前契约对齐；集成负责人 | [x] | 复用 aa9cb 完整 238/6202 与 I-09/I-14 窄修检查；I-15 suite 25 tests、TS/scoped lint/独立 review/build/双部署通过，最终 Community 源码扫描无匹配。327f 两端加载及 iOS 最终保存/重载通过，39 份原始回执保留事实与限制。开发及限定验证完成，未归档/提交/推送/发布 |
| T-16 | B-129/REQ-15 后续扩展 | 首版以后：完整动画理解、外部资源 SVG 渲染 | [-] | 用户于 2026-09-06 明确选择后续推进；重新启动需独立范围/依赖/网络边界设计，不阻塞本版静态处理及恢复验收 |

## Findings

### 生产实现交叉评审（2026-09-06）

| ID | 严重性 / 问题 | 处置 | 验证边界 |
| --- | --- | --- | --- |
| I-01 | P2：直接取消/抛错会移除原始文案恢复入口 | 保留独立 recovery 字段及恢复入口，清除自动 artifact 候选；手动选择才创建版本 | Chat 聚焦测试含取消/传输报错与仅选原文/实际改字；未完成宿主验证 |
| I-02 | P2：首次没有外部图片时，会话的关联笔记锚点会丢失 | 独立持久化 conversation.imageAnchor；外部/笔记库图片共用；Pagelet 纯文字首轮也登记，rename 原子更新且旧 turn 快照不能覆盖 | Memory/IDB store 及 Chat 回归；未完成宿主验证 |
| I-03 | P2：明确换场景后无推断结果，子版仍继承父版旅行风格 | 生成版本使用本次推断结果；仅本地编辑显式保留原场景；中文提示与别名、本地化显示对齐 | WritingVersion/风格选择聚焦回归；未完成真实请求交互验收 |
| I-04 | P2：启动时迟到的历史读取可清除新开始的导入 | 恢复历史前复查统一草稿占用和 revision | Chat pending-import 回归通过 |
| I-05 | P2：异步图片导出后来源被排除仍可复制；最终提交期间附件改变仍可报告完成 | 附件复制前复查原图，正式附件/笔记在 hash、Vault.process 与 completed checkpoint 窗口持续核对身份、事件与边界 | SaveAction 新增 7 项延迟回归；相关 3 suites / 48 tests、TS、lint 通过 |
| I-06 | P2：Git 早期规则被后续否定仍报 configured；原图移出导入目录仍套用旧同步说明 | 核对末尾有效规则，并发覆盖为 unknown；移出后提示实际路径且不自动排除新的共享父目录 | 图片资产/Chat 2 suites / 208 tests 通过；tracked/曾上传状态持续 unknown |
| I-07 | P2：SDK 自动重试时非空风格已失效，备用调用却静默丢风格继续 | 非空失效 preparation 明确停止；实际 SDK 内部 retry 覆盖图片及风格失效，不静默降级 | runtime 36 项通过，含真实 SDK retry；物理 fetch 仅 1 次、lease 释放 1 次；宿主验证待完成 |
| I-08 | P2：已明确授权的风格参考错误依赖自动 Memory 提取开关，默认可能记录却不使用 | 显式风格用途与自动提取资格分开；全局 Memory、治理就绪、来源与撤销检查仍保留，不自动改设置 | plugin 317 项及 Chat 193 项通过，含提取关闭/未确认 consent 下显式用途、总开关/暂停/Forget、兼容态失败提示；真实 UI 待完成 |
| I-09 | 旧设备已完成 legacy/compatibility 迁移后没有再次安全切换入口，风格参考要求 governed 而被阻止 | 用户批准的安全升级已实现；Desktop 02 的比较对象误拒绝已最小修复，不是旧资料损坏；25 项直接测试、TS/scoped lint 和独立 review 通过 | 2f0f 下 Desktop 03 与 iOS 01 均为 `safely_refused / profile_evidence_unsupported`，完整 Profile、兼容字段与治理状态不变，正确保留旧模式；未发生升级提交，不证明成功升级。[原始回执及判读](./p5-evidence/evidence.md#i-13-存储修复与-i-09-后续预检)保留不同拒绝原因 |
| I-10 | P2：旧图重看与失败续写素材未进入文案正常/恢复记录；重开时旧成功版本可越过新话题重新成为父版本 | 已修复并独立复核通过：补 host 素材回执与相关失败任务继承，区分聊天序号/版本排序；补新话题重开边界与异步恢复 currentness，不合并全会话无关图片 | 主体修复 5 suites / 329 tests 及旧全量 236/6117 通过；最终隔离补修 Chat 202、TS/lint/review 通过。cf6f 新实例实测旧图恢复 1 张、同轮两图恢复并默认保存正式 JPEG+PNG、精确正文与各层 hash 通过；[原始失败及修后证据](./p5-evidence/evidence.md)成对保留。不将人工恢复通过提升为自动 artifact 真实模型成功 |
| I-11 | P2：首次图片使用与原图管理均缺少约定的 provider 可见内容说明 | 补 device-local metadata 去重的非阻塞说明、Files/vault/旧图接点和随时可看的入口；通知初始化失败自身容错，普通图片存储检查仍 fail closed；不新增发送授权或确认 | 首轮独立复核指出的初始化失败问题已修复并复核通过。最终 2 suites / 231 tests、TS/lint 与 build 通过，源码冻结；fc6b 新构建待对应宿主验证，cf6f 旧界面不作为新说明通过证据 |
| I-12 | 兼容增量：三次完整 JSON 代码块回复均因原严格传输协议进入人工恢复 | 2026-09-06 用户批准后已实现单个完整 json 三反引号包装兼容，schema/requestId/原始总预算/完成证据及混杂内容人工恢复不变 | 2 suites / 75 tests、TS/scoped lint/独立复核通过；含真实 SDK 离线 stop 成功、length/source_changed 保留恢复。旧回复仍是旧规则人工恢复证据，自动版本的真实宿主路径待验收 |
| I-13 | P2：从临时活动窗口取得的 IndexedDB factory 在 Settings 关闭后失效，阻塞治理存储初始化 | 已改用稳定 realm 的工厂，不清库、不重建用户资料；原 `onupgradeneeded` 空对象错误保留为历史失败 | aa9cb 构建完整 238 suites / 6202 tests 通过；test 于 `13:22:27.267Z`、独立 b129-style-test 于 `13:21:28.355Z` 实际加载，Settings 关闭后两库真实 initialize 成功。只证明该存储入口修复，不替代风格、升级或 iOS 完整验收；后续部署身份见 Snapshot |
| I-14 | P2：移动图片草稿行被按钮挤压，带 hidden 的按钮仍参与布局 | 仅修 CSS 的草稿行布局与 hidden 显示规则；build/diff 与两目标部署通过，main 仍为 2f0f，styles 为 `a5998eba0c6fd0f027eb1e68f2d2d132f955a0daa6c9ad94d642fd7b863c50b2` | iOS `14:31:13.369Z` 实际修后 hidden 按钮 display=none/height=0；filename 为 277.1875×19、status 为 329.1875×32、remove 为 44×44，截图可操作，布局通过。另发现的 preview 问题由 I-15 修复；本 CSS 修改不涉及 JS |
| I-15 | P2：iOS 持久缓存 Blob 元数据存在但 arrayBuffer 读取抛 NotFoundError，重载后预览破图 | 已修复并关闭：先核验缓存字节可读性，失败按 cache miss，从经来源校验的原图重建；不回写或替代原件 | 新增 2 项回归、该 suite 25 tests、TS/scoped lint/diff、独立 review/build/双部署通过；327f 实际恢复同会话 PNG+HEIC，最终 iOS 重载后两图自然尺寸正常。诊断、最终加载/保存/预览回执见 P5 证据，不重跑无关全量 |

首次统一 `make deploy` 已完成 lint/TypeScript/build，全量 Jest 为 233 suites
通过、3 suites 失败，故未部署。失败涉及旧 Type-A 夹具缺少 host 来源及
Node 原生 ESM 原型被 Jest 直接加载。两组夹具修复后 320 项通过；Node
原型移至 `scripts/prototypes/b129-runtime-prototype.cases.mjs`，通过 tooling
wrapper 保留原 19 项检查，分组/运行器 3 项通过。下方历史日志中的旧命令仅为
当时实际执行路径。I-08 修复后第二次统一 `make deploy` 已退出 0：
236 suites / 6101 tests 全部通过，并完成 `test/` 生产部署；日志为本机
`/tmp/b129-full-deploy-02.log`。当时实际加载构建 hash 为 `6e0e3727ed901655ccfbc0691e6d06b184992be8bf66bf41136434c4dfd3d5ca`；后续构建和最新加载身份见 Current Snapshot。

Desktop 服务首次 `desktop-01` 在 case 09 报 `retry_not_idempotent`；原始失败
回执保留。只读核对确认生产返回和 schema 重读对象只有键顺序不同，附件字段
与磁盘输出一致；runner 改为全部字段的语义比较并记录分项状态/hash，不改生产
代码。同一生产构建的新 run `desktop-02` 完成全部 11 项，覆盖原件、转换、
版本/历史、取消重试和受控原图 lookup 缺失。它不包含 provider 调用或真实图片
理解。四种生产附件规则及真实插件重载的独立回执见下方 Validation Log。

当前聚焦证据：root Chat/版本/持久化/生成笔记边界 4 suites / 220 tests 通过；
P2 真实 `AIUtils → ChatOpenAI → bindTools → native fetch` 离线 transport 的 14 个
相关 suites / 384 tests 通过；P4 治理 17 suites / 370 tests、Settings/Pagelet
281 tests 通过。各组存在依赖覆盖，不相加冒充 full gate。TypeScript/lint 的
已执行快照无错误；第三轮全量基线与最后恢复隔离窄修的聚焦 gate 分开记录，完整 app 验收仍在进行。P0 可执行原型已改为对接
当前 V2 reader 的拒绝/升级契约，43 项通过；历史 V1 行为证据不改写为当前行为。

用户指南已补充实际入口、空间与格式、恢复、保存/风格分离和三类同步操作。
文档检查通过，仍只有两份 Episodic Memory 文档各自未入索引与不可达的 4 项
既有 advisory，未新增。

源码集成检查（2026-09-06）：processor/format/macOS converter 的 3 suites / 83 tests；
asset/store/lifecycle 的 3 suites / 56 tests；T-11 提取/双准入的 6 suites / 193 tests
已分别通过。UI/history/composer 初轮 3 suites / 208 tests 通过；随后正文版本、
generated-note 资格与 UI 集成 4 suites / 208 tests 通过，新增 artifact/recovery
测试后 Chat UI 共 180 tests 通过。每组对应当时改动切片，不能相加冒称统一全量
gate；这些是早期源码快照，当前统一 gate 与已完成 Desktop 证据见上方和下方日志，
完整 Desktop/iOS 验收尚未完成。

当前已接入 `pa_writing` 生成来源：首次创建笔记即携带该字段，共享 cached 与
exact-Markdown 资格检查均识别；局部编辑或损坏 detail 不会自动降格成自写来源。
保存动作只沿明确用户选定输出继续，generated-note 的读取排除不会阻止该输出
笔记补齐；原图和背景来源的 Data Boundary 检查仍保留。

| ID | Severity | Finding | Decision / fix | Verification | State |
| --- | --- | --- | --- | --- | --- |
| D-01 | 产品边界 | 用参考/主题角色决定保存图片会丢素材 | 用户明确所有图片都保留；SDD 将完整素材集与当次请求用图区分 | Spec AC-10；后续 T-08/09 | 设计处置完成，运行时待验证 |
| D-02 | 产品边界 | 排除同步前无法确认是否已上传 | 用户明确通知并继续导入；不等待手动排除、不新增确认 | Spec AC-06；后续 T-03 | 设计处置完成，运行时待验证 |
| D-03 | 产品边界 | 是否新增 Operations 开关关闭路径门禁 | 用户明确当前不构成绕过，未来 PA 能力承接权限迁移；本轮不改开关 | DEC-030；后续保存仍核对内容和目标 | 设计处置完成 |
| D-04 | 实施前约束 | 图片二进制不能经过 B-128 文本摘要/预算假设 | G-04 + 统一最终物化接点，snapshot 纳入图片版本 | 源码已核对；T-07 验证真实请求 | 方案已定义，待工程验证 |
| D-05 | 实施前约束 | summary/现有 scope 无法保存完整样例并限制类似场景；legacy merge 可漏控 | typed revision payload + 场景 predicate + 双路径防污染 | 独立只读源码核查；T-11–13 覆盖迁移、撤销及实际请求 | 方案已定义，待工程验证 |
| D-06 | 平台验证 | 原图取得、格式、资源与虚拟锚点不能由桌面类型声明保证 | G-01–03 分别验证宿主行为和恢复边界；D-13/14/17 承接实测决定 | P0 两端独立格式/入口/锚点/资源证据齐备；最低官方 API 静态检查与当前宿主实测分开 | P0 已完成；生产生命周期与尚未证实的 iOS 粘贴路径由后续 slice 验收 |
| D-07 | P2 计划依赖 | P0 曾要求等到 P3/P4 依赖的完整 G-05 证据，造成门禁循环 | 将 G-04/G-05 分成 P0 独立原型 a 和 P2/P4 集成 b；增加无后续阶段依赖的前置任务 | 独立复核确认 Plan/SDD/Tracker 的 gate 与依赖一致，循环消除 | 已修正并复核 |
| D-08 | P2 设计缺口 | 原图写入成功但登记前中断会留下未追踪文件，重试可能重复 | pending import 先登记 asset ID/目标路径/hash，再写文件并完成 asset 登记；重启按记录核对恢复 | 文档复核通过；T-04/05 将验证每个中断边界及取消在途写入 | 设计缺口已处理；运行时待验证 |
| D-09 | P2 设计缺口 | 防污染只在保存前启用，遗漏聊天结束即提取的未保存内容 | T-11 以消息 provenance 在 P2 图片聊天启用前保护提取及双准入；T-11b 单独承接 P3 生成笔记 metadata | Plan/SDD/任务依赖复核通过；T-11 无 P3 依赖，T-11b 在保存前 | 设计缺口已处理；运行时待验证 |
| D-10 | P2 设计缺口 | custom 范围样例不能直接复用现有治理动作，非匹配场景也必须能管理 | 分离合法 typed 样例的静态治理资格与动态场景使用；普通 custom 保持 fail closed | 动作接口与文档复核通过；G-05a/b、T-12/13 将验证非匹配场景管理及使用隔离 | 设计缺口已处理；运行时待验证 |
| D-11 | P2 设计缺口 | 未定义文案 artifact 协议却假定已有结构化结果通道，最终轮/中断行为不清 | 拟新增最终 text envelope、stream/invoke 完成证据和 typed bridge 事件；明确完整终态才自动提交，未知不当 stop；失败人工选择/编辑 | 独立限定复核确认设计闭合；G-04a/T-08 将验证 reserved final、合法 JSON+length、content_filter/unknown、中断 | 设计缺口已处理；运行时待验证 |
| D-12 | P2 设计缺口 | Pagelet handoff 仅检查文字，纯图或处理中草稿可能被重置或错接 | 统一文字/附件/处理中项的草稿占用谓词，handoff 双检；异步导入及 next-draft 恢复绑定草稿 identity | 独立限定复核确认设计闭合；T-04/06 将验证纯图、处理中、并发切换及下一份草稿 | 设计缺口已处理；运行时待验证 |
| D-13 | P2 实测设计缺口 | 公共附件 API 忽略尚不存在的 note，相对目录退回 vault 根层；原“附件先写”顺序错误 | 用户于 2026-09-06 明确批准先登记 receipt、创建确切正文，再规划并写图片/嵌入；失败保留未完成笔记，重试不能覆盖编辑 | P0 两端路径对照；当前生产 Desktop 四类目录、hash、正文/链接与 partial 重开 UI 恢复均通过 | 设计已落实；T-09/10 生产 iOS 及完整路径仍待验收 |
| D-14 | 平台兼容 | 上轮把底层解码差异外推为 Obsidian 产品支持差异，过早收敛到大库 | 用户复测后明确选择系统转换、失败提示提供 JPEG；正式保存 JPEG，HEIC 原件留在原位置并保留来源关联；不内置/安装 decoder、不远程转换、不保证所有设备自动处理或取得未同步原件 | 两端文件卡、Finder 原字节、iOS/macOS JPEG 实验及 QuickLook 误成功已记录；真实发布入口已有 allow-node-builtins，无需额外放宽审计 | 转换与保存设计已确认；生产平台隔离、导出质量/固定输出恢复与来源持久化待验证 |
| D-15 | P2 探针缺陷 | 初版异步内存采样未收敛在途调用，Canvas 编码无超时 | pending sample 收敛/异常处理 + 15 秒 encode timeout；保留旧 receipt 并标注限制 | 3 个 focused tooling regression 通过；iOS 使用修正后的 runner | 探针已修复；旧 Desktop 01 内存读数仅为初步观察 |
| D-16 | P2 原型缺陷 | V2 原型会由 V1 parser 静默剥除错误层级的 writingStyle | clone/V1 委托前只允许 revision 与 undo revision 持有字段，其他位置拒绝；不修改普通未知字段语义 | 初次 22 个治理检查及独立复核已关闭缺陷；最终 43 个检查继续覆盖错位字段、保序/坏行拒绝及预算边界 | 原型已修复；生产 schema 仍待实现 |
| D-17 | 媒体范围 | 完整动画理解及外部资源 SVG 尚无已验证实现 | 用户明确确认首版保留原件、提示静态 PNG/JPEG；不抽帧或联网补齐，静态自包含 SVG 继续本地处理；完整能力后续 T-16 | 最终两端原型已验证分类、保留原字节及恢复结果；被拒绝的动画/外部资源不送入解码器。早期静态化实验不作为支持证据 | P0 已完成；生产恢复 UI 由 T-04/14 验收，完整能力已明确延期 |

本表不将尚未执行的验证关闭为通过；也没有将媒体范围缩减或原图丢失风险记作
用户接受。实测出现 P0/P1/P2 correctness finding 时，在对应 slice 前关闭或取得
用户明确处置，不从本表的“方案已定义”推导放行。

## Validation Log

以下按验证推进顺序保留历史。初次实验的限制描述只代表当时证据；最终 P0
结论以下方“P0 最终验证”记录及证据索引为准，不把旧的待测事项继续当作当前阻塞。

| Date | Requirement / AC | Check | Result | Evidence / residual risk |
| --- | --- | --- | --- | --- |
| 2026-09-06 | T-00 / D-04–05 | 本分支 source + master B-128 只读核对；独立 Memory 接口核查 | 已形成 source-verified 设计 | API/schema 接点已核实；没有执行新运行时测试 |
| 2026-09-06 | T-00 / 全部 REQ/AC | `npm run docs:check` | 通过；188 Markdown、1375 local links，4 项既有 advisory | 两份 Episodic Memory 文档各有未入 architecture 索引与从 docs/index 不可达问题；由既有 known-findings 清单精确保留，本轮未新增 |
| 2026-09-06 | T-00 / 全部 REQ/AC | `git diff --check`；新文档 whitespace 检查；30 个稳定 REQ/AC ID 覆盖核对 | 通过 | Tracker 和 SDD 各覆盖 15 组 REQ/AC；不代表测试或运行时通过 |
| 2026-09-06 | T-00 / D-05/D-07 | 独立限定审查：风格设计、阶段依赖与产品偏离；D-07 修正复核 | 无剩余可执行 finding（限本次审查范围） | 源码级风格结论准确承接；没有将本次文档审查外推为全功能验收 |
| 2026-09-06 | D-08–D-12 | 本轮 review follow-up：文档修订、源码接点和任务依赖复核；D-11/D-12 再由独立 reviewer 验证 | 5 项设计缺口已处理，未改变已确认产品边界 | 仅修订 SDD/Plan/Tracker；补齐导入恢复、P2 前防污染、治理资格、输出完成证据及草稿保护；所有运行时任务仍 Todo |
| 2026-09-06 | D-08–D-12 / 全部 REQ/AC | 本轮 `npm run docs:check`、`git diff --check`、编辑文档 whitespace/30 个 REQ/AC ID 映射检查 | 通过；188 Markdown、1375 local links，仍为 4 项既有 advisory | 没有新增文档问题；未运行 Build、TypeScript、Jest 或 Obsidian/iOS smoke，文档检查不证明实现通过 |
| 2026-09-06 | T-01 / B-128 baseline | 备份并 stash 设计文档，`git merge --ff-only master`，恢复并保留双方产品索引 | 分支 HEAD `42859863`；无新 commit/push；原 stash 保留 | 基线整合，不将 master 的旧验证当作本功能验证；临时备份不属于产品数据 |
| 2026-09-06 | T-P0-04 / G-04a | `node --test __tests__/b129-runtime-prototype.test.mjs` | 19/19 通过；独立 reviewer 无 actionable finding | 真实 SDK、post-bind observer 与离线 transport；不是实际模型视觉质量或生产 bridge 验收 |
| 2026-09-06 | T-P0-05 / G-05a 初次原型 | `npm test -- --runInBand __tests__/b129-governance-prototype.test.ts` | 当时 22/22；V1 丢字段、旧 repository 拒绝旧 writer、V2 原型及聊天双准入均取得实证；D-16 修复后 TypeScript 通过 | 当时 IDB VersionError 为注入错误路径，预算仅为候选；下方最终 43 项检查、真实双连接迁移和预算校准已补齐这些 P0 证据 |
| 2026-09-06 | T-01/02/03 / G-01–03 | Desktop 2 次宿主探针、真实 iPhone 1 次完成回执 | 两端 PNG/JPEG/WebP/合成 SVG 可渲染；方向 6→480×640；原图 hash 不变，处理 PNG 无 EXIF/metadata；两端各 9 个单图资源阶梯 | [回执与边界清单](./p0-evidence/manifest.json)、[Desktop 01](./p0-evidence/desktop-01.json)、[Desktop 02](./p0-evidence/desktop-02.json)、[iOS 01](./p0-evidence/ios-01.json)、[输出检查](./p0-evidence/pixel-output-inspection.json)、[合成素材 manifest](./p0-evidence/fixture-manifest.json)；动画被静态化不算支持，外部 SVG 未解码，未验证选图入口 |
| 2026-09-06 | D-13 / T-03 | 两端实际 TFile 对照；用户批准新保存顺序；Desktop 4 种设置新顺序与真实阅读模式 | 路径、原图 hash、确切正文、`![[...]]` 解析全部通过，界面正常显示图片 | [先建笔记实验](./p0-evidence/save-order-desktop-01.json)；普通 `generateMarkdownLink` 需补 `!`；这不是生产 SaveReceipt 的失败恢复验收 |
| 2026-09-06 | D-14 / T-01 早期候选 | 固定 npm 包临时 Node + Desktop Blob Worker：有效/坏输入/取消 | libheif-js 1.23.2 可解码 640×480，Node/Desktop 像素 hash 一致；Desktop 初始化约 21 ms、解码约 25 ms；网络调用 0、原图不变；当时获准的候选随后被系统转换决定取代 | [Desktop HEIC](./p0-evidence/heic-desktop-01.json)、[Node HEIC](./p0-evidence/heic-node-01.json)；WASM heap 约 17 MB 非进程峰值；只评估临时包，未添加正式依赖，当前不采用 libheif |
| 2026-09-06 | D-15 / G-03 探针 | 独立 review → timeout/sample 修复 → `npm run test:tooling -- --runInBand __tests__/b129-platform-probe-script.test.ts` | 3/3 通过；取消超时释放及迟到采样成功/失败收敛 | iOS 用修正后的 runner；Desktop 01 原回执保留，旧内存采样不能被提升为安全阈值证明 |
| 2026-09-06 | 初次原型与文档 | TypeScript、脚本语法、tracked/untracked whitespace、Community 源码扫描；`npm run docs:check` | 当时通过 44 项原型检查（19 SDK + 22 治理 + 3 探针）；文档仍只有 4 项既有 advisory | 原型 review 的 D-15/16 已修复验证；没有修改生产源码或正式依赖，因此未运行插件 Build/full Jest 或重新部署；最终测试数量见下 |
| 2026-09-06 | D-14 / G-01 HEIC 复测 | 官方资料、真实笔记、Finder 文件粘贴、两端 JPEG 转换、macOS 方向/GPS、QuickLook 坏输入；独立边界复核 | 更正宿主/内核结论，JPEG 轻量路径在所测 iOS/macOS 可行；原图不变；保留失败及限制 | [复测回执清单](./p0-evidence/heic-recheck-20260906/manifest.json)；无生产代码/依赖修改；不能据此宣称所有 Desktop、相册原图获取或完整 HEIF 支持 |
| 2026-09-06 | D-14 / 复测记录 | 独立文档边界复核；`npm run docs:check`、`git diff --check`、9 项证据/source hash 与编辑文档 whitespace | 通过；191 Markdown、1443 links，4 项既有 advisory；独立复核无 actionable finding | 仅宿主实验与文档，未运行插件 Build/full Jest；libheif 未加入正式依赖，新架构与正式附件契约未自动批准 |
| 2026-09-06 | D-14/17 / 技术方案定稿 | 用户逐项确认三项决定；Decision/Spec/SDD/Plan/Tracker 对齐，独立限定复核与文档/REQ-AC 映射检查 | 三项选择已定稿；独立复核无 actionable finding 或新增需用户裁决事项；15 组 REQ/AC 映射保留 | 当时仅完成文档决定，P0 尚待实测；下方最终记录已补齐 P0，后续生产验收仍未完成 |
| 2026-09-06 | P0 最终验证 / G-01 | 两端 Files、Desktop Finder 粘贴、iOS Photos 实际入口；两端格式原型及独立像素/元数据检查 | Files 和 Finder 保持合成 HEIC 原 bytes/hash；Photos 返回 JPEG，按 unverified_import 保留取得内容并引导从 Files 取得原图；两端各 22 个有效格式案例通过 | [最终证据索引](./p0-evidence/technical-feasibility-20260906/README.md)；Photos 不算原图取得成功，iOS Files Copy→focused textarea 未取得 paste 事件，不推断 iOS 全平台不支持；实际生产入口仍由 T-04/14 验收 |
| 2026-09-06 | P0 最终验证 / G-02 | 四种附件规则及两端 anchor、leaf、rename、设置变化序列；逐类同步官方能力核对 | 实际目录、旧原图保留和 hash 一致；稳定 anchor 不随无关 leaf 改变；同步未知可按既有说明继续 | 最终证据索引中的 anchors 回执及 sync guide；指南不等于已配置排除或从未上传，生产接线仍在 T-03 |
| 2026-09-06 | P0 最终验证 / G-03 | 两端资源阶梯、真实 IDB Blob/LRU/lease/重开、取消/迟到编码/超时和注入配额失败；最终 3200/.9 单张及 8 张 48 MP 串行；两段 iOS Safari Memory timeline | 所测 Desktop/iPhone 15 的有界处理可行；最终资源配置、原图 hash 和小字质量依据已收口 | [资源分析](./p0-evidence/technical-feasibility-20260906/resource-host-analysis.md)；含真实 critical memory 事件及后台时序推断，未证明回到初始基线或所有设备安全；注入 quota 不冒充真实耗尽配额；实施参数只引用 SDD 本地处理 |
| 2026-09-06 | P0 最终验证 / G-04a/G-05a 与原型回归 | 4 个 source 原型 suites；SDK `node --test __tests__/b129-runtime-prototype.test.mjs`；tooling 探针回归 | 共 129 项通过：source 107（治理 43 在内）+ SDK 19 + tooling 3；真实两端临时 IDB 升级/旧 writer 保护通过 | 最终证据索引及 governance budget 回执；正文上限/共享预算已校准，生产 Chat、迁移和完整治理仍分别属于 P1/P2/P4 |
| 2026-09-06 | P0 最终验证 / 最低宿主 API | 官方 Obsidian 1.11.4 历史声明与同版 asar 的导出/实际实现只读检查；当前 Desktop/iOS 公共 API 实测 | 最低和当前 public API 可用性条款完成 | [最低 API 分析](./p0-evidence/technical-feasibility-20260906/minimum-api-analysis.md)；未安装/运行旧版宿主，不把静态检查写成旧版 runtime 或 iOS 实机验证 |
| 2026-09-06 | P0 最终文档与回归检查 | `npm run test:docs -- --runInBand`、TypeScript、Community 源码扫描、`npm run docs:check`、`git diff --check`、未跟踪文本空白与 30 个 REQ/AC ID 核对 | 58 项文档契约通过；TypeScript 与扫描通过；文档检查仅保留 4 项既有 advisory，未新增问题 | 两份 Episodic Memory 文档各有未入 architecture 索引及从 docs/index 不可达问题；本轮仅原型/证据/设计变更，无需生产 Build 或新部署 |
| 2026-09-06 | P0 最终独立交叉复核 | SDD/Plan/Spec 与入口、像素、资源和治理证据对照；限定修正后复核 | 旧小字报告的资源待测表述、Spec 的笼统未授权表述已修正；复核无剩余可执行问题 | 保留原样本、Photos 未核实来源、iOS 粘贴未证实、critical 归因推断和生产未实施边界；不将 P0 完成提升为整个功能 Validated |
| 2026-09-06 | P5 / T-15 全量检查与 Desktop 部署 | I-08 修复后第二次统一 `make deploy` | exit 0；236 suites / 6101 tests PASS，完成生产构建、部署及加载身份核对 | 本机 `/tmp/b129-full-deploy-02.log`；build/loaded SHA-256 `6e0e3727ed901655ccfbc0691e6d06b184992be8bf66bf41136434c4dfd3d5ca`。首次 233 suites 通过/3 失败而未部署的历史保留；本次成功不代表完整 app/iOS 或 I-09 已解决 |
| 2026-09-06 | P5 / Desktop 服务首次回执 | 当前生产服务 runner `desktop-01` | 前 8 项通过；case 09 报 `retry_not_idempotent`，已确认为 runner 的对象键顺序误报 | `test/b129-production-services/desktop-01/receipt.json` 原始失败保留；首返回与 Zod 重读的附件字段结构相同、序列化键顺序不同。修正仅涉及 ignored runner，未因此修改生产；该回执不改写为 11 项通过 |
| 2026-09-06 | T-04/05/08/09/10 / Desktop 生产服务 | 修正语义比较后的独立 run `desktop-02` | 11/11 PASS；PNG/HEIC 原件 hash、preview/provider JPEG、版本/turn/owner、精确正文/全部图片、note-create 后取消、重试及正式 JPEG 均通过 | `test/b129-production-services/desktop-02/receipt.json`；重复保存 state/附件语义/正文/hash 一致，原件不变；missing case 为受控 Vault lookup 缺失注入，不是物理删除。无模型调用，不证明图片理解；wrapper/lease/活动会话恢复 |
| 2026-09-06 | T-03/09 / B-129/AC-11 Desktop 生产附件规则 | 同一生产 SaveAction，各规则一张独立合成 PNG，目标不是活动笔记 | 根目录、指定目录、笔记同目录、笔记相对子目录 4/4 PASS；实际链接解析、正文/hash、重复保存同路径通过 | `test/b129-attachment-rules/desktop-rules-01/receipt.json`；测试使用宿主设置接口暂改 `attachmentFolderPath`，前后均 `/`，finally 已恢复；原件/正式附件保留。生产 iOS 相对规则尚待验证 |
| 2026-09-06 | T-05/10 / Desktop 生产持久重开 | 原件已写后注入一次 asset finalize 失败；另在真实 note create 后取消；随后真实插件重载 | prepare 3/3、resume 2/2 PASS；新旧插件实例不同、SHA 不变；启动已恢复 pending，原 hash 不变、重导 0 次原图写入且只有一个对应 imported 记录；partial/version/turn 从原 store 恢复 | `test/b129-reopen/desktop-reopen-01/prepare.json` 与 `resume.json`；这是受控失败加真实插件重载，不是 OS 崩溃。resume 只核对全局列表里的 partial，后续真实 UI 操作单独记录 |
| 2026-09-06 | T-09/10/14 / Desktop 真实保存 UI | More → 未完成的笔记保存 → 继续保存，再打开结果 | 已完成 `b129-reopen/desktop-reopen-01/partial.md`，阅读界面可见正式 PNG；磁盘来源标记为 completed 并包含正式附件链接 | 集成负责人真实 UI 观察；该操作发生在上述 resume 回执之后，原 resume 的 partial 状态不改写。只覆盖这次恢复保存，不外推文案生成/风格流程 |
| 2026-09-06 | T-04/14 / Desktop 真实导入与纯图请求 | 文件选择入口加入 `chart-sips.heic`，再移除草稿附件；另发送纯图消息 | 当时 HEIC 导入及草稿移除后原件保留通过；首个纯图请求返回当前笔记内容，未据此通过图片理解 | 原件 `test/pa-images/img_39f46d087ee24694a5c883ea42a684db.heic` 当时与 fixture hash 一致；后续视觉/恢复验证及明确测试清理见下，不能将该原件后来缺失误报成导入丢图 |
| 2026-09-06 | T-05/14 / Desktop 实际管理入口 | 缓存清理；Manage saved originals 显示已知引用 0→精确路径确认→回收站；展开同步说明 | 原件 39f... 按测试移入回收站，其他原件/正式附件 hash 不变；缓存清理提示保留原件/正式附件；三类同步限制文案可达 | [原始清理回执](./p5-evidence/original-cleanup-ui.json)；已知引用仅 PA 范围，通知可见不表示同步配置完成。iOS 生产仍待验 |
| 2026-09-06 | I-10 / T-15 第三轮完整基线 | 主体素材回执修复后 `make deploy` | exit 0；236 suites / 6117 tests PASS，构建 `6b8b9b32e521165e1799d66eb6d69641c73d82aa7c9b48a109317811ef57ef73` | 本机 `/tmp/b129-full-deploy-03.log`；该构建当时未重载，随后隔离窄修的聚焦 gate 与新构建单独记录，不能混作同一全量验证 |
| 2026-09-06 | I-10 / T-15 最终隔离修复与独立复核 | 新话题重开边界、异步恢复 currentness；Chat 202 tests、TS/lint、独立 review；build/deploy-current | 全部通过；新实例实际加载 cf6f 完整 hash 见 Current Snapshot，加载时间 `11:02:16.417Z` | [加载身份](./p5-evidence/i10-loaded-identity.json)；I-10 修复通过，后续操作对应新实例；未声称窄修后再次运行完整 236/6117 |
| 2026-09-06 | I-10 / T-04/09/14 真实旧图与双图恢复 | 旧会话 `resolve_chat_images` 重看 PNG；新聊天同轮 HEIC+PNG；真实人工恢复入口 | 旧图恢复 UI 为 1 图、Version 3 / AI draft；当轮恢复为 2 图，持久恢复记录与素材一致 | [旧图回执](./p5-evidence/i10-reresolve-recovery.json)、[双图回执](./p5-evidence/i10-multi-recovery.json)；wire 为 fetch-entry，非 provider 回执。3 次有效文案回复均 fenced JSON，严格协议人工恢复；围栏兼容待用户决定，自动 artifact 实际模型路径未证明 |
| 2026-09-06 | T-09/14 真实双图保存与精确复核 | 保存 UI 默认勾选两图，正式 JPEG+PNG；打开笔记可见两图 | 两图版本/来源/正式附件齐全，正文与原件/正式附件/receipt final note hash 一致，styleRevisionCount 为 0 | [初次保存检查](./p5-evidence/i10-multi-save.json)中正文 false 是把 6 字符 delimiter 按 7 跳过的 checker 误报；[修正复核](./p5-evidence/i10-multi-save-verified.json)确认同一笔记未变并全部通过，未修改产品/笔记 |
| 2026-09-06 | T-09/14 双图保存后的真实重载 | 实际 plugin reload，新实例加载 cf6f 于 `11:13:27.302Z`，重开 Writing versions | 6 项检查通过：新实例、两图、completed、笔记 hash、原件/正式 hash、模型设置恢复；UI 显示 1 · AI draft、Exact writing text、Associated images (2) | [重载回执](./p5-evidence/i10-multi-reload.json)；没有新模型请求，`deepseek-v4-flash` 仅为持久设置恢复，不是重新生成或新模型理解证明 |
| 2026-09-06 | T-14/15 Desktop 测后清理 | `obsidian vault=test dev:errors`、`dev:debug off`、`dev:mobile off` | 分别返回 `No errors captured`、`Debugger detached`、`already disabled` | 只表述最后错误捕获与调试状态；完整风格/当前生产 iOS 仍待验收，整体保持 Implementing |
| 2026-09-06 | T-15 最新文档与源码检查 | 统一 `npm run docs:check`、Community 源码扫描、`git diff --check` | 文档检查 exit 0：198 Markdown、1525 local links；源码扫描无匹配、空白检查通过 | 仍只有两份 Episodic Memory 文档各自索引/可达性的 4 项既有 advisory；未新增问题，不代替剩余产品决策或 app 验收 |
| 2026-09-06 | AC-10/15 Desktop 补验及 AC-05 部分验证 | cf6f 实例真实双图 V1→V2→V1 预览/保存；Files 导入动画 GIF、移除失败项；UI 清理缓存 | 回选原版精确保存两图，用户修改版独立保留；动画提示静态恢复，原件及文字保留；清理后持久副本 0 项、原件和正式文件 hash 不变 | 三份原始回执及初版草稿字段缺失边界见 P5 证据；没有新模型请求。重新预览/删聊天链路未完成。后续用户将模型改为 qwen3.8-max，已保留并停止 UI 动作；错误捕获为空，debug/mobile 已关闭 |
| 2026-09-06 | AC-12–14 验收路径核对 | 独立只读核对旧库公开 setup 与新空库首次 bootstrap | 旧库 Finish setup 不能替代 governed cutover；新空库可不调用 provider 走正式首次初始化 | 独立 b129-style-test 仅准备当前构建及合成材料、无转发的 loopback fixture；10 项无网络 fixture 检查通过，未启动宿主或 server，不当作风格 UI/SDK 通过。I-09 仍待用户决定 |
| 2026-09-06 | I-11 通知契约修复 | 聚焦 service/Chat 测试、TS、scoped lint、独立复核及 `npm run build` | 2 suites / 231 tests 与其余检查通过；新增初始化失败回归后独立复核无剩余 must-fix | 新构建 fc6b，日志 `/tmp/b129-i11-build.log`；只准备到尚未打开的独立 b129-style-test，不是当前 test 部署或宿主验证。没有新模型调用，待窗口空闲后完成 UI 验收 |
| 2026-09-06 | I-11 后文档与证据核对 | `npm run docs:check`、`git diff --check`、全 src Community 源码扫描；新增三份原回执逐字节/hash 核对 | 198 Markdown / 1540 local links；仍只有 4 项既有 advisory，源码扫描无匹配、空白检查通过 | 指南补首次图片说明与重复查看入口；保持历史回执原样。当前 test 尚未加载 fc6b，不提升新说明或风格/iOS 验收状态 |
| 2026-09-06 | I-11 冻结源码最终完整 gate | `npm run test:all -- --runInBand`、`npm run lint`；只读核对 production 构建与当前源码 | 两项命令均 exit 0，236 suites / 6131 tests PASS；已通过的 production build 为 fc6b，构建 provenance blockers 为空 | 本机 `/tmp/b129-i11-full-tests.log`、`/tmp/b129-i11-full-lint.log`、`/tmp/b129-i11-build.log`。保留此前全量也存在的 Jest 退出延迟提示，进程正常退出；日志中的 release docs 故意失败案例属于通过的契约测试。未部署或重载当前 test，不能替代剩余宿主及 iOS 验收 |

### HEIC 复测：产品支持与底层解码分开

以下保留 2026-09-06 前一阶段的 HEIC 复测事实；同日最终入口与格式验证补充见
后文“P0 最终证据范围”。前一阶段使用同一 640×480 合成 HEIC（16,893 bytes，SHA-256
`88d2d594a6f6b1ffd23285c076928621033a7574a2be3270ae7543305186f5c4`）。
macOS ImageIO 确认它是有效、可解码的单图；另用含合成 GPS/设备时间、方向 6
的 HEIC 核对元数据与方向。该阶段没有读取相册或把图片发送给 AI；后续 Photos
验证仅选择已导入的同一合成图，不将其他相册图片作为输入。

| 层次 / 入口 | Desktop macOS | 真实 iPhone |
| --- | --- | --- |
| Obsidian 实际笔记的 wiki/Markdown HEIC 图片写法 | 普通文件卡，无图片嵌入注册 | 同样是文件卡，无图片嵌入注册；Mirroring 画面确认 |
| Image 加载 vault resource / 正确 MIME Blob | 两条均解码失败；JPEG 对照正常 | 两条均 640×480 成功 |
| 系统文件复制 → 原生编辑器粘贴 | Finder 外部 HEIC 原样入库，bytes/hash 一致，没有自动转码 | 该阶段未验证；后续具体路径的未证实结果见最终证据范围 |
| 本地 JPEG 候选 | Obsidian 进程调用系统 sips → vault 外临时 PNG → 白底像素重绘 → JPEG 成功；非跨平台公共 API | 底层解码 → 白底 Canvas JPEG 成功；该 JPEG 在桌面笔记中正常显示 |

[Obsidian 官方格式清单](https://help.obsidian.md/Files+and+folders/Accepted+file+formats)
未列 HEIC/HEIF，不能预设宿主已提供统一兼容层。
[WebKit 的 HEIC 支持](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/#heic)
说明底层能力，不能代替 Obsidian 的嵌入行为。
[Apple 的格式转换说明](https://support.apple.com/en-us/116944) 表明部分交付入口
可能先转码；该阶段 Finder 结论不能外推到相册、Photos 复制、分享或 Files 选择。

转换实证与限制：

- macOS 单纯 sips 转 JPEG 会保留合成 GPS、设备与拍摄时间；经过像素重绘后
  这些字段消失，方向已落实为 480×640。iOS 输出仍有编码器生成的尺寸/色彩
  元数据；前一阶段 iOS 源图没有 GPS，不能单独证明 GPS 清除。最终两端均已
  使用含合成 GPS/设备/时间的同图验证，敏感字段未保留，方向落入像素，原图
  hash 均未变；仍不能写“所有元数据为空”。
- QuickLook 对有效 HEIC 返回图像，对损坏 HEIC 也返回非空的通用文件图标；
  不能以非空、尺寸或成功退出作为完整解码证据。另保留沙盒 sips 退出 0 却
  输出坏像素的失败事实；真实 Obsidian 进程中的系统转换像素正确。
- JPEG 为有损副本；前一阶段的白底合成和质量 0.9 尚不是默认值。最终已补齐
  所测静态图透明度、敏感元数据、相册交付、取消及资源校准；HDR/广色域照片
  保真、大 HEIC 的特定解码峰值、Windows/Linux 和旧宿主运行行为均不由这组
  合成图证据保证。完整动画/外部资源的延期和失败恢复仍按已批准边界执行，
  无需引入正式 libheif 依赖。
- 复测曾提出 JPEG 工作副本及正式附件关系待决；后续用户已明确确认只保存
  正式 JPEG、原 HEIC 留在原位置并保留来源关联，当前决定见 D-14。该决定
  保留原始复测事实，不删除原件，也不保证其他设备取得未同步原件。

旧回执保留。复测源脚本作为 `.js.txt` 证据快照保存在上述清单中，不是生产
实现；仅验证所述路径，不承诺已经具备完整失败恢复、清理或兼容性。

### P0 早期证据范围与复跑

- 重复生成合成文件：`python3 scripts/prototypes/generate-b129-image-fixtures.py`。
  初次 sips 在沙盒中编码失败，获准使用系统编码器后成功；manifest 保留两次
  结果。12 个合成素材约 7.6 MB，不读取用户相册。测试 vault 中的原图/结果保留，
  临时附件设置已恢复，Desktop debugger/mobile emulation 均为 off。
- 宿主探针：加载 `scripts/prototypes/b129-platform-probe.js` 后调用
  `runB129PlatformProbe(app, {runId: 'unique-id'})`；save-order 与 HEIC 实验
  分别见同目录 `b129-save-order-probe.js` 和 `b129-heic-evaluation.mjs`。
  所有 run 使用独有回执路径；失败或重试不得覆盖已留存证据。
- iPhone 已解锁并由 Safari Inspector 接入。首次 Console 提交短暂未显示变化，
  第二次输入报 clipboard timeout；随后可见命令历史与唯一完整回执，证明完成
  一次实际执行，没有提交第三条命令。记录设备为 iPhone 15 / Safari 所示
  iOS 26.6.1；reduced UA 的 18_7 不冒充真实系统版本。
- 复用既有宿主，不部署 B-129：Desktop Obsidian 1.14.0（installer 1.12.7），
  已加载 PA 2.10.0-beta.3；iPhone 已加载 PA 2.9.2。实验仅调用宿主 API，
  未更改插件生产代码或发起 AI 请求；不能据此声称新 Chat/保存 UI 已验收。
- 以上是早期单图与宿主入口的有限证据；当时相册/Files、静态恢复和资源校准
  尚待验证。后续已通过下述独立原型、实际入口及 Safari 内存采样补齐 P0；
  旧回执不用于证明后来新增的能力，也不把早期待测清单当作当前阻塞。

### P0 最终证据范围

- [最终证据索引](./p0-evidence/technical-feasibility-20260906/README.md) 汇总原始
  回执、复跑方法、像素/元数据检查、资源分析、最低 API 与三类同步指南。
  格式原型在两端各覆盖 22 个有效案例；动画/外部资源拒绝进入解码器，保留原
  字节并返回已批准的恢复提示。这是独立处理可行性，生产恢复 UI 尚未实施。
- 两端 Files 均取得 16,893 bytes 的原 HEIC，hash 与上述合成源一致；Desktop
  Finder 粘贴亦一致。iOS Photos 交付 43,471 bytes JPEG，只能记为
  `unverified_import`，不是 AC-04 的原图成功；已经验证的 Files 入口提供原图
  恢复路径。iOS Files Copy→focused textarea 未取得 paste 事件，仅该路径未
  证实，不推断平台全面不支持；T-04/14 继续验收真实移动触控与 clipboard。
- 资源实验包含既定尺寸/字节/张数/缓存阶梯，以及最终配置下单张和 8 张
  48 MP 串行处理；当前持有的 Image/canvas/URL 数量有界、结束归零，原图
  hash 不变。IDB 满额、LRU、lease、重开与真实版本升级有回执；配额错误为
  注入实验，未真实耗尽设备存储。工程默认值引用 [SDD 本地处理](./sdd.md)，
  不在 Tracker 复制数值，也不承诺任意 8 张图片一定可容纳。
- 两段真实 iOS Safari timeline 保留内存采样和残留容量。最终记录有一次
  critical MemoryPressureEvent：资源结束约 67 秒后、切后台 visibilitychange
  后约 0.320 秒发生。结合官方 WebKit 在挂起时主动进行 critical 清理的实现，
  推断它与后台清理相符；事件本身不标明来源，不能断言 OS OOM，也不能写成
  “没有内存压力事件”。没有人为模拟压力；该段前后另有两次手动 GC 观察，
  时间与该事件不重合。页内存没有被证明回到初始基线，分配容量也不能直接
  认定为泄漏。具体数字与解释见资源分析，P0
  结论只覆盖受测 Desktop/iPhone 15 的有界策略，不保证所有设备安全。
- 最低 1.11.4 的证据为官方历史 API 声明与同版发布 asar 的实际导出/实现；
  当前两端的公共 API 则已实际调用。两类证据合起来满足原 SDD 的可用性核对，
  不能表述为旧版宿主或旧 iOS runtime smoke。三类同步提供可复核官方指南，
  `unknown` 和通知已读分开，不冒称排除已配置或原图从未上传。
- G-04a/G-05a 只证明消息/结果协议、schema/旧 writer、静态治理资格、动态
  场景及共享预算可行；完整 Chat、保存、迁移和治理分别仍在 P1–P4。最终
  129 项原型检查通过，未新增生产代码或正式依赖，未将原型部署当成新功能发布。

## Closeout Readiness

- [ ] Owning contract 与实际实现行为一致；15 组 AC 有证据。
- [ ] Required review、Desktop/iOS smoke 与适用 checks 已记录。
- [ ] 未完成项经明确处置并按需要进入 Backlog。
- [ ] 稳定行为吸收到 current product/architecture/tests 与使用指南。
- [ ] 过程包按 delete-after-absorption 处置，仅保留真正独有且入链的证据。

规划完成不触发功能 closeout；实现验收、收尾和 Git/release 权限分别处理。
