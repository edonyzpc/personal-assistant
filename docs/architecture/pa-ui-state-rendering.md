# PA UI 状态、原生正文与设备本地恢复

Document status: Current
Updated: 2026-10-20
Work item: B-181
Authority: 已交付 UI 状态、正文、恢复和宿主生命周期的职责与兼容约束。
Product authority: [DEC-071](../product/decisions/dec-071-pa-ui-state-rendering.md)、[Product Spec](../product/specs/pa-ui-state-rendering-product-spec.md)

## 职责与稳定身份

领域服务继续拥有任务、历史、来源、权限、发送、取消和 Undo。React 管理 PA 自有交互壳，
每个 view 创建自己的 Zustand store；原生 renderer 独占 Markdown host 内部。store 不复制
整套领域模型，不作为业务完成或权限判断入口。局部重试沿用原 store 和草稿。

组件按 conversation/message/task/SavedInsight 的稳定身份更新，不能使用数组位置、任务状态
或更新时间作为实体 key。实体删除只释放自身状态。Operations actual/preview 在同一 root
更新 props；saved/editor 分段使用起始 operation 身份，追加保持起点，前段恢复后不串用后段状态。
主动收起、全部 Undo、组移除及关闭保留既有释放语义。

实现入口：[Chat 任务壳](../../src/chat/ui/image-task-mount.tsx)、
[Chat store](../../src/chat/ui/chat-ui-store.ts)、
[Operations mount](../../src/chat/operations-review/mount.tsx)、
[Pagelet store](../../src/pagelet/ui/pagelet-ui-store.ts)。React 保持 18.3.1，新增生产依赖
Zustand 5.0.15、TanStack React Virtual 3.14.21；jsdom 26.1.0 仅用于真实 React DOM 测试。

## 原生正文与交互暂停

[Native Markdown bridge](../../src/ui/native-markdown-bridge.ts) 为每个 host 管理 live 子树、
Component owner、至多一个 started 操作和一个 latest pending 输入；不建立历史正文队列。
相同有效输入复用，沿用既有显示预处理、表格兼容、Mermaid 和 32ms 合并规则。同一 host
只有一套调度和 owner；未展开的区域不构建，折叠/隐藏暂停显示并保留有效节点。

正文内选字、拖动选区或操作说明/输入/按钮进入 held。进度和终态继续更新，正文保留原节点，
最新输入合并为一份；已启动结果也不能越过 held 发布。有新正文才显示「正文有更新 · 查看最新」。
点击后消费最新有效内容；完成、清除选区或隐藏返回不会自行解除 held。held 状态归 bridge，
不另在 store 维护无人读取的镜像；关闭后不持久化 DOM 或冻结状态。

显示接收和发布分离，held/隐藏不会使业务 finalizer 等待用户操作。终态使用仍有效的历史消息
及节点归属检查；流事件仍遵循原 live-turn 准入。来源撤销使旧 started/pending 失效，不能因
「查看最新」复活。Mermaid 的异步工作先写隔离 staging，合法替换前保留 live owner，失败只
释放自身 staging。表格、链接、媒体、Mermaid 和完整历史继续沿用原生能力。

## 草稿、阅读与恢复

[ComposerDraft](../../src/chat/composer-draft.ts) 是草稿及 take/restore/revision 的唯一 owner。
[恢复映射](../../src/chat/composer-recovery.ts) 只投影纯数据白名单，排除 TFile、sourceReceipt、
函数、AbortController、运行期授权、图片二进制和完整 Pagelet handoff。引用/附件重新核验；
不能无损恢复的上下文显示待重新选择状态，用户重新选择或显式移除前不能带失效上下文发送。
恢复不调用 provider、不重放任务，也不获得新来源权限。

[Local recovery](../../src/ui/local-recovery.ts) 使用公有 App loadLocalStorage/saveLocalStorage，
记录 schema、vault/device 命名空间、conversation 和稳定 slot；不写同步 vault 文件或 data.json。
workspace getState/setState 只携带 slot/conversation 路由，实际内容保存在本地后端。
并存 view 独占槽；无 route 普通重开先领用明确待定且未占用的启动槽，身份查明只细化当前
存活 epoch。业务身份可即时更新，workspace 路由只发布成功保存的身份；失败保留可恢复路由。
相同 savedAt 按索引已有的最后保存顺序取最近记录。

