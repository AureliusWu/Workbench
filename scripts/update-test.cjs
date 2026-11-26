const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {Readable}=require('node:stream');
const updater=require('../electron/updater.cjs');
const pair=crypto.generateKeyPairSync('ed25519');
const publicKey=pair.publicKey.export({type:'spki',format:'pem'});
const bytes=Buffer.from('controlled installer fixture; never executed');
function manifest(version='1.2.0',data=bytes){const value={schemaVersion:1,version,filename:`Workbench-Setup-${version}-win-x64.exe`,sha256:crypto.createHash('sha256').update(data).digest('hex'),size:data.length};return {...value,signature:crypto.sign(null,updater.canonicalPayload(value),pair.privateKey).toString('base64')};}
function folder(){return fs.mkdtempSync(path.join(os.tmpdir(),'workbench-update-'));}
function clean(directory){const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('workbench-update-'));fs.rmSync(resolved,{recursive:true,force:true});}
function fixtureFetch(value=manifest(),data=bytes,calls=[]){return async url=>{calls.push(url);if(url===updater.FEED_URL)return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});assert.equal(url,updater.installerUrl(value));return new Response(data,{headers:{'content-length':String(data.length)}});};}
function controller(directory,options={}){return updater.createUpdateController({currentVersion:'1.1.9',publicKey,userDataDirectory:directory,eligibility:{enabled:true,reason:''},fetchImpl:fixtureFetch(),autoStart:false,...options});}
test('stable versions compare numeric components and reject ambiguous channels',()=>{
  assert.equal(updater.compareVersions('1.10.0','1.9.20'),1);assert.equal(updater.compareVersions('1.2.0','1.2.0'),0);assert.equal(updater.compareVersions('1.1.9','1.2.0'),-1);
  for(const value of ['v1.2.0','1.2','01.2.0','1.2.0-beta.1','1.2.0+build','1.2.-1','1000001.0.0','1.2.0 '])assert.throws(()=>updater.stableVersion(value));
});
test('manifest signature uses deterministic selected JSON fields and rejects tampering',()=>{
  const valid=manifest();assert.equal(updater.canonicalPayload(valid).toString(),JSON.stringify({schemaVersion:1,version:valid.version,filename:valid.filename,sha256:valid.sha256,size:valid.size}));
  assert.equal(updater.verifyManifest({...valid},publicKey).version,'1.2.0');
  for(const patch of [{version:'1.2.1',filename:'Workbench-Setup-1.2.1-win-x64.exe'},{sha256:'a'.repeat(64)},{size:valid.size+1},{filename:'../outside.exe'},{signature:Buffer.alloc(64).toString('base64')},{url:'https://evil.example/payload'}])assert.throws(()=>updater.verifyManifest({...valid,...patch},publicKey));
  const other=crypto.generateKeyPairSync('ed25519');assert.throws(()=>updater.verifyManifest(valid,other.publicKey.export({type:'spki',format:'pem'})),/签名/);
});
test('signed metadata enforces bounds and base64 signature shape',()=>{
  const valid=manifest();for(const patch of [{size:0},{size:updater.MAX_INSTALLER_BYTES+1},{size:1.5},{sha256:valid.sha256.toUpperCase()},{signature:'a'.repeat(88)},{schemaVersion:2}])assert.throws(()=>updater.verifyManifest({...valid,...patch},publicKey));
});
test('production requests allow only the fixed repository and exact release CDN hosts',()=>{
  const valid=manifest();assert.equal(updater.allowedUrl(updater.FEED_URL,'manifest').href,updater.FEED_URL);assert.equal(updater.allowedUrl(updater.installerUrl(valid),'installer',valid).href,updater.installerUrl(valid));
  assert.ok(updater.allowedUrl('https://release-assets.githubusercontent.com/github-production-release-asset/test?token=fixture','installer',valid));
  for(const url of ['http://github.com/AureliusWu/Workbench/releases/latest/download/workbench-update.json','https://github.com.evil.example/a','https://github.com/other/Workbench/releases/latest/download/workbench-update.json','https://release-assets.githubusercontent.com.evil.example/a','https://user:pass@github.com/AureliusWu/Workbench/releases/latest/download/workbench-update.json','https://github.com/AureliusWu/Workbench/releases/latest/download/workbench-update.json?token=bad'])assert.throws(()=>updater.allowedUrl(url,'manifest'));
  assert.throws(()=>updater.allowedUrl('https://github.com/AureliusWu/Workbench/releases/download/v1.2.0/other.exe','installer',valid));
});
test('redirects remain bounded and reject a hostile destination before its request',async()=>{
  let calls=0;await assert.rejects(updater.request(updater.FEED_URL,'manifest',null,{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.example/payload'}});}}),/信任/);assert.equal(calls,1);
  calls=0;await assert.rejects(updater.request(updater.FEED_URL,'manifest',null,{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:updater.FEED_URL}});}}),/重定向/);assert.equal(calls,6);
});
test('manifest reader bounds streamed bytes and rejects an oversized declaration',async()=>{
  await assert.rejects(updater.readBounded(new Response('small',{headers:{'content-length':'40000'}}),32768),/大小/);
  await assert.rejects(updater.readBounded(new Response('x'.repeat(32769)),32768),/大小/);
});
test('signed update downloads, emits ready, and only installs after explicit action',async()=>{
  const directory=folder(),calls=[],events=[];let launches=0,quits=0;const service=controller(directory,{fetchImpl:fixtureFetch(manifest(),bytes,calls),onState:value=>events.push(value.status),launch:async value=>{launches++;assert.equal(path.basename(value.installer),manifest().filename);await updater.verifyFile(value.installer,manifest());},onQuit:()=>{quits++;}});
  try{const result=await service.check();assert.equal(result.status,'ready');assert.equal(result.progress,100);assert.equal(launches,0);assert.equal(quits,0);assert.deepEqual(calls,[updater.FEED_URL,updater.installerUrl(manifest())]);assert.ok(events.includes('checking'));assert.ok(events.includes('downloading'));assert.equal(events.at(-1),'ready');await service.install();assert.equal(launches,1);assert.equal(quits,1);assert.equal(service.getState().status,'installing');}finally{service.dispose();clean(directory);}
});
test('tampering with cached bytes blocks install and preserves the running application',async()=>{
  const directory=folder();let launched=false,quit=false;const service=controller(directory,{launch:async()=>{launched=true;},onQuit:()=>{quit=true;}});
  try{await service.check();fs.writeFileSync(path.join(directory,'updates',manifest().filename),Buffer.alloc(bytes.length));await assert.rejects(service.install(),/SHA-256/);assert.equal(service.getState().status,'error');assert.equal(launched,false);assert.equal(quit,false);}finally{service.dispose();clean(directory);}
});
test('bad signatures never request an installer and network failures remain recoverable',async()=>{
  const directory=folder(),calls=[];const invalid={...manifest(),size:bytes.length+1};const service=controller(directory,{fetchImpl:fixtureFetch(invalid,bytes,calls)});
  try{assert.equal((await service.check()).status,'error');assert.deepEqual(calls,[updater.FEED_URL]);await assert.rejects(service.install(),/尚未准备/);}finally{service.dispose();clean(directory);}
  const other=folder(),offline=controller(other,{fetchImpl:async()=>{throw new Error('offline fixture');}});try{assert.equal((await offline.check()).status,'error');assert.equal(offline.getState().enabled,true);}finally{offline.dispose();clean(other);}
});
test('same and older signed releases never download or downgrade',async()=>{
  for(const version of ['1.1.9','1.1.8']){const directory=folder(),calls=[],service=controller(directory,{fetchImpl:fixtureFetch(manifest(version),bytes,calls)});try{assert.equal((await service.check()).status,'up-to-date');assert.equal(calls.length,1);await assert.rejects(service.install());}finally{service.dispose();clean(directory);}}
});
test('streaming download rejects truncation, excess bytes, and wrong hashes without a final exe',async()=>{
  const valid=manifest();for(const data of [bytes.subarray(0,bytes.length-1),Buffer.concat([bytes,Buffer.from('extra')]),Buffer.alloc(bytes.length)]){const directory=folder();try{await assert.rejects(updater.downloadInstaller(valid,{cacheDirectory:directory,fetchImpl:async()=>new Response(data)}));assert.equal(fs.existsSync(path.join(directory,valid.filename)),false);assert.deepEqual(fs.readdirSync(directory),[]);}finally{clean(directory);}}
});
test('valid cached installer is reused only after its content is reverified',async()=>{
  const directory=folder(),valid=manifest();fs.writeFileSync(path.join(directory,valid.filename),bytes);try{const file=await updater.downloadInstaller(valid,{cacheDirectory:directory,fetchImpl:async()=>{throw new Error('network should not be used');}});assert.equal(file,path.join(directory,valid.filename));}finally{clean(directory);}
});
test('concurrent checks share one download and automatic preference is persisted separately',async()=>{
  const directory=folder(),calls=[],service=controller(directory,{fetchImpl:fixtureFetch(manifest(),bytes,calls)});
  try{const [a,b]=await Promise.all([service.check(),service.check()]);assert.equal(a.status,'ready');assert.equal(b.status,'ready');assert.equal(calls.length,2);await service.setAutomatic(false);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'updater-settings.json'),'utf8')),{automatic:false});assert.equal(fs.existsSync(path.join(directory,'workbench.json')),false);const restarted=controller(directory);assert.equal(restarted.getState().automatic,false);restarted.dispose();}finally{service.dispose();clean(directory);}
});
test('disabled installations never fetch and disabling automatic scheduling prevents checks',async()=>{
  const directory=folder();let calls=0;const service=controller(directory,{eligibility:{enabled:false,reason:'portable fixture'},fetchImpl:async()=>{calls++;},autoStart:true,initialDelayMs:1,intervalMs:5});try{assert.equal((await service.check()).status,'disabled');await new Promise(resolve=>setTimeout(resolve,15));assert.equal(calls,0);}finally{service.dispose();clean(directory);}
  const other=folder(),automatic=controller(other,{fetchImpl:async()=>{calls++;throw new Error('unexpected');},autoStart:true,initialDelayMs:100,intervalMs:100});try{await automatic.setAutomatic(false);await new Promise(resolve=>setTimeout(resolve,120));assert.equal(calls,0);}finally{automatic.dispose();clean(other);}
});
test('installed-mode detection needs packaged Windows, sibling uninstaller, and matching registry path',async()=>{
  const directory=folder();fs.writeFileSync(path.join(directory,'Workbench.exe'),'fixture');fs.writeFileSync(path.join(directory,'Uninstall Workbench.exe'),'fixture');const options={platform:'win32',isPackaged:true,portable:false,executable:path.join(directory,'Workbench.exe'),queryRegistry:async()=>directory};
  try{assert.equal((await updater.detectInstalled(options)).enabled,true);assert.equal((await updater.detectInstalled({...options,portable:true})).enabled,false);assert.equal((await updater.detectInstalled({...options,isPackaged:false})).enabled,false);assert.equal((await updater.detectInstalled({...options,queryRegistry:async()=>os.tmpdir()})).enabled,false);fs.unlinkSync(path.join(directory,'Uninstall Workbench.exe'));assert.equal((await updater.detectInstalled(options)).enabled,false);assert.equal(updater.parseInstallLocation('  InstallLocation    REG_SZ    D:\\Programs\\Workbench\r\n'),'D:\\Programs\\Workbench');}finally{clean(directory);}
});
test('installer handoff waits for parent exit, hashes via .NET, and never kills a process',()=>{
  const script=updater.handoffScript({installer:'C:\\测试目录\\installer.exe',executable:'C:\\测试目录\\Workbench.exe',parentPid:123,readyFile:'C:\\temp\\ready',cancelFile:'C:\\temp\\cancel',errorFile:'C:\\temp\\failure',sha256:'a'.repeat(64),size:1234,expectedVersion:'1.2.0'});
  assert.ok(script.includes('GetProcessById(123)'));assert.ok(script.includes('$parent.WaitForExit(60000)'));assert.ok(script.includes("'/S --updated'"));assert.equal(script.includes('--force-run'),false);assert.ok(script.includes("Start-UpdateProcess $application '' $false"));assert.ok(script.includes("if ($installedVersion -ne '1.2.0')"));assert.ok(script.includes('[Security.Cryptography.SHA256]::Create()'));assert.ok(script.includes('CreateNoWindow=$hidden'));assert.ok(script.includes('[Diagnostics.ProcessWindowStyle]::Normal'));assert.equal(/Stop-Process|taskkill|Get-FileHash|Wait-Process|Set-Content|Start-Process|Test-Path/.test(script),false);assert.ok(script.indexOf('$parent.WaitForExit')<script.indexOf('$process=Start-UpdateProcess'));assert.ok(script.includes('$stream.Dispose()'));assert.ok(script.includes('[IO.File]::Exists($cancel)'));
});
test('a helper spawn failure rejects without asking the app to exit',async()=>{
  const directory=folder();try{await assert.rejects(updater.launchInstaller({installer:path.join(directory,'fixture.exe'),manifest:manifest(),cacheDirectory:directory,spawnImpl:()=>{const child=new EventEmitter();process.nextTick(()=>child.emit('error',new Error('spawn denied')));return child;}}),/继续运行/);}finally{clean(directory);}
});
test('Electron adapter preserves AbortSignal across an early outgoing close event',async()=>{
  let aborted=false;const net={request:()=>{const client=new EventEmitter();client.setHeader=()=>{};client.end=()=>process.nextTick(()=>client.emit('close'));client.abort=()=>{aborted=true;client.emit('abort');};return client;}};
  const controller=new AbortController(),pending=updater.createElectronFetch(net)('https://github.com/fixture',{signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(aborted,true);
});
test('Electron adapter exposes a redirect without following an unvalidated destination',async()=>{
  let aborted=false;const net={request:()=>{const client=new EventEmitter();client.setHeader=()=>{};client.end=()=>process.nextTick(()=>client.emit('redirect',302,'GET','https://evil.example/blocked',{location:['https://evil.example/blocked']}));client.abort=()=>{aborted=true;client.emit('abort');};client.followRedirect=()=>assert.fail('adapter must never follow a redirect');return client;}};
  const response=await updater.createElectronFetch(net)('https://github.com/fixture');assert.equal(response.status,302);assert.equal(response.headers.get('location'),'https://evil.example/blocked');assert.equal(aborted,true);
});
test('cancelling the Electron response body aborts its upstream request',async()=>{
  let aborted=false;const net={request:()=>{const client=new EventEmitter();client.setHeader=()=>{};client.end=()=>process.nextTick(()=>{const stream=new Readable({read(){}});stream.statusCode=200;stream.headers={'content-type':['application/octet-stream']};client.emit('response',stream);});client.abort=()=>{aborted=true;client.emit('abort');};return client;}};
  const response=await updater.createElectronFetch(net)('https://github.com/fixture');await response.body.cancel();await new Promise(resolve=>setImmediate(resolve));assert.equal(aborted,true);
});
