# <Feature> Closeout

Document status: Current
Delivery status: Closed
Updated: YYYY-MM-DD
Work item: B-xxx
Authority: 本 track 的最终结果、验证、遗留项与信息去向。
Decision: <Product lane only>
Product spec: <Product lane only>
Governance contract: <Governance lane only>

只保留一种 authority lane。只有最终结果无法合理吸收到 current contract/tests，且当前文档仍需引用时，才长期保留本文件；否则完成 disposition 后一并删除。

## Outcome And Verification

- Final state: Validated / Shipped / Cancelled / Superseded
- What changed:
- Release state:
- Checks and residual risk:

## Residual Work

| Backlog ID | Item | Restart condition | Historical basis |
| --- | --- | --- | --- |

## Information Disposition

按信息类别而非逐文件复制内容。默认 `delete-after-absorption`；`archive` 只用于当前 authority 仍需引用的独有证据。

| Information | Destination | Disposition | Why safe / why unique |
| --- | --- | --- | --- |
| Final behavior and decisions | <current contract/test> | durable contract | |
| Residual work | <Backlog or none> | backlog | |
| Feature Home / Tracker / optional Plan/SDD / logs | <absorbing authority> | delete-after-absorption | |
| Unique historical evidence | <archive path or none> | archive | |

## Final Actions

- Current contracts reconciled:
- Active Registry entry removed:
- Process package deleted after absorption:
- Archive evidence retained and linked from current authority: <none or exact path>
- Selected archive path preflight: <not applicable / absent / conflict; conflict fails closed>
