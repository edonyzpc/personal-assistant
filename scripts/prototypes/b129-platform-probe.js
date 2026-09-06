/* P0 only: run in the Obsidian test vault; no plugin/provider calls.
 * Fixture settings are restored in finally. Originals and receipts are retained.
 * Load this file with eval, then await globalThis.runB129PlatformProbe(app).
 * Browser decoder observations are NOT picker or production support claims.
 */
(() => {
  const sha256 = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const mkdir = async (vault, path) => {
    const parts = path.split('/');
    for (let index = 1; index <= parts.length; index += 1) {
      const prefix = parts.slice(0, index).join('/');
      if (prefix && !await vault.adapter.exists(prefix)) await vault.createFolder(prefix);
    }
  };
  const memory = async () => {
    const report = { jsHeapBytes: performance.memory?.usedJSHeapSize ?? null };
    if (typeof process !== 'undefined' && typeof process.getProcessMemoryInfo === 'function') {
      report.processKiB = await process.getProcessMemoryInfo();
    }
    return report;
  };
  const decode = async (bytes, mime) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    let timer;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('decode_timeout_15s')), 15000);
        image.onload = resolve;
        image.onerror = () => reject(new Error('native_image_decode_failed'));
        image.src = url;
      });
      return { image, release: () => { image.src = ''; URL.revokeObjectURL(url); } };
    } catch (error) {
      image.src = ''; URL.revokeObjectURL(url); throw error;
    } finally { clearTimeout(timer); }
  };
  const processImage = async (vault, fixturePath, mime, edge, outputType = 'image/jpeg', quality = 0.9) => {
    const bytes = await vault.adapter.readBinary(fixturePath);
    const beforeHash = await sha256(bytes);
    const started = performance.now();
    let decoded;
    const canvas = document.createElement('canvas');
    try {
      decoded = await decode(bytes, mime);
      const width = decoded.image.naturalWidth;
      const height = decoded.image.naturalHeight;
      if (width * height > 48000000) throw new Error('probe_pixel_ceiling');
      const scale = Math.min(1, edge / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
      const pixels = [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]]
        .map(([x, y]) => [...context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data]);
      let encodeTimer;
      const blob = await new Promise((resolve, reject) => {
        encodeTimer = setTimeout(() => reject(new Error('encode_timeout_15s')), 15000);
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('canvas_encode_failed')), outputType, quality);
      }).finally(() => clearTimeout(encodeTimer));
      const output = await blob.arrayBuffer();
      return { decodedWidth: width, decodedHeight: height, outputWidth: canvas.width,
        outputHeight: canvas.height, requestedMime: outputType, actualMime: blob.type,
        originalBytes: bytes.byteLength, outputBytes: output.byteLength,
        originalSha256: beforeHash, originalUnchanged: beforeHash === await sha256(await vault.adapter.readBinary(fixturePath)),
        elapsedMs: Math.round(performance.now() - started), corners: pixels, output };
    } finally { decoded?.release(); canvas.width = 0; canvas.height = 0; }
  };

  globalThis.runB129PlatformProbe = async (app, options = {}) => {
    if (app.vault.getName() !== 'test') throw new Error('test_vault_required');
    const fixtureRoot = 'b129-p0-fixtures';
    const manifest = JSON.parse(await app.vault.adapter.read(`${fixtureRoot}/manifest.json`));
    if (!Array.isArray(manifest.fixtures)) throw new Error('fixture_manifest_array_required');
    const fixtures = manifest.fixtures.map((entry) => ({ ...entry, file: entry.filename,
      mime: { PNG: 'image/png', JPEG: 'image/jpeg', WEBP: 'image/webp', GIF: 'image/gif',
        SVG: 'image/svg+xml', HEIC: 'image/heic', HEIF: 'image/heif' }[entry.format],
      resourceMP: entry.megapixels,
      externalResources: entry.filename === 'chart-external-resource.svg' }));
    const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, '-');
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('invalid_run_id');
    const root = `b129-p0-runs/${runId}`;
    if (await app.vault.adapter.exists(root)) throw new Error('unique_run_required');
    await mkdir(app.vault, root);
    const receipt = { kind: 'b129.platform-probe', version: 1, runId, startedAt: new Date().toISOString(),
      environment: { userAgent: navigator.userAgent, vault: app.vault.getName(), pluginVersion: app.plugins.plugins['personal-assistant']?.manifest.version },
      fixtureManifestSha256: await sha256(new TextEncoder().encode(await app.vault.adapter.read(`${fixtureRoot}/manifest.json`))),
      scope: 'host APIs and synthetic decoder experiment; no picker, Chat, provider, cache or production validation',
      formats: [], attachments: [], resources: [], createdPaths: [], errors: [] };
    const writeReceipt = async () => app.vault.adapter.write(`${root}/receipt.json`, JSON.stringify(receipt, null, 2));
    await writeReceipt();
    try {
      for (const fixture of fixtures.filter((entry) => !entry.resourceMP)) {
        const path = `${fixtureRoot}/${fixture.file}`;
        // External SVG must never make a request during this offline experiment.
        if (fixture.externalResources) {
          receipt.formats.push({ file: fixture.file, status: 'blocked_external_resource', complete: false });
          continue;
        }
        try {
          const result = await processImage(app.vault, path, fixture.mime, 1536, 'image/png');
          const outputPath = `${root}/${fixture.file.replace(/[^a-zA-Z0-9._-]/g, '_')}.processed.png`;
          await app.vault.createBinary(outputPath, result.output);
          delete result.output;
          receipt.createdPaths.push(outputPath);
          receipt.formats.push({ file: fixture.file, status: 'decoded', ...result,
            sourceHashMatchesManifest: result.originalSha256 === fixture.sha256,
            sourceFrameCount: fixture.frames, preservesAnimation: fixture.frames > 1 ? false : null,
            outputPath });
        } catch (error) {
          receipt.formats.push({ file: fixture.file, status: 'decode_failed', error: String(error.message) });
        }
      }
      await writeReceipt();
      const png = fixtures.find((entry) => entry.mime === 'image/png' && entry.frames === 1 && !entry.resourceMP);
      if (!png) throw new Error('static_png_required');
      const bytes = await app.vault.adapter.readBinary(`${fixtureRoot}/${png.file}`);
      const originalSetting = app.vault.getConfig('attachmentFolderPath');
      receipt.originalAttachmentSetting = originalSetting;
      // Private setting APIs ONLY arrange isolated host fixtures. Product uses public FileManager APIs.
      try {
        for (const [index, setting] of ['/', `${root}/fixed-attachments`, './', './assets'].entries()) {
          app.vault.setConfig('attachmentFolderPath', setting);
          for (const [anchorKind, sourcePath] of [['logical', 'PA Chat.md'], ['related', `${root}/related/note.md`]]) {
            const sourceExisted = await app.vault.adapter.exists(sourcePath);
            const basename = `b129-${runId}-${index}-${anchorKind}.png`;
            const resolved = await app.fileManager.getAvailablePathForAttachment(basename, sourcePath);
            const parent = resolved.includes('/') ? resolved.slice(0, resolved.lastIndexOf('/')) : '';
            const originalFolder = [parent, 'pa-images'].filter(Boolean).join('/');
            await mkdir(app.vault, originalFolder);
            const originalPath = `${originalFolder}/${basename}`;
            if (await app.vault.adapter.exists(originalPath)) throw new Error('original_collision');
            await app.vault.createBinary(originalPath, bytes);
            receipt.createdPaths.push(originalPath);
            const target = `${root}/target-${index}-${anchorKind}/note.md`;
            await mkdir(app.vault, target.slice(0, target.lastIndexOf('/')));
            const formalPath = await app.fileManager.getAvailablePathForAttachment(`formal-${basename}`, target);
            const file = await app.vault.createBinary(formalPath, bytes);
            receipt.createdPaths.push(formalPath);
            const link = app.fileManager.generateMarkdownLink(file, target);
            await app.vault.create(target, `B-129 P0 synthetic fixture\n\n${link}\n`);
            receipt.createdPaths.push(target);
            receipt.attachments.push({ setting, anchorKind, sourcePath, sourceExisted,
              sourceExistsAfter: await app.vault.adapter.exists(sourcePath), resolved, originalPath,
              target, formalPath, link, formalOutsideOriginalFolder: !formalPath.startsWith(`${originalFolder}/`),
              originalHashMatches: await sha256(await app.vault.adapter.readBinary(originalPath)) === png.sha256,
              formalHashMatches: await sha256(await app.vault.adapter.readBinary(formalPath)) === png.sha256 });
          }
        }
      } finally {
        app.vault.setConfig('attachmentFolderPath', originalSetting);
        receipt.attachmentSettingRestored = app.vault.getConfig('attachmentFolderPath') === originalSetting;
      }
      await writeReceipt();
      const resourceFixtures = fixtures.filter((entry) => entry.resourceMP);
      for (const fixture of options.skipResources ? [] : resourceFixtures) {
        for (const edge of [1536, 2048, 3072]) {
          const samples = [await memory()];
          let pendingSample;
          const timer = setInterval(() => {
            if (pendingSample) return;
            pendingSample = memory().then((sample) => samples.push(sample))
              .catch((error) => samples.push({ sampleError: String(error.message) }))
              .finally(() => { pendingSample = undefined; });
          }, 50);
          try {
            const result = await processImage(app.vault, `${fixtureRoot}/${fixture.file}`, fixture.mime, edge);
            delete result.output;
            samples.push(await memory());
            receipt.resources.push({ file: fixture.file, resourceMP: fixture.resourceMP, edge,
              ...result, samples, measurement: '50ms process samples when available; sampled maxima, not certified peak; synthetic image only' });
          } catch (error) {
            receipt.resources.push({ file: fixture.file, edge, error: String(error.message), samples });
          } finally { clearInterval(timer); await pendingSample; }
          await writeReceipt();
        }
      }
      const priorSetting = app.vault.getConfig('attachmentFolderPath');
      receipt.realNoteAttachmentControls = [];
      try {
        const target = `${root}/existing-anchor/note.md`;
        await mkdir(app.vault, `${root}/existing-anchor`);
        await app.vault.create(target, 'B-129 synthetic attachment anchor control\n');
        receipt.createdPaths.push(target);
        for (const setting of ['./', './assets']) {
          app.vault.setConfig('attachmentFolderPath', setting);
          receipt.realNoteAttachmentControls.push({ setting, sourcePath: target,
            resolved: await app.fileManager.getAvailablePathForAttachment('control.png', target) });
        }
      } finally { app.vault.setConfig('attachmentFolderPath', priorSetting); }
      receipt.finishedAt = new Date().toISOString();
    } catch (error) { receipt.errors.push(String(error.message)); }
    await writeReceipt();
    globalThis.b129PlatformReceipt = receipt;
    return { runId, receiptPath: `${root}/receipt.json`, formats: receipt.formats.map(({ file, status }) => ({ file, status })),
      attachmentCases: receipt.attachments.length, attachmentSettingRestored: receipt.attachmentSettingRestored,
      resourceCases: receipt.resources.length, errors: receipt.errors };
  };
})();
