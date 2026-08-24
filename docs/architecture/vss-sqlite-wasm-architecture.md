# VSS SQLite/WASM Current Architecture

Updated: 2026-08-11

Status: Current runtime contract. The SQLite/WASM baseline was verified against `src/vss/`, `src/plugin.ts`, `src/memory-manager.ts`, the current package manifest, and VSS tests during the documentation restructure; DEC-028/B-126 is the approved 2026-08-11 amendment, with implementation validation tracked in the [active package](../development/active/silent-first-use-memory-preparation/tracker.md).

## Authority And Product Boundary

- Markdown notes are the source of truth.
- OPFS SQLite and IndexedDB are device-local, reconstructable Memory cache/state. They are not synced user source data.
- `MemoryManager` owns user-facing readiness, confirmation, background-maintenance policy, progress, and notices.
- `VSS` is the internal facade for search, refresh, rebuild, reset, reconcile, verification, and index maintenance.
- `VectorIndex` hides the concrete storage/search implementation from product code.
- [DEC-028](../product/decisions/dec-028-silent-memory-auto-prepare.md) is the narrow first-use exception: the first Chat may start one non-blocking whole eligible vault rebuild without an Approval Modal and answer immediately. Shared folder/tag/generated-note exclusions still apply.
- Owner's later 2026-08-11 option 1 adds a prerequisite to that exception: an in-memory null marker cannot authorize destructive work until IndexedDB marker state has hydrated as known absent or the prior/unknown marker is durably invalidated. Before reset/provider work, VSS must durably save retry state and establish that truth; an unavailable transition fails closed while Chat remains answer-now.
- Missing local index, profile/settings stale, manual Prepare/Update, and other non-first-use costly rebuild paths require explicit user confirmation.
- Automatic background maintenance is allowed only after a confirmed or DEC-028 first-use prepare reaches durable usable ready. Abort, total failure, ready-marker publication failure, unavailable durable backend, unload, or Memory opt-out must not upgrade `memoryApprovalPolicy` or manufacture ready state. A denied persistent-storage request alone keeps the existing usable-but-evictable behavior and warning.

## Runtime Shape

```mermaid
flowchart TD
  Vault["Markdown vault\nsource of truth"]
  Events["create / modify / rename / delete"]
  MemoryManager["MemoryManager\nproduct policy + readiness"]
  VSS["VSS facade / VSSCore\nexclusive operation queue"]
  State["VSSIndexStateStore\nIndexedDB marker + dirty journal"]
  Index["SqliteVectorIndex\nmain-thread proxy + request queue"]
  Worker["Dedicated Worker\n@sqlite.org/sqlite-wasm"]
  OPFS["OPFS SAH pool\nSQLite database"]
  Vector["Worker vector cache\nbrute-force cosine / L2"]
  FTS["SQLite FTS5"]
  Provider["Configured embedding provider"]

  Vault --> Events --> MemoryManager
  MemoryManager --> VSS
  VSS --> State
  VSS --> Index --> Worker --> OPFS
  Worker --> Vector
  Worker --> FTS
  VSS --> Provider
  Provider --> VSS
```

## Main Components

### `VSS` / `VSSCore`

`src/vss.ts` exposes the facade; `src/vss/vss-core.ts` owns the runtime state and maintenance orchestration.

Key responsibilities:

- Build the active `EmbeddingProfile` and verify its signature.
- Generate query/document embeddings through configured AI utilities.
- Clean and chunk eligible Markdown.
- Maintain `verifyQueue`, confirmed dirty state, and the durable dirty journal.
- Serialize index mutations through the VSS exclusive operation queue.
- Coordinate rebuild, refresh, reset, delete, rename, reconcile, and shutdown.

All index writes must remain inside this boundary. Callers must not directly mutate `SqliteVectorIndex` or its worker.

### `VectorIndex`

`src/vss/types.ts` defines the storage facade used by VSS:

```ts
interface VectorIndex {
  initialize(profile: EmbeddingProfile): Promise<VectorIndexStatus>;
  upsertFile(fileState: VSSFileState, chunks: VSSChunk[], embeddings: number[][]): Promise<void>;
  updateFileMetadata(fileState: VSSFileState): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFilePaths(): Promise<string[]>;
  listFileRecords(): Promise<VSSFileRecord[]>;
  getFileRecord(path: string): Promise<VSSFileRecord | null>;
  search(queryEmbedding: number[], k: number): Promise<VectorSearchResult[]>;
  getChunksByPath(paths: string[], options?: VectorIndexPathLookupOptions): Promise<VectorSearchResult[]>;
  getStats(): Promise<VSSIndexStats>;
  verify(): Promise<VectorIndexStatus>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}
```

