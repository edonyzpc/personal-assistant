# B-133 Chat Image Generation Final Validation Evidence

Document status: Archived
Validated: 2026-09-19
Work item: B-133
Development branch: `codex/chat-image-generation-b133`

Current authority: [Chat Image Generation Architecture](../../architecture/chat-image-generation-architecture.md) /
[Product Spec](../../product/specs/pa-chat-image-generation-product-spec.md) /
[DEC-038](../../product/decisions/dec-038-chat-image-generation.md)

## Outcome And Identity

B-133 的开发、Desktop、CLI mobile simulator 与本次指定 iPhone 手动验收均已完成，
没有未解决的实现 finding。本文只保留以后仍需追溯的验证事实、迁移限制和证据边界；
稳定产品行为以当前 Architecture、Product Spec 和 DEC-038 为准。

- 开发基线：`96699da81ccb126b3cba267b6197bf0ffa36c941`。
- 功能提交：`458b71310d3fac6ba65e8de8aa58354cb92e4bc0`。
- 最终验收 HEAD：`c66a09839a962a2b14f96995c0839c2affb29116`。
- Linux / Desktop repo-local test vault 实际部署的 `main.js` SHA-256：
  `23bcd4e371e0f8354b731ef5b78558242dc681bed0f7042bfe312429a5df37ac`。
- 最终共享门禁自然退出：**290 suites / 7755 tests**，另有 lint、production build、
  Community 源码扫描和部署身份核对通过。R-18 聚焦回归为 **294 tests**。

这里的 `Validated` 绑定上述分支和提交，不表示代码已合并到 `master`，也不表示已经
发布 beta 或正式版本。本次归档仅为文档变更；未获得新的 commit、push、merge 或
release 授权。

## Evidence Levels And Research Boundary

验收结论组合了三类证据，三者不可互相冒充：源码/自动化证明确定性守卫与状态语义；
本代理在 repo-local test vault 的 Desktop、mobile simulator 和获授权合成 provider
调用证明相应应用链路；Owner 的 iPhone 手动反馈证明下文列出的单一设备正常路径。

