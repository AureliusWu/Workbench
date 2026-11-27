'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const updater=require('../electron/updater.cjs');

async function until(check,timeout=15000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,50));}
  throw Error('Timed out waiting for the actual helper process to finish');
}
for(const mode of ['cancel','integrity'])test(`actual owning donor exits while Windows helper survives (${mode})`,{skip:process.platform!=='win32',timeout:60000},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-handoff-'));
  // These legal path characters catch accidental shell expansion and command injection.
  const directory=path.join(root,"中文 空格 & exit 9 & %PATH% !bang! ^caret (test) 'quote'");
  await fs.mkdir(directory);const payload=Buffer.from('not an executable; cancellation or a hash mismatch must prevent any launch');
  const installer=path.join(directory,'fixture.exe'),receipt=path.join(directory,'receipt.json');await fs.writeFile(installer,payload);
  const options={installer,manifest:{version:'1.2.0',size:payload.length,sha256:mode==='cancel'?crypto.createHash('sha256').update(payload).digest('hex'):'0'.repeat(64)},cacheDirectory:directory,executable:path.join(directory,'nonexistent-application.exe')};
  // The donor itself owns launchInstaller's child. A sibling-helper test misses libuv job teardown.
  const donorScript="const fs=require('node:fs');const updater=require(process.argv[1]);const value=JSON.parse(Buffer.from(process.argv[2],'base64').toString('utf8'));updater.launchInstaller(value.options).then(result=>{fs.writeFileSync(value.receipt,JSON.stringify(result));if(value.mode==='cancel')fs.writeFileSync(result.cancelFile,'cancel');process.exit(0);}).catch(error=>{process.stderr.write(error.stack||error.message);process.exit(1);});";
  let donor;
  try{
    const detail=Buffer.from(JSON.stringify({options,receipt,mode}),'utf8').toString('base64');
    donor=spawn(process.execPath,['-e',donorScript,path.resolve(__dirname,'../electron/updater.cjs'),detail],{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';donor.stderr.on('data',chunk=>{stderr+=chunk;});
    const closed=new Promise((resolve,reject)=>{donor.once('error',reject);donor.once('exit',(code,signal)=>resolve({code,signal}));});
    const exit=await closed;assert.equal(exit.code,0,stderr);assert.equal(exit.signal,null);
    const result=JSON.parse(await fs.readFile(receipt,'utf8'));
    await until(async()=>{try{await fs.access(result.scriptFile);return false;}catch{return true;}});
    assert.equal((await fs.readFile(installer)).equals(payload),true);
    const log=await fs.readFile(result.diagnosticFile,'utf8');assert.match(log,/helper-start/);assert.match(log,/parent-exited/);assert.doesNotMatch(log,/installer-started/);
    if(mode==='cancel'){await assert.rejects(fs.access(path.join(directory,'last-update-error.txt')));assert.match(log,/cancelled/);}
    else{assert.match(await fs.readFile(path.join(directory,'last-update-error.txt'),'utf8'),/校验失败/);assert.match(log,/failure:/);}
  }finally{
    if(donor?.exitCode===null&&donor?.signalCode===null)donor.kill();
    const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('workbench-handoff-'));
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
