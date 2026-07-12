# <Feature> Closeout

Document status: Current
Delivery status: Closed
Updated: YYYY-MM-DD
Work item: B-xxx
Authority: 本 track 的最终结果、验证、遗留项与信息去向。
Lane: Product / Governance
Decision: <Product lane only: repo-local Accepted Decision path>
Product spec: <Product lane only: repo-local Approved/Current Product Spec path>
Governance contract: <Governance lane only: Current GOV-xxx for Closed, annual Archived GOV-xxx for Cancelled/Superseded>

只保留一种 lane 的 metadata：Product lane 必须保留 `Decision:` + `Product spec:` 并删除 `Governance contract:`；Governance lane 必须保留 `Governance contract:` 并删除 `Decision:` + `Product spec:`。混用或全部缺失都不能 closeout。

## Outcome

- Final state: Validated / Shipped / Cancelled / Superseded
- What changed:
- What did not change:
- Release state and evidence:

## Contract Reconciliation

| Contract | Final authority | Updated | Notes |
| --- | --- | --- | --- |
| Product Decision + Spec | <Product lane paths; delete this row for Governance> | Yes / No | |
| Governance | <Governance lane GOV-xxx; delete this row for Product> | Yes / No | |
| Architecture | <path> | Yes / No | |

## Verification And Review

| Gate | Result | Evidence | Residual risk |
| --- | --- | --- | --- |

## Residual Work

| Backlog ID | Item | Restart condition | Historical basis |
| --- | --- | --- | --- |

## Information Disposition

逐行列出本 track 实际创建或使用的每个 process artifact，包括 Feature Home、Plan、Tracker、实际存在的 SDD、review/verification 记录、handoff 与临时日志；不要使用目录通配符或“全部归档”。`Disposition` 只允许：`durable contract`、`backlog`、`archive`、`delete-after-absorption`。

| Source artifact / information | Unique information | Destination | Disposition | Why safe |
| --- | --- | --- | --- | --- |
| <path or temporary log> | <summary> | <current path / backlog / this closeout> | durable contract / backlog / archive / delete-after-absorption | <proof> |

## Archive Move

- Destination: `docs/archive/<year>/<feature>/`
- Destination preflight: Absent / Conflict. Conflict 必须 fail closed；不得覆盖、合并目录或自动改名后继续。
- Terminal authority: Closed Product tracks keep current Accepted Decision + Approved/Current Product Spec. Closed Governance tracks keep the Current GOV. Cancelled Governance tracks move an `Archived` + `Delivery status: Cancelled` annual `gov-xxx-<slug>.md` record; Superseded Governance tracks move an `Archived` + `Delivery status: Superseded` annual record and must link a new Current successor GOV. Without a successor GOV, use `Cancelled`. Cancelled/Superseded Product tracks use their annual terminal Decision + Product Spec records.
- Direct annual records: <none or exact paths>. These records never replace a Closed/Cancelled/Superseded package that entered Active development.
- Complete package destination: `docs/archive/<year>/<feature>/`. The full package is always archived even when annual terminal records also exist.
- Package documents changed to `Document status: Archived` during the move:
- Active Registry removed:
- Annual Archive index updated:
- Backlog source item removed only after this document references its outcome:
