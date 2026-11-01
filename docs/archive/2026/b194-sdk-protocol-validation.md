# B-194 SDK Protocol And Agent Boundary — Final Validation

Document status: Archived
Delivery status: Closed
Closed: 2026-11-01
Work item: B-194
Authority: 已完成 SDK 升级、兼容修复与收尾的历史验收证据；不是当前架构或发布授权。
Current contracts: [DEC-078](../../product/decisions/dec-078-sdk-protocol-and-agent-boundary.md)、
[Product Spec](../../product/specs/pa-sdk-protocol-agent-boundary-product-spec.md)、
[连接架构与 SDK 接缝](../../architecture/settings-status.md#sdk-接缝与恢复职责)。

## Outcome And Disposition

基线为 master `4160763b`，本项承接 `7dfd1777` 的 Terra 适配。Owner 确认 OpenAI
统一 Responses、Custom 固定 Chat Completions、其它服务复用 SDK，PA 保留结果与
harness 职责；后续明确授权开发测试、F-14 参数修复、F-15 重试修复，并于
2026-11-01 要求确认收尾、完成收尾和提交本地 master。没有推送、tag 或正式发布授权。

AC-01–08 已完成，F-01–15 已处理；F-13 的短等待 fixture 只能证明 hinted 路径，
其原兼容结论已由 F-15 的真实 SDK／图文回归取代。无本范围待开发项转 Backlog。
GPT 负责设计、文档、独立验收与真实应用检查；运行代码／测试由已配置的
pa-glm / ZAI `glm-5.3` / max 完成，未将其他模型称为 GLM。

稳定约束吸收至上述当前契约及 focused tests；Home／SDD／Tracker 按
delete-after-absorption 删除并移出 Active Registry。未提交过程原文保留在本机
`/private/tmp/pa-b194-closeout.0lZNym/process-package/`，不声称此前 Git 保存了该过程包。
本记录仅保留源码无法重建的服务实测、验证层次、例外处理与环境恢复事实。

## Requirement Acceptance

| Requirement / AC | 最终证据与边界 |
| --- | --- |
| REQ-01 / AC-01：OpenAI Responses／参数／图像 | 实际 SDK 请求覆盖 Sol 主模型、Astra Policy、Terra high；OpenAI 无 PA 温度／top_p 注入。生产工厂图像＋文字／允许历史请求通过；部署后的 Terra 图文 Writing 与 Sol 文字请求成功。Astra 只有确定性请求证据 |
| REQ-02 / AC-02：连接协议 | Custom 模型名、官方地址、bindTools／withConfig 仍走 Chat Completions；DashScope thinking 参数保持。真实 DashScope 和同一已配置兼容端点的 Custom 代表调用成功，不泛化到所有网关 |
| REQ-03 / AC-03：共同结果消费 | 实际 Memory／Pagelet／Ghost／提取等消费者验证文本块、字符串、拒绝与领域解析；普通工具 strict:false、Pagelet strict:true 分别保持。真实 AI Summary 保留原正文 |
| REQ-04 / AC-04：完成与效果 | SDK／Loop／原生 Writing／历史 ID 用例覆盖 completed、failed、incomplete、EOF 与取消；缺失终态不执行缓冲工具或交付成功写入。真实 Writing 工具接续、桌面／移动模拟 Stop 有观察证据 |
| REQ-05 / AC-05：准入与恢复 | 每次物理请求重新准入，来源／身份撤销、取消、未知效果不重放保持。F-15 覆盖无提示429退避、HTTP／真实SSE无status额度停止、图文恢复一致及脱敏；当前插件离线四场景通过 |
| REQ-06 / AC-06：数据策略 | 实际请求 store:false，无 previous_response_id／远端会话链；保持当前来源、凭据与权限 owner。无新增 Memory 调度、遥测或隐式配置探测请求，实测仅合成材料 |
| REQ-07 / AC-07：默认与保存值 | 新建默认 Terra，旧4o-mini当前推荐退出；显式保存模型、用途、凭据、历史和价格证据保留。设置观察确认已保存 small 不改，新建 large 预览取消后仍为原两连接；embedding／Memory不随聊天迁移 |
| REQ-08 / AC-08：依赖、平台与交付 | 精确锁定 core1.3.2／integration1.8.0／间接openai7.47.0；安装模拟、披露、build、lint、分组有效测试、部署与独立review通过。发布、远端CI与硬件测试不由本验收推定 |

## Automated Evidence And Reuse

- 原始升级目录：`/private/tmp/pa-b194-implementation.nvJsau`。完整 `test:all` 实际执行
  401套件，首轮386通过／15失败，9660通过／89失败／9749总。失败逐项确认为旧fixture
  的协议／终态／阶段假设，修正15套后842例通过，再对两份类型修正复验333例与TS通过。
  其余386套件输入未变复用；这是覆盖全部401套件的分段有效证据，不是第二次全量全绿。
- fixture 修正保留 EOF、取消、length、来源、权限和副作用负例；公共迭代器不补虚假
  成功终态，不删正确断言。独立审查发现的 failed 补传、strict、provider身份和
  公共EOF夹具问题均修正。重复一次15套检查本可省，已停止扩测，不另建治理机制。
- `npm ci --dry-run`、第三方披露生成／核对通过（44运行依赖、19打包资源），platform
  guards、bundle audit、DOM source scan通过。可选 tiktoken.pages.dev 路径仍存在，
  原网络披露保留；没有改变安装资产布局。
- F-14：`/private/tmp/pa-b194-parameters.O4QuEs`。改前真实请求温度断言失败；修复后
  三个既有套件77例通过，build／lint／部署通过。原失败日志的shell误用了只读变量，
  只把实际失败断言当红灯，不以wrapper码冒充Jest码。
- F-15：`/private/tmp/pa-b194-retry.uQGg86`。实际 SDK、fallback、Loop、图文及真实
  SSE 额度帧先复现目标失败；R2四套291例自然退出0，最后 SDK false 标记修正后两套
  166例通过，等价测试类型修正后Loop136例通过。未把旧手造SDK fixture当作生产
  retry hook证据：工厂套件证明物理退避，b129证明runtime／Loop／图像边界。
- F-15最终 `build-final.log` 含 TypeScript／Tailwind／生产bundle通过。标准Node栈
  的lint在未改大型paper-data解析时溢出；按已证实环境限制，用2048KB栈执行相同规则
  和完整文件范围通过，没有排除文件／改规则。source scan无匹配退出1为PASS。
- 收尾仅改文档，复用以上运行证据，不重复模型请求、完整Jest、build或设备矩阵。
  最终文档门通过（354 Markdown／4632本地链接），文档契约测试2套57例通过，
  diff检查通过；50个运行／测试／依赖文件与收尾前内容一致。日志保存在收尾目录，
  不将这些结果称为新的运行或远端CI验收。

## Deployed App And Real Service Evidence

均为 repo-local `test/`、Obsidian1.15.0、实际生产资产部署并重载后的观察；
已有 Memory／Web／后台发现保持原范围，无私人笔记或凭据进入记录。

- Terra/high：真实UI添加128×64合成蓝红PNG，执行 `@Writing`。实际
  `get_writing_context` 返回空style与一个图像，草稿正确包含代号、日期及左右颜色；
  持久化completed turn、一份ai_generated WritingVersion与一张generationInput图像。
  未保存到笔记、未外部发布。证据为升级目录的 `smoke-owned.json` 及桌面截图。
- DashScope qwen3.6-plus返回合成标记／stop；同一已配置端点／Key临时按Custom
  策略也返回对应标记／stop，finally恢复providerId和绑定。只证明该兼容端点。
- AI Summary 为独立合成笔记写入摘要／标签，保留原正文。设置中已保存的Terra／small
  不变；新建OpenAI预览Terra／large后取消，无额外embedding服务调用。
- 桌面和CLI移动模拟各在部分输出后点击Stop，持久化aborted；取消未新增写作成果。
  不声称provider远端已撤销或零费用，未测试iPhone／Android硬件。
- F-14 Sol：当前插件工厂一条固定合成文字请求，官方 `/responses` HTTP200、completed，
  返回 `B194-SOL-PARAMETERS`；无temperature／top_p／previous_response_id，store:false。
  无笔记读取、工具或设置保存。证据为参数目录 `live-sol-result.txt`。
- F-15离线探针：当前插件实际工厂invoke的文字／图片headerless429各两次请求，
  等待1827／1920ms后completed；额度不足各一次即InsufficientQuotaError。四项通过，
  零真实provider请求。stream／Loop／脱敏由自动回归证明，不冒充整段UI或服务实测。
  证据为重试目录 `app-result.txt`、`app-errors.txt`、`app-restoration.txt`。

## Recovery And Remaining Boundaries

原活动笔记／leaf、Chat路由与空草稿、右栏、连接／用途、Memory／Web／发现配置、
已保存small／1024及provider均恢复；原升级16项比较全通过。合成会话、写作版本与
独立视图已清理，合成笔记走可恢复Trash；F-14/F-15没有新增会话或笔记。临时fetch
和全局探针移除，debug／mobile恢复false，各阶段未捕获新增应用错误。worker均结束。

保留原始日志与独有截图、过程原文副本、当前构建及test插件，供已引用证据追溯；
未遗留运行中的验证任务。没有在收尾时重做已验证交互，也没有清除用户数据。
没有本范围未闭合需求；后续 SDK 升级应重验 protected接缝、failed补传和重试分类。
新provider／Custom Responses／远端会话仍按DEC-078重开条件处理，不提前建设框架。
本地收尾与提交不是正式版发布，远端CI和正式发布门仍在各自阶段处理。
