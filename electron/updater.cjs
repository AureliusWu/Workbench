'use strict';
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {Readable}=require('node:stream');
const execFileAsync=promisify(execFile);
const FEED_URL='https://github.com/AureliusWu/Workbench/releases/latest/download/workbench-update.json';
const RELEASE_BASE='https://github.com/AureliusWu/Workbench/releases/download/';
const INSTALL_REGISTRY_KEY='HKCU\\Software\\01102294-7068-596a-b26b-50193e5b226e';
const MAX_INSTALLER_BYTES=1024*1024*1024;
const CDN_HOSTS=new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
function stableVersion(value){
  if(typeof value!=='string'||value.length>32||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))throw new Error('更新版本号格式不受支持。');
  const parts=value.split('.').map(Number);if(parts.some(n=>!Number.isSafeInteger(n)||n>1000000))throw new Error('更新版本号超出范围。');return parts;
}
function compareVersions(a,b){const x=stableVersion(a),y=stableVersion(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function canonicalPayload(value){return Buffer.from(JSON.stringify({schemaVersion:value.schemaVersion,version:value.version,filename:value.filename,sha256:value.sha256,size:value.size}),'utf8');}
function verifyManifest(value,publicKey){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='filename,schemaVersion,sha256,signature,size,version'||value.schemaVersion!==1)throw new Error('更新清单格式不受支持。');
  stableVersion(value.version);
  if(value.filename!==`Workbench-Setup-${value.version}-win-x64.exe`||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)||!Number.isSafeInteger(value.size)||value.size<1||value.size>MAX_INSTALLER_BYTES)throw new Error('更新安装包信息不正确。');
  if(typeof value.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(value.signature)||Buffer.from(value.signature,'base64').toString('base64')!==value.signature)throw new Error('更新清单签名格式不正确。');
  let key;try{key=crypto.createPublicKey(publicKey);}catch{throw new Error('更新校验公钥不可用。');}
  if(key.asymmetricKeyType!=='ed25519'||!crypto.verify(null,canonicalPayload(value),key,Buffer.from(value.signature,'base64')))throw new Error('更新清单签名校验失败，已停止更新。');
  return Object.freeze({schemaVersion:1,version:value.version,filename:value.filename,sha256:value.sha256,size:value.size,signature:value.signature});
}
function installerUrl(manifest){return `${RELEASE_BASE}v${manifest.version}/${manifest.filename}`;}
function allowedUrl(input,kind,manifest){
  let url;try{url=new URL(input);}catch{throw new Error('更新下载地址无效。');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash)throw new Error('更新下载地址不受信任。');
  if(CDN_HOSTS.has(url.hostname))return url;
  if(url.origin!=='https://github.com'||url.search)throw new Error('更新下载地址不受信任。');
  if(kind==='manifest'&&(url.href===FEED_URL||/^\/AureliusWu\/Workbench\/releases\/download\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\/workbench-update\.json$/.test(url.pathname)))return url;
  if(kind==='installer'&&manifest&&url.href===installerUrl(manifest))return url;
  throw new Error('更新下载地址不受信任。');
}
async function request(url,kind,manifest,{fetchImpl=fetch,signal}={}){
  let target=url;
  for(let redirects=0;redirects<=5;redirects++){
    allowedUrl(target,kind,manifest);
    const response=await fetchImpl(target,{redirect:'manual',signal,credentials:'omit',headers:{Accept:kind==='manifest'?'application/json':'application/octet-stream','User-Agent':'Workbench-Updater'}});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');await response.body?.cancel();if(!location||redirects===5)throw new Error('更新下载重定向次数过多。');target=new URL(location,target).href;continue;
    }
    if(response.status!==200){await response.body?.cancel();throw new Error(response.status===404?'暂未发布可用的更新清单，请稍后重试。':`更新服务暂不可用（${response.status}）。`);}
    return response;
  }
  throw new Error('更新下载重定向失败。');
}
function createElectronFetch(net){
  return (url,options={})=>new Promise((resolve,reject)=>{
    let settled=false,client,incoming;
    const fail=error=>{if(!settled){settled=true;reject(error);}};
    const cleanup=()=>options.signal?.removeEventListener('abort',abort);
    const abort=()=>{const error=new Error('更新请求已取消。');error.name='AbortError';fail(error);incoming?.destroy(error);client?.abort();cleanup();};
    if(options.signal?.aborted){abort();return;}
    try{
      client=net.request({url,method:'GET',redirect:'manual',credentials:'omit',useSessionCookies:false});
      for(const [name,value]of Object.entries(options.headers||{}))client.setHeader(name,value);
      options.signal?.addEventListener('abort',abort,{once:true});
      client.once('abort',cleanup);
      client.on('error',error=>{fail(error);cleanup();});
      client.on('redirect',(status,_method,location,rawHeaders)=>{
        if(settled)return;const headers=new Headers();for(const [name,values]of Object.entries(rawHeaders||{}))for(const value of Array.isArray(values)?values:[values])headers.append(name,String(value));headers.set('location',location);
        // Expose the first hop, then cancel it. The outer request() validates the next URL before another request.
        settled=true;resolve(new Response(null,{status,headers}));client.abort();
      });
      client.once('response',response=>{
        if(settled){client.abort();return;}incoming=response;const headers=new Headers();for(const [name,values]of Object.entries(response.headers||{}))for(const value of Array.isArray(values)?values:[values])headers.append(name,String(value));
        let ended=false;response.once('end',()=>{ended=true;cleanup();});response.once('close',()=>{if(!ended)client.abort();cleanup();});
        try{const body=Readable.toWeb(response);settled=true;resolve(new Response(body,{status:response.statusCode,headers}));}catch(error){fail(error);client.abort();}
      });
      client.end();
    }catch(error){fail(error);client?.abort();}
  });
}
async function readBounded(response,limit){
  const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>limit)){await response.body?.cancel();throw new Error('更新清单超过允许大小。');}
  if(!response.body)throw new Error('更新服务没有返回内容。');const chunks=[];let size=0;
  for await(const chunk of response.body){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>limit)throw new Error('更新清单超过允许大小。');chunks.push(bytes);}
  return Buffer.concat(chunks).toString('utf8');
}
async function verifyFile(filename,manifest){
  const stat=await fsp.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==manifest.size)throw new Error('更新安装包大小校验失败。');
  const hash=crypto.createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(filename)){bytes+=chunk.length;if(bytes>manifest.size)throw new Error('更新安装包大小校验失败。');hash.update(chunk);}
  if(bytes!==manifest.size||hash.digest('hex')!==manifest.sha256)throw new Error('更新安装包 SHA-256 校验失败。');return true;
}
async function downloadInstaller(manifest,{cacheDirectory,fetchImpl=fetch,onProgress=()=>{},signal}={}){
  await fsp.mkdir(cacheDirectory,{recursive:true});if((await fsp.lstat(cacheDirectory)).isSymbolicLink())throw new Error('更新缓存目录不能是链接。');
  const file=path.join(cacheDirectory,manifest.filename);
  try{await verifyFile(file,manifest);onProgress(manifest.size,manifest.size);return file;}catch(error){if(error.code!=='ENOENT'){const stat=await fsp.lstat(file).catch(()=>null);if(stat?.isDirectory())throw new Error('更新缓存位置无效。');await fsp.unlink(file).catch(()=>{});}}
  const response=await request(installerUrl(manifest),'installer',manifest,{fetchImpl,signal});
  const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)!==manifest.size)){await response.body?.cancel();throw new Error('更新安装包声明大小与签名清单不一致。');}
  if(!response.body)throw new Error('更新安装包下载内容为空。');
  const temporary=path.join(cacheDirectory,`.download-${crypto.randomUUID()}.tmp`),handle=await fsp.open(temporary,'wx',0o600),hash=crypto.createHash('sha256');let size=0;
  try{
    for await(const chunk of response.body){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>manifest.size||size>MAX_INSTALLER_BYTES)throw new Error('更新安装包超过签名清单大小。');hash.update(bytes);let offset=0;while(offset<bytes.length){const result=await handle.write(bytes,offset,bytes.length-offset);if(!result.bytesWritten)throw new Error('无法写入更新缓存。');offset+=result.bytesWritten;}onProgress(size,manifest.size);}
    if(size!==manifest.size)throw new Error('更新安装包下载不完整。');if(hash.digest('hex')!==manifest.sha256)throw new Error('更新安装包 SHA-256 校验失败。');await handle.sync();await handle.close();await fsp.rename(temporary,file);return file;
  }catch(error){await handle.close().catch(()=>{});await fsp.unlink(temporary).catch(()=>{});throw error;}
}
function parseInstallLocation(output){const match=String(output).match(/^\s*InstallLocation\s+REG_SZ\s+(.+)\s*$/m);return match?match[1].trim():null;}
async function detectInstalled({platform=process.platform,isPackaged,executable=process.execPath,portable=Boolean(process.env.PORTABLE_EXECUTABLE_FILE),queryRegistry}={}){
  if(platform!=='win32'||!isPackaged||portable)return {enabled:false,reason:portable?'便携版请下载新版安装包后手动更新。':'自动更新仅在已安装的 Windows 版中可用。'};
  const directory=await fsp.realpath(path.dirname(executable));let uninstaller;
  try{uninstaller=await fsp.realpath(path.join(directory,'Uninstall Workbench.exe'));if(!(await fsp.stat(uninstaller)).isFile()||path.dirname(uninstaller).toLowerCase()!==directory.toLowerCase())throw new Error();}catch{return {enabled:false,reason:'未检测到有效安装记录，请使用安装版。'};}
  const query=queryRegistry||(async()=>{
    const reg=path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe');
    for(const view of ['64','32']){try{const result=await execFileAsync(reg,['query',INSTALL_REGISTRY_KEY,'/v','InstallLocation',`/reg:${view}`],{windowsHide:true,timeout:5000,maxBuffer:65536});const location=parseInstallLocation(result.stdout);if(location)return location;}catch{}}
    return null;
  });
  const registered=await query();if(!registered)return {enabled:false,reason:'没有找到此用户的安装注册信息。'};
  try{if((await fsp.realpath(registered)).toLowerCase()!==directory.toLowerCase())throw new Error();}catch{return {enabled:false,reason:'当前程序与安装记录不一致，请使用已安装的版本。'};}
  return {enabled:true,reason:'',directory,uninstaller};
}
function encodedPath(value){return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value,'utf8').toString('base64')}'))`;}
function handoffScript({installer,executable,parentPid,readyFile,cancelFile,errorFile,sha256,size,expectedVersion}){
  if(!Number.isSafeInteger(parentPid)||parentPid<1||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(size)||size<1)throw new Error('更新交接参数无效。');
  stableVersion(expectedVersion);
  return `$ErrorActionPreference='Stop'
$installer=${encodedPath(installer)}
$application=${encodedPath(executable)}
$ready=${encodedPath(readyFile)}
$cancel=${encodedPath(cancelFile)}
$failure=${encodedPath(errorFile)}
function Write-Phase([string]$message) {
  [Console]::WriteLine([DateTime]::UtcNow.ToString('o')+' '+$message)
}
function Start-UpdateProcess([string]$file,[string]$arguments,[bool]$hidden) {
  $info=[Diagnostics.ProcessStartInfo]::new()
  $info.FileName=$file
  $info.Arguments=$arguments
  $info.WorkingDirectory=[IO.Path]::GetDirectoryName($file)
  $info.UseShellExecute=$false
  $info.CreateNoWindow=$hidden
  if ($hidden) { $info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden }
  else { $info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Normal }
  # Do not inherit Electron/Node debugger mode from the exiting app or its test harness.
  foreach ($name in @('ELECTRON_RUN_AS_NODE','NODE_OPTIONS','ELECTRON_NO_ATTACH_CONSOLE')) { $info.EnvironmentVariables.Remove($name) }
  return [Diagnostics.Process]::Start($info)
}
$parent=$null
try {
  Write-Phase "helper-start pid=$PID"
  if (![IO.File]::Exists($installer)) { throw '更新安装包已丢失。' }
  try { $parent=[Diagnostics.Process]::GetProcessById(${parentPid}) } catch [ArgumentException] {}
  if ($null -eq $parent) { throw '工作台进程在交接前已退出。' }
  [IO.File]::WriteAllText($ready,'ready')
  Write-Phase 'ready'
  if (!$parent.WaitForExit(60000)) { throw '工作台尚未退出，已取消安装。' }
  Write-Phase 'parent-exited'
  if ([IO.File]::Exists($cancel)) { Write-Phase 'cancelled'; exit 0 }
  if ([IO.FileInfo]::new($installer).Length -ne ${size}) { throw '更新安装包大小校验失败。' }
  $hashAlgorithm=[Security.Cryptography.SHA256]::Create()
  $stream=[IO.File]::OpenRead($installer)
  try { $actualHash=[BitConverter]::ToString($hashAlgorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $hashAlgorithm.Dispose() }
  if ($actualHash -ne '${sha256}') { throw '更新安装包校验失败。' }
  Write-Phase 'installer-verified'
  # Silent NSIS must not auto-launch; restart explicitly after the install exits.
  $process=Start-UpdateProcess $installer '/S --updated' $true
  Write-Phase ("installer-started pid="+$process.Id)
  $process.WaitForExit()
  $code=$process.ExitCode
  $process.Dispose()
  Write-Phase ("installer-exited code="+$code)
  if ($code -ne 0) { throw ('安装未完成，退出码：'+$code) }
  if (![IO.File]::Exists($application)) { throw '安装完成后找不到工作台程序。' }
  $installedVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo($application).ProductVersion
  Write-Phase ("installed-version="+$installedVersion)
  if ($installedVersion -ne '${expectedVersion}') { throw ('更新后版本不匹配：'+$installedVersion) }
  $restarted=Start-UpdateProcess $application '' $false
  Write-Phase ("application-started pid="+$restarted.Id)
  if ($restarted.WaitForExit(1500)) {
    $restartCode=$restarted.ExitCode
    $restarted.Dispose()
    throw ('新版工作台启动后退出，退出码：'+$restartCode)
  }
  $restarted.Dispose()
  Write-Phase 'restart-dispatched'
} catch {
  Write-Phase ('failure: '+$_.Exception.Message)
  [IO.File]::WriteAllText($failure,('自动更新未完成：'+$_.Exception.Message))
  # Recover the existing installation if possible, once, without forcing any process to exit.
  if ($null -ne $parent -and $parent.HasExited -and ![IO.File]::Exists($cancel) -and [IO.File]::Exists($application)) {
    try { $recovery=Start-UpdateProcess $application '' $false; Write-Phase ("recovery-started pid="+$recovery.Id); $recovery.Dispose() }
    catch { Write-Phase ('recovery-failed: '+$_.Exception.Message) }
  }
  exit 1
} finally {
  if ($null -ne $parent) { $parent.Dispose() }
  try { [IO.File]::Delete($MyInvocation.MyCommand.Path) } catch {}
}`;
}
async function launchInstaller({installer,manifest,cacheDirectory,executable=process.execPath,parentPid=process.pid,spawnImpl=spawn}){
  const token=crypto.randomUUID(),readyFile=path.join(cacheDirectory,`handoff-${token}.ready`),cancelFile=path.join(cacheDirectory,`handoff-${token}.cancel`),errorFile=path.join(cacheDirectory,'last-update-error.txt'),scriptFile=path.join(cacheDirectory,`handoff-${token}.ps1`);
  await fsp.unlink(errorFile).catch(()=>{});
  const script=handoffScript({installer,executable,parentPid,readyFile,cancelFile,errorFile,sha256:manifest.sha256,size:manifest.size,expectedVersion:manifest.version});
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  let child,exitCode,exited=false;
  const diagnosticFile=path.join(cacheDirectory,`handoff-${token}.log`);
  let diagnostic;
  try{
    // Windows PowerShell 5.1 requires a BOM for UTF-8 source containing non-ASCII.
    // Use -File instead of an encoded command or hidden/detached console flags.
    // Do not use DETACHED_PROCESS: Windows PowerShell 5.1 can exit 0 without
    // running the script. Ignored stdin, file output and unref let the helper
    // survive a normal parent exit without inherited pipes or a visible window.
    await fsp.writeFile(scriptFile,'\uFEFF'+script,{flag:'wx',mode:0o600});
    diagnostic=await fsp.open(diagnosticFile,'wx',0o600);
    child=spawnImpl(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptFile],{windowsHide:true,stdio:['ignore',diagnostic.fd,diagnostic.fd]});
    child.once('exit',(code)=>{exited=true;exitCode=code;});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
  }catch{await fsp.unlink(scriptFile).catch(()=>{});throw new Error('无法启动更新安装程序，工作台会继续运行。');}
  finally{await diagnostic?.close().catch(()=>{});}
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    if(fs.existsSync(errorFile)||exited)break;
    if(fs.existsSync(readyFile)){
      await fsp.unlink(readyFile).catch(()=>{});
      // The script is already running and will clean up its own files.
      return {cancelFile,diagnosticFile,scriptFile};
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  await fsp.writeFile(cancelFile,'cancel','utf8');
  if(exited)await fsp.unlink(scriptFile).catch(()=>{});
  const detail=await fsp.readFile(errorFile,'utf8').catch(()=>fsp.readFile(diagnosticFile,'utf8').catch(()=>''));
  throw new Error(`更新安装程序没有准备好，工作台会继续运行。${detail.trim().slice(0,240)|| (exited?` (exit ${exitCode})`:'')}`);
}
function loadPreference(file){try{const value=JSON.parse(fs.readFileSync(file,'utf8'));return typeof value.automatic==='boolean'?value.automatic:true;}catch{return true;}}
async function persistPreference(file,automatic){await fsp.mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.tmp`;const handle=await fsp.open(temporary,'w',0o600);try{await handle.writeFile(JSON.stringify({automatic}));await handle.sync();}finally{await handle.close();}await fsp.rename(temporary,file);}
function createUpdateController({currentVersion,publicKey,userDataDirectory,eligibility={enabled:false,reason:'自动更新不可用。'},fetchImpl=fetch,onState=()=>{},onQuit=()=>{},launch=launchInstaller,autoStart=true,initialDelayMs=15000,intervalMs=6*60*60*1000}={}){
  stableVersion(currentVersion);const cacheDirectory=path.join(userDataDirectory,'updates'),preferenceFile=path.join(userDataDirectory,'updater-settings.json');
  let automatic=loadPreference(preferenceFile),disposed=false,pending=null,verifiedManifest=null,verifiedPath=null,timer=null,interval=null,preferenceQueue=Promise.resolve();
  let value={enabled:Boolean(eligibility.enabled),automatic,status:eligibility.enabled?'idle':'disabled',currentVersion,message:eligibility.enabled?'会自动检查并准备新版，安装前由你确认。':eligibility.reason};
  const failureFile=path.join(cacheDirectory,'last-update-error.txt');try{const failure=fs.readFileSync(failureFile,'utf8').replace(/^\uFEFF/,'').trim().slice(0,500);if(failure&&eligibility.enabled)value={...value,status:'error',message:failure};}catch{}
  const snapshot=()=>({...value});
  function emit(patch){if(disposed)return;value={...value,...patch,automatic};onState(snapshot());}
  function schedule(){clearTimeout(timer);clearInterval(interval);if(disposed||!automatic||!eligibility.enabled)return;timer=setTimeout(()=>{void check();},initialDelayMs);timer.unref?.();interval=setInterval(()=>{void check();},intervalMs);interval.unref?.();}
  async function check(){
    if(disposed||!eligibility.enabled||value.status==='installing'||value.status==='ready')return snapshot();if(pending)return pending;
    pending=(async()=>{
      emit({status:'checking',message:'正在检查更新…',progress:undefined});
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10*60*1000);timeout.unref?.();
      try{
        const response=await request(FEED_URL,'manifest',null,{fetchImpl,signal:controller.signal});const text=await readBounded(response,32768);let raw;try{raw=JSON.parse(text);}catch{throw new Error('更新清单不是有效的 JSON。');}
        const manifest=verifyManifest(raw,publicKey);const checkedAt=new Date().toISOString();
        if(compareVersions(manifest.version,currentVersion)<=0){emit({status:'up-to-date',message:'未发现适用于当前版本的更新。',checkedAt,availableVersion:undefined,progress:undefined,downloadedBytes:undefined,totalBytes:undefined});return snapshot();}
        verifiedManifest=manifest;emit({status:'downloading',availableVersion:manifest.version,checkedAt,progress:0,downloadedBytes:0,totalBytes:manifest.size,message:`正在后台准备 ${manifest.version}，你可以继续工作。`});let lastProgress=0;
        verifiedPath=await downloadInstaller(manifest,{cacheDirectory,fetchImpl,signal:controller.signal,onProgress:(received,total)=>{if(Date.now()-lastProgress<100&&received!==total)return;lastProgress=Date.now();emit({progress:Math.floor(received/total*100),downloadedBytes:received,totalBytes:total});}});
        emit({status:'ready',progress:100,downloadedBytes:manifest.size,message:`${manifest.version} 已准备好，保存后可重启安装。`});return snapshot();
      }catch(error){verifiedManifest=null;verifiedPath=null;emit({status:'error',message:error.name==='AbortError'?'更新检查或下载超时，请稍后重试。':String(error.message||'更新暂不可用。').slice(0,500)});return snapshot();}finally{clearTimeout(timeout);pending=null;}
    })();return pending;
  }
  async function setAutomatic(enabled){if(typeof enabled!=='boolean')throw new Error('自动更新设置不正确。');const operation=preferenceQueue.catch(()=>{}).then(async()=>{await persistPreference(preferenceFile,enabled);automatic=enabled;emit({});schedule();return snapshot();});preferenceQueue=operation;return operation;}
  async function install(){
    if(!eligibility.enabled||value.status!=='ready'||!verifiedManifest||!verifiedPath)throw new Error('更新尚未准备好，请先检查更新。');
    emit({status:'installing',message:'正在保存并准备安装，请稍候…'});
    try{await preferenceQueue;verifyManifest(verifiedManifest,publicKey);if(compareVersions(verifiedManifest.version,currentVersion)<=0)throw new Error('已拒绝安装旧版本。');await verifyFile(verifiedPath,verifiedManifest);await launch({installer:verifiedPath,manifest:verifiedManifest,cacheDirectory});await onQuit();}catch(error){emit({status:'error',message:String(error.message||'无法开始安装，工作台会继续运行。').slice(0,500)});throw error;}
  }
  if(autoStart)schedule();
  return {getState:snapshot,check,install,setAutomatic,dispose(){disposed=true;clearTimeout(timer);clearInterval(interval);}};
}
async function createWindowsUpdater({app,onState,onQuit,fetchImpl=fetch}={}){
  const eligibility=await detectInstalled({isPackaged:app.isPackaged});let publicKey='';
  try{publicKey=fs.readFileSync(path.join(__dirname,'update-public-key.pem'),'utf8');if(crypto.createPublicKey(publicKey).asymmetricKeyType!=='ed25519')throw new Error();}catch{eligibility.enabled=false;eligibility.reason='更新校验公钥不可用，请下载官方安装包。';}
  return createUpdateController({currentVersion:app.getVersion(),publicKey,userDataDirectory:app.getPath('userData'),eligibility,onState,onQuit,fetchImpl});
}
module.exports={FEED_URL,INSTALL_REGISTRY_KEY,MAX_INSTALLER_BYTES,stableVersion,compareVersions,canonicalPayload,verifyManifest,installerUrl,allowedUrl,request,createElectronFetch,readBounded,verifyFile,downloadInstaller,parseInstallLocation,detectInstalled,handoffScript,launchInstaller,createUpdateController,createWindowsUpdater};
