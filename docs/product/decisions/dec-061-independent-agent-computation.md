# DEC-061 — 独立通用计算工具

Decision ID: DEC-061
Status: Accepted
Updated: 2026-10-11
Work item: B-170
Authority: 用户明确要求独立计算、不做脚本内工具桥接，由 Agent 自主选择和组合工具；随后授权按方案完成开发测试，并要求等待 B-171 收尾、基于最新代码复核设计。

## Decision

提供一个普通 Chat 工具 `execute_code({ code })`，用于设备时间、日期、数值、数组和 JSON 计算。Agent 自行判断何时调用及如何使用结果。现有笔记工具保持独立，不向脚本暴露其他 PA 工具，不预设任何任务步骤、时间快照或日期解释。

采用已验证的 Pi 固定源码闭包：主线程 `CodemodeSandboxBase` + 浏览器 `VmLauncher`，Worker 内 `inlineLauncher` + QuickJS/WASM，原生 postMessage。精确来源、许可和可复现构建由 PA 维护；不是 npm 1.1.0 已提供浏览器入口的声明。

按本次方案实施为默认可用的普通能力，不新增设置、模式或确认框；仅在实际平台/运行条件不支持时如实返回不可用。无 shell、网络、文件系统、脚本写入、工具桥接或跨调用状态。不改变现有工具权限、完整查询、模型/thinking 或 B-171 的 prompt 分层。

## Consequences

计算结果经过现有工具执行、输入来源与结果准入、取消及历史路径。没有新增笔记来源不等于清除输入的来源依赖；执行事实与可接纳材料分开。每次独立 Worker，结束后释放；继承父绝对期限，不重领预算。

实施使用内部资源初值并记录其依据，资源失败明确报告，不新增容量设置或压力寻优项目。旧桥接原型、已发现缺陷与模型失败保留为历史证据，不整包移入生产，不据单次样本承诺提速。

## Traceability

- [Product Spec](../specs/pa-independent-computation-product-spec.md)
- [验证与边界](../../archive/2026/b170-independent-computation-validation.md)
- [研究与范围修订](../../archive/2026/b170-pi-codemode-feasibility.md#20-通用计算最小方案草案2026-10-11)
