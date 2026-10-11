# PA Agent Tool Disclosure Product Spec

Document status: Approved
Updated: 2026-10-11
Work item: B-172
Decision: [DEC-062](../decisions/dec-062-agent-hybrid-tool-disclosure.md)
Authority: 用户已确认混合管理范围及审查修订，并于 2026-10-11 授权实施、必要验证、P2 窄修和 closeout；本页持有当前产品合同，历史证据见 [验证记录](../../archive/2026/b172-agent-tool-disclosure-validation.md)。

## User Outcome And Scope

减少主 Chat Agent 为当前任务未使用的工具声明和指导支付的上下文成本，保持普通任务直接完成、专用能力可发现、选择与实际结果正确。不要求用户管理工具或理解加载过程，不增加设置和确认框。

“加载”仅表示向模型披露原生工具接口及对应指导；不承诺减少模块初始化时间、插件内存或所有任务的响应时间。Pagelet、工具实现、来源权限、领域效果、独立计算与纯输出协议保持原合同。

## Requirements And Acceptance

| Requirement | Behavior | Acceptance |
| --- | --- | --- |
| B-172/REQ-01 | 基础能力直接声明，其余当前可用能力通过完整短目录发现并按精确名称批量加载；无工具问答不必加载 | B-172/AC-01：初始 native 集合正确；目录等于当前可用但未披露的业务能力集合，不含 loader 自身；无待加载项时不披露 loader／配套指导；混合批次逐项报告 loaded、already_loaded、unavailable，有效项不被未知名称连带拒绝；下一请求生效 |
| B-172/REQ-02 | 只按真实任务绑定预披露所需能力；Agent 自主选择其余工具和步骤 | B-172/AC-02：Writing、图片、Ghost、结构化 web 来源按实际实例／绑定生效；仅用户关键词、历史调用或无效绑定不产生预披露与新权限 |
| B-172/REQ-03 | 同轮 native schema、工具指导、目录和实际请求预算使用一致披露结果；保留必要全局规则及真实执行事实 | B-172/AC-03：加载后声明和指导一起出现、对应目录项消失；Operations 不把未披露解释为禁止；目录、加载器及历史均进入实际 envelope 与整项成本 |
| B-172/REQ-04 | 披露不改变执行许可；加载沿原执行链，仅修改当前 run 的披露状态 | B-172/AC-04：合法未披露调用仍按原规则执行；来源／身份／取消／期限／效果准入有效；加载无领域效果、笔记来源卡或引文，不抹掉调用输入依赖；选定来源后，仍获准输入的加载参数错误保留有限纠错反馈，不回传失败参数；新 run 重置、退休 run 不污染新 run |
| B-172/REQ-05 | 保留全部既有接口语义、条件性能力、纯输出及其他运行入口 | B-172/AC-05：final-only 不暴露加载器、目录或业务工具；Writing 输出仍需有效上下文；execute_code 保持直接可用及独立计算边界；Pagelet 和领域工具未被合并／删除 |
| B-172/REQ-06 | 用可比证据回答四项效果问题，正确性优先于首轮体积 | B-172/AC-06：报告实际完整首请求、额外发现轮、全任务请求／usage／耗时及任务结果；基础任务新增发现轮为零；选择或结果回归须处理，未测与取舍如实保留，不把静态字符差额当作净 token 或提速率 |

## Disclosure Contract

直接提供的六项是 `query_notes`、`read_note`、`search_memory`、`get_current_note_context`、`load_skill`、`search_vault_metadata`；另保持 B-170 `execute_code` 的直接披露。所有条目先服从现有注册、来源与控制条件。没有 Memory 权限时，基础名单不能恢复 Memory。

目录只包含当前可用但尚未披露的业务工具名和简短用途，使用既有 description；不复制完整参数或长指导，也不包含加载器自身。只有目录非空时才披露 `load_tools` 及配套说明；目录为空不注销加载器或收窄原有执行许可。`load_tools` 可一次选择多项，无搜索排名、自动成组加载或逐项往返要求。加载结果只报告名称及状态；schema 在下一模型请求中出现，不在工具结果里重复携带。加载输入被 Host 拒绝时，保留必要的未执行事实和纠错提示，原来源限制继续生效。

`load_tools({ names: string[] })` 要求非空名称数组，按首次出现顺序去重；逐项返回 `loaded`、`already_loaded` 或 `unavailable`。未知名称不连带拒绝有效项，加载器自身按已披露处理，不进入已加载业务集合。

图片材料、Writing host、Ghost command、CreateImage command 和结构化 web 来源（`scope="web"`）等真实绑定可提前披露对应工具。`combined` 来源下的联网能力和普通 Chat 的图片生成、历史／状态查询及已配置联网仍可按需发现，不能因没有专用 command 而被隐藏为不可用。

工具可用、已披露、已执行是不同事实。加载不是授予写权限、选择笔记来源、用户确认、执行业务操作或业务完成证明。真实执行与恢复信息仍沿现有领域 owner 和历史投影展示；写入报告依据真实执行回执，当前披露状态不否认已完成效果，回执不成为执行前提。

## Measurement And Limits

首轮比较同时列出 schema、配套指导、目录、loader 和完整请求；整项比较包含后续加载调用、结果、重复声明、历史、provider 重试及可取得的 input/output/reasoning/cache usage。没有可靠单价时不伪造金额；字符与 provider token 分列。

首批只取当前主要配置最多五对任务：无工具问答、明确日期范围笔记查询、中文标题查找、已支持的普通联网、查找后追加合成笔记，每臂一次。现有联网不支持则标 N/A，不新增 provider 补矩阵。不同合理工具路径可接受，任务结果和来源／效果正确才可比较节省；单次耗时不代表稳定速度或整体使用分布。

## Delivered Scope And Limits

B-172 于 2026-10-11 按用户授权完成 closeout。四组有效样本的完整首请求减少约 21%–36%，普通任务零发现轮且总模型轮数相同，整项 tokens 合计减少 23.8%，核心查询及追加效果正确。此为每臂一次的观察；联网样本为 N/A，不证明稳定提速、总体成功率或金额节省。

最终 P2 提示修复及现有 Operations 完成轮断言通过 2 suites／82 tests 与类型、lint、diff 检查；未为该窄修重跑模型或部署。组合门禁、真实 Chat 受控 SDK 加载接线和各自输入身份见 [B-172 验证记录](../../archive/2026/b172-agent-tool-disclosure-validation.md)。实现接缝与来源边界见 [Agent Architecture](../../architecture/pa-agent-architecture-plan.md#capability-model)、[披露实现](../../../src/ai-services/pa-agent-tool-disclosure.ts) 和现有 focused tests。
