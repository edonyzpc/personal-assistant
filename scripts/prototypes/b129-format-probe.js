/* B-129 P0 only. Synthetic test-vault runner, not production media support.
 * No Node modules are read until the explicitly supplied real macOS host guard passes.
 * eval this file then runB129FormatProbe(app, {runId, Platform, FileSystemAdapter}).
 */
(() => {
  const u8 = (value) => value instanceof Uint8Array ? value : new Uint8Array(value);
  const text = (bytes, offset = 0, length = bytes.length - offset) =>
    String.fromCharCode(...bytes.subarray(offset, offset + Math.min(length, 128)));
  const be = (b, o) => (b[o] * 16777216 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]);
  const le = (b, o) => be(Uint8Array.from([b[o + 3], b[o + 2], b[o + 1], b[o]]), 0);
  const fail = (message) => { throw new Error(message); };
  const check = (signal, isCurrent = () => true) => {
    if (signal?.aborted) fail('cancelled');
    if (!isCurrent()) fail('stale_operation');
  };
  const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8(bytes)))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');

  function boxes(bytes, start = 0, end = bytes.length) {
    const result = [];
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) fail('truncated_box');
      let length = be(bytes, offset), header = 8;
      if (length === 1) {
        if (offset + 16 > end) fail('truncated_large_box');
        length = be(bytes, offset + 8) * 4294967296 + be(bytes, offset + 12); header = 16;
      } else if (length === 0) length = end - offset;
      if (!Number.isSafeInteger(length) || length < header || offset + length > end) fail('invalid_box_size');
      result.push({ type: text(bytes, offset + 4, 4), start: offset + header, end: offset + length });
      offset += length;
    }
    return result;
  }

  function heifInfo(bytes) {
    const top = boxes(bytes);
    const ftyp = top.find((box) => box.type === 'ftyp');
    if (!ftyp || ftyp.end - ftyp.start < 8) fail('missing_ftyp');
    const brands = [text(bytes, ftyp.start, 4)];
    for (let i = ftyp.start + 8; i + 4 <= ftyp.end; i += 4) brands.push(text(bytes, i, 4));
    if (!brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) fail('unsupported_heif_codec');
    if (brands.some((brand) => ['msf1', 'hevc', 'hevx'].includes(brand))) return { sequence: true, brands };
    const meta = top.find((box) => box.type === 'meta');
    if (!meta) fail('missing_heif_meta');
    const children = boxes(bytes, meta.start + 4, meta.end);
    const info = children.find((box) => box.type === 'iinf');
    if (!info) fail('missing_item_info');
    const items = [];
    for (const item of boxes(bytes, info.start + (bytes[info.start] === 0 ? 6 : 8), info.end)) {
      if (item.type !== 'infe') continue;
      const version = bytes[item.start];
      if (![2, 3].includes(version)) fail('unsupported_item_info');
      const idLength = version === 2 ? 2 : 4;
      const id = idLength === 2 ? (bytes[item.start + 4] << 8) + bytes[item.start + 5] : be(bytes, item.start + 4);
      const type = text(bytes, item.start + 4 + idLength + 2, 4);
      if (['hvc1', 'grid', 'iden', 'iovl'].includes(type)) items.push({ id, type });
    }
    const dependent = new Set();
    const ref = children.find((box) => box.type === 'iref');
    if (ref) {
      const wide = bytes[ref.start] !== 0;
      const size = wide ? 4 : 2;
      const idAt = (offset) => wide ? be(bytes, offset) : (bytes[offset] << 8) + bytes[offset + 1];
      for (const box of boxes(bytes, ref.start + 4, ref.end)) {
        if (!['dimg', 'thmb', 'auxl'].includes(box.type)) continue;
        if (box.start + size + 2 > box.end) fail('truncated_item_reference');
        const from = idAt(box.start);
        const count = (bytes[box.start + size] << 8) + bytes[box.start + size + 1];
        if (box.start + size + 2 + size * count !== box.end) fail('invalid_item_reference');
        if (box.type !== 'dimg') dependent.add(from);
        else for (let i = 0; i < count; i++) dependent.add(idAt(box.start + size + 2 + i * size));
      }
    }
    const roots = items.filter((item) => !dependent.has(item.id));
    if (roots.length !== 1) return { sequence: false, brands, imageCount: roots.length, items };
    const primary = children.find((box) => box.type === 'pitm');
    if (!primary) fail('missing_primary_item');
    const primaryId = bytes[primary.start] === 0
      ? (bytes[primary.start + 4] << 8) + bytes[primary.start + 5] : be(bytes, primary.start + 4);
    if (primaryId !== roots[0].id) fail('primary_item_ambiguous');
    return { sequence: false, brands, imageCount: 1, primaryId, items };
  }

  function gifFrames(bytes) {
    if (bytes.length < 13) fail('truncated_gif');
    let i = 13 + ((bytes[10] & 128) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0);
    let frames = 0;
    const blocks = () => {
      while (i < bytes.length) {
        const length = bytes[i++];
        if (!length) return;
        i += length;
        if (i > bytes.length) fail('truncated_gif_subblock');
      }
      fail('missing_gif_subblock_end');
    };
    while (i < bytes.length) {
      const kind = bytes[i++];
      if (kind === 0x3b) { if (!frames) fail('gif_without_frame'); return frames; }
      if (kind === 0x21) { i++; blocks(); continue; }
      if (kind !== 0x2c || i + 9 > bytes.length) fail('invalid_gif_block');
      const packed = bytes[i + 8];
      i += 9 + ((packed & 128) ? 3 * (2 ** ((packed & 7) + 1)) : 0);
      i++; // LZW code size followed by image-data sub-blocks.
      blocks(); frames++;
    }
    fail('missing_gif_trailer');
  }

  function svgPolicy(bytes, Parser, embeddedImages = []) {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // An external entity must be rejected before constructing even an inert XML tree.
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) return 'external_or_active_svg';
    if (!Parser) return 'svg_parser_unavailable';
    const doc = new Parser().parseFromString(source, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg' ||
      doc.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg') return 'invalid_svg';
    const checkCss = (css) => {
      const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
      // image-set() accepts bare quoted URLs, unlike url(); never pass such
      // unresolved CSS image sources into an SVG image decoder.
      if (/\\|@|animation\s*:|transition\s*:|expression\s*\(|(?:-webkit-)?image-set\s*\(/i.test(clean)) return false;
      for (const match of clean.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        if (!/^#[\w:.-]+$/.test(match[2])) return false;
      }
      return true;
    };
    for (const element of doc.querySelectorAll('*')) {
      if (element.namespaceURI !== 'http://www.w3.org/2000/svg' ||
        /^(script|foreignObject|iframe|animate.*|set|discard)$/i.test(element.localName)) return 'external_or_active_svg';
      if (element.localName === 'style' && !checkCss(element.textContent ?? '')) return 'external_or_active_svg';
      for (const attr of element.attributes) {
        if (/^on/i.test(attr.localName) || attr.localName === 'base') return 'external_or_active_svg';
        if (attr.localName === 'href' && attr.value && !/^#[\w:.-]+$/.test(attr.value)) {
          const embedded = attr.value.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i);
          if (!embedded) return 'external_or_active_svg';
          const decoded = Uint8Array.from(atob(embedded[2]), (char) => char.charCodeAt(0));
          const nested = classify(decoded, `embedded.${embedded[1]}`);
          if (nested.policy !== 'static' || nested.format !== embedded[1].toLowerCase()) return 'external_or_active_svg';
          embeddedImages.push({ bytes: decoded, mime: nested.mime });
        }
        if (!checkCss(attr.value)) return 'external_or_active_svg';
      }
    }
    return 'static';
  }

  function classify(value, name = '', options = {}) {
    const bytes = u8(value);
    const extension = name.toLowerCase().split('.').pop();
    let format = 'unknown', policy = 'unsupported', frames = 1, details;
    try {
      if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) { format = 'jpeg'; policy = 'static'; }
      else if (text(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') {
        format = 'png'; policy = 'static';
        let ended = false;
        for (let i = 8; i < bytes.length;) {
          if (i + 12 > bytes.length) fail('truncated_png_chunk');
          const size = be(bytes, i), kind = text(bytes, i + 4, 4);
          if (i + 12 + size > bytes.length) fail('truncated_png_chunk');
          if (kind === 'acTL') {
            if (size !== 8) fail('invalid_apng_control');
            frames = be(bytes, i + 8);
            // acTL marks animation semantics even if this instance has one frame.
            policy = 'animated';
          }
          i += 12 + size;
          if (kind === 'IEND') { ended = true; break; }
        }
        if (!ended) fail('missing_png_end');
      } else if (/^GIF8[79]a$/.test(text(bytes, 0, 6))) {
        format = 'gif'; frames = gifFrames(bytes); policy = frames > 1 ? 'animated' : 'static';
      } else if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') {
        format = 'webp'; policy = 'static'; frames = 0;
        const end = le(bytes, 4) + 8;
        if (end !== bytes.length) fail('invalid_webp_size');
        for (let i = 12; i < end;) {
          if (i + 8 > end) fail('truncated_webp_chunk');
          const size = le(bytes, i + 4), kind = text(bytes, i, 4);
          if (i + 8 + size > end) fail('truncated_webp_chunk');
          if ((kind === 'VP8X' && (bytes[i + 8] & 2)) || kind === 'ANIM' || kind === 'ANMF') policy = 'animated';
          if (kind === 'ANMF') frames++;
          i += 8 + size + (size & 1);
        }
        frames ||= 1;
      } else if (text(bytes, 4, 4) === 'ftyp') {
        format = 'heic'; details = heifInfo(bytes);
        policy = details.sequence || details.imageCount !== 1 ? 'multiple_images' : 'static';
      } else if (/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[^]*?-->\s*)?<svg[\s/>]/i.test(new TextDecoder().decode(bytes))) {
        format = 'svg'; policy = svgPolicy(bytes, options.DOMParser ?? globalThis.DOMParser);
      }
    } catch (error) { policy = 'malformed'; details = { error: error.message }; }
    const extensions = { jpeg: ['jpg', 'jpeg'], png: ['png', 'apng'], gif: ['gif'], webp: ['webp'], heic: ['heic', 'heif'], svg: ['svg'] };
    return { format, policy, frames, extension, extensionMatches: extensions[format]?.includes(extension) ?? false,
      mime: { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml' }[format],
      ...(details ? { details } : {}) };
  }

  function abortable(start, signal, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(new Error('cancelled'));
      const timer = setTimeout(() => finish(new Error('operation_timeout')), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      try { start((value) => finish(null, value), (error) => finish(error)); } catch (error) { finish(error); }
    });
  }

  async function validateEmbeddedRasters(bytes, options, receipt) {
    const embedded = [];
    if (svgPolicy(bytes, globalThis.DOMParser, embedded) !== 'static') fail('svg_not_self_contained');
    receipt.embeddedRasters = [];
    // Header classification proves neither valid pixel data nor complete SVG
    // rendering: validate every raster before decoding the enclosing SVG.
    for (const entry of embedded) {
      check(options.signal, options.isCurrent);
      const item = { bytes: entry.bytes.byteLength, mime: entry.mime, sha256: await sha256(entry.bytes), decoded: false };
      receipt.embeddedRasters.push(item);
      const image = new Image();
      const url = URL.createObjectURL(new Blob([entry.bytes], { type: entry.mime }));
      receipt.urlsCreated = (receipt.urlsCreated ?? 0) + 1;
      try {
        await abortable((resolve, reject) => {
          image.onload = resolve; image.onerror = () => reject(new Error('embedded_raster_decode_failed')); image.src = url;
        }, options.signal, options.decodeTimeoutMs ?? 8000);
        check(options.signal, options.isCurrent);
        const width = image.naturalWidth, height = image.naturalHeight;
        if (!width || !height || width * height > (options.maxPixels ?? 48000000)) fail('embedded_raster_pixel_budget');
        item.decoded = true; item.width = width; item.height = height;
      } finally {
        image.onload = null; image.onerror = null; image.src = ''; URL.revokeObjectURL(url);
        receipt.urlsReleased = (receipt.urlsReleased ?? 0) + 1;
      }
    }
  }

  async function drawJpeg(bytes, mime, options, receipt) {
    const image = new Image();
    const canvas = document.createElement('canvas');
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    receipt.urlsCreated = (receipt.urlsCreated ?? 0) + 1;
    try {
      await abortable((resolve, reject) => {
        image.onload = resolve; image.onerror = () => reject(new Error('native_decode_failed')); image.src = url;
      }, options.signal, options.decodeTimeoutMs ?? 8000);
      check(options.signal, options.isCurrent);
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width * height > (options.maxPixels ?? 48000000)) fail('pixel_budget_exceeded');
      const scale = Math.min(1, (options.edge ?? 3072) / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      receipt.decodedWidth = width; receipt.decodedHeight = height;
      receipt.outputWidth = canvas.width; receipt.outputHeight = canvas.height;
      receipt.corners = [[.05,.05],[.95,.05],[.05,.95],[.95,.95]].map(([x,y]) =>
        [...context.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data]);
      const blob = await abortable((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('encode_failed')),
        'image/jpeg', options.quality ?? .9), options.signal, options.decodeTimeoutMs ?? 8000);
      check(options.signal, options.isCurrent);
      const output = await blob.arrayBuffer();
      check(options.signal, options.isCurrent);
      if (blob.type !== 'image/jpeg' || classify(output, 'output.jpg').format !== 'jpeg') fail('output_mime_mismatch');
      const verified = new Image();
      const verifyUrl = URL.createObjectURL(blob);
      receipt.urlsCreated++;
      try {
        await abortable((resolve, reject) => {
          verified.onload = resolve; verified.onerror = () => reject(new Error('output_not_decodable')); verified.src = verifyUrl;
        }, options.signal, options.decodeTimeoutMs ?? 8000);
        if (verified.naturalWidth !== canvas.width || verified.naturalHeight !== canvas.height) fail('output_dimensions_mismatch');
        receipt.outputDecodeVerified = true;
      } finally {
        verified.onload = null; verified.onerror = null; verified.src = ''; URL.revokeObjectURL(verifyUrl); receipt.urlsReleased = (receipt.urlsReleased ?? 0) + 1;
      }
      receipt.outputMime = blob.type; receipt.outputBytes = output.byteLength;
      // A fresh pixel buffer does not copy source EXIF; generated ICC/dimensions may remain.
      receipt.metadataPolicy = 'fresh_pixels_no_source_metadata_copy; inspect output EXIF separately';
      return output;
    } finally {
      image.onload = null; image.onerror = null; image.src = ''; URL.revokeObjectURL(url);
      canvas.width = 0; canvas.height = 0;
      receipt.urlsReleased = (receipt.urlsReleased ?? 0) + 1; receipt.canvasReleased = true;
    }
  }

  async function systemConvert(input, options, receipt) {
    const { Platform, FileSystemAdapter, adapter, signal } = options;
    if (!Platform?.isDesktopApp || !Platform?.isMacOS || typeof FileSystemAdapter !== 'function' ||
      !(adapter instanceof FileSystemAdapter)) fail('system_conversion_unavailable');
    check(signal, options.isCurrent);
    const load = options.loadNode ?? ((id) => require(id)); // Guard before even evaluating require.
    const fs = load('node:fs/promises'), path = load('node:path'), os = load('node:os'), cp = load('node:child_process');
    if (!/^b129-(?:p0-fixtures|heic-core-check|format-fixtures)\/[a-zA-Z0-9._/-]+$/.test(input) ||
      input.split('/').some((part) => !part || part === '.' || part === '..')) fail('synthetic_fixture_path_required');
    const source = path.resolve(adapter.getBasePath(), input);
    const base = path.resolve(adapter.getBasePath()) + path.sep;
    if (!source.startsWith(base)) fail('outside_vault');
    let dir, output;
    try {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'b129-format-'));
      output = path.join(dir, 'intermediate.png'); receipt.tempCreated = true;
      check(signal, options.isCurrent);
      const expected = options.expectedSourceHash;
      if (expected && await sha256(await fs.readFile(source)) !== expected) fail('source_changed');
      await new Promise((resolve, reject) => {
        let reason, timer, killTimer, child;
        const stop = (value) => {
          if (reason) return;
          reason = value; receipt.processKillRequested = true;
          child?.kill('SIGTERM');
          killTimer = setTimeout(() => child?.kill('SIGKILL'), 2000);
        };
        const abort = () => stop('cancelled');
        const finish = (error, _stdout, stderr) => {
          clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
          receipt.processExited = true; receipt.systemStderr = String(stderr ?? '').slice(0, 512);
          if (reason || error) reject(new Error(reason ?? `system_conversion_failed:${error.code ?? 'unknown'}`));
          else resolve();
        };
        // execFile callback fires after process exit and stdio close; cancellation waits for it.
        try {
          child = cp.execFile('/usr/bin/sips', ['-s', 'format', 'png', source, '--out', output],
            { maxBuffer: 8192, shell: false }, finish);
          receipt.systemCommand = '/usr/bin/sips'; receipt.shell = false;
          timer = setTimeout(() => stop('system_conversion_timeout'), options.systemTimeoutMs ?? 15000);
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        } catch (error) { finish(error); }
      });
      check(signal, options.isCurrent);
      const png = await fs.readFile(output);
      if (classify(png, 'intermediate.png').format !== 'png') fail('system_output_not_png');
      receipt.intermediateBytes = png.byteLength;
      return await drawJpeg(png, 'image/png', options, receipt);
    } finally {
      // Never recursively remove a directory; only the two exact owned paths can be removed.
      const errors = [];
      if (output) await fs.unlink(output).catch((error) => { if (error.code !== 'ENOENT') errors.push(`unlink:${error.code}`); });
      if (dir) await fs.rmdir(dir).catch((error) => errors.push(`rmdir:${error.code}`));
      receipt.tempCleaned = Boolean(dir) && errors.length === 0;
      if (errors.length) { receipt.cleanupErrors = errors; fail('temporary_cleanup_failed'); }
    }
  }

  async function processFixture(app, fixture, options = {}) {
    const receipt = { path: fixture.path, name: fixture.name ?? fixture.path, startedAt: new Date().toISOString(),
      draftPreserved: true, originalRetained: true, decoderCalled: false, networkRequestsInitiated: 0 };
    let output;
    const started = performance.now();
    const bytes = await app.vault.adapter.readBinary(fixture.path);
    receipt.originalSha256 = await sha256(bytes); receipt.originalBytes = bytes.byteLength;
    receipt.classification = classify(bytes, receipt.name);
    try {
      check(options.signal, options.isCurrent);
      if (receipt.classification.policy !== 'static') {
        receipt.status = 'needs_static_image'; receipt.recovery = '原文件和草稿已保留，请提供静态 PNG/JPEG。';
      } else {
        if (receipt.classification.format === 'svg') await validateEmbeddedRasters(bytes, options, receipt);
        receipt.decoderCalled = true;
        try {
          output = await drawJpeg(bytes, receipt.classification.mime, options, receipt);
          receipt.conversion = 'native_pixels';
        } catch (error) {
          if (receipt.classification.format !== 'heic' || error.message !== 'native_decode_failed') throw error;
          output = await systemConvert(fixture.path, { ...options, adapter: app.vault.adapter, expectedSourceHash: receipt.originalSha256 }, receipt);
          receipt.conversion = 'macos_system_then_pixels';
        }
        check(options.signal, options.isCurrent);
        if (await sha256(await app.vault.adapter.readBinary(fixture.path)) !== receipt.originalSha256) fail('source_changed');
        receipt.outputSha256 = await sha256(output); receipt.status = 'converted';
      }
    } catch (error) {
      output = undefined; receipt.status = ['cancelled', 'stale_operation'].includes(error.message) ? error.message : 'needs_static_image';
      receipt.error = error.message; receipt.recovery = '原文件和草稿已保留，请提供 JPEG。';
    } finally {
      receipt.originalUnchanged = await sha256(await app.vault.adapter.readBinary(fixture.path)) === receipt.originalSha256;
      receipt.elapsedMs = Math.round(performance.now() - started);
    }
    return { receipt, output };
  }

  async function mkdir(vault, path) {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      if (!await vault.adapter.exists(parent)) await vault.createFolder(parent);
    }
  }
  globalThis.B129FormatProbe = { classify, heifInfo, abortable, systemConvert, processFixture, validateEmbeddedRasters };
  globalThis.runB129FormatProbe = async (app, options = {}) => {
    if (app.vault.getName() !== 'test') fail('test_vault_required');
    if (!/^[a-zA-Z0-9_-]+$/.test(options.runId ?? '')) fail('unique_run_id_required');
    const root = `b129-format-runs/${options.runId}`;
    if (await app.vault.adapter.exists(root)) fail('unique_run_required');
    const manifest = JSON.parse(await app.vault.adapter.read('b129-p0-fixtures/manifest.json'));
    const fixtures = options.fixtures ?? manifest.fixtures.filter((item) => !item.megapixels)
      .map((item) => ({ path: `b129-p0-fixtures/${item.filename}` }));
    await mkdir(app.vault, root);
    const receipt = { kind: 'b129.p0.formats.v1', startedAt: new Date().toISOString(), runId: options.runId,
      environment: { userAgent: navigator.userAgent },
      scope: 'synthetic fixture byte classification and host local pixels; no picker/provider/production validation', cases: [] };
    for (const [index, fixture] of fixtures.entries()) {
      const result = await processFixture(app, fixture, options);
      if (result.output) {
        check(options.signal, options.isCurrent);
        const outputPath = `${root}/${index}-${result.receipt.classification.format}.jpg`;
        await app.vault.createBinary(outputPath, result.output); result.receipt.outputPath = outputPath;
      }
      receipt.cases.push(result.receipt);
      await app.vault.adapter.write(`${root}/receipt.json`, JSON.stringify(receipt, null, 2));
    }
    receipt.finishedAt = new Date().toISOString();
    await app.vault.adapter.write(`${root}/receipt.json`, JSON.stringify(receipt, null, 2));
    return { receiptPath: `${root}/receipt.json`, cases: receipt.cases.map(({ name, status, conversion, classification, error }) =>
      ({ name, status, conversion, classification, error })) };
  };
})();
