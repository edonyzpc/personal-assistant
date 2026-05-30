# SDD: WASM 懒加载

**Status:** Implemented; historical design record
**Phase:** 3.3

---

## Implementation Status (2026-05-30)

This SDD has been implemented in current code. `esbuild.config.mjs` uses `lazyBinaryPlugin`, and `src/vss/sqlite-inline-assets.ts` obtains the WASM bytes through `getSqliteWasmBinary()` only when building the inline SQLite WASM URL.

Regression coverage exists in `__tests__/sqlite-inline-assets.test.ts`. This document is retained as a historical design record, not as an open implementation plan.

---

## 1. Context

插件包含 SQLite WASM 二进制（~941KB）用于向量相似度搜索（Memory）。设计时的打包/加载方式是：

- esbuild `binary` loader 处理 `.wasm` import
- 构建期生成 `NM("AGFzbQ...")` 调用，模块评估时立即解码为 `Uint8Array`
- 即便用户从未使用 Memory，模块加载即占用堆内存

**实测数据（`dist/main.js`）:**
- Bundle 总大小：3,340,025 bytes（~3.2MB）
- base64 WASM 字符串：~1,285,147 bytes（~1.22MB，**38.5%** of bundle）
- 解码后 Uint8Array：~941KB
- **插件加载时 WASM 占堆约 2.2MB**

WASM 实际使用发生在：`createSqliteIndex()`（`vss.ts:1827-1836`）→ `getInlineSqliteWasmUrl()` + `createInlineSqliteWorker()`，触发于 Memory 操作（首次发生在 `MemoryManager` 启动 60s 延迟后的 reconcile）。

**核心矛盾:** WASM 字节在插件加载瞬间分配，但实际使用至少在数十秒后，且不用 Memory 的用户永远不需要。

---

## 2. Goals

1. 插件加载时不解码 WASM Uint8Array
2. 仅在首次 Memory 操作时按需解码
3. 解码后释放 base64 字符串（允许 GC）
4. 不破坏现有 Web Worker 通信流程
5. 不增加 mobile 平台风险

## Non-goals

- 不改 WASM 文件本身或 SQLite 接入逻辑
- 不分离 WASM 为外部 sidecar 文件（避免 multi-file packaging）
- 不切换 esbuild 到 ESM/code-splitting（破坏 Obsidian CJS 兼容性）

---

## 3. 方案对比与选型

### Option A: Dynamic `import()` of WASM module
- esbuild 当前 `splitting: false` + `format: "cjs"`，dynamic import 在打包后退化为同步 require
- 整个模块图仍同步评估，**无效**
- 切 ESM + splitting 破坏 Obsidian 兼容性

❌ **不可行**

### Option B: `fetch()` on demand from sidecar
- 把 `.wasm` 作为独立文件随插件分发
- 多文件打包改动大，新增故障点（CORS、文件丢失、mobile 路径）
- 偏离当前 single-file plugin + inlined worker 设计哲学

⚠️ **可行但不推荐**

### Option C（推荐）: 延迟模块评估 + lazy decode

核心洞察：esbuild `binary` loader 的解码发生在模块评估时。改为自定义 esbuild 插件，把 `.wasm` 编译为返回 Uint8Array 的**惰性 getter 函数**，base64 字符串作为常量保留在 bundle 中，仅在首次调用时 `atob` 解码并缓存。

✅ **改动 3 文件，零包装变更，0 mobile 风险**

---

## 4. Spec

### 4.1 esbuild 自定义插件

替换 `'.wasm': 'binary'` 为 `lazyBinaryPlugin`：

```javascript
const lazyBinaryPlugin = {
    name: "lazy-binary-wasm",
    setup(build) {
        // 实施提示: 不要写 onResolve。这里的 `path.resolve(args.resolveDir, args.path)`
        // 对 bare module 导入（如 `@sqliteai/sqlite-wasm/sqlite3.wasm`）会算成
        // `<resolveDir>/@sqliteai/...` 这种无效路径。让 esbuild 默认 resolver 走 node_modules，
        // 再用默认 file namespace 的 onLoad 拦截 `.wasm$` 即可。
        build.onLoad({ filter: /\.wasm$/ }, async (args) => {
            const { readFile } = require("node:fs/promises");
            const bytes = await readFile(args.path);
            const base64 = bytes.toString("base64");
            return {
                contents: `
var _b64 = ${JSON.stringify(base64)};
var _decoded = null;
var _decoding = null;  // Promise 锁 —— 防御未来并发调用
export default function getSqliteWasmBinary() {
    if (_decoded !== null) return _decoded;
    // 同步路径：当前消费者全是同步调用，第一次进入即完成解码
    var b = atob(_b64);
    _decoded = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) _decoded[i] = b.charCodeAt(i);
    _b64 = null;
    return _decoded;
}
// 异步导出（暂未消费，但保留契约以便未来 dynamic import 切换）
export function getSqliteWasmBinaryAsync() {
    if (_decoded !== null) return Promise.resolve(_decoded);
    if (_decoding !== null) return _decoding;
    _decoding = Promise.resolve().then(() => {
        if (_decoded !== null) return _decoded;
        var b = atob(_b64);
        _decoded = new Uint8Array(b.length);
        for (var i = 0; i < b.length; i++) _decoded[i] = b.charCodeAt(i);
        _b64 = null;
        return _decoded;
    });
    return _decoding;
}
`,
                loader: "js",
            };
        });
    },
};
```

**Diff:**
- **Before:** `NM("AGFzbQ...")` 模块评估时同步解码 → 立即占堆 941KB
- **After:** `_b64` 是普通字符串常量，模块评估**只是引用**，首次调用 `getSqliteWasmBinary()` 才 `atob` 解码并 `_b64 = null` 释放原始字符串

**并发解码保护（Promise lock）:**

当前调用链是同步的（`getInlineSqliteWasmUrl()` → `getSqliteWasmBinary()`），第一次进入即完成解码，不存在竞态。但保留 `getSqliteWasmBinaryAsync()` + `_decoding` Promise 锁有两个原因：
1. **防御未来重构** — 一旦切换到 dynamic chunk lazy import（§7 进一步优化），多消费者并发可能出现，Promise 锁保证只解码一次
2. **签名一致性** — 同步 + 异步两条契约同时存在，未来切换异步无需改 plugin 设计

### 4.2 `sqlite-inline-assets.ts` 改动

```diff
- import sqliteWasmBinary from "@sqliteai/sqlite-wasm/sqlite3.wasm";
+ import getSqliteWasmBinary from "@sqliteai/sqlite-wasm/sqlite3.wasm";

  let cachedSqliteWasmUrl: string | null = null;

  export function getInlineSqliteWasmUrl(): string {
      if (cachedSqliteWasmUrl === null) {
-         const blob = new Blob([sqliteWasmBinary], { type: "application/wasm" });
+         const blob = new Blob([getSqliteWasmBinary()], { type: "application/wasm" });
          cachedSqliteWasmUrl = URL.createObjectURL(blob);
      }
      return cachedSqliteWasmUrl;
  }
```

`cachedSqliteWasmUrl` 已有惰性逻辑，只需在第一次调用时把 `Uint8Array` 取出即可。Blob 构造完成后底层数据被 Blob 持有，与 `_decoded` 共享同一块内存，**无额外拷贝**。

### 4.3 TypeScript 类型声明（`src/types/assets.d.ts`）

`.wasm` import 当前依赖 esbuild loader，TypeScript 不识别。该文件**已存在**（含 `*.md` 和 `*?worker-source` 声明），本次只**修改其中的 `*.wasm` 块**，从值导入声明改为函数导入声明：

```typescript
// src/types/assets.d.ts
declare module "*.wasm" {
    const getBinary: () => Uint8Array;
    export default getBinary;
    export function getSqliteWasmBinaryAsync(): Promise<Uint8Array>;
}
```

`tsconfig.json` 的 `include` 已覆盖 `src/**/*`（包含 `*.d.ts`）。如果消费者使用 `import` 语句而非 `import =`，需确认 `esModuleInterop: true`（当前已是 true，`tsconfig.json:18`）。

