# B-190 Ghost Publishing Reliability — Final Validation

Document status: Archived
Delivery status: Closed
Closed: 2026-10-28
Work item: B-190
Authority: 已完成工程范围的历史验收与证据限制，不作为当前实现或执行权限来源。
Current contracts: [DEC-053](../../product/decisions/dec-053-lean-ghost-publishing.md)、
[Product Spec](../../product/specs/pa-ghost-blog-publishing-product-spec.md)、
[Design](../../development/ghost-blog-publishing-design.md)。

## Outcome And Disposition

Owner 确认原发布失败由图片上传限额触发，缩小图片后功能可正常发布；随后批准可选站点
限额、分阶段事实、草稿顺序重试及根级原生横线。图片大小由程序判断，Agent 只转述；
失败重试接受重新生成 metadata、重复上传及无可靠 ID 时可能重复草稿，不增加确认或
持久恢复机制。已发布原文的人工确认边界保持。

B-190/REQ-01–04、AC-01–04 及审查修正已完成本地工程验收。2026-10-28 Owner 明确
授权文档收尾及本地 master 提交；这不包含 push、部署或发布。当前规则已吸收进上述
契约与 focused tests，Home／Plan／SDD／Tracker 删除；只保留本记录中的独有证据。
处置见 [Disposition Log](../disposition-log.md)。无待修实现 blocker；下述未观察项保留
为证据限制，不扩为新的模型、设备或发布门禁。

## Requirement And Evidence

| Requirement / AC | 实际保障与证据 |
| --- | --- |
| REQ-01 / AC-01 | exporter 回归验证根级标准横线生成原生节点，嵌套横线明确报真实来源位置；YAML、setext、代码与 `—-` 语义不改。R11 合成 Ghost 实际收到每稿一个根级原生横线，未声称真实编辑器／主题呈现通过。 |
| REQ-02 / AC-02 | settings／configuration／action-context／service 覆盖可选十进制 MB、换站清空、metadata AI 前 stat 预检及实际 bytes 复核；同站 URL 继续原有资源校验，仅免上传资源豁免站点限额。R11 应用超限场景零 HTTP，缩图后同加载实例可再准备。 |
| REQ-03 / AC-03 | service／controller／工具／runtime／history 覆盖图片与文章阶段、部分上传成功、413／timeout、保存后本地失败及闭合回执。R12 固定图片超限说明与旧消息兼容；R13 保留旧保守恢复回执，图片上传未知不误报重复草稿。 |
| REQ-04 / AC-04 | 实际 tool→Host→controller→service 集成覆盖新 scope、当前来源、删除旧嵌入依赖后重试及同 ID 最新版本更新；R13 加入 GET 临时失败再读。工具在途／成功缓存、目标／权限拒绝、dispatcher 批内去重与 unknown 窄例外保留；无 ID 未知 POST 可以重试并提示重复。 |

## Automated Validation

- R4：10 suites／450 tests 的定向证据通过，覆盖 exporter、设置／准备、service、
  controller／集成及 runtime／历史／Host。后续只重跑受变化影响的输入。
- R11 之前的完整 Jest 原命令自然 **exit 1**：395/397 suites、9548/9550 tests 通过。
  两项过时预期分别在 B-157 与 ChatService 定向修复，55／123 tests 通过；其余有效
  结果复用，不能改写为完整命令 exit 0。R11 lint、生产 build／TypeScript 与部署通过。
- R12：回执相关 3 suites／115 tests 报告 PASS，但外层 zsh 误用只读变量导致 wrapper
  exit 1；旧消息兼容条件收紧后，受影响 domain suite 30 tests 自然 exit 0。
  TypeScript／lint／docs／diff 通过，未重新构建、部署或运行真实模型。
