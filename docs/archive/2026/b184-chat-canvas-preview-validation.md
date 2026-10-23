# B-184 Chat Canvas 最终验收

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-23
Work item: B-184

本页保留产品取舍的真实反例、最终验证与证据限制；当前行为由
[DEC-073](../../product/decisions/dec-073-chat-canvas-preview-native-open.md)、
[Product Spec](../../product/specs/pa-chat-canvas-preview-product-spec.md)及
[Architecture](../../architecture/chat-canvas-preview.md)持有。

## 授权与处置

Owner 先选择生成时预览、打开最新文件、可改默认路径与一次“保存并打开”，随后授权
按 B-184 完成开发测试。2026-10-22 两次明确修订分别为“预览跟随原生解析，原始 JSON
原样保存”和图片渲染不受来源准入拦截；非图片与模型来源边界保留。2026-10-23 明确
要求“收尾 b-184，然后提交到 master”，仅含本地签名提交，不含推送或发布。

全部九组 REQ/AC 和已确认 review findings 已完成必要验证，无本范围未完成项需转
Backlog。稳定行为吸收到当前契约和回归测试；删除 Active 入口、Home、SDD、Tracker
及已吸收的演示原型/截图，处置见 [Disposition Log](../disposition-log.md)。原型的
9 项通过只是模拟 UI 证据，从未作为插件验收。未提交过程原文和终态 Tracker 备份于
`/private/tmp/pa-b184-closeout-20261023-kcexz3sa/`，不声称旧 Git 可恢复完整过程。
B-124 在 B-184 开发期间临时让位为 Next；2026-10-23 B-184 收尾并合入远程 master
后，恢复 B-124 原有 Now，保留远程 B-187 的 Next，不推进或宣称其他 track 完成。

GLM 经 pa-glm / ZAI 完成 bounded 调查；实施 session 在明确周/月额度错误后自然
exit 1，未交付最终结果。按既有授权由 GPT 接管，原草稿和有效证据保留；源码/存储/
资源边界由非实现者交叉复核，主控统一集成和 app 验收，不把接管称作 GLM 成功。

## 确定性验证与复用

集成基线为 master `43050df2`。收尾开始时已核生产构建输入匹配；本次更新文档并在
暂存检查后移除 `canvas/types.ts` 的一个多余 EOF 空行，运行逻辑和测试未变。该纯空白
清理不影响下述行为证据；复用原构建/测试/app 验收，不为提交重新构建或部署。

| 范围 | 已观察结果与限制 |
| --- | --- |
| 最初完整 gate | 完整 lint、生产 build（TS/Tailwind/esbuild）、DOM scan 与 diff 检查通过。原全仓 Jest 自然 exit 1：407 suites PASS / 2 FAIL，9817 tests PASS / 46 FAIL；不能称为全仓命令全绿 |
| 原失败诊断 | plugin-record-note 缺真实 registerEvent mock；Ghost loopback server 被 sandbox EPERM 阻止。修真实 mock/事件集合断言并允许受控本机服务器后，原失败项及 UI 共 3 suites / 428 tests PASS；未弱化正确断言 |
| 最后 review-followup | storage/parser 2 suites / 30 tests、UI 1 suite / 10 tests、资源/Share Card 2 suites / 33 tests，共 73 PASS；有目标红灯与修后绿灯，独立 reviewer 复用原日志，不重复执行 |
| 当前构建与部署 | 完整 lint、production build、2 suites / 61 artifacts、deploy-current PASS。首轮 build 两处类型接线修正后通过；行为未改，复用测试。部署验证资产身份，不代替测试成功 |
| lint 环境 | 未改的大纹理文件导致默认 Node 栈溢出；沿原完整 ESLint 范围使用 `--stack-size=8192`，没有改规则或排除源码 |
| 修复覆盖 | 历史同阶段旧快照/assistant 身份/同会话窄事务；恢复路径 scheme；异步 owner settle 后清理；偏远坐标 Fit；CRLF 原文保真；原生图片展示与非图片反例；Share Card 默认行为兼容 |
| 收尾检查 | docs:check 与 diff check；文档 checker/fixtures 未变，复用既有 2 suites / 57 tests 的文档工具契约结果 |

