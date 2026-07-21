# <Feature> Software Design Document

Document status: Draft
Updated: YYYY-MM-DD
Work item: B-xxx
Authority: 本 track 的 source-verified implementation design、兼容性、风险与 test matrix。
Product spec: <repo-local product spec path>
Governance contract: <Current GOV-xxx path for L2G; delete Product spec line>
Plan: <optional Delivery Plan link; delete when no plan.md>
Tracker: [Development Tracker](./tracker.md)

仅在多模块设计、共享基础设施、行为/数据/隐私/生命周期、兼容性或迁移复杂度需要 source-verified design 时创建本文件。

## Current Source Baseline

列出已经用 `rg` 核实的现有模块、接口、类型、setting key、command ID、locale key 与 CSS class。拟新增名称必须标注 `Proposed`。

## Design And Data Flow

## Interfaces And Ownership

## Lifecycle And Cleanup

## Data, Privacy, Permission And Cost

## Compatibility, Migration And Rollback

覆盖 persisted state、旧设置、desktop/mobile、Obsidian reload/mount/unmount 与 fallback。

## Test Matrix

| Requirement / AC | Unit / integration | App smoke | Failure / fallback | Evidence target |
| --- | --- | --- | --- | --- |
| B-xxx/REQ-01 / B-xxx/AC-01 | <test> | <action> | <case> | Tracker row |

## Open Design Findings

所有 P0/P1/P2 在实现前关闭或由用户明确延期。

## Approval

- Design authority:
- Approved on:
- Authorized implementation scope:
