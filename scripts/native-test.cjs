const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {validateState,readState,writeState,occursOn,reminderKey,normalizeAiEndpoint,normalizeApiKey}=require('../electron/state.cjs');
function state(){return{schemaVersion:1,tasks:[],notes:[],focusSessions:[],reviews:{},settings:{name:'我',lastSaturdayWork:true,dayOverrides:{},focusMinutes:25,breakMinutes:5,morningGreeting:true,autoLaunch:false,aiEndpoint:'',aiModel:''}};}
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
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
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