### 4.4 Jest mock 拆分（split-mock 方案）

**约束发现:** 原 jest 配置把 `\.wasm$` 和 `\?worker-source$` 都映射到 `__mocks__/asset-string.js`。如果把 asset-string.js 改成函数返回，会同时破坏 `?worker-source` 消费者 —— 后者把值喂给 `new Blob([sqliteWorkerSource], { type: "text/javascript" })`（见 `sqlite-inline-assets.ts:5`），期望的是字符串/Uint8Array 值而非函数。

**Canonical 方案:** 拆分为两个独立 mock，互不影响。

新建 `__mocks__/wasm-binary-fn.js`（仅服务 `*.wasm`）：

```javascript
// Jest mock for `*.wasm` imports. Mirrors lazyBinaryPlugin's emitted shape: a sync default
// getter + named getSqliteWasmBinaryAsync. Actual bytes do not matter — tests that
// exercise the wasm payload mock SqliteVectorIndex itself.
const _bytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
function getSqliteWasmBinary() { return _bytes; }
function getSqliteWasmBinaryAsync() { return Promise.resolve(_bytes); }
module.exports = getSqliteWasmBinary;
module.exports.default = getSqliteWasmBinary;
module.exports.getSqliteWasmBinaryAsync = getSqliteWasmBinaryAsync;
```

修改 `jest.config.js` 的 `moduleNameMapper`：

```diff
  moduleNameMapper: {
-     "\\.wasm$": "<rootDir>/__mocks__/asset-string.js",
+     "\\.wasm$": "<rootDir>/__mocks__/wasm-binary-fn.js",
      "\\?worker-source$": "<rootDir>/__mocks__/asset-string.js",
  },
```

`__mocks__/asset-string.js` 保持值导出不动（继续给 `?worker-source` 用），但**更新注释**澄清它现在只服务 worker-source，不再服务 wasm（避免误导后续维护）。

**为什么不合并成单一 dual-purpose mock:** 试过 `module.exports = function(){...}; module.exports.default = module.exports;` 这种 hybrid 形态可以同时通过 jest 解析为函数和值（typeof = function 但可以被 Blob 接受），但语义混乱、调用方读不出契约。拆分清晰，对应 plugin 真实 emit 形状。

### 4.5 Worker 流程不变

`inlineSqliteWorkerPlugin` 把 worker 单独打成子 bundle 内联为字符串。Worker 内部 `import sqlite3InitModule from "@sqliteai/sqlite-wasm"`（JS 模块，非 `.wasm`），通过 `wasmUrl` postMessage 接收 URL，由 `locateFile` 回调使用。**Worker 不直接 import `.wasm`，无改动。**

---

## 5. 内存收益

| 状态 | 当前 | 优化后 |
|------|------|------|
| 插件加载，base64 字符串 | ~1.25MB（V8 heap） | ~1.25MB（同） |
| 插件加载，Uint8Array | **~941KB**（立即分配） | **0KB**（延迟） |
| 首次 Memory 操作 | 0KB（已分配） | +941KB（按需） |
| Blob 建立后 | 0KB（共享 buffer） | 0KB（同） |
| `_b64 = null` 后 | N/A | **-1.25MB**（GC 字符串） |
| **插件加载净占用** | **~2.2MB** | **~1.25MB** |
| **首次使用后稳态** | **~2.2MB** | **~941KB** |

- 不用 Memory 用户永久节省 ~941KB
- 用户首次进入 Memory 流程后，长期内存占用反而比当前**更低**（base64 字符串被 GC）

---

## 6. Implementation Steps

### 文件: `esbuild.config.mjs`
1. 顶部加 `import { readFile } from 'node:fs/promises';`（plugin onLoad 用）
2. 删除 loader map 中的 `'.wasm': 'binary'`
3. 新增 `lazyBinaryPlugin` 定义（含同步 + 异步两条 export）
4. 加入 `plugins` 数组（在 `inlineSqliteWorkerPlugin` 前后均可）

