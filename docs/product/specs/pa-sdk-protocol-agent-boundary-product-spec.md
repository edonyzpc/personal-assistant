# PA SDK Protocol And Agent Boundary Product Spec

Document status: Approved
Updated: 2026-11-01
Work item: B-194
Decision: [DEC-078](../decisions/dec-078-sdk-protocol-and-agent-boundary.md)
Authority: Owner 已确认的连接协议、SDK 复用、Agent 结果与执行边界；批准产品范围不等于实施或发布授权。

## Problem And Product Outcome

用户应能通过已配置服务使用适合的模型，而无需为每个新型号等待 PA 复制协议实现。
协议统一后，工具、文字辅助和来源控制仍按同一 PA 契约工作。符合“安静且可信”：
保持选择的服务与模型、结果如实呈现、取消有效，不增加协议管理界面或额外确认层。

## Scope

### In Scope

- B-194/REQ-01 — OpenAI 聊天用途统一 Responses，不限定 Terra；覆盖主 Agent、Policy、Pagelet 和文字辅助消费者，保留既有 Chat 图像输入及其来源边界，不扩大模型的图像能力承诺。保持现行默认 Terra 与默认 reasoning high 的选择，模型参数适用性优先由 SDK 处理，不向不支持该参数的模型无差别硬塞。真实 OpenAI 连接不注入 PA 内部温度值，使用 SDK／API 的模型默认；Custom 与 DashScope 保留调用者传入的温度，不按模型名套用 OpenAI 参数策略。
- B-194/REQ-02 — Custom 固定 OpenAI-compatible Chat Completions，包含 SDK 偏好 Responses 的模型名及指向官方 OpenAI 的 Custom 地址。DashScope 继续采用 SDK 适配与现有 thinking 参数语义；服务身份从真实连接解析，不从兼容投影或模型名字猜测。
- B-194/REQ-03 — 复用 SDK 的消息、协议、流式、工具格式与重试能力；普通 Chat 与带图 Agent 对暂时限流保持一致恢复，无等待提示的 429 沿用 SDK 有界退避，额度不足不重试。PA 纯文本消费者读取文本投影，保留原消息和拒绝／非文本处理。更新仅针对实际消费缺口，不建立新的模型名单或 provider 框架。
- B-194/REQ-04 — PA 对流式及非流式结果统一理解完成、截断、失败、缺少终态和取消；工具调用及结果 ID 保持对应。未完成结果不能作为成功的写入成果、执行缓存工具或触发不适用的 invoke fallback。
- B-194/REQ-05 — 连接身份、来源准入、取消、重试前检查、预算、权限与实际效果归属继续由既有 owner 控制。SDK 返回、模型声明或 provider 完成均不替代这些事实。
- B-194/REQ-06 — OpenAI Responses 显式不保存响应供后续 API 检索，由 PA 组装当前准入的历史；不新增服务端会话／推理缓存。其它服务的外发范围、存储和用户控制保持原契约，无新增遥测或隐藏 API 调用。
- B-194/REQ-07 — 旧 4o-mini 当前默认、占位及专门维护基线退出；新建 OpenAI 聊天默认采用 Terra。已保存的 chat／policy 模型、Key、用途和历史不改写；历史价格／迁移证据按真实消费者保留，不进行全库字符串替换。embedding 和图片默认及 Memory 配置不随此次聊天调整改变。
- B-194/REQ-08 — 升级共享 SDK 并验证实际受影响调用、打包和平台路径；完成本项验收后再进入正式发布准备。安装、升级与打开设置不触发新的模型调用或全库准备；完成证据及限制见最终验收记录。

### Non-goals

- 不新增 provider、自动服务切换、协议探测请求、付费 fallback、动态插件／能力注册平台。
- 不新增 Custom Responses 设置或 SDK hosted tools；不把聊天 SDK 的能力当作 PA 已开放能力。
- 不替换 PA Agent／harness，不将语义判断塞进硬编码规则，不新增权限／确认层。
- 不把 embedding、独立图片生成或规划语音改走聊天 Responses，不修改 Memory 调度／索引。
- 不因 SDK 升级重拍 README 素材、进行模型排名或重复原有完整功能验收。

## User Flow And States

