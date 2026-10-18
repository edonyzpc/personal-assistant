# Chat Markdown Table Display Product Spec

Document status: Current
Updated: 2026-10-18
Work item: B-179
Decision: [DEC-069](../decisions/dec-069-chat-markdown-table-display-compatibility.md)
Authority: 本文持有已实现的显示兼容范围与原文边界；Owner 于 2026-10-18 授权开发测试，并在独立审查后明确确认收尾 B-179 及提交本地 master。后续性能优化仍需单独决定。

## Problem And Product Outcome

Chat 正文含有完整 Markdown 表格时，部分段落/表格相邻写法被当前原生解析器显示为
竖线文本。目标是在已证实的边界下显示可读表格，同时保护用户原文和现有原生能力，
符合[安静且可信](../pa-product-north-star.md)的产品标准。

## Scope

### In Scope

| Requirement | 行为 |
| --- | --- |
| B-179/REQ-01 | 顶层普通段落紧接有效表头与分隔行时，在显示副本中补必要空行，继续原生表格渲染；同类结构通用处理，不绑定某条回复、标题、语言或行数 |
| B-179/REQ-02 | 正常表格、代码、原始 HTML 块、普通竖线文本、未成形表格及非目标嵌套语境不被兼容规则改写；只插入必要空行，保留原换行和正文，重复处理不重复插入 |
| B-179/REQ-03 | 复制、历史存储、后续上下文及原文操作继续使用消息原文；无笔记/会话迁移、附加模型请求、设置、确认或持久缓存 |
| B-179/REQ-04 | 实时、完成、历史及 Mermaid 失败回退使用一致的显示兼容；保留原生 owner、链接/嵌入/后处理、取消/关闭和滚动语义 |
| B-179/REQ-05 | 非候选正文跳过块解析；保持当前单任务、最新内容合并及 32ms 冷却。分别记录兼容处理、原生构建、发布和后续帧成本，不以改延时或改变显示宽度代替性能解决方案 |

### Non-goals

- 引用/列表内相似表格边界的新增兼容，以及任意不完整或错误 Markdown 的自动修复。
- 变更模型输出约定、提示词或历史原文；替换 renderer、重做表格视觉样式。
- 本轮实施稳定 DOM 复用、尾部解析、虚拟列表、Worker 或通用增量解析框架。
- 为单一桌面原型建立跨设备性能承诺或常驻性能采集平台。

## User Flow And States

1. 用户正常阅读 Chat，无新增入口。输入尚不构成有效表格时沿用原生显示。
2. 收到完整表头和有效分隔行后，符合目标结构的显示输入补空行，再交原生 renderer。
3. 继续生成、完成、停止和重开历史时，沿现有消息状态显示对应原文的兼容结果。
4. 复制或将原文用于后续操作时，取原消息内容。兼容处理不成为数据写回步骤。
5. 桌面和现有 mobile 共用逻辑与自然列宽；原生原有滚动及交互继续有效。

## Trust, Data And Authority

- Provider 文本只作为待显示数据，不提供执行权限；渲染继续通过原生处理链。
- 不新增网络、AI 成本、持久化或隐私范围。原始私人会话不进入仓库夹具。
- 关闭兼容接线即可回退；用户笔记、消息原文、设置及历史不需要恢复。

## Acceptance Criteria

| Acceptance | 通过条件 |
| --- | --- |
| B-179/AC-01 | 合成的顶层段落→三列表格在原生对照中由竖线段落变成一张表；表头、全部数据行、单元格内容正确；多表和转义竖线按结构识别 |
| B-179/AC-02 | 已有空行、非候选、围栏/缩进代码、原始 HTML 块、引用/列表、普通竖线和无效分隔行原样透传；LF/CRLF、多表及幂等性回归通过 |
| B-179/AC-03 | 显示兼容后复制及历史内容仍逐字等于原文；后续上下文和原文操作未接入兼容副本，无额外写入或 provider 调用 |
| B-179/AC-04 | 实时→完成、停止、历史重开、Mermaid 回退、迟到渲染和关闭清理保持正确；原生链接与代表性嵌入可用，不留下 owner/回调或旧消息覆盖 |
| B-179/AC-05 | 非候选输入不调用块解析；实际部署的代表性短表及大表对照分别报告各阶段耗时和环境，不把两次帧回调称为首字延迟；现有流式合并与冷却语义回归保持 |

## Implementation And Compatibility Contract

- [显示兼容 helper](../../../src/chat/markdown-table-compat.ts)只返回字符串，不负责 DOM、存储或调度。
  非候选正文直接返回；候选使用内部复用的 `MarkdownIt({ html: true }).disable('inline')`
  识别块结构，原始 HTML 作为保护块，不使用第二套 HTML renderer 或 Ghost 扩展规则。
- 仅相邻的顶层 `paragraph_open → table_open` 产生插入；按原文行偏移从后向前补空行，
  保留 LF/CRLF、其余内容及幂等性。包含单独 CR 的非目标换行输入原样透传，避免行号错位。
- [Chat 入口](../../../src/chat/chat-view.ts)只在实际 `renderMarkdownInto` 时派生显示副本，
  正常、实时、历史及 Mermaid 失败回退共用该副本；copy、rendered identity、pending/in-flight、
  历史、上下文及其他原文操作仍使用原始 content。不开辟逐 provider chunk 的解析路径。
- [原生渲染](../../../src/chat/mermaid.ts)、owner 的加载/卸载、迟到结果校验、链接/嵌入后处理、
  取消/关闭、首末态、单任务与最新 pending 合并、32ms 冷却和自然列宽均保留。
  parser 不缓存消息或 token，不新增观察器、计时器、持久状态或运行时资产。
- 无数据迁移。回退只移除显示适配接线及 helper，不回写消息、历史或笔记。

## Performance Follow-up Boundary

全文原生构建与 DOM 发布后的样式/布局仍是大表的主要成本；现有调度没有已确认缺陷。
稳定表格 DOM 是后续优先候选，未在本次实现。进入实施前须证明稳定行可保留、可变末行
可更新、结构/依赖变化能回退全文路径，且 owner、原生后处理、链接事件及关闭清理正确；
不能仅靠整表 `textContent` 相等判定组件等效，或同时无限保留新旧 owner。
若安全复用后仍受原生全文构建限制，再单独评估尾部构建；不据原型引入通用增量解析框架。

## Validation And Revisit

本范围已完成开发测试与独立审查，无未完成项或待定产品选择。
[B-179 验证记录](../../archive/2026/b179-chat-markdown-table-display-validation.md)保留实际
test vault 桌面、官方移动模拟、性能对照及证据限度；不代表 Anthelion 部署或发布。
兼容范围和性能重构的后续启动条件见 [DEC-069](../decisions/dec-069-chat-markdown-table-display-compatibility.md#revisit-trigger)。
