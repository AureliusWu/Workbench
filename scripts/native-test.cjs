const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {validateState,readState,writeState,occursOn,reminderKey,normalizeAiEndpoint,normalizeApiKey,validateReviewExport,exportTarget,backupBeforeImport}=require('../electron/state.cjs');
function state(){return{schemaVersion:1,tasks:[],notes:[],focusSessions:[],reviews:{},settings:{name:'我',lastSaturdayWork:true,dayOverrides:{},focusMinutes:25,breakMinutes:5,morningGreeting:true,autoLaunch:false,aiEndpoint:'',aiModel:''}};}
function removeTestDirectory(folder){const resolved=path.resolve(folder);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('workbench-native-'));fs.rmSync(resolved,{recursive:true,force:true});}
test('state validates empty data, rejects invalid dates and strips credentials',()=>{
  const valid=state();valid.apiKey='private';valid.settings.aiApiKey='private';
  assert.equal(validateState(valid).apiKey,undefined);assert.equal(validateState(valid).settings.aiApiKey,undefined);
  valid.settings.dayOverrides['2026-02-30']='rest';assert.throws(()=>validateState(valid),/设置/);
});
test('import rejects prototype keys, duplicate tasks and malformed time',()=>{
  const task={id:'one',title:'事务',date:'2026-11-24',time:'09:30',priority:'high',done:false,createdAt:'2026-11-24T01:00:00Z',steps:[],repeat:'none',estimate:25,reminder:true};
  const input=state();input.tasks=[task,{...task}];assert.throws(()=>validateState(input),/重复/);
  input.tasks=[{...task,time:'25:00'}];assert.throws(()=>validateState(input),/待办/);
  input.tasks=[];input.settings.dayOverrides=JSON.parse('{"__proto__":"rest"}');assert.throws(()=>validateState(input),/设置/);
});
test('atomic persistence recovers backup without overwriting it with corrupt primary',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-native-'));const file=path.join(folder,'workbench.json');
  try{
    const original=state();original.settings.name='原始';writeState(file,original);
    const updated=state();updated.settings.name='新状态';writeState(file,updated);
    fs.writeFileSync(file,'{incomplete');const recovered=readState(file);assert.equal(recovered.recovered,true);assert.equal(recovered.state.settings.name,'原始');
    writeState(file,updated);assert.equal(readState(file).state.settings.name,'新状态');assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`,'utf8')).settings.name,'原始');
    assert.equal(fs.existsSync(`${file}.tmp`),false);
  }finally{removeTestDirectory(folder);}
});
test('reminder recurrence does not run before start and matches weekdays',()=>{
  assert.equal(occursOn({date:'2026-11-24',repeat:'daily'},'2026-11-23'),false);
  assert.equal(occursOn({date:'2026-11-24',repeat:'weekly'},'2026-12-01'),true);
  assert.equal(occursOn({date:'2026-11-24',repeat:'weekly'},'2026-12-02'),false);
  assert.equal(occursOn({date:'2026-11-24',repeat:'none'},'2026-11-25'),false);
});
test('recurring template and occurrence snapshot share one notification ledger key',()=>{
  assert.equal(reminderKey({id:'daily-series'},'2026-11-24'),reminderKey({id:'daily-series::2026-11-24'},'2026-11-24'));
  assert.notEqual(reminderKey({id:'daily-series::2026-11-24'},'2026-11-24'),reminderKey({id:'daily-series'},'2026-11-25'));
});
test('AI endpoint normalization accepts explicit secure providers and local services only',()=>{
  assert.equal(String(normalizeAiEndpoint('https://api.openai.com/v1')),'https://api.openai.com/v1/chat/completions');
  assert.equal(String(normalizeAiEndpoint('https://api.example.com/v1/chat/completions/')),'https://api.example.com/v1/chat/completions');
  assert.equal(String(normalizeAiEndpoint('http://127.0.0.1:11434/v1/')),'http://127.0.0.1:11434/v1/chat/completions');
  for(const address of ['http://example.com/v1','https://user:secret@example.com/v1','https://example.com/v1?key=secret','file:///C:/secrets','http://localhost.evil.com/v1'])assert.throws(()=>normalizeAiEndpoint(address));
  assert.equal(normalizeApiKey('  local-key  '),'local-key');
  assert.throws(()=>normalizeApiKey('private\nvalue'),error=>!error.message.includes('private'));
});
test('only documented fields survive import and note/session identifiers remain unique',()=>{
  const valid=state();valid.settings.privateToken='secret';valid.nested={apiKey:'secret'};
  const result=validateState(valid);assert.equal(result.nested,undefined);assert.equal(result.settings.privateToken,undefined);
  valid.notes=[{id:'note',text:'想法',color:'pink',createdAt:'2026-11-24T01:00:00Z'},{id:'note',text:'重复',color:'mint',createdAt:'2026-11-24T01:00:00Z'}];assert.throws(()=>validateState(valid),/便签/);
});
test('schema1 old backups normalize tag arrays and preserve archive/tag edits on round trip',()=>{
  const old=state();old.notes=[{id:'note',text:'旧版便签',color:'pink',createdAt:'2026-11-24T01:00:00Z'}];
  const migrated=validateState(old);assert.equal(migrated.schemaVersion,1);assert.deepEqual(migrated.noteTags,[]);assert.deepEqual(migrated.notes[0].tagIds,[]);assert.equal(migrated.notes[0].archivedAt,undefined);
  migrated.noteTags=[{id:'office',name:' 办公 '}];migrated.notes[0].tagIds=['office'];migrated.notes[0].archivedAt='2026-11-24T02:00:00Z';
  const next=validateState(migrated);assert.equal(next.noteTags[0].name,'办公');assert.deepEqual(next.notes[0].tagIds,['office']);assert.equal(next.notes[0].archivedAt,'2026-11-24T02:00:00Z');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-native-'));try{const file=path.join(folder,'state.json');writeState(file,next);assert.deepEqual(readState(file).state,next);}finally{removeTestDirectory(folder);}
});
test('tag validation rejects unknown references, duplicates and malformed archive timestamps',()=>{
  const input=state();input.noteTags=[{id:'tag',name:'办公'}];input.notes=[{id:'note',text:'备忘',color:'mint',createdAt:'2026-11-24T01:00:00Z',tagIds:['missing']}];assert.throws(()=>validateState(input),/标签/);
  input.notes[0].tagIds=['tag','tag'];assert.throws(()=>validateState(input),/便签/);
  input.notes[0].tagIds=['tag'];input.notes[0].archivedAt='yesterday';assert.throws(()=>validateState(input),/便签/);
  delete input.notes[0].archivedAt;input.noteTags.push({id:'another',name:' 办公 '});assert.throws(()=>validateState(input),/标签/);
  input.noteTags=[{id:'tag',name:'办公'},{id:'tag',name:'生活'}];assert.throws(()=>validateState(input),/标签/);
});
test('undated tasks are nonrecurring and never eligible for calendar reminders',()=>{
  const input=state(),task={id:'inbox',title:'想做的事',date:'',time:'',priority:'low',done:false,createdAt:'2026-11-24T01:00:00Z',steps:[],repeat:'none',estimate:25,reminder:false};input.tasks=[task];
  assert.equal(validateState(input).tasks[0].date,'');assert.equal(occursOn(task,'2026-11-24'),false);
  for(const patch of [{time:'09:00'},{reminder:true},{repeat:'daily'},{repeat:'weekly'}]){input.tasks=[{...task,...patch}];assert.throws(()=>validateState(input),/待办/);}
  assert.equal(occursOn({...task,repeat:'daily'},'2026-11-24'),false);
});
test('Markdown exports require a valid complete week and bounded literal text',()=>{
  const valid={weekStart:'2026-11-23',weekEnd:'2026-11-29',markdown:'# 周总结\n\n已完成 **会议纪要**。\n'};assert.deepEqual(validateReviewExport(valid),valid);
  for(const patch of [{weekStart:'2026-11-24'},{weekEnd:'2026-11-30'},{weekEnd:'2026-02-30'},{markdown:''},{markdown:'坏\0内容'},{markdown:'字'.repeat(800000)}])assert.throws(()=>validateReviewExport({...valid,...patch}));
});
test('exports cannot overwrite state through direct, junction or hardlink aliases',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-native-'));try{
    const data=path.join(folder,'data'),outside=path.join(folder,'exports');fs.mkdirSync(data);fs.mkdirSync(outside);const file=path.join(data,'workbench.json');writeState(file,state());
    const permitted=path.join(outside,'review.md');assert.equal(exportTarget(permitted,data,[file]),permitted);
    assert.throws(()=>exportTarget(file,data,[file]),/本地数据/);assert.throws(()=>exportTarget(path.join(data,'review.md'),data,[file]),/本地数据/);
    const alias=path.join(outside,'review.md');fs.linkSync(file,alias);assert.throws(()=>exportTarget(alias,data,[file]),/链接/);
    const linkedDirectory=path.join(outside,'linked-data');fs.symlinkSync(data,linkedDirectory,'junction');assert.throws(()=>exportTarget(path.join(linkedDirectory,'review.md'),data,[file]),/本地数据/);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).schemaVersion,1);
  }finally{removeTestDirectory(folder);}
});
test('import snapshots survive normal .bak rotation and omit unknown private fields',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-native-'));try{
    const file=path.join(folder,'workbench.json'),old=state();old.settings.name='导入前';old.apiKey='secret';writeState(file,old);
    const backup=backupBeforeImport(file,old);assert.ok(backup);const imported=state();imported.settings.name='导入后';writeState(file,imported);imported.settings.name='导入后编辑';writeState(file,imported);
    const preserved=JSON.parse(fs.readFileSync(backup,'utf8'));assert.equal(preserved.settings.name,'导入前');assert.equal(preserved.apiKey,undefined);assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`,'utf8')).settings.name,'导入后');
    assert.equal(backupBeforeImport(file,null),null);
  }finally{removeTestDirectory(folder);}
});
test('first 1.1 save preserves exact old schema1 bytes once, independently of bak rotation',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-native-'));try{
    const file=path.join(folder,'workbench.json'),old=state();old.settings.name='升级前';old.notes=[{id:'legacy',text:'旧版保留的记录',color:'pink',createdAt:'2026-11-24T01:00:00Z'}];
    const bytes=Buffer.from(`  ${JSON.stringify(old)}\r\n`);fs.writeFileSync(file,bytes);
    // Reading/migrating in memory must not create an upgrade snapshot or alter primary bytes.
    assert.equal(readState(file).state.notes[0].text,'旧版保留的记录');assert.equal(fs.existsSync(path.join(folder,'backups')),false);assert.deepEqual(fs.readFileSync(file),bytes);
    const next=state();next.settings.name='升级后';writeState(file,next);
    const snapshot=path.join(folder,'backups','before-1.1.0.json');assert.deepEqual(fs.readFileSync(snapshot),bytes);
    next.settings.name='升级后继续编辑';writeState(file,next);assert.deepEqual(fs.readFileSync(snapshot),bytes);assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`,'utf8')).settings.name,'升级后');
  }finally{removeTestDirectory(folder);}
});
test('upgrade snapshot failure leaves both old primary and bak untouched',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-native-'));try{
    const file=path.join(folder,'workbench.json'),old=state();old.settings.name='原数据';const original=JSON.stringify(old);fs.writeFileSync(file,original);
    const older=state();older.settings.name='原备份';const previousBackup=JSON.stringify(older);fs.writeFileSync(`${file}.bak`,previousBackup);
    // A regular file blocking the backups directory simulates a failed preservation destination.
    fs.writeFileSync(path.join(folder,'backups'),'blocked');
    assert.throws(()=>writeState(file,state()));assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(fs.readFileSync(`${file}.bak`,'utf8'),previousBackup);assert.equal(fs.existsSync(`${file}.tmp`),false);
  }finally{removeTestDirectory(folder);}
});
test('an existing upgrade snapshot is never overwritten and a partial one blocks replacement',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-native-'));try{
    const file=path.join(folder,'workbench.json'),old=state();old.settings.name='当前旧数据';const primary=JSON.stringify(old);fs.writeFileSync(file,primary);fs.mkdirSync(path.join(folder,'backups'));
    const snapshot=path.join(folder,'backups','before-1.1.0.json');fs.writeFileSync(snapshot,'{partial');assert.throws(()=>writeState(file,state()),/备份/);assert.equal(fs.readFileSync(file,'utf8'),primary);assert.equal(fs.readFileSync(snapshot,'utf8'),'{partial');
    const preserved=state();preserved.settings.name='较早有效快照';const saved=JSON.stringify(preserved);fs.writeFileSync(snapshot,saved);writeState(file,state());assert.equal(fs.readFileSync(snapshot,'utf8'),saved);
  }finally{removeTestDirectory(folder);}
});
