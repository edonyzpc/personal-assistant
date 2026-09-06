/* Consolidated synthetic real-device P0 lane. Append after the four runners. */
globalThis.runB129DeviceP0 = async (app, runId) => {
  if (app.vault.getName() !== 'test' || !/^[a-z0-9-]+$/.test(runId)) throw new Error('test_run_required');
  const path = `b129-p0-fixtures/${runId}-checkpoint.json`;
  if (await app.vault.adapter.exists(path)) throw new Error('unique_run_required');
  const receipt = {kind:'b129-device-p0',runId,startedAt:new Date().toISOString(),phases:[],errors:[]};
  const save = () => app.vault.adapter.write(path,JSON.stringify(receipt,null,2));
  await save();
  const phase = async (name,fn) => {
    receipt.stage=name;await save();
    try {receipt.phases.push({name,result:await fn()});}
    catch(error){receipt.errors.push({name,error:String(error)});}
    await save();
  };
  const manifest=JSON.parse(await app.vault.adapter.read('b129-p0-fixtures/manifest.json'));
  const fixtures=manifest.fixtures.filter(x=>!x.megapixels).map(x=>({path:`b129-p0-fixtures/${x.filename}`}));
  fixtures.push(...(await app.vault.adapter.list('b129-format-fixtures')).files.map(path=>({path})),
    {path:'b129-heic-core-check/chart-synthetic-gps.heic'});
  await phase('formats',()=>runB129FormatProbe(app,{runId:`${runId}-formats`,fixtures}));
  await phase('resources',()=>runB129ResourceProbe(app,{runId:`${runId}-resources`}));
  await phase('anchors',()=>runB129AnchorSequenceProbe(app,`${runId}-anchors`));
  await phase('acquisition',()=>mountB129AcquisitionProbe(app,{runId:`${runId}-acquire`}));
  receipt.stage='awaiting_real_picker';receipt.finishedAt=new Date().toISOString();await save();
  console.log('B129_DEVICE_P0_READY',JSON.stringify({path,errors:receipt.errors}));
  return {path,errors:receipt.errors};
};
