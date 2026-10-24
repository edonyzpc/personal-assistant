# Chat Mermaid Auto Enable Product Spec

Document status: Approved
Updated: 2026-10-24
Work item: B-188
Decision: [DEC-074](../decisions/dec-074-chat-mermaid-auto-enable.md)
Authority: 本文持有 Owner 已授权的原生 Mermaid 自动开启范围与验收标准；交付状态只在 Tracker。

## Outcome And Scope

消除 Chat 绘制 Mermaid 时的 Allow 点击，保持原生 Markdown 与图内交互，符合
[North Star](../pa-product-north-star.md) 的低负担方向。开启的是宿主本设备本 vault
设置，并非 Chat 私有设置；笔记同受影响，手动关闭后下次 PA 绘图会重新开启。

| Requirement | 行为 |
| --- | --- |
| B-188/REQ-01 | 在需要原生绘制 Mermaid 前确保宿主开关已开启，再调用原有 renderer |
| B-188/REQ-02 | 以当前设置为准，已 true 不重复写入/通知；不保存“检查过”状态 |
| B-188/REQ-03 | 普通文本、外层代码/HTML 示例及已降级为 text 的流式块不触发设置写入或刷新；允许只读检查 |
| B-188/REQ-04 | 正文、历史与放大窗口沿用原生 renderer、sourcePath、原文、链接/文字选择、owner 和现有源码回退/错误显示 |
| B-188/REQ-05 | 副作用只为本设备本 vault 的宿主开关；无新增 PA 设置、provider 请求、迁移或后台任务；卸载不撤销设置 |

## Acceptance Criteria

| Acceptance | 通过条件 |
| --- | --- |
| B-188/AC-01 | 未开启时原生 renderer 调用前已写 true 并通知；合法图直接显示、无 Allow |
| B-188/AC-02 | 已 true 时零额外写入/事件；关闭后下次绘图再开启；同消息多图不重复设置 |
| B-188/AC-03 | 普通内容/代码/HTML 示例、已转 text 的块不写设置或发事件；反引号、波浪线、引用和列表中的有效 Mermaid fence 能触发 |
| B-188/AC-04 | 生产接线中正文/历史和 Modal 出图，链接、文字选择和关闭操作正常；现有原文/sourcePath/owner 及失败路径回归保持 |
| B-188/AC-05 | 实际 diff 与运行行为限定当前 App 的 vault storage，不新增 UI/外发/后台维护/卸载回写 |

## Non-goals And Compatibility

不替换 renderer、改 securityLevel、栅格化 SVG、轮询设置或强刷全部旧消息；不修复
其他 Mermaid fence 的旧流式/源码提取限制，不构建版本/图形/设备矩阵。现有 Allow
静态页面需再次原生渲染，可通过重开会话触发。storage API 公共，Mermaid 键/事件私有；
仅有当前本机宿主的证据，不承诺未来版本。回滚停止自动接线后可在宿主中手动关闭。

## Delivery

[Feature Home](../../development/active/chat-mermaid-auto-enable/README.md) / [Tracker](../../development/active/chat-mermaid-auto-enable/tracker.md)。
无未定产品选项；提交、发布和归档另行授权。