**注:** plugin 实施时 `onResolve` 阶段需要让 esbuild 默认 resolver 走 node_modules（处理 bare module 如 `@sqliteai/sqlite-wasm/sqlite3.wasm`）。最简形态是**不写 onResolve**，只在默认 `file` namespace 用 `build.onLoad({ filter: /\.wasm$/ }, ...)` 拦截。§4.1 伪代码里的 `onResolve` 是示意，实施时不要照搬 `path.resolve(args.resolveDir, args.path)` —— 那对 bare module 路径不成立。

### 文件: `src/types/assets.d.ts`（修改已有文件）
5. 重写 `*.wasm` 块为函数声明（参见 §4.3），保留 `*.md` 和 `*?worker-source` 块不变

### 文件: `src/vss/sqlite-inline-assets.ts`
6. import 默认导入从值改为函数（line 2）
7. `getInlineSqliteWasmUrl()` 改调函数

### 文件: `__mocks__/wasm-binary-fn.js`（新增）
8. 创建 function-shaped mock（参见 §4.4）

### 文件: `jest.config.js`
9. `moduleNameMapper` 里 `*.wasm` remap 到 `wasm-binary-fn.js`（参见 §4.4）

### 文件: `__mocks__/asset-string.js`
10. 仅更新文件顶部注释（说明它现在只服务 `?worker-source`），导出值不变

### 验证
11. `tsc -noEmit -skipLibCheck`（确认类型声明生效）
12. `npm test`（确认现有 sqlite/vss 测试通过）
13. `npm run build`（确认输出文件中 base64 仍存在但被函数包裹）
14. `npm run audit:bundle`（gzip 预算）
15. 手动 Obsidian 装载 + Memory 端到端（延后到 release 前统一）

---

## 7. 进一步优化（不在本 SDD 范围）

**完整 VSS 模块 lazy import**：当前 `plugin.ts` 静态 import `VSS`（line 8），导致 vss.ts（97KB 源码）在插件加载时同步评估。

```typescript
// 概念性代码，本 SDD 不实施
private async initVss() {
    const { VSS } = await import('./vss');
    return new VSS(this, this.vssCacheDir, this.createVSSIndexStateStore());
}
```

esbuild `splitting: false` 把 dynamic import 退化为 require，需要类似 `inlineSqliteWorkerPlugin` 的自定义 async chunk 方案。**未来 work**，需评估改造成本。

---

## 8. Test Plan

### 已有测试不变
- 全部 vss/sqlite 测试通过 mock 后保持兼容（mock 改为函数）
- `npm test` 全量回归

### 手动验证
1. **插件冷启动:**
   - 启动前后 Obsidian 主进程内存对比（DevTools Memory profiler）
   - 期望：插件加载完后 heap 增量比当前少 ~941KB
2. **Memory 首次使用:**
   - 触发任意 memory 搜索
   - 验证：搜索成功，VSS 索引正常构建
   - 内存：解码后 +941KB，base64 字符串 GC 后 -1.25MB
3. **Mobile（iOS/Android）:**
   - 装载插件 + Memory 流程端到端
   - 验证 `atob` 性能（量级 10-100ms，与设备 CPU 强相关；不卡 UI 即可，不卡死阈值具体值）
4. **Bundle audit:**
   - `node scripts/audit-bundle.mjs`
   - 验证 gzip size 在预算内
5. **WASM 字节内容一致性:**
   - 建议增加单测：mock 一个 WASM 文件，对比 `getSqliteWasmBinary()` 返回值与 esbuild `binary` loader 字节相等

---

## 9. Risks

