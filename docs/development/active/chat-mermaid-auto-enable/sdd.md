# Chat Mermaid Auto Enable SDD

Document status: Approved
Updated: 2026-10-24
Work item: B-188
Authority: Owner 2026-10-24 实施授权；三路设计审查无 P0/P1/P2，已接受只读检查限制的精简建议。
Product spec: [Product Spec](../../../product/specs/pa-chat-mermaid-auto-enable-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Source-verified Design

现有 `src/chat/mermaid.ts::renderMarkdownWithOwner` 是正文、历史与
`MermaidPreviewModal.onOpen` 共用原生入口。`chat-view.ts` 在 bridge.prepare 中先
做显示兼容和 Mermaid defer/fallback，再将实际渲染输入交给该 helper。
`src/ui/native-markdown-bridge.ts` 继续管理暂停、owner、废弃结果及发布。

唯一生产改动落点为 `mermaid.ts`。新增局部 helper `ensureMermaidEnabledForRender`，
在现有 try 内、原生调用之前同步执行：

1. 可先按 fence 标记快速排除；读取 `app.loadLocalStorage('mermaid-vault-trust')`。
   已 true 则返回，不做结构解析或写入。
2. 未开启时用现有 markdown-it 依赖的局部惰性 block parser（html:true，禁用 inline），
   筛选 fence token，从 `token.info` 首词取语言，沿现有行为忽略大小写。
3. 有 Mermaid 才 `saveLocalStorage(key, true)`，随后
   `app.workspace.trigger('post-processor-change')`；继续原 `MarkdownRenderer.render`。

不新增 await、缓存 trust、常驻监听、权限/解析服务。局部结构判断避免外层代码及
HTML 示例误开，并覆盖列表首行。旧 contains/defer/source 提取扫描器的限制保持，
不宣称本 parser 等价于宿主全部扩展语法，也不趁此次重写旧流式调度。

宿主拥有开关与图形绘制；PA 只负责绘制前检查/写入，bridge 仍拥有生命周期。
同步异常进入已有 rejection；Chat 走既有 fallback/错误显示，Modal 走既有错误显示。
不吞错、不重试，不以不完整 mock 为由给真实 App API 加可选链。

## Compatibility And Rollback

storage API since 1.8.7，项目最低宿主 1.11.4；本机 1.14.4 已验证私有键/事件。
普通笔记也受开启影响，主动关闭后下次 PA Mermaid 会再开启；不区分“从未开启”
和“用户关闭”（宿主均返回 null）。不新增版本表、迁移或备用 renderer。
移除局部接线即可回滚代码；卸载不清除宿主值，避免覆盖用户自己的设置。
临时验证记录并恢复原值，只清理自有会话/视图。

## Requirement And Test Mapping

| Requirement / AC | 设计与最低证据 |
| --- | --- |
| B-188/REQ-01 / B-188/AC-01 | 同步 write→event→render 顺序断言；生产接线真实出图 |
| B-188/REQ-02 / B-188/AC-02 | 同一旅程检查初次写入、重复零写、用户清除后再开启及多图 |
| B-188/REQ-03 / B-188/AC-03 | 少量正反 fence 参数例；只约束副作用，不约束 load 次数 |
| B-188/REQ-04 / B-188/AC-04 | 扩展已有流式→终态→Modal 用例；复用原文/sourcePath/owner/回退断言；真实链接、选择与放大操作 |
| B-188/REQ-05 / B-188/AC-05 | 独立实际 diff 审查和测试库状态回执，不新建后台/跨 vault 模拟系统 |

实施与门禁分工见 Tracker。只补一个存储异常回归，现有 fallback/error 语义均允许，
不为列表与旧 scanner 的交界新增统一解析工程。无未解决阻塞设计 finding。
