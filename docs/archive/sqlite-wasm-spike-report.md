# SPEC-A6 Spike: SQLite WASM Compatibility

**Date**: 2026-06-15
**Scope**: Verify whether `@sqlite.org/sqlite-wasm` can replace `@sqliteai/sqlite-wasm` for the v2.3 migration.

---

## 1. API Compatibility: PASS (with minor changes)

### Default export

| Aspect | @sqliteai/sqlite-wasm | @sqlite.org/sqlite-wasm | Compatible? |
|---|---|---|---|
| Default export | `sqlite3InitModule` (function) | `init` (aliased as `default`) | YES - same signature |
| Accepted options | `{ locateFile, printErr, ... }` | `{ locateFile, printErr, ... }` (Emscripten Module) | YES |
| Return value | `Promise<Sqlite3Static>` | `Promise<Sqlite3Static>` | YES |
| `globalThis.sqlite3ApiConfig` | Supported | Supported | YES |

Both packages wrap the same upstream Emscripten-generated `sqlite3InitModule`. The `@sqlite.org` package re-exports it as `default` under the name `init`, but the runtime function object is identical in shape. The import in `sqlite-worker.ts` would change from:

```ts
// Before
import sqlite3InitModule from "@sqliteai/sqlite-wasm";
// After
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
```

No other change needed -- the default export is a callable with the same `locateFile`/`printErr` options.

### OPFS SAH Pool

| Aspect | @sqliteai | @sqlite.org | Compatible? |
|---|---|---|---|
| `installOpfsSAHPoolVfs` | Present on module | Present on module | YES |
| Options: `name` | Supported | Supported | YES |
| Options: `directory` | Supported | Supported | YES |
| Options: `initialCapacity` | Supported | Supported | YES |
| Options: `verbosity` | Supported | Supported (runtime, not in .d.mts) | YES |
| Options: `forceReinitIfPreviouslyFailed` | Supported | Supported (runtime, not in .d.mts) | YES |
| Options: `clearOnInit` | Supported | Supported | YES |
| Return: `OpfsSAHPoolDb` constructor | Present on pool util | Present on pool util | YES |
| `pauseVfs()` | Present (optional) | Present (typed) | YES |
| `isPaused()` | Present (optional) | Present (typed) | YES |

**Directory default**: Both use `options.directory || "." + this.vfsName`. The code already passes an explicit directory (`/personal-assistant-vss`), so the default is irrelevant.

### OO1 Database API (exec, prepare, bind, step, etc.)

Both packages expose the same OO1 API surface. The `exec({ sql, bind, rowMode, resultRows })`, `prepare()`, `bind()`, `bindAsBlob()`, `step()`, `reset()`, `finalize()`, and `close()` methods are all present with identical signatures in the `@sqlite.org` package.

### FTS5

Both packages bundle FTS5. Schema creation with `CREATE VIRTUAL TABLE ... USING fts5(...)` is standard SQLite and works identically.

### Exports map: `./sqlite3.wasm`

| Package | Export path | Physical path |
|---|---|---|
| @sqliteai | `./sqlite3.wasm` | `./sqlite-wasm/jswasm/sqlite3.wasm` |
| @sqlite.org | `./sqlite3.wasm` | `./dist/sqlite3.wasm` |

Both expose `./sqlite3.wasm` in their exports map. The import in `sqlite-inline-assets.ts` would change from:

```ts
// Before
import getSqliteWasmBinary from "@sqliteai/sqlite-wasm/sqlite3.wasm";
// After
import getSqliteWasmBinary from "@sqlite.org/sqlite-wasm/sqlite3.wasm";
```

The `lazyBinaryPlugin` in `esbuild.config.mjs` resolves via esbuild's default resolver (no special onResolve), so it will pick up the new path automatically -- no esbuild config change needed.

---

## 2. Vector SQL Functions: NOT PRESENT (expected, by design)

The following 3 SQL functions are **vendor-specific extensions** from `@sqliteai` and do **not** exist in `@sqlite.org`:

1. `vector_init('table', 'column', 'type=FLOAT32,...')` -- called in `initializeVectorColumn()`
2. `vector_as_f32(blob)` -- called in `upsertFile()` and `search()`/`searchHybrid()`
3. `vector_full_scan('table', 'column', query, k)` -- called in `search()` and `searchHybrid()`

**Usage sites in sqlite-worker.ts**:
- Line 415: `vector_init` (1 call site)
- Line 447: `vector_as_f32` in INSERT (1 call site)
- Lines 559, 607: `vector_full_scan` + `vector_as_f32` in SELECT (2 call sites)

**Replacement strategy** (per SPEC-A6 plan): Replace with JS brute-force cosine search. The `vector_init` call becomes a no-op (or is removed). `vector_as_f32` is replaced by direct BLOB storage/retrieval. `vector_full_scan` is replaced by `bruteForceTopK`.

---

## 3. JS Brute-Force Performance: ACCEPTABLE

Benchmark: 10,000 vectors, 1024 dimensions, top-10 queries.

| Metric | Value |
|---|---|
| Cold query | 22.96ms |
| Avg (100 queries) | 16.46ms |
| P50 | 14.43ms |
| P95 | 30.86ms |
| P99 | 83.36ms |
| Max | 83.36ms |
| Memory (vectors only) | ~39.1MB |

**Assessment**: For the expected vault size (typical: 1k-5k chunks, max: ~10k chunks), the P50 of ~14ms is well within the 500ms search deadline already set in `searchHybrid()`. Even at P99 (83ms), it is acceptable. The test was run on a desktop (Apple Silicon); mobile will be slower, but 10k chunks is an extreme case for mobile vaults.

**Note**: The benchmark runs on Node.js (V8). Browser WASM workers use V8/SpiderMonkey JIT which should give similar or better performance for typed array operations. The sort step dominates at high vector counts; for production, a partial-sort or min-heap could improve P95/P99 by ~30%.

---

## 4. OPFS Compatibility: PASS

| Aspect | Assessment |
|---|---|
| `installOpfsSAHPoolVfs` exists | YES |
| SAH pool directory convention | Identical: `options.directory \|\| "." + vfsName` |
| Database open via `new OpfsSAHPoolDb(name, "c")` | YES, same constructor |
| Read existing OPFS databases | YES -- both use the same SAH pool file format (metadata header + SQLite pages). The file format is determined by SQLite itself, not the JS wrapper. |

**Migration path for existing data**: No data migration needed. The OPFS directory (`/personal-assistant-vss`) and database file format are controlled by the SQLite engine, not the JS wrapper. Switching packages is transparent to existing OPFS data.

**Caveat**: The `verbosity` and `forceReinitIfPreviouslyFailed` options are supported at runtime in `@sqlite.org` but are **not declared in the TypeScript types** (`.d.mts`). The worker code will need a type assertion or `@ts-expect-error` for these two options until upstream adds them to the type declarations.

---

## 5. WASM Binary Size Comparison

| Package | WASM size | Notes |
|---|---|---|
| @sqliteai/sqlite-wasm | 941 KB | Includes vector extension |
| @sqlite.org/sqlite-wasm | 844 KB | Standard SQLite (no vector extension) |
| **Delta** | **-97 KB (-10.3%)** | Vector logic moves to JS |

After base64 encoding for inline bundling, the savings translate to ~130 KB smaller base64 string in the bundle, plus the vector extension JS code is no longer loaded.

---

## 6. Migration Code Changes Estimate

### Files requiring changes (3 files, ~15 lines)

1. **`src/vss/sqlite-worker.ts`** (~10 lines)
   - Line 2: Change import path
   - Line 415: Remove or no-op `vector_init` call
   - Line 447: Remove `vector_as_f32()` wrapper (store raw BLOB)
   - Lines 549-585: Rewrite `search()` to load embeddings from DB, run `bruteForceTopK`
   - Lines 598-614: Rewrite vector leg of `searchHybrid()` similarly

2. **`src/vss/sqlite-inline-assets.ts`** (1 line)
   - Line 2: Change import path from `@sqliteai/sqlite-wasm/sqlite3.wasm` to `@sqlite.org/sqlite-wasm/sqlite3.wasm`

3. **`package.json`** (1 line)
   - Swap `@sqliteai/sqlite-wasm` dependency for `@sqlite.org/sqlite-wasm`

### Files NOT requiring changes

- **`esbuild.config.mjs`**: No changes needed. The `lazyBinaryPlugin` and `inlineSqliteWorkerPlugin` are generic; they resolve via esbuild's default resolver.
- **`src/vss/sqlite-vector-index.ts`**: Worker communication protocol is vendor-agnostic. No changes.
- **`src/vss/sqlite-worker-protocol.ts`**: Message types are unchanged.
- **All other `src/vss/*.ts` files**: Only interact via the worker protocol.

### New file needed (1 file, ~40 lines)

- **`src/vss/brute-force-search.ts`**: Pure-JS `bruteForceTopK` function (cosine similarity over Float32Array map).

---

## 7. Risk Assessment

| Risk | Level | Mitigation |
|---|---|---|
| API incompatibility | LOW | APIs are identical (same upstream Emscripten build) |
| OPFS data loss | NONE | Same file format, same directory conventions |
| Performance regression (vector search) | LOW | JS brute-force P50 ~14ms vs compiled extension; acceptable for 10k vectors |
| Missing TypeScript types for `verbosity`/`forceReinit` | LOW | Use type assertion; file upstream issue |
| Bundle size regression | NONE | -97 KB WASM, +~2 KB JS brute-force = net reduction |

---

## 8. Conclusion: RECOMMEND MIGRATION

The `@sqlite.org/sqlite-wasm` package is a drop-in replacement for `@sqliteai/sqlite-wasm` for all standard SQLite operations (exec, prepare, OPFS SAH pool, FTS5). The 3 vendor-specific vector SQL functions (`vector_init`, `vector_as_f32`, `vector_full_scan`) are not present, but a JS brute-force replacement performs acceptably (P50 ~14ms for 10k x 1024-dim vectors).

**Key benefits of migration**:
1. Official SQLite team package -- better long-term maintenance
2. 97 KB smaller WASM binary (-10.3%)
3. Removes dependency on third-party vector extension
4. JS brute-force is easier to debug and optimize than compiled WASM extension

**Estimated effort**: 1-2 hours for the migration itself, plus testing.