设计调研发生于 2026-09-18。本地安装的 ChatGPT 桌面包 `26.911.61220` 仅做了会话
模块静态观察：看到结构化输入提示、生成结果和状态识别。由于界面连接失败，本代理
没有在 ChatGPT 中完成真实交互或生图，也没有确认字面量 `@CreateImage` 是 ChatGPT
的实际入口。[ChatGPT Images](https://help.openai.com/en/articles/11084440-images-in-chatgpt)
与 [Wan 图片生成和编辑 API](https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-and-editing-api-reference)
只作为产品与接口研究依据，不能证明 PA 的运行行为。PA 的运行结论来自本项目证据。

最终实现也以源码为准：Chat 图片任务固定使用 `wan2.7-image` 和 `2K`；Featured
Image 继续保留 `wan2.7-image` / `wan2.7-image-pro` 两种既有模型及自己的数量、路径
和插入语义。早期设计中的 Proposed 模型/比例 UI、全局单任务并发等设想不构成已实现
行为。

## Acceptance Criteria Evidence Map

下表按 Product Spec 的 14 项 AC 保留最低充分的组合证据。它没有把输入、入口、连接、
数量和平台做付费笛卡尔积；没有具体风险的重复组合不是追加验收门。

| AC | 最低充分证据与结论 | 保留边界 |
| --- | --- | --- |
| AC-01 | `@CreateImage` 接线、自然语言 Agent 规划、真实 Wan 结果、负例与歧义澄清组合通过；R-18 修复后的本地 SSE/provider 回放证明同轮普通文字和图片卡可以并存 | 自然语言真实参考图验收的初始隔离脚本删除了 native writing 字段，故该次只证明规划→Wan→图片卡；R-18 无外部请求的回放补集成接线，不证明真实文本模型与 Wan 同轮输出质量；研究中的 ChatGPT 入口也不作为证据 |
| AC-02 | 纯文字、外部主动添加合成图、vault picker/精确引用及真实参考图生成通过；未选择图片的来源守卫由聚焦测试覆盖 | 不外推未授权图片或任意 URL |
| AC-03 | 新图/较早版本精确父链、真实旧版本编辑、透明输入确认和白底副本流程通过；原文件 hash 不变 | 早期一次白底副本编辑没有 parent，只作端点证据 |
| AC-04 | Desktop 放大、复制回 Chat、原文件下载 hash 通过；指定 iPhone 的放大、复制、导出也通过 | 其他移动系统未测 |
| AC-05 | 复用连接、独立连接、聊天 provider 切换保持、明确不兼容提示和真实独立连接调用通过 | 其他区域/账号未测 |
| AC-06 | 旧设置迁移、独立密钥、两入口统一连接及 Featured Image 真实生成/callout 插入通过 | Chat 参数没有替代 Featured 默认值 |
| AC-07 | 默认一张、多子请求预算、拒绝隐式合并/第三子请求、部分成功与实际计数回归通过 | 没有为排列覆盖追加真实多图付费调用 |
| AC-08 | 在途任务期间新文字轮、New Chat/History 切换、原卡更新、焦点与草稿保护通过 | provider 与跨会话由组合证据覆盖，无重复付费矩阵 |
| AC-09 | prepared/running/saving/completed/stopped/unknown 状态、停止竞态和实际 provider 状态一致；无远端取消时不宣称远端取消或免费 | 未真实命中 Wan `PENDING` 取消 |
| AC-10 | 未提交、已有 task ID、saving、unknown、stopped、过期、连接变化及 plugin reload 恢复通过；恢复没有新 submit | reload 不是 OS 崩溃矩阵 |
| AC-11 | 本地原件、临时 URL 失效补链、版本/AI 来源和历史重开通过；指定 iPhone 历史正常显示 | 不承诺跨设备聊天/任务同步 |
| AC-12 | 每次选目标笔记、迁移/插入去重、清缓存、正式附件保护及 R-16 删除语义通过 | 删除聊天清元数据但只留图片文件；同步排除不夸大 |
| AC-13 | 首次披露、物理发送前来源再验证、撤回/失效、日志脱敏和事实隔离通过 | provider 仅收到各次明确授权的合成文字/图片 |
| AC-14 | Desktop 实际交互、CLI mobile simulator、Featured 回归及指定 iPhone 的系统导出/剪贴板最小案例通过 | 真机结论只覆盖该设备正常路径；移动重定向拒绝仍为源码测试 |

## Provider And Artifact Evidence

所有真实调用均使用获授权的合成素材。Agent 侧累计 **5 次 Wan 成功**：4 个 Chat
任务和 1 次 Featured Image；最后一批另有恰好 **8 次文本请求**。Owner 在手机上的
手动验收不计入 Agent 的 provider 授权/调用计数。

| 用途 | Provider / 本地身份 | 输出与 SHA-256 | 证明范围 |
| --- | --- | --- | --- |
| 初始文字生成 | Chat task `08e3f3c1d90f4928b06b657c487c2c5a`；当前记录未保留对应 Wan provider task ID | `img_792bf0bb098c41939c40af5c52d141cb.png`; `3c1b43d092dcdd9b27bb25447ff44b99e48cfb7641a59f5bed74f0f7cd2fb59c` | 文字到图片、异步查询与本地保存 |
| 早期编辑端点 | Wan task `0cc041da-8718-4d7f-8d23-239a1ed594ae` | `img_1e5cd66fed164cb1ad30fd1dc232f348.png`; `281bce64349e0ba29ca79b6751ee5b46876ea274be1d4dc2b4a21e4593a1b800` | 白底合成输入编辑；输入 hash `8e23fbe53ec22ff7e80c5a99c5e813ac3f9b6b3cc19b05fde3369ac04b95a531`，不证明父版本 |
| R-14 正式父版本编辑 | Wan task `7fcb2aeb-9ce9-44bb-bb30-a14616c87d47`; Chat task `d1bab61fbe744233a0aa279686009103` | `img_cb811579905f445eb9a7fccdb17eb3dd.png`; `0610cb893c541ad6d1af5f74aa172349779d049dd8bb1745aba4c88947ca4eb3` | 先确认、白底副本、确切 parent 和原图不变 |
| 自然语言参考图 | Wan task `26194927-73ee-4c93-9809-768133b69218`; Chat task `b285f448a48b4d6a92e68b2bb61fa3ab` | `img_15036119862e4ab481779d142dc1fb7b.png`; `6cb61185462b7d66b78525d2c143ca5a6c555578a8b0e29e5eebd1208d110fec` | 外部合成参考图、自然语言规划、独立连接和图片卡；初始隔离脚本删除 native writing 字段，因此不证明普通文字回复集成或真实模型端到端输出质量 |
| Featured Image | 同步接口，无异步 provider task ID | `b964e39e-f23c-4238-9595-2ee0a4ecbfcb_0.png`; `24d2f4ebdbec026e8c09f9c89ce2e50d51aaf00c48d8822e4f12842f9721e1d5` | 独立连接、既有 Featured 流程和 callout 插入 |

## Critical Findings And Migration Constraints

- **R-14，透明编辑输入。** 原始纸鹤 PNG 含少量透明像素。实现先说明限制并暂停，
  用户确认后才制作本次使用的白底不透明 PNG 并提交；未确认/停止时没有生成 POST。
  原始文件和已有输出保持不变。不能把早期一次性测试授权当作产品默认授权。
- **R-16，删除聊天。** 删除会话/对应内容会清除生成任务、版本、提示词和输入来源
  元数据，只保留图片文件；已迁移的正式附件和笔记引用不会被任务清理误删。
- **R-17，SecretStorage。** 初版独立图片密钥 ID 使用 `:image` 后缀，会违反宿主
  SecretStorage ID 约束。修复先给 vault scope 加图片标记，再复用 token ID 归一化，保持
  64 字符范围内的独立槽；实际写入/读回、独立参考图和 Featured 调用通过。
- **R-18，新会话身份。** 初版在新 Chat 首次生图时，图片提交已建立会话而原生文字
  writing context 仍绑定 `null`，导致 `Writing context unavailable`。修复在创建
  writing context 前预留会话 ID，只允许同一轮从 `null` 收敛到该确切 ID；其他会话、
  旧父版本、来源变化和已结束轮次守卫没有放宽。修复后的 Desktop 本地 SSE/provider
  回放为 `calls=2`、`submits=1`，任务 `3fa05308f37c414abdf9885c1f4dc7e0`
  完成，图片卡和普通文字回复同时可见；隔离会话、任务和替身已清理。
- **IndexedDB v3 回退边界。** v2 记录升级到 v3 后仍保留；升级被阻塞或中断时安全
  失败并可重试。但旧 v2 客户端再打开 v3 数据库会得到 `VersionError`。因此证据只
  证明数据与升级语义，不证明安装旧插件后 UI 可以正常回退。
- **R-12 移动网络。** 指定 iPhone 的正常生成、下载与保存路径已通过；重定向响应
  必须拒绝导入仍由 source test 证明，未在真机上人为构造重定向。

## Owner-Reported Mobile Manual Acceptance

以下结果由 Owner 在 **iPhone 15 Pro Max**、安装提交 `c66a098` 后手动反馈，
不是本代理的真机观察。Owner 未提供 iOS 版本、Obsidian 版本、手机安装包或
`main.js` 文件 hash、M-02 的 hash 原值或截图；Linux / Desktop test vault 的部署
产物 hash 因此不能冒充手机构建字节已独立核验。这些缺失不改变本次正常路径的通过
结论，也不能由本文补造。

| Case | Owner 反馈 | 结论 |
| --- | --- | --- |
| M-01 | 生成、保存、放大全部成功，符合预期 | 指定设备的生成、结果卡、保存与放大正常路径通过 |
| M-02 | 原图与导出文件 hash 一致 | 指定设备导出得到原文件字节；hash 原值未提供 |
| M-03 | 打开系统导出后取消成功 | 未出现错误成功反馈或异常文件的报告 |
| M-04 | Chat 与系统备忘录复制粘贴均成功 | 图片剪贴板及 Chat 粘贴入口在该设备通过 |
| M-05 | 历史正常显示 | 本地历史结果在该设备可重开查看 |

Owner 报告“未发现问题”。该反馈关闭 **F-06** 与 **R-12** 在这台设备上的正常路径；
不外推 Android、其他 iPhone/iPad、其他 iOS/Obsidian 版本或不同网络环境。

## Evidence Retention And Final Boundaries

2026-09-19 Owner 的手动反馈满足先前“通过之后再进行 B-133 收尾”的条件授权。
稳定行为、28 项讨论细节和 14 组 REQ/AC 已进入当前 Product Spec/Architecture/使用指南；
Feature Home、SDD、Tracker 吸收后删除，完整原文可从 `c66a098` 恢复，处置登记于
[Disposition Log](../disposition-log.md)。没有剩余实现事项转入 Backlog。
本次文档门禁为 `npm run docs:check`（链接/生命周期检查，仅 4 条既有 episodic-memory
advisory）、`npm run test:docs -- --runInBand`（2 suites / 58 tests）
与 `git diff --check`，均自然退出通过；未修改 runtime，未重复生图或代码全量门禁。

代表性 Desktop/simulator 回执曾保存在
`/tmp/pa-b133-natural-reference.png`、`/tmp/pa-b133-featured-inserted.png`、
`/tmp/pa-b133-native-after-fix.{json,png}`、`/tmp/pa-b133-batch-evidence.json`、
`/tmp/pa-b133-r14-*.png` 和 `/tmp/pa-b133-cross-*.png`。`/tmp` 路径只便于同机复核，
不是跨机器持久证据；本文保留可迁移的 task ID、hash、观察结论和限制。

没有未解决的实现 finding。未实测的 Wan `PENDING` 远端取消、其他区域/账号、其他
移动平台和旧插件 UI 回退不构成本次实现缺陷，也没有被写成已经通过。后续 master
集成、beta/stable 发布及其各自门禁仍需单独授权并在对应最终输入上执行。
