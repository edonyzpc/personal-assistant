/* P0 host API feasibility after the 2026-09-06 user-approved save-order change.
 * Synthetic test vault only. This is not the production SaveReceipt implementation.
 */
globalThis.runB129SaveOrderProbe = async (app, runId) => {
  if (app.vault.getName() !== 'test' || !/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('test_scope_required');
  const root = `b129-p0-runs/${runId}`;
  if (await app.vault.adapter.exists(root)) throw new Error('unique_run_required');
  await app.vault.createFolder(root);
  const beforeSetting = app.vault.getConfig('attachmentFolderPath');
  const result = { kind: 'b129.save-order-probe', runId, cases: [], restored: false };
  const bytes = await app.vault.adapter.readBinary('b129-p0-fixtures/chart-transparent.png');
  const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  try {
    for (const [index, setting] of ['/', `${root}/fixed`, './', './assets'].entries()) {
      app.vault.setConfig('attachmentFolderPath', setting);
      const folder = `${root}/case-${index}`;
      await app.vault.createFolder(folder);
      const path = `${folder}/note.md`;
      const body = 'B-129 synthetic writing fixture\n\n保留这段文字。  \n不重新生成。';
      const receiptPath = `${folder}/save-receipt.json`;
      const receipt = { notePath: path, initialText: body, state: 'planned', attachment: null };
      await app.vault.adapter.write(receiptPath, JSON.stringify(receipt));
      const note = await app.vault.create(path, body);
      receipt.state = 'note-created';
      await app.vault.adapter.write(receiptPath, JSON.stringify(receipt));
      const attachmentPath = await app.fileManager.getAvailablePathForAttachment(`b129-${runId}-${index}.png`, path);
      receipt.attachment = { path: attachmentPath, sha256: await hash(bytes), state: 'planned' };
      await app.vault.adapter.write(receiptPath, JSON.stringify(receipt));
      const attachment = await app.vault.createBinary(attachmentPath, bytes);
      receipt.attachment.state = 'written';
      await app.vault.adapter.write(receiptPath, JSON.stringify(receipt));
      const link = `!${app.fileManager.generateMarkdownLink(attachment, path)}`;
      const fullText = `${body}\n\n${link}\n`;
      await app.vault.process(note, (current) => {
        if (current !== body) throw new Error('note_changed_do_not_overwrite');
        return fullText;
      });
      receipt.state = 'completed';
      await app.vault.adapter.write(receiptPath, JSON.stringify(receipt));
      const resolved = app.metadataCache.getFirstLinkpathDest(attachmentPath, path);
      result.cases.push({ setting, path, attachmentPath, link,
        expectedFolder: setting === './' ? folder : setting === './assets' ? `${folder}/assets` : setting === '/' ? '' : setting,
        actualFolder: attachmentPath.includes('/') ? attachmentPath.slice(0, attachmentPath.lastIndexOf('/')) : '',
        originalHashMatches: await hash(await app.vault.adapter.readBinary(attachmentPath)) === receipt.attachment.sha256,
        exactFinalText: await app.vault.read(note) === fullText,
        linkResolves: resolved?.path === attachmentPath });
    }
  } finally {
    app.vault.setConfig('attachmentFolderPath', beforeSetting);
    result.restored = app.vault.getConfig('attachmentFolderPath') === beforeSetting;
    await app.vault.adapter.write(`${root}/receipt.json`, JSON.stringify(result, null, 2));
  }
  return result;
};