原始开发/全仓/桌面/移动证据在 `/private/tmp/pa-b184-dev.3ckejizr/`。
最后修复原日志分别在 `/private/tmp/pa-b184-storage-followup.m2JP6GMx/green-final.log`、
`/private/tmp/pa-b184-ui-followup.m0aLhU/green-suite.log`、
`/private/tmp/b184-image-policy-focused-final.log`；最终 build/artifacts/deploy/app 与恢复
回执在 `/private/tmp/pa-b184-followup-final/`。失败和中间结果保留，临时日志不是运行依赖。

## 原生路径与图片取舍

真实 Obsidian 1.14.4 首次保存到 B 目录时，文字 `![](./image.png)` 未按 B 解析；旧
“跟随拟保存目录”预览显示 B 图，原生却显示 A 图，原验收为 FAIL。独立 bundle 核对
文字 owner 的 file=null/sourcePath 空串，文件节点另有 Canvas 路径，公共 API 没有
文字上下文 setter。该静态事实未用来调用私有 API，也不外推其他版本。

Owner 选择跟随原生并原样保存后，同一 vault 状态下 Chat/原生指向相同资源；改变
目标 A→B 保留 raw/视角/文字引用，嵌入笔记仍用自身路径。同名候选可能随宿主状态
变化，不承诺永久选中 A 或 B。旧 FAIL 不回填为 PASS。

后续审查按旧 REQ-08 把引用式图片漏扫列为 P1。Owner 明确认为图片展示合理，因而
改为统一原生展示的窄例外；不是宣称旧 Data Boundary 只约束模型。旧六类资源全拒绝
的零读取证据保留为旧策略历史，新策略另行验收。网页正文/iframe、非图片和模型来源
仍保持原边界；远端图片请求是允许的实际网络效果。

## 真实交互与证据边界

| 场景 | 观察与结论 |
| --- | --- |
| 桌面保存与原生编辑 | 从真实 History 入口加载，预览不创建文件；一次保存在受控 native open 失败后 createAttempts=1，重试成功。创建前后 raw 字节一致；原生加文字、移动卡片/分组、连线、Undo/Redo、重开最新内容通过，Chat 不反写 |
| 最后图片/Fit 差量 | 真实来源排除同时拒绝夹具图片/笔记；图片在引用块文字、file、group 背景正常显示，多行引用 HTTP 图 naturalWidth=180，本机服务收到一次请求，同目录笔记只占位。真实 Zoom in → Fit 从 10040/10030/320/240 回到 10000/10000/400/300；fresh errors 0 |
| 移动主体 | 官方 CLI mobile simulator + 390×844 单触点覆盖路径、缩放/JSON、保存、新 native tab、原生缩放/Fit与返回 Chat。core 打开后可能重写尺寸/默认值；原样保存只承诺 PA 创建边界 |
| 最后触控平移 | 工具仅发送 down/up，没有 move，不能证明平移。Owner 在同一模拟器明确报告“画布能平移，侧栏保持关闭”，作为单独人工通过证据；不改判工具结果、不称物理 iPhone 验收 |
| 宿主修复 | SVG tooltip 触发宿主 isShown 错误，改为 title/aria-labelledby 后实际流程无新增错误；HTML data-ignore-swipe 复用宿主侧滑边界，无第二套手势系统 |
| 环境恢复 | 原会话/笔记与策略恢复；mobile=false、1459×949、touch=0、debugger detached，预览残留0；自有夹具核对后移入可恢复 Trash，本机图片服务终止 |

早期隐藏窗口的 noWindowsAvailable 和菜单跨次工具输入失焦只记录为工具/现场限制；
后续恢复可见窗口及连续键盘操作完成对应验收。未增加模型采样、主题/媒体/设备全排列
或物理 iPhone 门。该记录证明本地实现与上述宿主场景，不代表 CI、推送或版本发布。