The SQLite implementation also exposes bounded hybrid-search and clustering operations used behind the VSS facade. Product callers should still depend on VSS, not the concrete class.

### `SqliteVectorIndex`

`src/vss/sqlite-vector-index.ts` is the main-thread proxy. It:

- creates the dedicated Worker lazily;
- supplies inline Worker/WASM URLs;
- serializes requests with a promise queue;
- correlates Worker responses by request id;
- rejects new work after terminal dispose;
- releases pending requests, object URLs, and Worker resources during shutdown.

### SQLite Worker

`src/vss/sqlite-worker.ts` loads `@sqlite.org/sqlite-wasm` and opens an OPFS SAH-pool database. The worker, not the Obsidian UI thread, owns SQLite and search-side vector memory.

Current storage/search behavior:

- Chunks, metadata, file records, and Float32 embedding BLOBs are durable in SQLite.
- A vector cache is lazily loaded in the Worker and invalidated after relevant writes.
- Vector search uses the repo-owned `bruteForceTopK()` implementation with cosine or L2 distance.
- Hybrid search combines the vector leg with SQLite FTS5 and fuses ranks with reciprocal-rank fusion.
- Current runtime does not load `sqlite-vector`, call `vector_init`, or call `vector_full_scan`.
- Current runtime does not provide ANN; exact worker-side scan remains the default.

## Local Storage Model

### OPFS SQLite

The active database is scoped to the plugin/vault/device-local context and opened through `opfs-sahpool`.

Durable tables include:

- `vss_meta`: schema/profile/backend metadata.
- `vss_files`: one indexed-state record per note path.
- `vss_chunks`: chunk content, metadata, timestamps, and embedding BLOBs.
- `vss_chunks_fts`: FTS5 search surface synchronized with chunk records.

The current schema version is `VSS_SCHEMA_VERSION = 2`; the default embedding dimension is `1024`, and the default distance metric is cosine.

### IndexedDB Local State

`VSSIndexStateStore` persists the local marker, dirty journal, and migration/diagnostic state separately from OPFS.

- The marker says that compatible local Memory was prepared for a specific scope/profile; it is not a backup of embeddings.
- `marker === null` is only known absent after successful hydration for the current local-state store/generation. Before that it is unknown and cannot authorize destructive reset or provider work.
- The dirty journal contains only confirmed work that still needs refresh.
- `verifyQueue` remains process-local and is reconstructed by vault events and reconcile.
- Ordinary non-destructive observation/verification may keep process-local pending state and retry IndexedDB persistence later. This existing behavior does not apply to destructive rebuild admission.
- Destructive rebuild atomically durable-saves the whole-vault retry journal, a null/invalidation marker and a content-free guard carrying the original `first-use`、`settings-changed` or `local-memory-missing` reason. It may proceed after hydrated known absence or after this same-generation durable invalidation; transition failure preserves the old OPFS index/marker and stops before `VectorIndex.reset()` and before any embedding-provider call.
- Hydration prioritizes the rebuild guard over marker/OPFS inference; abort and total failure retain it, so a confirmed recovery cannot restart as silent first-use.
- Full success clears the guard only after durable ready publication and Memory policy/lifecycle admission. Deferred rebuild returns an opaque prepared-run handle；`admitPreparedRebuild(handle)` and `rollbackPreparedRebuild(handle, reason)` mutate only while that handle still owns the prepared marker/guard. A stale handle is a no-op, so an older cancelled lifecycle cannot admit or erase a newer rebuild.
- Foreground startup/chat/readiness must not open OPFS only to reconstruct a missing marker.

See [VSS Local State](./vss-local-state-plan.md) for the focused state-store contract. Browser persistent-storage permission denial remains a separate usable-but-evictable warning and is not marker uncertainty.

## Freshness And Mutation Flow

```mermaid
flowchart LR
  Event["Vault event / reconcile"]
  Observe["observeChangedFile"]
  Verify["verifyQueue\nlocal hash + metadata"]
  Dirty["confirmed dirty\nIndexedDB journal"]
  Embed["provider embeddings"]
  Write["exclusive upsert/delete"]
  Ready["ready snapshot"]

  Event --> Observe
  Observe -->|metadata drift or strong write evidence| Verify
  Observe -->|missing index record| Dirty
  Verify -->|hash unchanged| Ready
  Verify -->|hash changed| Dirty
  Dirty --> Embed --> Write --> Ready
```

