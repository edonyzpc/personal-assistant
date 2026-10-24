# B-188 Chat Mermaid Auto Enable 最终验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-24
Work item: B-188

当前产品边界与稳定接线责任由 [DEC-074](../../product/decisions/dec-074-chat-mermaid-auto-enable.md)
和 [Product Spec](../../product/specs/pa-chat-mermaid-auto-enable-product-spec.md)持有。
本页保留原生宿主依赖、环境失败／复验和实际交互的历史证据。

## 授权与处置

Owner 于 2026-10-24 授权按审查后的精简方案完成开发、测试和实机验证；随后只授权
本项本地 master 提交，排除其他任务差量。本地实现提交为 `222f040a`。本轮另获清理
项目临时文件和已完成 active 记录的授权；没有新 Git 提交、推送或发布授权。

T-01～T-03、五组 REQ/AC 及独立验收均已完成，无未解决 finding 或需转 Backlog 的
本范围工作。稳定设计吸收到 Spec，Feature Home、SDD与Tracker删除；处置见
[Disposition Log](../disposition-log.md)。原包与终态Tracker备份在
`/private/tmp/pa-project-cleanup-20261024/recent/`；旧Git记录不代替本轮未提交收尾。

GLM在基于 `d48bc8a2` 的隔离工作树完成局部 helper与测试，使用既有pa-glm／ZAI、配置
glm-5.3；GPT独立审查、整合并负责集中门禁／真实应用验收。worker不部署或改共享树。
实现冻结差异为3个授权文件，生产新增25行；隔离工作树已由应用工具归档。

## 自动化与部署证据

| 范围 | 结果与限制 |
| --- | --- |
| 设计／独立审查 | 三路设计审查与实际diff独立审查无P0/P1/P2；删除了“不允许读取设置”的错误限制，只约束写入／通知。存储异常沿既有fallback/error，不扩大旧scanner修复 |
| 局部验证 | 新增10个结构／开关用例，实施前6 fail／4 pass；最终2 suites／453 tests PASS，TS、diff与DOM/style scan通过，均自然退出。中间fixture／类型适配错误不当作产品红灯 |
| 集中源码门禁 | 平台guard、完整lint、production build自然exit 0；lint沿原配置使用 `node --stack-size=8192`，复用已确认的大纸纹常量栈限制诊断，不改规则或源码 |
| 完整Jest原结果 | 自然exit 1：409 suites PASS／1 FAIL；9849 tests PASS／45 FAIL，共9894。唯一失败为Ghost client本机监听 `EPERM 127.0.0.1` |
| 环境定向复验 | 获准在沙箱外仅重跑Ghost client，53 tests全部通过且自然exit 0；其余原结果复用，410套／9894项要求已覆盖。不把原完整命令改记exit 0 |
| 部署与文档 | src扫描零匹配exit 1为PASS、diff exit 0；deploy-current验证生产身份并复制后reload。docs:check 348 Markdown／4427 links通过，既有两套docs contract结果复用完整运行 |

生产部署 main SHA-256 为
`3ca17552493742e0435b9a22bf17c0f47f379f19ac23b910ef80d0521b12c84d`；身份只证明产物匹配，
不代替上述测试结果。实施期B-187/B-188双Now的docs失败保留，未修改checker或他项状态。

## 原生宿主交互与恢复

2026-10-23 的临时实验仅证明 Obsidian 1.14.4 中 `mermaid-vault-trust=true` 配合
`post-processor-change` 可在重新原生渲染时出图：关闭时2 Allow／0图，重复检查仅
写入／通知各1次，旧静态Chat不自动更新，重开后2图／0 Allow。该实验不是生产接线验收。

2026-10-24 在可见、解锁的 repo-local test、Obsidian 1.14.4／PA 3.0.1 上补生产验收：

- 关闭宿主开关后打开本地双图历史会话，由生产helper自动开启，实际2 SVG／0 Allow。
  没有注入开启helper，也未主动发送provider请求。
- 双击图内文字选中 `Mermaid`；点击放大看到原生图，Escape关闭；图中节点链接复用
  已开的 `2026-05-01.md` 标签。
- 再清除设置并读回null，重开原生消息仍得到2 SVG／0 Allow，证明不缓存“检查过”。
- fresh dev:errors为空；console仅本轮命令与正常API lifecycle。自有会话／leaf删除，
  原active conversation、trust=true和leaf `b7678fe7a865243a`恢复。初次reveal未激活
  侧栏，后显式setActiveLeaf完成恢复；debug=false、mobile=false、探针已清除。

未改笔记，未触发额外移动／图种／模型矩阵。宿主键／事件是私有契约，只有1.14.4
本机证据；不能外推版本兼容、物理设备、CI或发布。开启影响本设备本vault的普通笔记，
卸载不撤销宿主值；这些是已批准产品边界，不作为待修复finding。

原始日志／退出码／截图在 `/private/tmp/pa-b188-20261024-0ldaIx/`，汇总为 `result.json`；
路线实验位于 `/private/tmp/pa-mermaid-runtime-20261023/`。收尾只读复核了完整Jest失败
与Ghost复验原日志／退出码、集中build/lint退出码和result中的2图、选择、链接复用、
再次开启及最终恢复。未重新执行测试或应用操作。
