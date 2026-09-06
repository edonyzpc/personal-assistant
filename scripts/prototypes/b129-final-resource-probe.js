/* B-129 P0 final narrow 3200px calibration, no production/IDB/provider effects.
 * First eval b129-resource-probe.js, then this file, then:
 * await runB129FinalResources(app, 'unique-run-id')
 */
(() => {
  const expectedPolicy = Object.freeze({ maxOriginalBytes: 20 * 1024 * 1024, maxDecodedPixels: 48000000,
    maxImagesPerTurn: 8, maxVariantBytes: 4 * 1024 * 1024, maxRequestImageBytes: 24 * 1024 * 1024,
    processingTimeoutMs: 15000 });
  const assert = (condition, reason) => { if (!condition) throw new Error(reason); };
  const sha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const elapsed = (started) => Math.round(performance.now() - started);
  const emptyResources = (state) => state.activeImages === 0 && state.activeCanvases === 0 && state.activeUrls === 0;

  globalThis.runB129FinalResources = async (app, runId) => {
    assert(app.vault.getName() === 'test', 'test_vault_required');
    assert(typeof runId === 'string' && /^[a-zA-Z0-9_-]+$/.test(runId), 'unique_run_id_required');
    const api = globalThis.b129ResourceProbeInternals;
    assert(api && ['admit', 'processImage', 'serialBatch', 'resources', 'memorySampler'].every((name) =>
      typeof api[name] === 'function'), 'load_resource_probe_first');
    assert(Object.entries(expectedPolicy).every(([key, value]) => api.candidates[key] === value), 'candidate_policy_changed');
    const root = `b129-p0-final-resources/${runId}`;
    assert(!await app.vault.adapter.exists(root), 'unique_run_required');
    if (!await app.vault.adapter.exists('b129-p0-final-resources')) await app.vault.createFolder('b129-p0-final-resources');
    await app.vault.createFolder(root);
    const receipt = { kind: 'b129.p0.final-resource-3200.v1', runId, startedAt: new Date().toISOString(),
      environment: { userAgent: navigator.userAgent }, status: 'running', stage: 'fixture', candidatePolicy: { ...expectedPolicy },
      edge: 3200, quality: .9, cases: [], progress: [], errors: [], resources: api.resources(),
      scope: 'One 48MP image, then eight fresh serial decodes of the same synthetic 48MP source. Distinct per-image Blob/URL work; batch retains encoded variants. No actual provider, IDB, or production Chat.',
      evidenceLimits: ['Repeated 48MP source tests peak decode geometry, not eight distinct photographs or maximum JPEG entropy.',
        'Owned-reference counters are not native memory measurements; read sampler/Safari evidence separately.',
        'Byte limits are enforced candidates, not a claim that every eight-image input fits.'] };
    const checkpoint = () => app.vault.adapter.write(`${root}/receipt.json`, JSON.stringify(receipt, null, 2));
    let bytes;
    const sourcePath = 'b129-p0-fixtures/resource-48mp.jpg';
    const cases = async (name, work) => {
      receipt.stage = name;
      await checkpoint();
      const started = performance.now(), sampler = api.memorySampler();
      const result = { name, startedAt: new Date().toISOString(), status: 'running' };
      try { Object.assign(result, await work()); result.status = 'passed'; }
      catch (error) { result.status = 'failed'; result.error = String(error.message ?? error); throw error; }
      finally {
        result.elapsedMs = elapsed(started);
        try { result.memory = await sampler.stop(); }
        catch (error) { result.memory = { error: String(error.message ?? error) }; }
        result.resourcesAfter = { ...receipt.resources };
        receipt.cases.push(result);
        await checkpoint();
      }
    };
    const processOne = async (index) => {
      const value = await api.processImage(bytes, { edge: 3200, quality: .9, state: receipt.resources, policy: api.candidates });
      assert(value.decodedWidth === 8000 && value.decodedHeight === 6000, 'source_not_48mp');
      assert(value.outputWidth === 3200 && value.outputHeight === 2400, 'unexpected_output_dimensions');
      assert(value.mime === 'image/jpeg' && value.blob.type === 'image/jpeg', 'unexpected_output_mime');
      assert(value.outputBytes === value.blob.size && value.blob.size <= expectedPolicy.maxVariantBytes, 'variant_byte_budget');
      const output = await value.blob.arrayBuffer();
      assert(new Uint8Array(output)[0] === 255 && new Uint8Array(output)[1] === 216, 'invalid_jpeg_signature');
      return { ...value, index, outputSha256: await sha(output) };
    };
    try {
      await checkpoint();
      const manifest = JSON.parse(await app.vault.adapter.read('b129-p0-fixtures/manifest.json'));
      const fixture = manifest.fixtures.find((item) => item.filename === 'resource-48mp.jpg');
      assert(fixture && fixture.megapixels === 48 && fixture.storedWidth === 8000 && fixture.storedHeight === 6000,
        'registered_48mp_fixture_required');
      bytes = await app.vault.adapter.readBinary(sourcePath);
      const originalHash = await sha(bytes);
      receipt.original = { path: sourcePath, sha256: originalHash, bytes: bytes.byteLength };
      assert(originalHash === fixture.sha256 && bytes.byteLength === fixture.bytes, 'fixture_integrity_mismatch');
      const dimensions = api.admit(bytes, api.candidates);
      assert(dimensions.width === 8000 && dimensions.height === 6000, 'source_header_not_48mp');
      await cases('single-48mp-3200', async () => {
        const { blob, ...report } = await processOne(0);
        const outputPath = `${root}/single-48mp-3200.jpg`;
        await app.vault.createBinary(outputPath, await blob.arrayBuffer());
        assert(emptyResources(receipt.resources), 'single_owned_resources_leaked');
        assert(await sha(await app.vault.adapter.readBinary(outputPath)) === report.outputSha256, 'written_output_hash_mismatch');
        return { ...report, outputPath, outputHashVerified: true };
      });
      await cases('serial-eight-48mp-3200', async () => {
        const batch = await api.serialBatch(Array.from({ length: 8 }, (_, index) => index), async (index) => {
          const result = await processOne(index);
          const { blob, ...progress } = result;
          receipt.progress.push({ ...progress, ordinal: index + 1, total: 8 });
          await checkpoint();
          return result;
        }, api.candidates);
        assert(batch.count === 8 && batch.reports.length === 8, 'incomplete_eight_image_batch');
        assert(batch.reports.every((item) => item.decodedWidth === 8000 && item.decodedHeight === 6000), 'batch_contains_smaller_source');
        assert(batch.totalBytes <= expectedPolicy.maxRequestImageBytes, 'request_image_byte_budget');
        assert(emptyResources(receipt.resources), 'batch_owned_resources_leaked');
        assert(receipt.resources.maxActiveImages <= 1 && receipt.resources.maxActiveCanvases <= 1 && receipt.resources.maxActiveUrls <= 1,
          'decode_was_not_serial');
        return { ...batch, aggregateWithinBudget: true, allEightSources48MP: true };
      });
      receipt.original.afterSha256 = await sha(await app.vault.adapter.readBinary(sourcePath));
      receipt.original.unchanged = receipt.original.sha256 === receipt.original.afterSha256;
      assert(receipt.original.unchanged, 'original_changed');
      receipt.status = 'completed';
    } catch (error) {
      receipt.status = 'failed'; receipt.errors.push({ stage: receipt.stage, error: String(error.message ?? error) });
      if (receipt.original) {
        try { receipt.original.afterSha256 = await sha(await app.vault.adapter.readBinary(sourcePath));
          receipt.original.unchanged = receipt.original.sha256 === receipt.original.afterSha256; }
        catch (readError) { receipt.original.recheckError = String(readError.message ?? readError); }
      }
    } finally {
      bytes = undefined; receipt.stage = 'finished'; receipt.finishedAt = new Date().toISOString();
      receipt.ownedResourcesReleased = emptyResources(receipt.resources); await checkpoint();
    }
    return { receiptPath: `${root}/receipt.json`, status: receipt.status, cases: receipt.cases.map(({ name, status, totalBytes, outputBytes, elapsedMs, error }) =>
      ({ name, status, totalBytes, outputBytes, elapsedMs, error })), errors: receipt.errors };
  };
})();