1. 用户继续在现有连接界面选择 OpenAI、DashScope 或 Custom，保存模型与凭据；不新增协议选项。
2. Chat（包括既有图像输入）及文字辅助按真实用途连接构造 SDK 模型：OpenAI 为 Responses，Custom 为 Chat Completions，DashScope 交 SDK。
3. provider 输出进入 PA 共同结果处理，再按现有功能显示文字、执行已允许工具或交付成果。
4. 不支持的模型／端点、截断、失败及取消沿现有可见错误或领域降级路径处理；不静默更换服务、模型或协议。
5. Custom 过去若依赖 SDK 自动 Responses，升级后按本次明确选择固定 Chat Completions；手册说明改用 OpenAI 连接的适用场景，不自动重写用户配置。
6. 桌面与移动端沿既有网络传输和取消路径；不增加平台专属能力承诺。

## Trust, Data And Authority

- 来源与工具权限仍以当前 Data Boundary、来源有效性和 Operations 契约为准。
- OpenAI 设置 `store:false`；不使用远端响应 ID 绕过每轮来源检查，也不宣称因此全本地或零日志。
- provider、Key、模型和请求归属不随重试／取消／设置变化被悄悄替换；已接受或未知效果不重放。
- 无持久化 schema 迁移。现有显式用户配置和 Memory profiles 原样保留，回滚不清数据。
- 初始授权为设计文档；2026-11-01 Owner 后续授权完成开发测试，并明确要求收尾及提交本地 master。收尾不等于发布，推送和发布仍分别授权。

## Acceptance Criteria

- B-194/AC-01 — 至少以两个真实模型名的确定性请求证明 OpenAI 始终调用 Responses，且主模型／Policy／文字辅助均使用相同策略；不以 Terra 名称特判维持通路。检查实际请求未注入温度／top_p，Terra 保持 high；虚构型号的模拟成功只证明路由，不能作为参数兼容证据。通过生产工厂与实际 SDK 的一条合成图片＋文字请求证明既有图像输入、文字及当前允许的历史正确保留；不以仅验证内部消息对象代替请求证据。
- B-194/AC-02 — Custom 即使模型名命中 SDK Responses 偏好、经过 `bindTools`／`withConfig` 或地址指向官方 OpenAI，仍请求 Chat Completions；DashScope 保持 SDK 路径及有效 thinking 参数，无 provider／模型自动替换。
- B-194/AC-03 — 字符串及 SDK 文本块均被真实文字消费者正确读取；工具、usage、拒绝和媒体信息不因全局字符串化丢失，现有领域校验保留。普通工具的既有可选参数语义与 Pagelet 的显式严格结构化输出分别保持，不统一覆盖其 strict 选择。
- B-194/AC-04 — completed 且通过现有领域校验、来源及执行准入后，文字／工具／原生写入成果可正常交付；provider 完成不替代这些条件。incomplete、failed、无终态和取消不会交付成功成果或执行缓存工具。失败语义和 fallback 由同一运行事实驱动，工具结果 call ID 往返有效。
- B-194/AC-05 — SDK 序列化／重试等待后的发送仍检查来源、身份和取消；变更连接或撤销来源后不发送或不交付陈旧结果，已有动作权限与效果恢复保持。无等待提示的暂时 429 经 SDK 退避后可恢复，普通和带图路径均保留重试事实；额度不足在 SDK、stream→invoke 和 Agent 恢复层均停止，图像错误不泄露原始请求／错误内容。
- B-194/AC-06 — 实际请求验证 OpenAI `store:false`、不携带远端会话链；每轮使用当前允许的历史。升级和配置读取零额外 provider 工作，秘密不进入普通日志。
- B-194/AC-07 — 当前新建／旧首配入口不再推荐 4o-mini；已有显式模型、凭据、用途、历史和索引不变，旧迁移夹具仍验证保留语义，未把旧价格数据改标成新模型价格。
- B-194/AC-08 — 升级输入完成共享依赖所需检查、针对性部署交互和独立审查；文档区分设计、自动测试、真实服务、app 和发布证据。正式发布仍单独授权。

## Open Decisions

无待 Owner 决定的产品选项。新版 SDK 终态可见性、最窄扩展位置及具体文件组织属于
已批准边界内的工程验证；不能以技术困难自行改变上述协议或数据选择。

## Delivery Evidence

- Final validation: [B-194](../../archive/2026/b194-sdk-protocol-validation.md)。开发测试与收尾完成，过程包已吸收删除。
- Architecture contracts: [连接架构](../../architecture/settings-status.md)、[Command Architecture Contract](../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)
- Release / rollout boundary: SDK 升级验收先于正式发布准备；本次收尾及本地提交不包含推送、tag 或发布。
