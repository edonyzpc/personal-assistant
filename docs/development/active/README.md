# Active Development Registry

Document status: Current
Updated: 2026-07-21
Authority: 当前正在执行的 L2/L3 Product track 与 L2G engineering governance/tooling track 索引。

新 track 必须在下表登记，并链接其 Feature Home。`Delivery status (derived)` 只为快速浏览，唯一权威是对应 Tracker；`docs:check` 强制三处一致，不能在本索引复制 task 明细。

| Track | Work item | Delivery status (derived) | Target | Updated | Feature Home / Tracker |
| --- | --- | --- | --- | --- | --- |
| Master-first branch management | B-117 | Validated | Repo governance/tooling; no release commitment | 2026-07-19 | [Feature Home](./master-first-branch-management/README.md) / [Tracker](./master-first-branch-management/tracker.md) |
| Pagelet UI/UX optimization | B-118 | Implementing | Desktop/iPhone UI hardening; no release commitment | 2026-07-21 | [Feature Home](./pagelet-ui-ux-optimization/README.md) / [Tracker](./pagelet-ui-ux-optimization/tracker.md) |
| Insight Enhancement Layer | B-119 | Planned | Graph/Pattern/Maintenance AI enhancement; no release commitment | 2026-07-21 | [Feature Home](./insight-enhancement-layer/README.md) / [Tracker](./insight-enhancement-layer/tracker.md) |

完成或取消后，先生成 `closeout.md`，再将实际存在的 artifacts 移动到 `docs/archive/<year>/<feature>/`，并从本表删除；plan-only track 不补造 SDD。
