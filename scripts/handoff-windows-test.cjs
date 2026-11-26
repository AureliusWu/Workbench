'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const updater=require('../electron/updater.cjs');

async function until(check,timeout=15000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,50));}
  throw Error('Timed out waiting for the actual helper process to finish');
}
test('actual Windows PowerShell handoff signals readiness and honors cancellation',{skip:process.platform!=='win32',timeout:60000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-handoff-'));
  const payload=Buffer.from('not an executable; cancellation must prevent any launch');
  const installer=path.join(directory,'fixture.exe');
  await fs.writeFile(installer,payload);
  const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  try{
    await once(parent,'spawn');
    const result=await updater.launchInstaller({installer,manifest:{size:payload.length,sha256:crypto.createHash('sha256').update(payload).digest('hex')},cacheDirectory:directory,executable:process.execPath,parentPid:parent.pid});
    assert.equal(parent.exitCode,null);
    assert.equal(parent.signalCode,null);
    await fs.writeFile(result.cancelFile,'cancel');
    const closed=once(parent,'exit');parent.kill();await closed;
    await until(async()=>{try{await fs.access(result.scriptFile);return false;}catch{return true;}});
    await assert.rejects(fs.access(path.join(directory,'last-update-error.txt')));
    assert.equal((await fs.readFile(installer)).equals(payload),true);
  }finally{
    if(parent.exitCode===null&&parent.signalCode===null){parent.kill();await once(parent,'exit').catch(()=>{});}
    await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
