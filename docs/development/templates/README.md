# Documentation Templates

Document status: Current
Updated: 2026-07-12
Authority: 新建需求、产品决策、Product/Governance contract 与 Active Package 的 canonical template set。

按 [Documentation Workflow](../documentation-workflow.md) 选择最轻 lane；不要为了“完整”给 L0 修复创建空文档。

| Template | 使用时机 | 目标位置 |
| --- | --- | --- |
| [Discovery](./discovery.md) | 需要跨会话澄清、研究、讨论或比较方案 | `docs/development/discovery/<slug>.md` |
| [Decision](./decision.md) | 重要接受/拒绝/延期/替代决定 | `docs/product/decisions/<decision-id>-<slug>.md` |
| [Product Spec](./product-spec.md) | 产品范围获批后固化用户契约 | `docs/product/specs/<feature>-product-spec.md` |
| [Governance Contract](./governance-contract.md) | 固化不改变 PA runtime/用户行为的 repo governance/tooling 规则 | `docs/development/governance/gov-<id>-<slug>.md` |
| [Feature Home](./feature-readme.md) | 创建 L2/L3 Product 或 L2G Governance Active Package | `docs/development/active/<feature>/README.md` |
| [Plan](./plan.md) | 定义交付 phase 与 stop point | Active Package `plan.md` |
| [SDD](./sdd.md) | 定义实现设计、风险、回滚与 test matrix | Active Package `sdd.md` |
| [Tracker](./tracker.md) | 维护唯一执行状态与验证证据 | Active Package `tracker.md` |
| [Closeout](./closeout.md) | 完成、取消或替代 track | Active Package `closeout.md`，随后随包归档 |

创建文档时删除所有占位提示，填入 repo-local 精确链接，并同步相应 index。Product track 保留 `Decision:` + `Product spec:` metadata 并删除 `Governance contract:`；L2G track 只保留 `Governance contract:`，删除 Product metadata。
