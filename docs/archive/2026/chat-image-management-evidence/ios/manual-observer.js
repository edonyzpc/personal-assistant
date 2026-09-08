(async () => {
  const fixture = 'b129-ios-20260908';
  const root = 'b129-ios-manual-20260909';
  const expected = '8c22f1ba514870fd74c0e8286e415cd6ab323b5a411c73f0f25bc31af4670039';
  if (app.vault.getName() !== 'test') throw Error('Wrong vault');
  if (window.__b129ManualFinish) throw Error('Observer already installed');
  if (await app.vault.adapter.exists(root)) throw Error('Receipt directory already exists');
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
  const p = app.plugins.plugins['personal-assistant'];
  const identity = await p.getLoadedPluginBuildIdentity();
  const diskHash = await hash(new TextEncoder().encode(await app.vault.adapter.read('.obsidian/plugins/personal-assistant/main.js')));
  if (diskHash !== expected || identity.blocker || identity.loadedPluginArtifactSha256 !== expected) throw Error('Build mismatch');
  const fixtureHashes = {};
  for (const name of ['selected.jpg', 'actual.heic', 'unselected.png']) fixtureHashes[name] = await hash(await app.vault.adapter.readBinary(fixture + '/' + name));
  if (fixtureHashes['selected.jpg'] !== 'cbadec49daf87826830fec406a1d3df3045f1286280fb12f1e66d92ce6930c37' || fixtureHashes['actual.heic'] !== 'b9b2598e37cd0b0e9dc7a2bb378a2e499d900794249ba0d5c53555a579d7393b') throw Error('Fixture mismatch');
  const original = {conversation: await p.chatHistoryStore.getActiveConversationId(), note: app.workspace.getActiveFile()?.path, leaves: app.workspace.getLeavesOfType('llm-chat').map(l => l.id)};
  const now = new Date().toISOString(), id = 'b129_ios_manual_20260909';
  if (await p.chatHistoryStore.getConversation(id)) throw Error('Conversation already exists');
  await app.vault.adapter.mkdir(root);
  await app.vault.adapter.write(root + '/original.json', JSON.stringify(original, null, 2));
  await p.chatHistoryStore.upsertConversation({id, title: 'B129 manual inputs 20260909', createdAt: now, updatedAt: now, turnCount: 0, preview: '', imageAnchor: {path: 'PA Chat.md', kind: 'logical_root'}});
  await p.chatHistoryStore.setActiveConversationId(id);
  const events = [], errors = [], listeners = [];
  let sequence = 0, tail = Promise.resolve();
  const draft = () => document.querySelector('.llm-input textarea')?.value;
  const record = (kind, data) => {
    const event = {n: ++sequence, at: new Date().toISOString(), kind, ...data};
    events.push(event);
    tail = tail.then(() => app.vault.adapter.write(root + '/event-' + String(event.n).padStart(3, '0') + '.json', JSON.stringify(event, null, 2))).catch(e => errors.push({recorder: String(e)}));
    return tail;
  };
  const originalImport = p.imageAssetService.importFile;
  p.imageAssetService.importFile = async function(file, options) {
    const bytes = await file.arrayBuffer();
    const beforeAssets = (await p.chatHistoryStore.listImageAssets()).length;
    const beforeFiles = new Set(app.vault.getFiles().map(f => f.path));
    const input = {name: file.name, type: file.type, size: file.size, sha256: await hash(bytes), magic: Array.from(new Uint8Array(bytes).slice(0, 32)), draft: draft()};
    let output;
    try { output = await originalImport.call(this, file, options); }
    catch (error) {
      await record('import-rejected', {input, error: String(error), assetDelta: (await p.chatHistoryStore.listImageAssets()).length - beforeAssets, newFiles: app.vault.getFiles().filter(f => !beforeFiles.has(f.path)).map(f => f.path)});
      throw error;
    }
    await record('import-accepted', {input, asset: output.asset, byteMatch: await hash(await app.vault.adapter.readBinary(output.asset.originalPath)) === input.sha256});
    return output;
  };
  const listen = (type, fn) => { document.addEventListener(type, fn, true); listeners.push([type, fn]); };
  const files = list => Array.from(list || []).map(f => ({name: f.name, type: f.type, size: f.size}));
  listen('change', e => { if (e.target instanceof HTMLInputElement && e.target.type === 'file') void record('native-file-change', {trusted: e.isTrusted, accept: e.target.accept, files: files(e.target.files), draft: draft()}); });
  listen('cancel', e => { if (e.target instanceof HTMLInputElement && e.target.type === 'file') void record('native-file-cancel', {trusted: e.isTrusted, draft: draft()}); });
  listen('paste', e => { if (e.target.closest?.('.llm-input')) void record('paste', {trusted: e.isTrusted, types: Array.from(e.clipboardData?.types || []), files: files(e.clipboardData?.files), draft: draft()}); });
  listen('click', e => { const b = e.target.closest?.('button'); if (b && (b.closest('.llm-view') || b.closest('.pa-chat-image-picker'))) void record('click', {trusted: e.isTrusted, label: b.getAttribute('aria-label') || b.textContent, draft: draft()}); });
  const onError = e => errors.push({message: e.message});
  window.addEventListener('error', onError);
  window.__b129ManualFinish = async () => {
    await tail;
    const result = {identity: await p.getLoadedPluginBuildIdentity(), fixtureHashes, events, errors, viewport: [innerWidth, innerHeight], draft: draft(), images: [...document.querySelectorAll('.llm-input img')].map(i => ({alt: i.alt, complete: i.complete, width: i.naturalWidth, height: i.naturalHeight}))};
    p.imageAssetService.importFile = originalImport;
    for (const [type, fn] of listeners) document.removeEventListener(type, fn, true);
    window.removeEventListener('error', onError);
    await p.chatHistoryStore.setActiveConversationId(original.conversation);
    for (const leaf of app.workspace.getLeavesOfType('llm-chat')) if (!original.leaves.includes(leaf.id)) leaf.detach();
    const note = original.note && app.vault.getAbstractFileByPath(original.note);
    if (note) await app.workspace.getLeaf(false).openFile(note);
    delete window.__b129ManualFinish;
    result.restored = {observerRemoved: true, conversation: await p.chatHistoryStore.getActiveConversationId() === original.conversation, note: app.workspace.getActiveFile()?.path === original.note, temporaryChatsRemaining: app.workspace.getLeavesOfType('llm-chat').filter(l => !original.leaves.includes(l.id)).length};
    await app.vault.adapter.write(root + '/final.json', JSON.stringify(result, null, 2));
    console.log('PA_B129_MANUAL_FINAL ' + JSON.stringify(result));
    return result;
  };
  await record('setup', {identity, fixtureHashes, vault: app.vault.getName(), reusedPluginInstance: true});
  await p.activeChatView();
  console.log('PA_B129_MANUAL_READY');
})()
