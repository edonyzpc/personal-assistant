# B-193 README Experience — Final Validation

Document status: Archived
Delivery status: Closed
Closed: 2026-11-01
Work item: B-193
Authority: 已完成改版及另行授权 OpenAI 调整的历史证据；不代替当前行为契约或发布授权。
Current contracts: [GOV-007](../../development/governance/gov-007-readme-experience.md)、
[连接设置](../../architecture/settings-status.md)、[连接产品契约](../../product/specs/pa-multi-provider-connections-product-spec.md)。

## Outcome And Disposition

Owner 于 2026-11-01 明确要求确认收尾条件、完成收尾、提交 master 并推送远程。
B-193 必需文档、三场景、真实素材及测试环境恢复已完成，最后两项成品问题已修正。
稳定内容保留于双语 README、Manual、公开示例、历史演示、网络披露和 GOV-007。
Home/Plan/Tracker 吸收后删除，移出 Active Registry；本记录保留不可由源码重建的
验收、素材来源及恢复事实。无本范围未完成实现项转 Backlog，不包含正式版发布。
未提交过程原文保存在本机 `/private/tmp/pa-b193-closeout.HIpRlK/process-package/`，
不声称旧 Git 已保存该过程包。规划分镜仍作为 GOV-007 的设计示意，不冒充产品截图。

README 原范围是文档和素材；Terra 默认与 API 修复、reasoning high、embedding large
分别来自后续明确授权。产品接线与说明一起交付，不以 README 任务自行授权运行变更。
GPT 负责文档、真实应用验收和独立接受；配置的 pa-glm/ZAI/glm-5.3 完成附加源码与
定向测试。2026-11-01 复审及局部修正复核均为独立只读检查，未重复模型采样。

## Requirement And Evidence

| Requirement / AC | 最终证据与边界 |
| --- | --- |
| REQ-01 / AC-01：首次理解与后续入口 | 双语类别、受众、主行动、首次成功核对及三种独立后续需求齐全；未把30秒／2分钟目标记作用户实测 |
| REQ-02 / AC-02/07：真实场景与公开输入 | 下述 Chat、Memory、Pagelet 均从公开英文虚构笔记实际执行，中文等价文本核对；非固定答案测试 |
| REQ-03/04 / AC-03：能力与信任 | 当前源码复核能力、依赖、退役／规划状态；配置前披露默认后台准备、数据、费用和控制；图像与 Ghost 边界准确 |
| REQ-05 / AC-04：图文 | 四张新采集图及同原片两处局部；原A1窄屏不可读已修正，不能将原无横溢结果当作可读性证明 |
| REQ-06 / AC-08：版本一致 | 以 bfe02fff 加获授权 Terra 修复的实际构建采集；源码构建路径和未发布差异清楚，不冒称旧商店包包含新界面 |
| REQ-07 / AC-05：披露连续 | 手册、法律、工程、上游致谢与历史入口保留；Quick Capture 模板 owner、Pagelet 设置名称按源码修正 |
| REQ-08 / AC-06：范围与恢复 | 无合作标识、遥测、外部媒体上传或 Ghost 发布；测试状态与单条原索引恢复有实际证据 |

## Real Scenes And Material Provenance

2026-10-31，Obsidian 1.15.0，macOS 桌面，英文／深色 UI，1×缩放。
源为 `master bfe02fffe9a63fcd64f70da69d61f9d64c058c8f + 获授权 Terra 修复`；
实际部署 main.js SHA-256 为 `0346ddd1af0c27e8ff888a377c70a075b8912900308f92d11e5a6b48cc288d81`。
仅使用[公开虚构示例](../../guides/readme-examples.md)中的三篇笔记；无私人内容或密钥。

- Chat：真实 My notes 请求，12959ms；`get_current_note_context(full)` 成功，回答区分事实、
  假设和建议，保留工具尚未决定，原笔记未改。会话 `998b3c14-38ba-4386-80d0-1ad5db50f4c3`。
- Memory：官方 OpenAI `text-embedding-3-small` / 1536 的独立演示 profile，3 files/3 chunks；
  17894ms，真实 `search_memory` 成功、3来源并打开 Practice record。会话
  `560bb186-3a35-4a9f-9998-66ce8d8ce680`。不声称这是后续 large/1024 默认的实测。
- Pagelet：Learning plan 发起发现，verified、3来源，打开 Practice record；Discuss in Chat
  后0轮、可编辑草稿、尚未发送。主动 Ask 后9041ms基于同一携带发现继续分析；4个
  `read_note` recoverable失败并有 `tool_batch_preflight_rejected`，未独立重读原文。
  README 如实披露，不为无警告素材重新采样。会话 `a7d745a4-1e36-4a76-b92c-f8c428cde68a`。

原片为2916×1898 JPEG。下列仅用 sips 矩形裁切／导出，无重绘、拼接或替换输出文字。
前四图采集于10月31日，两处首屏局部于11月1日从同一 Chat 原片裁出。

| 产物（docs/assets/readme/） | 原片与裁切 x/y/w/h | 字节 |
| --- | --- | --- |
| chat-note-context.jpg | chat-note-context-raw.jpg；136/140/2750/700；完整对照入口 | 246864 |
| chat-note-detail.jpg | 同原片；140/684/660/78；笔记未决事项 | 16268 |
| chat-answer-detail.jpg | 同原片；1680/500/660/118；回答及来源 | 18900 |
| memory-sources.jpg | memory-sources-raw.jpg；1662/275/1226/1060 | 244918 |
| pagelet-insight.jpg | pagelet-chat-prepared-raw.jpg；230/650/1380/1100 | 253325 |
| pagelet-chat-prepared.jpg | 同原片；1650/962/1245/850；发送前材料 | 122782 |

总903057字节；配置图、额外成果图、视频为按需／可选，已有静态路径足够，未制作。
原片与脱敏场景JSON保存在 `/private/tmp/b193-stable-scenes.rzp7zw78/`。

## Presentation And Recovery

- 原双语 README 在 Obsidian 阅读模式完成桌面与320×844本地预览；正文宽度无横溢，
  表格内部可横滚。中文明亮背景字体30px相对原16px约188%，不是200%浏览器缩放。
- 复审发现原2750宽A1缩至272px时关键文字不可辨。改为两张660宽局部上下展示，
  保留完整画面链接；272px素材预览能读出完整短句及来源，独立只读复核通过。
  本轮只改图片与Markdown，未新增GitHub／设备渲染证据。预览和检查日志位于
  `/private/tmp/b193-readme-polish.0kQLHt/`。
- 原范围、Memory=false、提取=true、自动发现=false、用途绑定、2连接、原笔记／
  会话／空草稿、主题／字号、debug=false、mobile=false均恢复；原13篇Markdown集合未变。
  3篇演示、2份预览及图片复制件核对后移出vault，公开示例保留。
- 范围变更曾导致原1024 profile中的单条合成测试索引被本地移除；未擅自全库重建。
  Owner明确授权恢复发送后，仅该篇通过既有small/1024连接恢复。原indexId和旧catalog
  保留，1条路径恢复，mutation epoch真实递增；原文未改。新增1536演示profile保持inactive。
  安全证据 `single-index-recovery.json` 等与原场景保存在同目录。

## OpenAI Validation

- Terra 400修复按官方API契约接入窄Responses adapter；仅确切官方端点／模型使用，
  沿用凭据、来源及取消保护，保留call_id；失败、截断或缺失终态不作为成功执行工具。
  未增加远端会话／推理缓存、依赖或产品权限。
- 修复阶段7 suites/158 tests通过；生产build含TypeScript通过。原lint在未改动的大型
  share-card-paper-data.ts解析栈溢出，同一规则以 `node --stack-size=4096` 完整执行通过。
  完整test:all实际400/401 suites、9736/9737 tests通过；唯一旧默认断言修正后对应
  plugin-lifecycle整个suite117/117通过，其余输入有效复用。没有第二次全量全绿或新coverage。
- 实际修复构建返回固定短句及原合成笔记目标文本，耗时6904ms／6973ms，真实当前笔记
  工具成功、原文不变；没有独立HTTP状态采集，不编造200。详见原日志目录
  `/private/tmp/pa-terra-responses.bdGE7M/`。此前旧4o语义失败不一概归因于API。
- 后续high：3 suites/71 tests和TypeScript通过，核对离线实际SDK请求体；只保留SDK最终
  参数中已有的effort，不承诺SDK的所有顶层参数写法均支持Terra。证据目录
  `/private/tmp/pa-openai-high-uxcas84z/`。
- 后续large/1024：3 suites/156 tests和TypeScript通过，真实SDK离线请求体覆盖新默认
  large及显式保存small；不迁移存量连接或索引。证据目录 `/private/tmp/pa-openai-large-pc9opq27/`。
  **high／large调整后未重新部署或实调API**；不冒充默认组合实测，不使已保存连接的素材失效。
- 文档契约2 suites/57 tests通过，后续未改变checker或fixture，复用证据。最后局部修正
  docs:check通过353 Markdown／4612本地链接；本次收尾另检查调整后的链接图。
  发现一次仅为tee落盘的重复七套测试，作为过程改进记录；不因此补测或扩展测试体系。
- 收尾docs:check通过351 Markdown／4602本地链接，diff及新增文本空白检查通过。
  首次检查发现已清空的Active目录仍被识别为缺文件的package；移除空目录后通过，
  未修改checker或降低要求。日志保存在 `/private/tmp/pa-b193-closeout.HIpRlK/`。

## Residual Evidence Boundaries

实际GitHub渲染、商店全新安装、陌生读者理解／计时、iPhone／Android硬件未在本任务验证。
这些边界已明确披露，不转化为未经需求支持的新门禁。Pagelet接续不证明重新读原文成功，
演示不证明任意模型、服务商或平台兼容。正式发布、发布后安装文案对齐和远程CI结果
分别取证，不能由本记录或本地检查推定。
