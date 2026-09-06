/* B-129 P0 resource feasibility only; no production Chat/provider changes.
 * eval this file, then await runB129ResourceProbe(app, { runId: 'unique-id' }).
 * All files are new synthetic test-vault artifacts. The independent IDB is
 * removed after the run. Checkpoints separate actual observations from faults.
 */
(() => {
  const MiB = 1024 * 1024;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const errorText = (error) => String(error?.message ?? error);
  function deadline(promise, ms, label) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })])
      .finally(() => clearTimeout(timer));
  }
  const sha = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  const candidates = Object.freeze({ maxOriginalBytes: 20 * MiB, maxDecodedPixels: 48000000,
    maxImagesPerTurn: 8, maxVariantBytes: 4 * MiB, maxRequestImageBytes: 24 * MiB,
    processingTimeoutMs: 15000 });

  // Only JPEG/PNG inputs are admitted by this resource probe. Format coverage
  // belongs to the independent G-01 runner. Dimensions are read before decode.
  function dimensions(bytes) {
    const data = new Uint8Array(bytes);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length >= 24 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) {
      return { width: view.getUint32(16), height: view.getUint32(20), mime: 'image/png' };
    }
    if (data[0] !== 255 || data[1] !== 216) throw new Error('probe_requires_jpeg_or_png');
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset] !== 255) throw new Error('invalid_jpeg_header');
      while (data[offset] === 255) offset += 1;
      const marker = data[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > data.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > data.length) throw new Error('invalid_jpeg_segment');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw new Error('invalid_jpeg_dimensions');
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3), mime: 'image/jpeg' };
      }
      offset += length;
    }
    throw new Error('jpeg_dimensions_missing');
  }
  function admit(bytes, policy = candidates) {
    if (bytes.byteLength > policy.maxOriginalBytes) throw new Error('original_byte_budget');
    const size = dimensions(bytes);
    if (!size.width || !size.height || size.width * size.height > policy.maxDecodedPixels) {
      throw new Error('decoded_pixel_budget');
    }
    return size;
  }

  function resources() { return { activeImages: 0, activeCanvases: 0, activeUrls: 0,
    maxActiveImages: 0, maxActiveCanvases: 0, maxActiveUrls: 0 }; }
  function track(state, name, delta) {
    state[name] += delta;
    const maximum = `max${name[0].toUpperCase()}${name.slice(1)}`;
    state[maximum] = Math.max(state[maximum], state[name]);
  }

  // Cleanup is synchronous when cancellation/timeout wins. A callback arriving
  // later can neither recreate resources nor publish a result. Low-level native
  // work may continue internally: these counters measure owned references only.
  function processImage(bytes, options = {}) {
    const policy = options.policy ?? candidates;
    const size = admit(bytes, policy);
    const state = options.state ?? resources();
    const signal = options.signal;
    const started = performance.now();
    return new Promise((resolve, reject) => {
      let settled = false;
      let url;
      let image;
      let canvas;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (image) { image.onload = null; image.onerror = null; image.src = ''; image = null; track(state, 'activeImages', -1); }
        if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null; track(state, 'activeCanvases', -1); }
        if (url) { URL.revokeObjectURL(url); url = null; track(state, 'activeUrls', -1); }
      };
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(new Error('cancelled'));
      if (signal?.aborted) { finish(new Error('cancelled')); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => finish(new Error('processing_timeout')), options.timeoutMs ?? policy.processingTimeoutMs);
      try {
        image = new Image(); track(state, 'activeImages', 1);
        url = URL.createObjectURL(new Blob([bytes], { type: size.mime })); track(state, 'activeUrls', 1);
        image.onerror = () => finish(new Error('native_decode_failed'));
        image.onload = () => {
          if (settled) return;
          try {
            const width = image.naturalWidth;
            const height = image.naturalHeight;
            if (!width || !height || width * height > policy.maxDecodedPixels) throw new Error('decoded_pixel_budget');
            const scale = Math.min(1, (options.edge ?? 2048) / Math.max(width, height));
            canvas = document.createElement('canvas'); track(state, 'activeCanvases', 1);
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('canvas_context_unavailable');
            context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const outputWidth = canvas.width;
            const outputHeight = canvas.height;
            const onBlob = (blob) => {
              if (settled) return;
              if (!blob || blob.type !== 'image/jpeg') { finish(new Error('unexpected_output_mime')); return; }
              if (blob.size > policy.maxVariantBytes) { finish(new Error('variant_byte_budget')); return; }
              finish(null, { blob, decodedWidth: width, decodedHeight: height, outputWidth, outputHeight,
                outputBytes: blob.size, mime: blob.type, elapsedMs: Math.round(performance.now() - started) });
            };
            // Injectable callback wrappers exercise late completion without
            // claiming that a synthetic timeout represents a real slow decoder.
            canvas.toBlob(options.wrapCallback ? options.wrapCallback(onBlob) : onBlob, 'image/jpeg', options.quality ?? 0.9);
          } catch (error) { finish(error); }
        };
        image.src = url;
      } catch (error) { finish(error); }
    });
  }

  async function serialBatch(items, processOne, policy = candidates) {
    if (items.length > policy.maxImagesPerTurn) throw new Error('image_count_budget');
    const blobs = [];
    const reports = [];
    let totalBytes = 0;
    try {
      for (const item of items) {
        const result = await processOne(item);
        if (totalBytes + result.blob.size > policy.maxRequestImageBytes) throw new Error('request_image_byte_budget');
        totalBytes += result.blob.size;
        blobs.push(result.blob);
        const { blob, ...report } = result;
        reports.push(report);
      }
      return { reports, totalBytes, count: blobs.length };
    } finally { blobs.length = 0; }
  }

  function transaction(db, mode, callback) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('variants', mode);
      const timer = setTimeout(() => { try { tx.abort(); } catch (_) { /* Already finished. */ } reject(new Error('idb_transaction_timeout')); }, 15000);
      let value;
      tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error ?? new Error('idb_transaction_failed')); };
      try { value = callback(tx.objectStore('variants'), tx); } catch (error) { tx.abort(); reject(error); }
    });
  }
  function openDatabase(name, version = 1, upgrade) {
    if (!/^b129-resource-probe-[a-zA-Z0-9_-]+$/.test(name)) throw new Error('probe_database_required');
    return new Promise((resolve, reject) => {
      let abandoned = false;
      const request = indexedDB.open(name, version);
      const fail = (error) => { abandoned = true; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => fail(new Error('probe_database_open_timeout')), 15000);
      request.onupgradeneeded = () => {
        if (abandoned) { request.transaction.abort(); return; }
        if (upgrade) upgrade(request.result); else request.result.createObjectStore('variants', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => db.close(); resolve(db);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error('probe_database_blocked'));
    });
  }
  function deleteDatabase(name) {
    return deadline(new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('probe_database_delete_blocked'));
    }), 15000, 'probe_database_delete_timeout');
  }
  function evictionPlan(entries, pinned, incomingBytes, maxBytes) {
    if (incomingBytes > maxBytes) throw new Error('cache_item_over_capacity');
    let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    const evict = [];
    for (const [id, entry] of [...entries].sort((a, b) => a[1].used - b[1].used)) {
      if (bytes + incomingBytes <= maxBytes) break;
      if (!pinned.has(id)) { evict.push(id); bytes -= entry.bytes; }
    }
    if (bytes + incomingBytes > maxBytes) throw new Error('cache_all_entries_leased');
    return { evict, bytesAfter: bytes + incomingBytes };
  }
  function verifyCacheSnapshot(rows, entries, originalHash, reopenedHash) {
    const expectedIds = [...entries.keys()].sort();
    const actualIds = rows.map((entry) => entry.id).sort();
    assert(JSON.stringify(expectedIds) === JSON.stringify(actualIds), 'persisted_lru_keys_match');
    const expectedBytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    const actualBytes = rows.reduce((sum, entry) => sum + entry.blobBytes, 0);
    assert(expectedBytes === actualBytes, 'persisted_lru_capacity_match');
    assert(rows.every((entry) => entry.storedBytes === entry.blobBytes), 'persisted_blob_size_metadata_match');
    assert(originalHash === reopenedHash, 'blob_bytes_survive_close_reopen');
    return { ids: actualIds, count: rows.length, blobBytes: actualBytes, writeHash: originalHash,
      reopenedHash, persistedKeysMatch: true, persistedCapacityMatch: true, persistedHashMatch: true };
  }

  async function heldEncodeTimeout(bytes, state, timeoutMs = 100) {
    let late;
    let arrive;
    const arrived = new Promise((resolve) => { arrive = resolve; });
    const pending = processImage(bytes, { state, timeoutMs,
      wrapCallback: (callback) => (blob) => { late = () => callback(blob); arrive(); } });
    const outcome = await pending.then(() => 'unexpected_success', errorText);
    assert(outcome === 'processing_timeout', 'timeout_wins');
    // The underlying callback may itself be late. Require its actual arrival;
    // an absent callback is an unverified case, never lateIgnored:true.
    await deadline(arrived, 15000, 'late_encode_callback_not_observed');
    const cleanupBefore = { ...state };
    assert(state.activeImages === 0 && state.activeCanvases === 0 && state.activeUrls === 0, 'timeout_resources_released');
    late(); await delay(10);
    assert(JSON.stringify(cleanupBefore) === JSON.stringify(state), 'late_timeout_completion_no_resources');
    return { faultInjection: 'held actual Canvas result; forced deadline; actual held callback replayed after timeout',
      outcome, lateCallbackObserved: true, lateCallbackReplayed: true, lateIgnored: true,
      cleanupBefore, cleanupAfter: { ...state } };
  }

  async function storageEstimate() {
    try { return navigator.storage?.estimate ? await navigator.storage.estimate() : { unavailable: true }; }
    catch (error) { return { error: errorText(error) }; }
  }
  function memorySampler() {
    const samples = [];
    let stopped = false;
    let pending;
    const read = async () => {
      const sample = { atMs: Math.round(performance.now()), jsHeapBytes: performance.memory?.usedJSHeapSize ?? null };
      if (typeof process !== 'undefined' && typeof process.getProcessMemoryInfo === 'function') {
        sample.processKiB = await deadline(process.getProcessMemoryInfo(), 2000, 'memory_sample_timeout');
      }
      if (!stopped) samples.push(sample);
    };
    const tick = () => {
      if (pending || stopped) return;
      pending = read().catch((error) => { if (!stopped) samples.push({ error: errorText(error) }); })
        .finally(() => { pending = undefined; });
    };
    tick();
    const interval = setInterval(tick, 100);
    return { async stop() {
      clearInterval(interval);
      await pending;
      await read().catch((error) => samples.push({ error: errorText(error) }));
      stopped = true;
      const max = (values) => values.length ? Math.max(...values) : null;
      return { samples, sampledMaxJSHeapBytes: max(samples.flatMap((s) => typeof s.jsHeapBytes === 'number' ? [s.jsHeapBytes] : [])),
        sampledMaxProcessPrivateKiB: max(samples.flatMap((s) => typeof s.processKiB?.private === 'number' ? [s.processKiB.private] : [])),
        method: '100 ms renderer sampling when exposed; unavailable on ordinary iOS WKWebView; sampled maximum is not certified whole-device peak' };
    } };
  }

  async function mkdir(vault, path) {
    const parts = path.split('/');
    for (let end = 1; end <= parts.length; end += 1) {
      const part = parts.slice(0, end).join('/');
      if (!await vault.adapter.exists(part)) await vault.createFolder(part);
    }
  }
  const assert = (condition, label) => { if (!condition) throw new Error(`probe_assertion:${label}`); };

  globalThis.runB129ResourceProbe = async (app, options = {}) => {
    if (app.vault.getName() !== 'test') throw new Error('test_vault_required');
    const runId = options.runId;
    if (typeof runId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('unique_run_id_required');
    const root = `b129-p0-resources/${runId}`;
    if (await app.vault.adapter.exists(root)) throw new Error('unique_run_required');
    await mkdir(app.vault, root);
    const phases = options.phases ?? ['images', 'cache', 'lifecycle', 'migration'];
    if (phases.some((phase) => !['images', 'cache', 'lifecycle', 'migration'].includes(phase))) throw new Error('unknown_probe_phase');
    const receipt = { kind: 'b129.resource-probe', version: 1, runId, status: 'running',
      startedAt: new Date().toISOString(), userAgent: navigator.userAgent,
      scope: 'synthetic host feasibility; independent cache; no production integration or provider',
      candidatePolicy: candidates, candidateValuesAreNotProductDefaults: true,
      stage: 'starting', completed: [], errors: [], originals: [], resources: resources() };
    globalThis.b129ResourceReceipt = receipt;
    const checkpoint = async () => app.vault.adapter.write(`${root}/checkpoint.json`, JSON.stringify(receipt, null, 2));
    const runCase = async (label, work) => {
      receipt.stage = label; await checkpoint();
      const sampler = memorySampler();
      const started = performance.now();
      let result;
      try { result = { label, status: 'passed', ...await work() }; }
      catch (error) { result = { label, status: 'failed', error: errorText(error), errorName: error?.name }; receipt.errors.push(result); }
      finally {
        const memory = await sampler.stop();
        result = { ...result, elapsedMs: Math.round(performance.now() - started), memory };
        receipt.completed.push(result); await checkpoint();
        await delay(40);
      }
      return result;
    };
    const fixtureRoot = 'b129-p0-fixtures';
    const manifest = JSON.parse(await app.vault.adapter.read(`${fixtureRoot}/manifest.json`));
    const readFixture = async (name) => {
      const entry = manifest.fixtures.find((item) => item.filename === name);
      if (!entry) throw new Error(`fixture_not_registered:${name}`);
      const bytes = await app.vault.adapter.readBinary(`${fixtureRoot}/${name}`);
      assert(await sha(bytes) === entry.sha256, `fixture_hash:${name}`);
      if (!receipt.originals.some((item) => item.name === name)) receipt.originals.push({ name, beforeHash: entry.sha256 });
      return bytes;
    };
    const outputImage = async (name, bytes, edge, quality = 0.9) => {
      const result = await processImage(bytes, { edge, quality, state: receipt.resources });
      const path = `${root}/${name}.jpg`;
      const output = await result.blob.arrayBuffer();
      await app.vault.createBinary(path, output);
      const { blob, ...metadata } = result;
      return { ...metadata, path, sha256: await sha(output) };
    };
    try {
      await checkpoint();
      if (phases.includes('images')) {
        for (const mp of [12, 24, 48]) {
          for (const edge of [1536, 2048, 3072]) {
            for (const quality of [0.8, 0.9]) {
              await runCase(`image-${mp}mp-${edge}-q${quality}`, async () => {
                const bytes = await readFixture(`resource-${mp}mp.jpg`);
                return { megapixels: mp, edge, quality, ...await outputImage(`resource-${mp}mp-${edge}-q${quality}`, bytes, edge, quality) };
              });
            }
          }
        }
        for (const count of [1, 2, 4, 8]) {
          await runCase(`serial-${count}-images`, async () => ({
            // Repeated synthetic source calibrates decode/resource concurrency,
            // not diversity, model context length, or photographic fidelity.
            ...await serialBatch(Array.from({ length: count }, (_, index) => index), async () => {
              const bytes = await readFixture('resource-12mp.jpg');
              return processImage(bytes, { edge: 2048, state: receipt.resources });
            }), resourcesAfter: { ...receipt.resources },
          }));
        }
        for (const fileMiB of [1, 5, 10, 20]) {
          await runCase(`encoded-${fileMiB}mib`, async () => {
            const bytes = await readFixture('chart-exif-orientation-6.jpg');
            const padded = new Uint8Array(fileMiB * MiB); padded.set(new Uint8Array(bytes));
            const result = await processImage(padded.buffer, { edge: 2048, state: receipt.resources });
            const { blob, ...metadata } = result;
            return { ...metadata, encodedBytes: padded.byteLength,
              fixtureKind: 'valid JPEG with synthetic trailing padding; isolates byte cost, not image entropy' };
          });
        }
        await runCase('small-text-comparison', async () => {
          const canvas = document.createElement('canvas');
          let bytes;
          try {
            canvas.width = 3200; canvas.height = 1800;
            const context = canvas.getContext('2d');
            context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = '#111';
            for (const [index, size] of [12, 16, 24, 36].entries()) {
              context.font = `${size}px monospace`;
              context.fillText(`${size} px ORIGINAL: ABCDEFGH 0123456789 retain all pictures and exact source`, 40, 80 + index * 90);
            }
            context.fillRect(40, 460, 200, 1);
            const blob = await deadline(new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('text_fixture_encode_failed')), 'image/png')), 15000, 'text_fixture_encode_timeout');
            bytes = await blob.arrayBuffer();
          } finally { canvas.width = 0; canvas.height = 0; }
          const originalPath = `${root}/small-text-original.png`;
          await app.vault.createBinary(originalPath, bytes);
          const outputs = [];
          for (const edge of [1536, 2048, 3072, 3200]) {
            outputs.push({ edge, ...await outputImage(`small-text-${edge}`, bytes, edge) });
          }
          return { originalPath, outputs, readable: 'requires visual inspection at 1:1; no automatic pass claim' };
        });
      }
      if (phases.includes('cache')) {
        for (const capacityMiB of [64, 128, 256]) {
          await runCase(`cache-${capacityMiB}mib`, async () => {
            const name = `b129-resource-probe-${runId}-${capacityMiB}`;
            const capacity = capacityMiB * MiB;
            let db;
            let deleted = false;
            const entries = new Map();
            const pinned = new Set();
            const evicted = [];
            let counter = 0;
            const estimateBefore = await storageEstimate();
            let bytesWritten = 0;
            let realQuotaExceeded = false;
            let writeHash;
            let report;
            try {
              db = await openDatabase(name);
              for (let index = 0; index < capacityMiB / 4 + 2; index += 1) {
                // Unique deterministic bytes prevent the probe from relying on
                // shared Blob handles. Allocate one 4 MiB payload per write.
                const raw = new Uint8Array(4 * MiB);
                for (let part = 0; part < raw.length; part += 65536) crypto.getRandomValues(raw.subarray(part, part + 65536));
                const blob = new Blob([raw], { type: 'application/octet-stream' });
                if (index === 0) writeHash = await sha(raw);
                const id = `variant-${index}`;
                const plan = evictionPlan(entries, pinned, blob.size, capacity);
                try {
                  await transaction(db, 'readwrite', (store) => {
                    for (const old of plan.evict) store.delete(old);
                    store.put({ id, blob, bytes: blob.size, used: ++counter });
                  });
                } catch (error) {
                  if (error?.name === 'QuotaExceededError') { realQuotaExceeded = true; break; }
                  throw error;
                }
                for (const old of plan.evict) { entries.delete(old); evicted.push(old); }
                entries.set(id, { bytes: blob.size, used: counter });
                if (index === 0) pinned.add(id);
                bytesWritten += blob.size;
                receipt.cacheProgress = { capacityMiB, entries: entries.size, logicalBytes: plan.bytesAfter, totalBytesWritten: bytesWritten };
                if (index % 4 === 0) await checkpoint();
              }
              assert(entries.has('variant-0'), 'leased_entry_survives_lru');
              if (!realQuotaExceeded) assert(evicted.join(',') === 'variant-1,variant-2', 'oldest_unleased_evicted');
              db.close(); db = await openDatabase(name);
              let lease;
              await transaction(db, 'readonly', (store) => {
                const request = store.get('variant-0'); request.onsuccess = () => { lease = request.result?.blob; };
              });
              assert(lease instanceof Blob && lease.size === 4 * MiB, 'blob_survives_close_reopen');
              const beforeHash = await sha(await lease.arrayBuffer());
              const rows = [];
              let persistedCount;
              await transaction(db, 'readonly', (store) => {
                const count = store.count(); count.onsuccess = () => { persistedCount = count.result; };
                const cursor = store.openCursor();
                cursor.onsuccess = () => {
                  const current = cursor.result;
                  if (!current) return;
                  rows.push({ id: current.key, storedBytes: current.value.bytes, blobBytes: current.value.blob.size });
                  current.continue();
                };
              });
              assert(persistedCount === rows.length, 'persisted_cursor_count_match');
              const persistedSnapshot = verifyCacheSnapshot(rows, entries, writeHash, beforeHash);
              assert(evicted.every((id) => !persistedSnapshot.ids.includes(id)), 'evicted_blobs_absent_after_reopen');
              await transaction(db, 'readwrite', (store) => store.clear());
              let count;
              await transaction(db, 'readonly', (store) => { const request = store.count(); request.onsuccess = () => { count = request.result; }; });
              assert(count === 0, 'manual_clear_empty');
              assert(await sha(await lease.arrayBuffer()) === beforeHash, 'active_blob_lease_unchanged_after_clear');
              lease = null;
              report = { capacityMiB, logicalCapacityReached: !realQuotaExceeded, realQuotaExceeded,
                actualQuotaExhaustionAttempted: false, bytesWritten, evicted, closeReopen: true,
                leaseSurvivedClear: true, persistedSnapshot, estimateBefore, estimateAfter: await storageEstimate(),
                scope: 'real IDB Blob transactions; logical cache capacity tested, browser quota not exhausted' };
            } finally { db?.close(); deleted = await deleteDatabase(name); }
            return { ...report, databaseDeleted: deleted };
          });
        }
      }
      if (phases.includes('lifecycle')) {
        await runCase('cancel-and-late-encode', async () => {
          const bytes = await readFixture('chart-exif-orientation-6.jpg');
          const abort = new AbortController();
          let late;
          let callbackArrived;
          const arrived = new Promise((resolve) => { callbackArrived = resolve; });
          const pending = processImage(bytes, { state: receipt.resources, signal: abort.signal,
            wrapCallback: (callback) => (blob) => { late = () => callback(blob); callbackArrived(); } });
          const outcome = pending.then(() => 'unexpected_success', errorText);
          await Promise.race([arrived, pending]); abort.abort();
          assert(await outcome === 'cancelled', 'cancel_wins');
          const snapshot = JSON.stringify(receipt.resources); late(); await delay(10);
          assert(snapshot === JSON.stringify(receipt.resources), 'late_completion_no_resources');
          return { faultInjection: 'held actual Canvas result and cancelled before delivery', outcome: 'cancelled', lateIgnored: true };
        });
        await runCase('timeout-and-late-encode', async () => {
          const bytes = await readFixture('chart-exif-orientation-6.jpg');
          return heldEncodeTimeout(bytes, receipt.resources);
        });
        await runCase('admission-and-quota-failures', async () => {
          const bytes = await readFixture('chart-exif-orientation-6.jpg');
          const draft = { text: 'Synthetic draft retained', original: receipt.originals[0]?.beforeHash };
          const expected = JSON.stringify(draft);
          const failures = [];
          const expectFailure = async (label, expectedError, work) => {
            try { await work(); throw new Error(`missing_failure:${label}`); }
            catch (error) { assert(errorText(error) === expectedError, label); failures.push({ label, error: expectedError }); }
          };
          await expectFailure('file', 'original_byte_budget', () => processImage(bytes, { policy: { ...candidates, maxOriginalBytes: 1 } }));
          await expectFailure('pixels', 'decoded_pixel_budget', () => processImage(bytes, { policy: { ...candidates, maxDecodedPixels: 1 } }));
          await expectFailure('output', 'variant_byte_budget', () => processImage(bytes, { state: receipt.resources, policy: { ...candidates, maxVariantBytes: 1 } }));
          await expectFailure('count', 'image_count_budget', () => serialBatch(Array(9), () => { throw new Error('must_not_decode'); }));
          await expectFailure('aggregate', 'request_image_byte_budget', () => serialBatch([1, 2], async () => ({ blob: new Blob([new Uint8Array(2)]) }), { ...candidates, maxRequestImageBytes: 3 }));
          // This is deliberately named as an injected storage error, separate
          // from the actual capacity/quota observation above.
          const current = await processImage(bytes, { state: receipt.resources });
          let storageWarning;
          try { throw new DOMException('Synthetic quota denial', 'QuotaExceededError'); }
          catch (error) { if (error.name !== 'QuotaExceededError') throw error; storageWarning = 'cache_not_retained'; }
          assert(current.blob.size <= candidates.maxVariantBytes && JSON.stringify(draft) === expected, 'bounded_memory_fallback_and_draft');
          return { failures, quotaFaultInjected: true, actualQuotaExhaustion: false,
            storageWarning, retainedMemoryBytes: current.blob.size, draftUnchanged: true,
            scope: 'independent state transition feasibility; production Chat draft integration is P1/P2' };
        });
      }
      if (phases.includes('migration')) {
        await runCase('idb-v1-v2-and-old-writer', async () => {
          const name = `b129-resource-probe-${runId}-migration`;
          const textRecord = { id: 'synthetic-text-turn', content: 'Synthetic original text stays exact.', createdAt: 1 };
          let oldConnection;
          let newConnection;
          let versionChangeReceived = false;
          let retained;
          let oldVersionError;
          const open = (version, upgrade) => openDatabase(name, version, upgrade);
          try {
            oldConnection = await open(1, (db) => db.createObjectStore('turns', { keyPath: 'id' }));
            await deadline(new Promise((resolve, reject) => {
              const tx = oldConnection.transaction('turns', 'readwrite');
              tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
              tx.objectStore('turns').put(textRecord);
            }), 15000, 'migration_write_timeout');
            oldConnection.onversionchange = () => { versionChangeReceived = true; oldConnection.close(); };
            newConnection = await open(2, (db) => {
              for (const store of ['assets', 'variants', 'writingVersions', 'saveReceipts']) db.createObjectStore(store, { keyPath: 'id' });
            });
            await deadline(new Promise((resolve, reject) => {
              const tx = newConnection.transaction('turns', 'readonly');
              tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
              const request = tx.objectStore('turns').get(textRecord.id); request.onsuccess = () => { retained = request.result; };
            }), 15000, 'migration_read_timeout');
            try { const unexpected = await open(1); unexpected.close(); }
            catch (error) { oldVersionError = error?.name; }
            assert(versionChangeReceived, 'old_connection_closed_on_versionchange');
            assert(JSON.stringify(retained) === JSON.stringify(textRecord), 'old_text_record_preserved');
            assert(oldVersionError === 'VersionError', 'old_writer_native_versionerror');
            return { realBrowserIDB: true, versionChangeReceived, textUnchanged: true, oldVersionError,
              newStores: Array.from(newConnection.objectStoreNames),
              scope: 'native browser upgrade feasibility only; production Chat schema upgrade and business recovery remain P1/P4' };
          } finally { oldConnection?.close(); newConnection?.close(); await deleteDatabase(name); }
        });
      }
      for (const original of receipt.originals) {
        original.afterHash = await sha(await app.vault.adapter.readBinary(`${fixtureRoot}/${original.name}`));
        original.unchanged = original.beforeHash === original.afterHash;
        assert(original.unchanged, 'original_unchanged');
      }
      assert(receipt.resources.activeImages === 0 && receipt.resources.activeCanvases === 0 && receipt.resources.activeUrls === 0, 'resources_released');
      receipt.status = receipt.errors.length ? 'completed_with_failures' : 'completed';
    } catch (error) { receipt.status = 'failed'; receipt.errors.push({ stage: receipt.stage, error: errorText(error) }); }
    finally { receipt.stage = 'finished'; receipt.finishedAt = new Date().toISOString(); await checkpoint(); }
    return { path: `${root}/checkpoint.json`, status: receipt.status, cases: receipt.completed.length, errors: receipt.errors };
  };
  globalThis.b129ResourceProbeInternals = { dimensions, admit, processImage, serialBatch,
    resources, evictionPlan, verifyCacheSnapshot, heldEncodeTimeout, memorySampler, candidates };
})();
