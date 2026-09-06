/* P0 fixture-only acquisition UI. This is not the production Chat composer.
 * Reads only files explicitly selected/pasted/dropped by the operator.
 * Writes unique receipts and captured bytes under the test vault. No network.
 */
(() => {
  const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
  const mkdir = async (vault, path) => {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const next = parts.slice(0, i).join('/');
      if (!await vault.adapter.exists(next)) await vault.createFolder(next);
    }
  };
  globalThis.mountB129AcquisitionProbe = async (app, options = {}) => {
    if (app.vault.getName() !== 'test' || !/^[a-zA-Z0-9_-]+$/.test(options.runId || ''))
      throw new Error('unique_test_run_required');
    if (globalThis.b129Acquisition) throw new Error('previous_probe_must_close');
    const root = `b129-acquisition-runs/${options.runId}`;
    if (await app.vault.adapter.exists(root)) throw new Error('run_exists');
    await mkdir(app.vault, `${root}/captured`);
    const manifest = JSON.parse(await app.vault.adapter.read('b129-p0-fixtures/manifest.json'));
    const expected = manifest.fixtures.map(f => ({name:f.filename,sha256:f.sha256,format:f.format}));
    const note = await app.vault.create(`${root}/input.md`, '# B129 acquisition test\n\nSynthetic images only.\n');
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(note, {state:{mode:'preview'}});
    const doc = leaf.view.containerEl.ownerDocument;
    const panel = doc.createElement('section');
    panel.id = 'b129-acquisition-panel';
    const title = doc.createElement('h2');title.textContent = 'B129 原文件入口验证';panel.append(title);
    const intro = doc.createElement('p');intro.textContent = '仅选择本轮合成测试图片。记录入口文件字节，不发送给 AI。';panel.append(intro);
    const receipt = {kind:'b129-acquisition',runId:options.runId,createdAt:new Date().toISOString(),
      userAgent:navigator.userAgent,pluginVersion:app.plugins.plugins['personal-assistant']?.manifest.version,
      expected,events:[],errors:[],closed:false};
    const status = doc.createElement('p');status.textContent = '等待真实选择、粘贴或拖入';
    let tail = Promise.resolve(), closed = false;
    const listeners = [];
    const on = (node, event, fn) => {node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
    const checkpoint = () => app.vault.adapter.write(`${root}/receipt.json`,JSON.stringify(receipt,null,2));
    const capture = (kind, files, types) => {
      if (closed) return;
      const list = [...files];
      const entry = {sequence:receipt.events.length + 1,kind,types,files:[],startedAt:new Date().toISOString()};
      receipt.events.push(entry);
      tail = tail.then(async () => {
        await checkpoint();
        for (const file of list) {
          const item = {name:file.name,type:file.type,size:file.size,lastModified:file.lastModified};
          entry.files.push(item);
          if (file.size > 24 * 1024 * 1024) {item.error='probe_byte_ceiling';continue;}
          const bytes = await file.arrayBuffer();
          item.sha256 = await sha(bytes);
          item.matchesFixture = expected.filter(f=>f.sha256===item.sha256).map(f=>f.name);
          item.magic = [...new Uint8Array(bytes).slice(0,16)].map(n=>n.toString(16).padStart(2,'0')).join('');
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100) || 'unnamed.bin';
          item.capturedPath = `${root}/captured/${entry.sequence}-${entry.files.length}-${safeName}`;
          await app.vault.createBinary(item.capturedPath,bytes);
          item.savedHashMatches = await sha(await app.vault.adapter.readBinary(item.capturedPath))===item.sha256;
          await checkpoint();
        }
        entry.finishedAt=new Date().toISOString();
        status.textContent=`已记录 ${receipt.events.length} 次入口事件；本次 ${entry.files.length} 个文件`;
        await checkpoint();
      }).catch(async error=>{receipt.errors.push({sequence:entry.sequence,message:String(error)});await checkpoint();status.textContent='探针记录失败，请查回执';});
    };
    for (const [kind,label,accept] of [['files','选择原文件（Files）',''],['photos','选择照片（系统图片入口）','image/*']]) {
      const row=doc.createElement('p'), caption=doc.createElement('label'), input=doc.createElement('input');
      caption.textContent=label;input.type='file';input.multiple=true;input.accept=accept;input.setAttribute('aria-label',label);
      on(input,'change',()=>{capture(kind,input.files||[],['file-input']);input.value='';});
      caption.append(input);row.append(caption);panel.append(row);
    }
    const text=doc.createElement('textarea');text.rows=3;text.setAttribute('aria-label','粘贴或拖入合成图片');
    text.placeholder='在这里粘贴或拖入合成图片';panel.append(text);
    on(text,'paste',event=>{
      const files=[...(event.clipboardData?.files||[])];
      const types=[...(event.clipboardData?.types||[])];
      if(files.length){event.preventDefault();event.stopPropagation();}
      capture('paste',files,types);
    });
    on(text,'dragover',event=>{event.preventDefault();event.stopPropagation();});
    on(text,'drop',event=>{event.preventDefault();event.stopPropagation();capture('drop',event.dataTransfer?.files||[],[...(event.dataTransfer?.types||[])]);});
    const cancel = doc.createElement('button');cancel.textContent='记录取消/无文件选择';
    on(cancel,'click',()=>capture('operator_cancelled_picker',[],[]));panel.append(cancel,status);
    leaf.view.contentEl.prepend(panel);
    const close = async () => {
      if(closed)return;closed=true;listeners.forEach(fn=>fn());await tail;
      receipt.closed=true;receipt.closedAt=new Date().toISOString();await checkpoint();panel.remove();
      delete globalThis.b129Acquisition;
    };
    globalThis.b129Acquisition={root,receipt,flush:()=>tail,close};
    await checkpoint();return {root,expectedFixtures:expected.length,ready:true};
  };
})();
