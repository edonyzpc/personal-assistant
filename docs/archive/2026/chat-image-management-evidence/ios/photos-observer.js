(async()=>{
  const root='b129-ios-20260908', expected='8c22f1ba514870fd74c0e8286e415cd6ab323b5a411c73f0f25bc31af4670039';
  if(app.vault.getName()!=='test') throw Error('Wrong vault');
  const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
  const old=app.plugins.plugins['personal-assistant'];
  const original={conversation:await old.chatHistoryStore.getActiveConversationId(),note:app.workspace.getActiveFile()?.path,attachment:app.vault.getConfig('attachmentFolderPath'),leaves:app.workspace.getLeavesOfType('llm-chat').map(l=>l.id)};
  const diskHash=await hash(new TextEncoder().encode(await app.vault.adapter.read('.obsidian/plugins/personal-assistant/main.js')));
  if(diskHash!==expected) throw Error('Device asset not synced: '+diskHash);
  await app.plugins.disablePlugin('personal-assistant');
  await app.plugins.enablePlugin('personal-assistant');
  const p=app.plugins.plugins['personal-assistant'];
  const identity=await p.getLoadedPluginBuildIdentity();
  if(p===old||identity.blocker||identity.loadedPluginArtifactSha256!==expected) throw Error('Loaded identity mismatch');
  const id='b129_ios_20260908';
  if(await p.chatHistoryStore.getConversation(id)) throw Error('Fixture already exists');
  const now=new Date().toISOString();
  await p.chatHistoryStore.upsertConversation({id,title:'B129 iPhone current build',createdAt:now,updatedAt:now,turnCount:0,preview:'',imageAnchor:{path:'PA Chat.md',kind:'logical_root'}});
  await p.chatHistoryStore.setActiveConversationId(id);
  app.vault.setConfig('attachmentFolderPath','attachments');
  await app.vault.adapter.write(root+'/original.json',JSON.stringify(original,null,2));
  const events=[];let tail=Promise.resolve();let seq=0;
  const record=(kind,data)=>{const event={n:++seq,at:new Date().toISOString(),kind,...data};events.push(event);tail=tail.then(()=>app.vault.adapter.write(root+'/event-'+String(event.n).padStart(3,'0')+'.json',JSON.stringify(event,null,2)));return tail;};
  const originalImport=p.imageAssetService.importFile;
  p.imageAssetService.importFile=async function(file,options){
    const bytes=await file.arrayBuffer(), beforeAssets=(await p.chatHistoryStore.listImageAssets()).length;
    const beforeFiles=new Set(app.vault.getFiles().map(f=>f.path));
    const input={name:file.name,type:file.type,size:file.size,sha256:await hash(bytes),magic:Array.from(new Uint8Array(bytes).slice(0,32)),draft:document.querySelector('.llm-input textarea')?.value};
    try {
      const output=await originalImport.call(this,file,options);
      await record('import-accepted',{input,asset:output.asset,byteMatch:await hash(await app.vault.adapter.readBinary(output.asset.originalPath))===input.sha256});
      return output;
    } catch(error){await record('import-rejected',{input,error:String(error),assetDelta:(await p.chatHistoryStore.listImageAssets()).length-beforeAssets,newFiles:app.vault.getFiles().filter(f=>!beforeFiles.has(f.path)).map(f=>f.path)});throw error;}
  };
  const listeners=[];
  const listen=(type,fn)=>{document.addEventListener(type,fn,true);listeners.push([type,fn]);};
  listen('change',e=>{if(e.target instanceof HTMLInputElement&&e.target.type==='file')void record('native-file-change',{trusted:e.isTrusted,accept:e.target.accept,files:Array.from(e.target.files||[]).map(f=>({name:f.name,type:f.type,size:f.size}))});});
  listen('cancel',e=>{if(e.target instanceof HTMLInputElement&&e.target.type==='file')void record('native-file-cancel',{trusted:e.isTrusted,draft:document.querySelector('.llm-input textarea')?.value});});
  listen('paste',e=>{if(e.target.closest?.('.llm-input'))void record('paste',{trusted:e.isTrusted,files:Array.from(e.clipboardData?.files||[]).map(f=>({name:f.name,type:f.type,size:f.size})),draft:document.querySelector('.llm-input textarea')?.value});});
  listen('click',e=>{const b=e.target.closest?.('button');if(b&&(b.closest('.llm-view')||b.closest('.pa-chat-image-picker')))void record('click',{trusted:e.isTrusted,label:b.getAttribute('aria-label')||b.textContent,draft:document.querySelector('.llm-input textarea')?.value});});
  const errors=[];const onError=e=>errors.push({message:e.message});window.addEventListener('error',onError);
  window.__b129Finish=async()=>{
    await tail;
    const result={identity,instanceChanged:p!==old,events,errors,viewport:[innerWidth,innerHeight],draft:document.querySelector('.llm-input textarea')?.value,
      images:[...document.querySelectorAll('.llm-input img')].map(i=>({alt:i.alt,complete:i.complete,width:i.naturalWidth,height:i.naturalHeight})),
      assets:(await p.imageAssetService.listAssets()).filter(a=>a.createdAt>=Date.parse(now)),
      providerCalled:false};
    p.imageAssetService.importFile=originalImport;
    for(const [type,fn] of listeners)document.removeEventListener(type,fn,true);
    window.removeEventListener('error',onError);
    app.vault.setConfig('attachmentFolderPath',original.attachment);
    await p.chatHistoryStore.setActiveConversationId(original.conversation);
    result.restored={attachment:app.vault.getConfig('attachmentFolderPath')===original.attachment,conversation:await p.chatHistoryStore.getActiveConversationId()===original.conversation};
    await app.vault.adapter.write(root+'/final.json',JSON.stringify(result,null,2));
    console.log('PA_B129_IOS_FINAL '+JSON.stringify(result));return result;
  };
  await record('setup',{identity,instanceChanged:p!==old,vault:app.vault.getName(),viewport:[innerWidth,innerHeight]});
  await p.activeChatView();
  console.log('PA_B129_IOS_READY '+JSON.stringify({identity,instanceChanged:p!==old,vault:app.vault.getName()}));
})()