草稿/有效阅读变化按 250ms 防抖保存，任务 tick 不写盘。新编辑（包括输入后清空）使旧读取
失效；清空/发送消费保持 dirty 直到空记录成功保存。损坏/schema 失败记录不被被动空状态覆盖，
失败可见，内存输入继续可用，不静默换存储后端或建立后台重试队列。删除会话同时清理视图历史、
恢复记录并失效迟到回调。空白未绑定 Chat 仅有顶部零位置时不保留槽；未发送草稿、真实会话
顶部位置和有效锚点/disclosure 仍保留，不批量清历史记录。

[Reading controller](../../src/ui/reading-position.ts) 对每个真实 scrollport 管理稳定锚点、
相对 offset、有界 fallback 和最小 disclosure 上下文；只在可见有效布局采样/恢复。隐藏、关闭
及销毁前采集最后有效布局，不能用零尺寸覆盖。Chat 的关闭/正常重启恢复已交付；Pagelet 阅读
目前只保留实例内状态。Chat 附件/父版本异步核验期间的新滚动与旧快照优先级尚未补齐，
两项按 Owner 决定分别后置到 [B-182/B-183](../backlog.md#已延期的产品与工程工作)。
防抖/flush 前系统强杀仍可能丢失最后一次按键，不承诺异常退出下零损失。

## Pagelet 测量与宿主生命周期

[SavedInsightList](../../src/pagelet/ui/SavedInsightList.tsx) 只虚拟化实际 Saved Insights 垂直列表，
使用 SavedInsight.id 和既有 `.pa-pagelet-tab-body`，保留 sections 顺序、完整正文/来源。
候选导航保留宽屏 wrap/移动 select；Chat 不虚拟化、不截断历史。

TanStack public measureElement/ResizeObserver 是单一活动测量者。隐藏零高不覆盖正尺寸，返回
沿同一入口重测，不用 resizeItem 回填旧缓存。列表第一次显露才挂载，随后更新保留 section/root。
前方布局变化重算列表起点，重新启用从真实 body.scrollTop 初始化；恢复目标用 public rangeExtractor
临时纳入范围，恢复期间暂停虚拟器补偿，结束后凭当前有效范围释放。行提交后的 onLayout
沿 reading controller 原准入补采语义位置，不增加第二套恢复 loop。

Panel 原生正文按 candidate.id 复用；无 ID 摘要仅在同一 summarySaveNote 实体及 targetPath 下
复用，不凭正文 hash 合成实体。来源撤销或实体更换释放旧 owner，阅读再验证与用户选择的
取消责任保持独立。

[View lifecycle](../../src/ui/view-display-lifecycle.ts) 绑定实际 ownerDocument/defaultView。
隐藏关闭所有临时菜单、取消长按/提示入口、暂停显示和无效布局采样，保留草稿/DOM/held；返回
不主动 focus。异步 Memory 菜单沿原 requestId 失效，不能晚到重开。document 交接解除旧监听，
重绑新宿主；Saved 列表重建内部 virtualizer，保留外部 root/store 和稳定 ID 正尺寸。
关闭先 flush，再失效 epoch、清订阅/计时、unmount 并释放 reading/native owner；不可取消的
工作结束后只清理自身资源。局部错误不能清空健康 sibling root 或重放业务效果。

样式统一进入 `src/custom.pcss`，使用 PA 类和主题变量，按实际容器宽度约束、换行，保留焦点、
语义展开和 reduced-motion。触摸/IME、软键盘及 iPad 旋转的物理设备证据仍有缺口，见
[T-012](../backlog.md#触发型评估)；桌面窄容器通过不等于硬件验证。

## 验证与回退

当前回归分布在 Chat、native bridge、image mount、Operations diff/model、composer/local recovery、
reading、Pagelet list/panel suites；独有实际交互、完整/差量检查和限制见
[B-181 验证](../archive/2026/b181-ui-state-rendering-validation.md)。
回退按完整 surface 入口执行，不能让旧/新 renderer 同写 host。设备本地 schema 记录可被旧实现
忽略，不回滚业务任务/历史、不覆盖旧业务数据。没有新增设置、埋点、同步服务或窗口协调框架；
单次原生大段构建不可抢占的成本仍存在，不承诺固定帧率。
