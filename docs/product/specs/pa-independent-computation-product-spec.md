# Independent Computation Product Spec

Document status: Current
Updated: 2026-10-11
Work item: B-170
Decision: [DEC-061](../decisions/dec-061-independent-agent-computation.md)
Authority: 用户确认的独立通用工具边界；本页持有稳定行为与实现约束，验证事实见[验证与边界](../../archive/2026/b170-independent-computation-validation.md)。

## Requirements And Acceptance

| Requirement | Behavior | Acceptance |
| --- | --- | --- |
| B-170/REQ-01 | 一个默认可用的独立计算工具，准确说明 JS、设备时间/偏移与无 Intl 的能力；Agent 自主选择 | B-170/AC-01：实际 native/compat 请求提供工具及必要说明；参数、结构化结果和时间/数值/JSON 计算可用，无固定工具序列 |
| B-170/REQ-02 | Pi 固定闭包与 QuickJS Worker 隔离，不注册 PA 工具，不提供网络、文件系统、shell或持久状态 | B-170/AC-02：无笔记权限也可计算；隔离与调用间清理有效，三文件安装可运行，来源和 MIT 许可可追溯 |
| B-170/REQ-03 | 沿原 PA 执行链维护输入来源、绝对期限、带原因取消、实际执行事实和历史终态 | B-170/AC-03：不伪造来源或清除输入依赖；初始化/计算停止、超时、迟到结果拒收、释放和再次调用正确；已启动失败不冒充未执行 |
| B-170/REQ-04 | 在已核对 test 环境完成必要真实接线与最少模型功能验证，复用有效证据 | B-170/AC-04：指定构建的常规 Chat 计算/Stop/历史/恢复由 Mac 与 Obsidian mobile simulator 验证；iOS 仅补本次 classic→Blob module Worker 的最终加载、结构化计算与释放兼容检查；两个自然功能样本按信息依据与答案判定；Android 未验证如实保留，不推定全平台通过 |

验收按实际机制复用证据：旧 iOS 后台调度事实与现有绝对墙钟回归共同覆盖未变的期限恢复语义；常规接线不要求整套 iPhone 重测。mobile simulator 不冒充 WKWebView 兼容证据，最终平台证据边界见[验证记录](../../archive/2026/b170-independent-computation-validation.md)。

## Implementation Contract

普通 capability `execute_code({ code })` 接受异步 JavaScript 函数体；`return` 返回结构化值，`text()` 输出文本。准确声明设备时间、本地偏移与无 `Intl` 的环境；工具进入实际 native/compat 声明与现有同源估算，不添加关键词路由、固定步骤或必经 Skill。Agent 自行决定是否调用，并与现有笔记工具独立组合。

主线程复用 Pi `CodemodeSandboxBase` 与浏览器 `VmLauncher`，单次 Worker 内运行 `inlineLauncher` 和 QuickJS/WASM，使用原生 `postMessage`。Pi 固定为 `c5f5b3282d5e4203c085e59837ba17aeaf2829b5`，QuickJS 为 `quickjs-wasi@3.6.2`；固定闭包与 MIT 许可由仓库维护，不声称 npm 1.1.0 已提供这些浏览器入口。现有 esbuild 将 Worker/WASM 内联进主包，安装仍只需 `main.js`、`manifest.json`、`styles.css`；不依赖临时目录或额外 Worker 资源。Worker 的 `Symbol.dispose` 兼容处理先于 QuickJS 求值，不污染主 realm。

| Owner | Stable responsibility |
| --- | --- |
| Runtime / capability registry | 注册当前实例拥有的独立能力；不归入笔记读取工具，Web-only 仍可计算，不新增 action owner 或 operationId |
| 现有来源准入与 lineage | 计算能力对应空读取计划，自产结果不增加笔记来源，再合并原 callLineage；不得按工具名清除输入依赖 |
| 独立计算模块 | 每次新建 Worker，返回文本/结构化结果；不注册 PA 工具、shell、网络、文件系统、任意导入或跨调用状态；结束时释放监听、Worker 与 Blob URL |
| 原 dispatcher / interrupt owner | 传递父墙钟与工具期限中较早的绝对 deadline；初始化、执行和收尾共享剩余预算，并保留首个中断原因。入口已过期不启动 Worker；恢复后也按绝对期限决定结果是否可接纳 |
| 原 Chat / history | 使用原 controller/run 和历史保存路径；停止后仅补已开始调用的有限执行终态，不重新接纳迟到正文、来源或 Context Used |

执行事实与结果材料分开：未进入 executor 或 adapter 明确返回 `not_started` 时保留该事实；已执行后中断可有限保留 owner 的 executionState/recovery/resultFact，不以丢弃正文推断没有效果。成功 owner 事实不补 `acceptance_unknown`；写入仍走原直接工具，不将 Worker 终止解释为宿主效果撤销。

QuickJS 内存 64 MiB、工具期限 120 秒是已验证的内部起点，实际期限不超过父剩余预算；它们不是全进程内存保证或任意规模承诺。中断检查次数不是毫秒。输出沿现有准入，不截断后声称完整；资源失败明确报告，首版不输出图片。成功只读调用不默认缓存，不新增设置、Worker 池、调度框架或单独历史 API。

## Non-goals And Compatibility

不桥接 `query_notes/read_note`，不改变完整查询、正文按需读取、Memory、写入工具、模型设置或 B-171。首版输出结构化值和文本，不输出图片；无任意导入、命名时区库、UI 编辑器、Worker 池或后台平台。计算可处理 Agent 传入的数据；原输入 lineage 与来源限制继续有效。

保留现有插件最低版本和安装三文件布局。资源耗尽如实失败，不静默伪装完整结果；内部初值可按具体失败调整，不承诺任意规模。无数据迁移，回退恢复上一构建。开发验证不触及私人 vault，Git/release 不在本次授权内。
