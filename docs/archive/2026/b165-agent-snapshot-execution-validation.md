# B-165 PA Agent 快照执行与完整 Debug 最终验证

Document status: Archived
Recorded: 2026-10-08
Work item: B-165

本页紧凑保留事故诊断、最终验收与证据限制，不作为当前实现或执行状态权威。
稳定行为见 [DEC-055](../../product/decisions/dec-055-agent-snapshot-execution-and-debug-history.md)、
[Product Spec](../../product/specs/pa-agent-snapshot-execution-product-spec.md)；实际机制见
[Agent architecture](../../architecture/pa-agent-architecture-plan.md#source-and-trust-boundaries)
和 [Debug architecture](../../architecture/pa-agent-debug-view.md)。

Owner 已授权按收缩方案完成开发测试、必要隔离部署，并在验收后明确授权 B-165
closeout 与本地 master 提交。T-01–05、八项 REQ / 七项 AC 和独立审查均已完成，
无未完成开发测试项转入 Backlog；不以此记录证明远程推送、发布或生产 anthelion 部署。

## 事故诊断与历史边界

最初诊断基线 `4e57a31d`、安装 PA 2.10.6；实施基线 `b6d6da2d`。
标签工具实际扫描 1,859 篇元数据，后续回答继承 1,861 个来源依赖；这不是全文外发数量。
B-155 的异步扫描与批次准入复用仍有效，本次命中的多阶段内部证据重处理和每 chunk
guard 在旧修复之前已存在，属于其未覆盖路径，不能将两次现场冻结认定为同一具体调用。

同一任务 turn_21 的准备记录为 13.685s / 13.644s / 58.284s / 137.512s。
最后一段在 14:07:02.590–14:09:20.102，HTTP 于 14:09:20.182 发出；
`provider_source_prepare:start/end` 为相邻 seq 2105/2106，没有子段记录。
安装 `main.js` SHA-256 为
`cf2a532c029b1ab21c4e95cc683d807f7d00fa00d82a35dc2478f478a5cdb644`，关键入口存在。
因此该段属于本地发送前准备，不含该轮 HTTP 等待、流式接收或另一次 Agent 推理；
精确内部耗时分摊、完整量级及连续冻结时长不可恢复。

| 当时入口 | 确认的工作与已实施覆盖 |
| --- | --- |
| vault `binding.prepare` | 路径/索引复核，transcript/history 排序、复制、完整 canonical 序列化与比较；已移除旧生成快照的重复证明 |
| management `binding.prepare` | 没有 Memory 管理合同也复制 transcript、筛选管理结果、同步全量比较；已取消这条无必要处理 |
| `prepareInputCurrent` | transcript 双遍投影、各消息继承来源复核、history/provider 重组与 union lineage 准入，再重复 vault canonical；本轮准备结果复用，不再重入这些旧快照步骤 |
| `assertAnswerVaultCurrent` | 再查 epoch、同步 provider JSON 比较；该固定输入一致性证明已删除，取消和实际动作边界保留 |

真实源码算法的 Node 22 合成诊断分别证明同步独占与切片 wall 等待：14 条消息各继承
1,859 来源时内部结构从 9,739 B 增至 1,556,851 B；无管理合同的 management 准备
约 78.65ms、零主动让出；canonical 约 1.854s、1,170 次 timer 让出；真实
TaskSourceRun/SourceAccess/DataBoundary 的一次热态重投影约 1.459s、79,937 次边界
判断、239,811 次 metadata 查询、658 次让出，union 准入另有 7,436 次判断。
这些是机制证据，文件/缓存为内存替身、epoch 固定，不能乘算成事故 137.512s 或
解释其百分比。历史缺口无需通过新增遥测框架或重现同样时长补齐。

## 最终行为验收

| AC | 已接受证据 |
| --- | --- |
| B-165/AC-01 | 真实 runtime 的受控生成途中改配置、编辑/删除源，当前响应与交付继续；同轮 retry/fallback 原输入不变 |
| B-165/AC-02 | 下一 loop 实际 payload 移除新排除原文、参数、助手历史及摘要；真实模型自主读取允许的替代笔记，见下节 |
| B-165/AC-03 | 元数据统计保持；相同包装/发送/重试不重准备，不重入 vault/management/canonical/provider JSON 的旧快照证明；无配置变化不随 loop/chunk 重查旧来源 |
| B-165/AC-04 | 完整文本、返回 reasoning、工具参数与结果写入本地历史；真实 store 重开完整，后改来源不清理历史 |
| B-165/AC-05 | 老历史、媒体引用/指纹、真实容量缺口、单大项和慢写、明确删除/Forget/迟到写入均有回归；原生回收改善见下节 |
| B-165/AC-06 | 连续 ready chunks、Debug 关/开、逐次原生 new tab/切换/编辑/命令、最终保存/flush、详情分页、生成中 Stop 与实际 mobile simulator 通过；终末一次 344ms 保留，不承诺零延迟 |
| B-165/AC-07 | Writing/Operations/图片/明确删除回归保持；durable Forget 同步通知独立 Writing style owner，普通配置变化不误作 Forget；Ghost 有限闭合事实、重放与未知效果边界独立审核 |

GPT 按 Owner 明确要求直接实施；运行与 Debug writer 分工，独立 reviewer 未参与写入，
root 统一执行昂贵门禁。修正基于实际反例，复用既有 loop/helper、timer、writer 和事务；
未增加通用权限缓存、worker、日志平台或跨事务回收恢复机制。

## 应用与模型证据

使用 Obsidian 1.14.4 的隔离 profile、进程/socket、native window 和 repo test vault；
CDP 操作前核对 vault `/mnt/code/personal-assistant/test` 与 userData
`/tmp/pa-b165-host/config/obsidian`，native window ID `115343364`。
没有操作日常 anthelion 或共享 profile；用户在隔离窗口手动配置 Secret，未显示其值。

### 大正文与输入响应

同一 1,902 来源、4,096 连续 ready text chunks / 122,880 chars，受控 SSE 使用实际
SDK/Runtime/tools/store；原生鼠标/键盘操作，每次记录 request→visible、焦点和数量，
最多创建 12 个临时 tab 后重复切换既有 tab，不靠 CLI 创建 tab 代替真实输入。

| 结果 | Debug 关 | Debug 开 |
| --- | --- | --- |
| streamLLM start→end | 10.546s | 12.568s |
| 最终渲染 / 历史保存 wall | 115ms / 326ms | 101ms / 356ms |
| 受载 new tab 最大 / 空闲最大 | 66ms / 68ms | 98ms / 75ms |
| 生成中既有 tab 切换最大 | 174ms | 217ms |
| 完整 DOM、canonical、历史 | 4,096 行，完全一致 | 4,096 行，完全一致 |
| 响应期间 source path 热检查 | 0 | 0 |

Debug 关的一次终末渲染/保存期间 tab 切换为 344ms；含坐标查询等待，记录中没有隐藏。
Debug 开的 2,019 次 metadata 调用不能归 PA chunk guard：保存的 caller 样本均为
原生 Quick Switcher `getSuggestions→updateSuggestions/onInput`，关的 metadata 热调用为 0。
每次 new tab 只增加一个并正确聚焦，无阻塞后多标签集中回放。

Debug 开的 final flush 2,319ms 期间持续观察原生输入，标签切换最大 217ms；
命令面板 61ms、Quick Switcher 32ms、note 切换 106ms、实际编辑保存 73ms。
Debug 打开 177ms、展开 62ms、分页 63ms，显示 16,384→32,768 chars；新 store
重开保留 output 122,880 chars、reasoning 1,462 chars、原始工具输入与 tags 结果，
4,212 events / 4,626,002 accounted bytes、completed/no gap。

实际消费 148 chunks / 4,440 chars 时原生 Stop，196ms 显示结束，部分 DOM/历史一致且
明确未完成；后续 new tab 68ms。启动前 0 chunks 的取消不作为该项通过证据。
CLI mobile simulator 确认 `emulate-mobile is-phone is-mobile`、实际 viewport 390×844；
原生 Send 未遮挡，32 chunks / 960 chars 完整显示/保存，Debug 121ms 打开，动画完成
后的布局正常，错误捕获为空。这不是 iPhone 硬件证明；首次被 Electron 忽略的 CDP
metrics 与动画中截图是 fixture/观察时点问题，实际调整自有窗口后完成验收。

初次 Chat 合并方案仍有 75.913s stream、最高 1,205ms 后半程切换，未判通过。
CPU 命中原生长字面段落自动链接反复扫长尾、HTML concat；严格子集的等价输入保留
同一 public renderer、sanitizer、postprocessors、owner/path 和原文，strict true/false
原生完整 HTML/text 对照一致，102,400 chars 解析 1,053.3→28.3ms。
随后 300–461ms 切换的 CPU 命中滚动帧/布局；既有 32ms 间隔在同步布局后延续，
最新结果见上表。Markdown、链接、实体等语法与未知换行配置仍走原输入。

### 回收与真实模型更新取材

原生 IndexedDB 同一 20,000 events / 64 contents / 9,841,226 bytes：同一原子事务
改为两次子项 key-range 删除和一次 run 删除，请求 20,065→3、enqueue 207.3→0.2ms、
timer gap 231.4→15.1ms、prune wall 2,973.6→373ms，剩余 run 0；只删除自建探针 DB。
相邻 run/vault、转义身份、多个分段、事务回滚与迟到写入回归保留。

配置的 Qwen / glm-5.3 实际模型先成功读 A，随后排除 A 目录；下一轮实际输入移除
旧正文，Agent 一次重读 A 被当前读取准入拒绝，再成功读允许的 B，最终正确回答 B 日期。
共 4 次物理请求，Host 未强制追加分析轮；模型将首次成功读取叙述为失败，这一叙述错误
照实保留，不宣称完美工具路径或总体成功率。重开 store 仍有 A/B 原始结果、completed/no gap。
该证据对应较早 bundle；后续仅 Chat 显示变化，运行/配置/Debug 源码未变，按输入复用。

局部原始证据在 `/tmp/pa-b165-host/`：`ui-smoke-off.json`、`ui-smoke-on.json`、
`ui-smoke-stop.json`、`mobile-smoke.json`、`mobile-smoke-settled.png`、
`model-recovery-result.json`、`reclaim-after-range.json` 和原生等价/CPU 诊断文件。
这些是本机临时产物，不承诺跨设备可用；本页保留可长期引用的条件、结论与限制。

## 检查、身份与处置

| 检查 | 结果与复用边界 |
| --- | --- |
| broad freeze 最终 gate | `make deploy` 自然 exit 0，平台 guards/lint/production build/完整 Jest/test 部署；380 suites / 9,160 tests，667.167s。Jest 一秒退出提示后自然退出，未 forceExit |
| 最新窄 Chat 修改 | `npm test -- --runInBand __tests__/chat-view.test.ts`，378/378，7.782s；包含字面段落 19 个边界、4,096 片段完整/取消、首段即时及同步布局 100ms 后仍留间隔的时序回归。类型、scoped lint/build、diff、DOM scan 通过，独立只读审核通过 |
| 文档合同 | 2 suites / 57 tests，7.418s；实施收尾 `docs:check` 274 Markdown / 3,581 local links 与 diff check 通过。结项仅文档变化，复用源码、构建、应用及文档合同测试，不重复运行 |
| 结项文档 | `npm run docs:check` PASS，272 Markdown / 3,583 local links，自然 exit 0；`git diff --check` PASS。Active 入链已清理，仅存紧凑证据与当前契约 |

broad bundle SHA-256 为
`76528be1b88d60962cf3d7ebe33748f2ad624bcfa6931effa1e6b623f821fbf1`。
最新应用验收 bundle SHA-256 为
`808f8c31f7177902c2ac1f6d74ccdc76085443a26e9e43a5c6aeb3fd7c0b9b55`；
后续局部 Chat 修改补上述近邻/type/lint/build 与最新应用，未声称完整 suite 在该 bundle 重跑。
日志分别为 `/tmp/pa-b165-final-gate4.log`、`/tmp/pa-b165-scroll-settle-focused.log`。
早期失败、模型叙述错误、历史时长缺口和终末 344ms 均保留，未降低正确接受标准求 PASS。

验收后的源码/测试按实际耦合提交到本地 master：
`987d7ce643b5d87ddf5ea9f9b46d34b6bb895527` 为快照/完整 Debug，
`a41c4b61de4a5d4d48642863b894b564b593f6ef` 为 Chat 响应修复，也是本次最终代码末端。
提交过程未修改已验收源码或测试输入；文档结项另作独立提交，不以本地提交证明远程交付。

结项将稳定设计吸收入当前 Product/Architecture，移除 Active 入口，删除未提交的
Feature Home/SDD/Tracker，不归档完整过程包、不声称 Git 已保存被删的完整草稿。
精确清理自建 1,902 文件，剩余 0，原始 Debug A/B 文本仍保留；恢复窗口桌面尺寸、
关 CLI debug/mobile、PA Debug=false / Memory=true，重新加载清除合成 transport/hooks。
用户手动配置的 Secret 仍 present/ready，最新资产未变，隔离 profile 和证据保留。
历史 137.512s 精确分项是不可追溯的证据限制，不是未完成实现；若生产再出现可观测
长阻塞，再从新的现场证据启动定向诊断，不增加常驻流程。