- `create` / `modify` use observation and verification rather than directly treating every event as changed content.
- Startup replay with matching indexed metadata is ignored for maintenance.
- Rename/delete keep their explicit index-maintenance paths.
- Reconcile compares current vault paths and indexed file records, then schedules bounded verification or mutation.
- Hash-equal files update metadata without provider calls.
- Confirmed dirty files retain state across restart and retry with existing backoff/policy.
- Rebuild uses a cross-file embedding batch; normal refresh remains a per-file path with hash skipping.

See [Embedding Refresh](./vss-embedding-refresh.md) for batching, budgets, scheduling, and progress.

## Concurrency And Lifecycle

Three layers prevent overlapping mutation:

1. VSS exclusive operation queue serializes semantic index writes.
2. `SqliteVectorIndex` serializes Worker requests.
3. The Worker owns the single active SQLite/SAH-pool connection.

Additional lifecycle rules:

- `dispose()` is terminal; an old plugin instance must not reinitialize or schedule new maintenance.
- Hot reload uses a scope-specific shutdown barrier before a new instance opens the same OPFS scope.
- Foreground lock recovery is short and non-blocking; it must not trigger embeddings or silently load legacy JSON fallback.
- Manual prepare/technical diagnostics may use bounded retry.
- Concurrent first-use Chat calls reuse the same active preparation. Disabling Memory or unloading the plugin aborts that run; the old lifecycle cannot persist auto policy, update status, or show a late success/failure Notice.
- If marker truth or durable invalidation is unavailable, the first Chat still completes answer-now; later status/Chat paths retry state-store initialization and re-evaluate the hydrated marker instead of assuming a fresh install.
- Reset clears the local Memory copy and VSS maintenance state without modifying source notes.

## Durable And Fallback Behavior

- `SqliteVectorIndex` is the durable automatic-maintenance backend.
- The fallback `MemoryVectorIndex` is read-only for automatic maintenance.
- Background status must not claim updates are running when the durable mutation path is unavailable.
- OPFS loss after a previously prepared index or an incompatible profile leads to explicit prepare/rebuild UX, not silent provider work. Only a genuinely uninitialized first-use Chat is eligible for the DEC-028 silent path.
- Old vault-visible JSON cache/state files are historical user-owned artifacts and are not the active fallback.

## Packaging

- Runtime package: `@sqlite.org/sqlite-wasm`.
- `src/vss/sqlite-inline-assets.ts` resolves the bundled WASM bytes.
- The Worker source and WASM payload are prepared as inline object URLs so normal plugin packaging remains `main.js`, `manifest.json`, and `styles.css`.
- Any future external Worker/WASM asset change must audit build, deploy, release, install, and docs together.

## Validation Boundary

Current automated coverage includes worker initialization/disposal, OPFS locking, data-safety migration, vector index operations, hybrid search, dirty/verify behavior, rebuild/refresh, and Memory policy paths.

The B-126 first-use contract additionally requires focused coverage for immediate answer-now/no Modal, active-run reuse, durable success versus total failure/abort/marker-publication failure, retained confirmation for recovery/manual paths, Memory disable/unload cleanup, and unknown-marker preflight that preserves the old index/marker with zero reset/provider calls. See the [B-126 Product Spec](../product/specs/pa-silent-first-use-memory-preparation-product-spec.md); mocked mobile coverage is not real-device proof.

Desktop and real-device iOS evidence exist for the current Memory path. Physical Android validation remains in [Backlog B-003](../backlog.md#下一步可执行); do not infer Android parity from desktop or iOS.

## Current Limits

- Exact search loads/caches vectors in the Worker and remains O(n); it reduces UI-thread coupling but does not remove vector-cache memory cost.
- ANN and quantization are not active.
- Manual/background refresh does not yet share rebuild's global cross-file batch pipeline.
- Provider token estimation is conservative rather than tokenizer-exact.
- OPFS and IndexedDB are local cache/state, so clearing browser/app storage can require explicit Memory preparation again.

## Related Docs

- [Embedding Refresh](./vss-embedding-refresh.md)
- [Local State](./vss-local-state-plan.md)
- [Architecture Overview](./architecture-overview.md)
- [Historical pre-migration design](../archive/vss-sqlite-wasm-architecture-pre-official-wasm-migration.md)
- [Historical implementation tracker](../archive/vss-sqlite-wasm-development-tracker.md)