- R13：已有集成先准确复现 GET 失败缺少 retry，再修复。新增夹具的异步等待、失败包络
  预期及无效资源替身问题经诊断校准；最终 5 个既有 suites／165 tests 自然 exit 0。
  独立验收发现可选字段与新夹具类型问题，收窄并补回原成功缓存断言后，工具 suite
  43 tests 自然 exit 0，其余有效证据复用。主 checkout 的 TypeScript、lint、docs、
  diff 检查通过；DOM source scan 空输出 exit 1 为 PASS。Node PATH 缺失造成的127
  与产品／断言失败分别保留，进程 PATH 修复后命令自然退出。未新增测试文件或模型采样。
- 收尾仅整理文档，复用未漂移的已验收源码／测试；执行 `npm run docs:check`、
  `npm run test:docs -- --runInBand` 与 `git diff --check`，不重复运行产品全量门禁。

实现 writer 为已配置 ZAI／glm-5.3 的 Codex CLI，GPT 维护契约并独立验收；服务端实际
型号未单独核实。R13 首次调查为补齐消费者范围由 GPT 中断，后续实施及类型收口均自然
exit 0；不把主动中断记为成功交付。

## R11 Application Observation And Limits

Obsidian 1.15.0、repo-local test vault；已加载资产与部署产物 SHA-256 均为
`a6bcaf0afbc7418fb892f9f2baf367f50101a9c77de3fad847a10573be0e8293`。
模型配置为 qwen／deepseek-v4-pro；Ghost 使用本机合成服务，不是生产站点。

1. 5,762,138 bytes 超过配置的 5,000,000 bytes，工具／卡片事实正确，服务端请求为零。
2. 缩至26,483 bytes后，同插件加载实例、同请求连续两次 prepare；首次文章保存后丢响应，
   第二次成功，共2次图片上传、2次 draft POST、1次丢响应。两个草稿各有一个原生横线；
   卡片显示保存、已上传1图及可能重复提示，无新增确认。源正文不变，仅语义新增 GHOST_ID。
3. 首次观察揭示 dispatcher 仍按工具 success 包络拦截 unknown 重试；修正后上述连续
   场景通过。成功后的观察不能覆盖此前真实失败。

模型在超限场景仍把 body 图片大小误说为文章大小。这是历史解释失败；Owner 后续明确
图片大小由程序验收，故不作为限额功能阻断。R12 改进固定回执表达，**没有重新抽样，
不声称模型措辞问题已被实测消除**。

Open preview 实际触发 Web viewer 未启用提示；临时启用后自动化无法观察原生页面，
没有对应预览请求。真实 Ghost 编辑器往返、主题呈现及启用后的原生预览未验证。
R12／R13 未 build／deploy／app smoke，R11 资产不能证明后续版本已部署。
本范围未操作私人 vault、生产 Ghost 或正式上线；后续获得专用环境或出现明确呈现
回归时，再对受影响行为补验，不自动重启整套模型／平台矩阵。

应用观察后原 Chat／草稿／history pointer、活动页、Ghost 设置、权限、Memory／后台
发现与 Web viewer 已恢复，debugger=false、mobile不变；合成内容、假 Key 和临时服务
已清理。恢复记录 `restored=true`、`errors=[]`；未经批准的完整界面采集未作为证据。

## Local Evidence Provenance

原始日志保留本机，不纳入插件或 Git，也不把本机路径视为其他环境已有的证据：

- `/private/tmp/pa-b190-kBkdxG/`：R4–R11 定向／完整门禁日志；
  `app-final-{loaded-identity,oversize,retry,binding}.json`、`app-cleanup-result.json`。
- `/private/tmp/pa-b190-receipt-1zYyiD/`：R12 `focused.log`、`focused-rerun.log`、
  类型／lint／docs 日志及接收清单。
- `/private/tmp/pa-b190-review-fixes-scxdES/`：R13 `red-integration.log`、`focused.log`、
  `type-fix-b153.log`、`typecheck-final.log`、`lint.log`、`docs-check.log` 及窄增量接收清单。
- `/private/tmp/pa-b190-closeout-nnN28J/`：收尾前文档副本、终态 Tracker、文档检查及提交范围。
