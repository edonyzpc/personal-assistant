/* P0 host attachment-path state sequence, unique synthetic test vault paths. */
globalThis.runB129AnchorSequenceProbe = async (app, runId) => {
  if(app.vault.getName()!=='test'||!/^[a-zA-Z0-9_-]+$/.test(runId))throw new Error('test_scope_required');
  const root=`b129-anchor-sequences/${runId}`;
  if(await app.vault.adapter.exists(root))throw new Error('unique_run_required');
  const mkdir=async path=>{const p=path.split('/');for(let i=1;i<=p.length;i++){const q=p.slice(0,i).join('/');if(!await app.vault.adapter.exists(q))await app.vault.createFolder(q);}};
  const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  await mkdir(`${root}/A`);await mkdir(`${root}/B`);await mkdir(`${root}/moved`);
  const before=app.vault.getConfig('attachmentFolderPath');
  const result={kind:'b129-anchor-sequence',runId,createdAt:new Date().toISOString(),cases:[],restored:false};
  const noteA=await app.vault.create(`${root}/A/anchor.md`,'B129 synthetic anchor');
  const noteB=await app.vault.create(`${root}/B/unrelated.md`,'B129 unrelated active note');
  const bytes=await app.vault.adapter.readBinary('b129-p0-fixtures/chart-transparent.png');
  const sourceHash=await sha(bytes);const stored=[];
  const record=async(label,anchorPath,expectedPrefix,write=false)=>{
    const resolved=await app.fileManager.getAvailablePathForAttachment(`b129-${runId}-${label}.png`,anchorPath);
    const base=resolved.includes('/')?resolved.slice(0,resolved.lastIndexOf('/')):'';
    const passed=base===expectedPrefix;
    const entry={label,activePath:app.workspace.getActiveFile()?.path,anchorPath,setting:app.vault.getConfig('attachmentFolderPath'),resolved,actualFolder:base,expectedFolder:expectedPrefix,passed};
    if(write){const path=`${base?base+'/':''}pa-images/b129-${runId}-${label}.png`;await mkdir(base?`${base}/pa-images`:'pa-images');await app.vault.createBinary(path,bytes);stored.push(path);entry.originalPath=path;entry.hashMatches=await sha(await app.vault.adapter.readBinary(path))===sourceHash;}
    result.cases.push(entry);await app.vault.adapter.write(`${root}/receipt.json`,JSON.stringify(result,null,2));
  };
  try{
    app.vault.setConfig('attachmentFolderPath','./assets');
    await app.workspace.getLeaf(false).openFile(noteA);
    await record('initial',noteA.path,`${root}/A/assets`,true);
    await app.workspace.getLeaf(false).openFile(noteB);
    await record('leaf-changed',noteA.path,`${root}/A/assets`);
    await app.fileManager.renameFile(noteA,`${root}/moved/anchor.md`);
    await record('anchor-moved',noteA.path,`${root}/moved/assets`,true);
    app.vault.setConfig('attachmentFolderPath',`${root}/fixed-new`);
    await record('setting-changed',noteA.path,`${root}/fixed-new`,true);
    app.vault.setConfig('attachmentFolderPath','./assets');
    await record('no-related-note','PA Chat.md','assets');
    result.existingOriginals=[];
    for(const path of stored)result.existingOriginals.push({path,exists:await app.vault.adapter.exists(path),hashMatches:await sha(await app.vault.adapter.readBinary(path))===sourceHash});
    result.allPassed=result.cases.every(c=>c.passed&&(c.hashMatches??true))&&result.existingOriginals.every(c=>c.exists&&c.hashMatches);
  }finally{
    app.vault.setConfig('attachmentFolderPath',before);result.restored=app.vault.getConfig('attachmentFolderPath')===before;
    await app.vault.adapter.write(`${root}/receipt.json`,JSON.stringify(result,null,2));
  }
  return result;
};