| 风险 | 影响 | 缓解 |
|------|------|------|
| 类型从值变函数导致漏改 call site | 中 | grep 全仓 `sqliteWasmBinary` 确认仅 `sqlite-inline-assets.ts` 直接消费；mock 同步更新 |
| `atob` 解码差异 | 极低 | 与 `sqlite-vector-index.ts:407-412` 既有 `decodeBase64` 模式一致 |
| Worker sub-bundle 受影响 | 无 | Worker 不 import `.wasm`，验证已确认 |
| 首次使用增加解码延迟 | 极低 | 量级 10-100ms（设备相关），相比 SQLite WASM 初始化（100-500ms）可忽略 |
| Mobile WebView 兼容 | 低 | `atob` + Uint8Array 在所有 modern WebView 支持 |
| Jest mock 调用契约改变 | 低 | mock 文件同步改为函数 |
| esbuild 自定义 plugin 异常 | 中 | 失败时构建直接报错，不进生产 |
| 首次解码并发竞态 | 极低 | 当前同步路径无竞态；预留 `getSqliteWasmBinaryAsync()` + Promise 锁防御未来 dynamic import 切换 |
| TypeScript 不识别 `.wasm` 默认导入 | 中 | 新增 `src/types/assets.d.ts` 声明，esModuleInterop 已开启 |

---

## 10. Rollback

直接还原 5 个文件（含一个 mock 新增）：

1. `esbuild.config.mjs`
   - 恢复 loader map 里 `'.wasm': 'binary'`
   - 移除 `lazyBinaryPlugin` 定义和 plugins 数组里的引用
   - 移除顶部 `import { readFile } from 'node:fs/promises';`（如果只有 plugin 用到它）
2. `src/vss/sqlite-inline-assets.ts`
   - 恢复 `import sqliteWasmBinary from "@sqliteai/sqlite-wasm/sqlite3.wasm";`
   - `getInlineSqliteWasmUrl()` 内部恢复 `new Blob([sqliteWasmBinary], ...)`
3. `src/types/assets.d.ts`
   - **只 revert `*.wasm` 块**，恢复为 `const source: Uint8Array; export default source;`
   - 文件本身保留（含 `*.md` 和 `*?worker-source` 声明）
4. `jest.config.js`
   - 恢复 `"\\.wasm$": "<rootDir>/__mocks__/asset-string.js"`
5. `__mocks__/wasm-binary-fn.js`
   - **删除文件**（rollback 后无消费者）

**注意:** `__mocks__/asset-string.js` 在本 PR 中**没有改过实际导出**（只更新了文件顶部注释），rollback 时只需 revert 注释回到原描述即可。

---

## 11. Verification Checklist

Historical SDD checklist. Current code/test status is tracked in `docs/v2-fix-plan.md`; do not treat unchecked boxes here as current release blockers without re-auditing the code.

- `tsc -noEmit -skipLibCheck`
- `npm test`
- `npm run build`
- `npm run audit:bundle`
- DevTools heap snapshot 对比（cold/warm 各取一次）
- iOS Obsidian 实测 Memory 流程
- Android Obsidian 实测 Memory 流程
- 验证 `dist/main.js` 中 `_b64 = "..."` 字符串存在 + `getSqliteWasmBinary` 函数存在

---

## 12. Critical Files

**修改:**
- `esbuild.config.mjs` — `lazyBinaryPlugin` 实现 + 移除 loader 里的 `.wasm` 条目 + 顶部加 `readFile` import
- `src/types/assets.d.ts` — **修改**（已有文件）`*.wasm` 模块类型声明从值改函数
- `src/vss/sqlite-inline-assets.ts` — import 名 + Blob 构造改函数调用
- `jest.config.js` — `moduleNameMapper` 里 `*.wasm` remap 到新 mock
- `__mocks__/asset-string.js` — **仅更新注释**（明确只服务 `?worker-source`），导出值不变

**新增:**
- `__mocks__/wasm-binary-fn.js` — `*.wasm` 专用 function-shaped mock，匹配 plugin 契约

**阅读参考（无需改动）:**
- `src/vss.ts` — 理解调用链
- `src/plugin.ts` — 理解 lifecycle
- `tsconfig.json` — 确认 esModuleInterop: true 已启用

---

## 13. Historical Workflow

1. 设计记录定稿并通过 review。
2. 原计划通过独立开发分支或 worktree 实施，避免与其他 Phase 3 项目互相阻塞。
3. 完成 TypeScript、Jest、lint/build 与必要的 Obsidian smoke 验证后合入。

This workflow is historical because WASM lazy loading is implemented in current code.
