const {app,BrowserWindow,ipcMain,dialog,Notification,Tray,Menu,nativeImage,clipboard,ClipboardItem,desktopCapturer,screen,shell,safeStorage,globalShortcut,session}=require('electron');
const {Blob}=require('node:buffer');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const {validateState,readState,writeState,localDate,occursOn,reminderKey,normalizeAiEndpoint,normalizeApiKey,validateReviewExport,exportTarget,backupBeforeImport,MAX_BYTES}=require('./state.cjs');
app.setName('Workbench');
if (process.env.WORKBENCH_DATA_DIR) {
  const isolated=path.resolve(process.env.WORKBENCH_DATA_DIR);
  fs.mkdirSync(isolated,{recursive:true});
  app.setPath('userData',isolated);
}
app.setAppUserModelId('com.aureliuswu.workbench');
const mainFile=path.join(__dirname,'../dist/index.html');
const devUrl=!app.isPackaged && process.env.WORKBENCH_DEV_URL;
let mainWindow,tray,state=null,quitting=false,storeError=null,captureInProgress=false;
const utilityWindows=new Map();
const allowedRoots=new Set();
const activeNotifications=new Set();
let reminderLedger={};
const dataFile=()=>path.join(app.getPath('userData'),'workbench.json');
const keyFile=()=>path.join(app.getPath('userData'),'ai-key.bin');
const ledgerFile=()=>path.join(app.getPath('userData'),'notification-ledger.json');
const preload=path.join(__dirname,'preload.cjs');
const utilityPreload=path.join(__dirname,'utility-preload.cjs');
function boundedText(value,max,allowEmpty=true) { if(typeof value!=='string'||value.length>max||(!allowEmpty&&!value.trim()))throw new Error('输入格式不正确。');return value; }
function secureWindow(win) {
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
}
function assertMain(event) { if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)throw new Error('不允许的操作来源。'); }
function handle(name,fn) { ipcMain.handle(name,async(event,...args)=>{assertMain(event);return fn(...args);}); }
function showMain() { if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();if(mainWindow.isMinimized())mainWindow.restore();mainWindow.focus();} }
function notify(title,body) {
  boundedText(title,2000);boundedText(body,2000);
  const fallback=()=>showReminderPopup(title.slice(0,100),body.slice(0,1000)).catch(()=>{});
  if(!Notification.isSupported()){fallback();return;}
  const n=new Notification({title:title.slice(0,100),body:body.slice(0,1000),silent:false});
  activeNotifications.add(n);let failed=false;
  const onFailure=()=>{activeNotifications.delete(n);if(!failed){failed=true;fallback();}};
  n.on('click',showMain);n.on('close',()=>activeNotifications.delete(n));n.on('failed',onFailure);try{n.show();}catch{onFailure();}
  // Keep native instances alive for click delivery without accumulating objects forever.
  setTimeout(()=>activeNotifications.delete(n),120000).unref();
}
async function showReminderPopup(title,body) {
  if(quitting)return;
  const reminders=[...utilityWindows.values()].filter(entry=>entry.type==='notification');
  if(reminders.length>=3)reminders[0].win.close();
  const area=screen.getPrimaryDisplay().workArea,width=Math.min(380,area.width-24),height=174;
  const win=new BrowserWindow({width,height,x:area.x+area.width-width-16,y:area.y+area.height-height-16-Math.min(reminders.length,2)*(height+8),frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,show:false,backgroundColor:'#fff4f8',webPreferences:{preload:utilityPreload,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  secureWindow(win);const id=win.webContents.id;
  utilityWindows.set(id,{type:'notification',win,payload:{type:'notification',title,body}});
  win.on('closed',()=>utilityWindows.delete(id));
  await win.loadFile(path.join(__dirname,'utility.html'));if(!win.isDestroyed())win.showInactive();
  const timer=setTimeout(()=>{if(!win.isDestroyed())win.close();},15000);timer.unref();win.once('closed',()=>clearTimeout(timer));
}
function icon() {
  let image=nativeImage.createFromPath(path.join(__dirname,'../build/icon.png'));
  if(image.isEmpty()) image=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAG0lEQVQ4T2P8z8Dwn4ECwESJ5lEDRg0YNYABBgBQPQIfpSnvFwAAAABJRU5ErkJggg==');
  return image;
}
function createMain() {
  const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  mainWindow=new BrowserWindow({width:Math.min(1440,area.width),height:Math.min(940,area.height),minWidth:Math.min(1000,area.width),minHeight:Math.min(700,area.height),show:false,frame:false,title:'花笺 Workbench',backgroundColor:'#fff8fb',icon:icon(),webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false}});
  secureWindow(mainWindow);
  mainWindow.once('ready-to-show',()=>mainWindow.show());
  mainWindow.on('close',event=>{if(!quitting){event.preventDefault();mainWindow.hide();}});
  mainWindow.webContents.on('render-process-gone',()=>{if(!quitting)mainWindow.reload();});
  if(devUrl)mainWindow.loadURL(devUrl);else mainWindow.loadFile(mainFile);
}
function createTray() {
  tray=new Tray(icon().resize({width:32,height:32}));
  tray.setToolTip('花笺 Workbench · 提醒在后台继续');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'打开花笺 Workbench',click:showMain},
    {label:'截图并贴到桌面  Ctrl+Alt+A',click:()=>capture().catch(e=>notify('截图未完成',e.message))},
    {label:'贴出剪贴板图片  Ctrl+Alt+V',click:()=>pinClipboard().catch(e=>notify('贴图未完成',e.message))},
    {type:'separator'},{label:'退出（停止提醒）',click:()=>{quitting=true;app.quit();}}
  ]));
  tray.on('double-click',showMain);tray.on('click',showMain);
}
function persistLedger() {
  try {const temporary=`${ledgerFile()}.tmp`;fs.writeFileSync(temporary,JSON.stringify(reminderLedger));fs.renameSync(temporary,ledgerFile());}catch{}
}
function notificationOnce(id,title,body) { if(reminderLedger[id])return;reminderLedger[id]=Date.now();persistLedger();notify(title,body); }
function checkReminders() {
  if(!state&&storeError)return;
  const now=new Date(),today=localDate(now),minute=now.getHours()*60+now.getMinutes();
  // The durable ledger avoids repeat alerts after app restarts.
  for(const [key,time]of Object.entries(reminderLedger))if(Number(time)<Date.now()-35*86400000)delete reminderLedger[key];
  const settings=state?.settings||{morningGreeting:true,name:''};
  if(settings.morningGreeting&&now.getHours()>=6&&now.getHours()<12)notificationOnce(`greeting:${today}`,`早安，${settings.name||'新的一天'}`,`今天也慢慢来，把重要的小事放进花笺。`);
  if(!state)return;
  const overrideIds=new Set(state.tasks.filter(t=>t.repeat==='none').map(t=>t.id));
  for(const task of state.tasks) {
    if(!task.date||!task.reminder||!task.time||task.done||!occursOn(task,today))continue;
    if(task.repeat!=='none'&&overrideIds.has(`${task.id}::${today}`))continue;
    const [hour,min]=task.time.split(':').map(Number),due=hour*60+min;
    // Catch reminders missed while the running computer slept earlier today.
    if(minute>=due)notificationOnce(reminderKey(task,today),`待办提醒 · ${task.title}`,`${task.time} · ${task.priority==='high'?'高优先级':task.priority==='medium'?'中优先级':'低优先级'}，点击回到工作台。`);
  }
}
function saveState(input, recovering=false) {if(storeError&&!recovering)throw new Error(`${storeError} 请先导入有效备份。`);const next=writeState(dataFile(),input);state=next;storeError=null;checkReminders();}
async function exportData() {
  if(!state)throw new Error('还没有可导出的本地数据。');
  const result=await dialog.showSaveDialog(mainWindow,{title:'导出花笺备份',defaultPath:`Workbench-备份-${localDate()}.json`,filters:[{name:'JSON 备份',extensions:['json']}]});
  if(result.canceled||!result.filePath)return false;
  const target=exportTarget(result.filePath,app.getPath('userData'),[dataFile(),`${dataFile()}.bak`,`${dataFile()}.tmp`,keyFile(),`${keyFile()}.tmp`,ledgerFile(),`${ledgerFile()}.tmp`]);
  await fsp.writeFile(target,JSON.stringify(validateState(state),null,2),'utf8');return true;
}
async function exportReview(payload) {
  const review=validateReviewExport(payload);
  const result=await dialog.showSaveDialog(mainWindow,{title:'导出周总结 Markdown',defaultPath:`周总结_${review.weekStart}_至_${review.weekEnd}.md`,filters:[{name:'Markdown 文档',extensions:['md']}]});
  if(result.canceled||!result.filePath)return false;
  const filename=path.extname(result.filePath)?result.filePath:`${result.filePath}.md`;
  if(path.extname(filename).toLowerCase()!=='.md')throw new Error('请将周总结保存为 .md 文件。');
  const target=exportTarget(filename,app.getPath('userData'),[dataFile(),`${dataFile()}.bak`,`${dataFile()}.tmp`,keyFile(),`${keyFile()}.tmp`,ledgerFile(),`${ledgerFile()}.tmp`]);
  await fsp.writeFile(target,review.markdown,'utf8');return true;
}
async function importData() {
  const result=await dialog.showOpenDialog(mainWindow,{title:'导入花笺备份',properties:['openFile'],filters:[{name:'JSON 备份',extensions:['json']}]});
  if(result.canceled||!result.filePaths[0])return null;
  const filename=result.filePaths[0];if((await fsp.stat(filename)).size>MAX_BYTES)throw new Error('备份文件超过 20 MB。');
  const imported=validateState(JSON.parse(await fsp.readFile(filename,'utf8')));
  const answer=await dialog.showMessageBox(mainWindow,{type:'question',title:'导入备份',message:`替换当前的 ${state?.tasks.length||0} 条待办和 ${state?.notes.length||0} 条便签？`,detail:'当前数据会另存为数据目录 backups 中的导入前备份。API 密钥不包含在备份中。',buttons:['取消','导入并替换'],defaultId:0,cancelId:0});
  if(answer.response!==1)return null;
  backupBeforeImport(dataFile(),state);
  saveState(imported,true);return state;
}
async function canonicalAllowed(input) {
  boundedText(input,32768,false);const resolved=await fsp.realpath(input);
  for(const root of allowedRoots) {
    const relative=path.relative(root,resolved);
    if(relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative)))return resolved;
  }
  throw new Error('请先通过“选择文件夹”授权访问这个位置。');
}
async function selectFolder() {
  const result=await dialog.showOpenDialog(mainWindow,{title:'选择工作文件夹',properties:['openDirectory']});
  if(result.canceled||!result.filePaths[0])return null;
  const root=await fsp.realpath(result.filePaths[0]);allowedRoots.add(root);return root;
}
function category(name,isDirectory) {
  if(isDirectory)return '文件夹';
  const ext=path.extname(name).toLowerCase();
  if(['.doc','.docx','.xls','.xlsx','.ppt','.pptx','.pdf','.txt','.md','.csv'].includes(ext))return '文档';
  if(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.ico'].includes(ext))return '图片';
  if(['.zip','.rar','.7z','.tar','.gz'].includes(ext))return '压缩包';
  if(['.mp4','.mov','.mkv','.mp3','.wav','.flac','.m4a'].includes(ext))return '影音';
  return '其他';
}
async function listFiles(input) {
  const folder=await canonicalAllowed(input),entries=await fsp.readdir(folder,{withFileTypes:true});
  if(entries.length>20000)throw new Error('该文件夹超过 20000 项，请选择更小的子文件夹。');
  const output=[];
  // Bound I/O fan-out for large office folders and skip broken links.
  for(let i=0;i<entries.length;i+=64) {
    const batch=await Promise.all(entries.slice(i,i+64).filter(e=>!e.name.startsWith('.')).map(async entry=>{
      const target=path.join(folder,entry.name);try{const resolved=await canonicalAllowed(target),stat=await fsp.stat(resolved);return {name:entry.name,path:resolved,category:category(entry.name,stat.isDirectory()),modified:stat.mtime.toISOString(),isDirectory:stat.isDirectory()};}catch{return null;}
    }));output.push(...batch.filter(Boolean));
  }
  return output.sort((a,b)=>Number(b.isDirectory)-Number(a.isDirectory)||b.modified.localeCompare(a.modified));
}
async function saveApiKey(key) {
  key=normalizeApiKey(key);if(!key){await fsp.rm(keyFile(),{force:true});return;}
  if(!await safeStorage.isAsyncEncryptionAvailable())throw new Error('Windows 密钥保护暂不可用，密钥未保存。');
  const encrypted=await safeStorage.encryptStringAsync(key);await fsp.writeFile(`${keyFile()}.tmp`,encrypted,{mode:0o600});await fsp.rename(`${keyFile()}.tmp`,keyFile());
}
async function storedKey() {
  if(!fs.existsSync(keyFile()))return '';
  if(!await safeStorage.isAsyncEncryptionAvailable())throw new Error('Windows 密钥保护暂不可用。');
  try{return (await safeStorage.decryptStringAsync(await fsp.readFile(keyFile()))).result;}catch{throw new Error('无法解密本机 AI 密钥，请在偏好设置中重新保存。');}
}
async function aiReview(payload) {
  if(!payload||typeof payload!=='object')throw new Error('AI 请求格式不正确。');
  const prompt=boundedText(payload.prompt,100000,false),model=boundedText(payload.model,200,false);
  const url=normalizeAiEndpoint(payload.endpoint);
  const key=normalizeApiKey(payload.apiKey?payload.apiKey:await storedKey());
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  try {
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model,messages:[{role:'system',content:'你是温和务实的个人行政助理。仅根据提供的真实周数据给出中文复盘和下一周可执行建议。不要虚构已完成任务，不要给出医疗或财务判断。'},{role:'user',content:prompt}],temperature:0.5,max_tokens:1400}),signal:controller.signal,redirect:'error'});
    if(!response.ok)throw new Error(`AI 服务返回 ${response.status}，请检查地址、模型和密钥。`);
    if(Number(response.headers.get('content-length'))>2*1024*1024)throw new Error('AI 回复过大。');
    let content='',bytes=0;const reader=response.body?.getReader();if(!reader)throw new Error('AI 服务没有返回内容。');const decoder=new TextDecoder();
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2*1024*1024){await reader.cancel();throw new Error('AI 回复超过 2 MB。');}content+=decoder.decode(value,{stream:true});}content+=decoder.decode();
    let json;try{json=JSON.parse(content);}catch{throw new Error('AI 服务返回的不是有效 JSON。');}
    const answer=json.choices?.[0]?.message?.content;if(typeof answer!=='string'||!answer.trim())throw new Error('AI 服务没有返回文字建议。');return answer.slice(0,50000);
  }catch(error){if(error.name==='AbortError')throw new Error('AI 请求超过 60 秒，请稍后重试。');throw error;}finally{clearTimeout(timer);}
}
async function pinImage(image) {
  if(!image||image.isEmpty())throw new Error('剪贴板中没有图片，请先截图或复制一张图片。');
  const size=image.getSize(),display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),area=display.workArea;
  const scale=Math.min(1,(area.width-100)/size.width,(area.height-120)/size.height);
  const win=new BrowserWindow({width:Math.max(240,Math.round(size.width*scale)),height:Math.max(160,Math.round(size.height*scale)+42),minWidth:180,minHeight:100,alwaysOnTop:true,frame:false,backgroundColor:'#fff8fb',show:false,webPreferences:{preload:utilityPreload,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  secureWindow(win);utilityWindows.set(win.webContents.id,{type:'pin',win,payload:{type:'image',src:image.toDataURL()}});
  const id=win.webContents.id;win.on('closed',()=>utilityWindows.delete(id));
  await win.loadFile(path.join(__dirname,'utility.html'));win.show();return win;
}
async function writeClipboardImage(image) {
  if(!image||image.isEmpty())throw new Error('没有可复制的图片。');
  await clipboard.write([new ClipboardItem({'image/png':new Blob([image.toPNG()],{type:'image/png'})})]);
}
async function readClipboardImage() {
  const items=await clipboard.read();
  for(const item of items) {
    const type=item.types.includes('image/png')?'image/png':item.types.find(value=>['image/jpeg','image/bmp','image/webp'].includes(value));
    if(!type)continue;
    const blob=await item.getType(type);
    if(blob.size>100*1024*1024)throw new Error('剪贴板图片超过 100 MB，请先缩小图片。');
    const image=nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
    if(!image.isEmpty())return image;
  }
  throw new Error('剪贴板中没有图片，请先截图或复制一张图片。');
}
async function pinClipboard(){await pinImage(await readClipboardImage());}
async function pinNote(input) {
  const text=boundedText(input,50000,false);
  const win=new BrowserWindow({width:360,height:340,minWidth:230,minHeight:170,alwaysOnTop:true,frame:false,backgroundColor:'#fff2bd',show:false,webPreferences:{preload:utilityPreload,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  secureWindow(win);const id=win.webContents.id;utilityWindows.set(id,{type:'pin',win,payload:{type:'note',text}});win.on('closed',()=>utilityWindows.delete(id));
  await win.loadFile(path.join(__dirname,'utility.html'));win.show();
}
async function capture() {
  if(captureInProgress)throw new Error('正在截图，请先完成或按 Esc 取消。');
  captureInProgress=true;const wasVisible=mainWindow?.isVisible();let overlay;
  try {
    const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if(wasVisible)mainWindow.hide();
    // Wait for compositor to remove the workbench before freezing the screen.
    await new Promise(resolve=>setTimeout(resolve,250));
    const all=screen.getAllDisplays();const maxWidth=Math.max(...all.map(d=>Math.ceil(d.size.width*d.scaleFactor))),maxHeight=Math.max(...all.map(d=>Math.ceil(d.size.height*d.scaleFactor)));
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:maxWidth,height:maxHeight}});
    const source=sources.find(s=>String(s.display_id)===String(display.id))||(sources.length===1?sources[0]:null);
    if(!source||source.thumbnail.isEmpty())throw new Error('无法获取当前屏幕，请重试。');
    // Normalize the bitmap to a scale-1 representation before mapping DIP selection coordinates.
    const image=nativeImage.createFromBuffer(source.thumbnail.toPNG());
    overlay=new BrowserWindow({...display.bounds,frame:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,movable:false,backgroundColor:'#000000',show:false,enableLargerThanScreen:true,webPreferences:{preload:utilityPreload,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    secureWindow(overlay);
    utilityWindows.set(overlay.webContents.id,{type:'capture',win:overlay,image,display,payload:{type:'capture',src:image.toDataURL()},onFinish:()=>{captureInProgress=false;if(wasVisible)showMain();}});
    const id=overlay.webContents.id;
    overlay.on('closed',()=>{const entry=utilityWindows.get(id);utilityWindows.delete(id);entry?.onFinish();});
    await overlay.loadFile(path.join(__dirname,'utility.html'));overlay.show();overlay.focus();
  }catch(error){captureInProgress=false;overlay?.destroy();if(wasVisible)showMain();throw error;}
}
function installIpc() {
  handle('state:load',()=>{if(storeError)throw new Error(storeError);return state;});
  handle('state:save',input=>saveState(input));handle('state:export',exportData);handle('state:import',importData);handle('review:export',exportReview);
  handle('notify',notify);handle('capture',capture);handle('pin:clipboard',pinClipboard);handle('pin:note',pinNote);
  handle('files:select',selectFolder);handle('files:list',listFiles);handle('files:open',async input=>{const target=await canonicalAllowed(input);const result=await shell.openPath(target);if(result)throw new Error(result);});
  handle('window:action',action=>{
    if(action==='minimize')mainWindow.minimize();else if(action==='maximize')mainWindow.isMaximized()?mainWindow.unmaximize():mainWindow.maximize();else if(action==='close')mainWindow.hide();else if(action==='pin')mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop());else throw new Error('未知窗口操作。');
  });
  handle('autoLaunch',enabled=>{if(typeof enabled!=='boolean')throw new Error('设置格式不正确。');if(!app.isPackaged)throw new Error('开机启动仅可在发行版中设置。');app.setLoginItemSettings({openAtLogin:enabled,path:process.env.PORTABLE_EXECUTABLE_FILE||process.execPath});});
  let keyWrite=Promise.resolve();
  handle('ai:key',key=>{const operation=keyWrite.catch(()=>{}).then(()=>saveApiKey(key));keyWrite=operation;return operation;});handle('ai:hasKey',()=>fs.existsSync(keyFile()));handle('ai:review',aiReview);handle('version',()=>app.getVersion());
  ipcMain.handle('utility:ready',event=>{const entry=utilityWindows.get(event.sender.id);if(!entry||event.senderFrame!==entry.win.webContents.mainFrame)throw new Error('不允许的操作来源。');return entry.payload;});
  ipcMain.handle('utility:action',async(event,action,value)=>{
    const entry=utilityWindows.get(event.sender.id);if(!entry||event.senderFrame!==entry.win.webContents.mainFrame)throw new Error('不允许的操作来源。');
    if(action==='close')entry.win.close();else if(action==='open'&&entry.type==='notification'){showMain();entry.win.close();}else if(action==='opacity'&&entry.type==='pin'&&Number.isFinite(value))entry.win.setOpacity(Math.max(0.25,Math.min(1,value)));else if(action==='copy'&&entry.payload.type==='image')await writeClipboardImage(nativeImage.createFromDataURL(entry.payload.src));
  });
  ipcMain.handle('utility:select',async(event,rect)=>{
    const entry=utilityWindows.get(event.sender.id);if(!entry||entry.type!=='capture'||event.senderFrame!==entry.win.webContents.mainFrame)throw new Error('不允许的截图来源。');
    const bounds=entry.display.bounds;
    if(!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k]))||rect.width<4||rect.height<4||rect.x<0||rect.y<0||rect.x+rect.width>bounds.width+1||rect.y+rect.height>bounds.height+1)throw new Error('请选择有效的截图区域。');
    const imageSize=entry.image.getSize(),scaleX=imageSize.width/bounds.width,scaleY=imageSize.height/bounds.height;
    const crop=entry.image.crop({x:Math.floor(rect.x*scaleX),y:Math.floor(rect.y*scaleY),width:Math.max(1,Math.min(imageSize.width-Math.floor(rect.x*scaleX),Math.round(rect.width*scaleX))),height:Math.max(1,Math.min(imageSize.height-Math.floor(rect.y*scaleY),Math.round(rect.height*scaleY)))});
    await writeClipboardImage(crop);entry.win.close();await pinImage(crop);
  });
}
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',showMain);
  app.whenReady().then(()=>{
    session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    session.defaultSession.setPermissionCheckHandler(()=>false);
    try{const result=readState(dataFile());state=result.state;if(result.recovered)setTimeout(()=>notify('已从恢复副本载入','主数据文件不可用，花笺已载入最近一次有效备份。'),2500);}catch(error){storeError=error.message;}
    try{const ledger=JSON.parse(fs.readFileSync(ledgerFile(),'utf8'));if(ledger&&typeof ledger==='object'&&!Array.isArray(ledger))reminderLedger=ledger;}catch{}
    installIpc();createMain();createTray();
    globalShortcut.register('CommandOrControl+Alt+A',()=>capture().catch(e=>notify('截图未完成',e.message)));
    globalShortcut.register('CommandOrControl+Alt+V',()=>pinClipboard().catch(e=>notify('贴图未完成',e.message)));
    setInterval(checkReminders,15000).unref();setTimeout(checkReminders,3000);
  }).catch(error=>{dialog.showErrorBox('花笺无法启动',error.message);quitting=true;app.quit();});
}
app.on('before-quit',()=>{quitting=true;globalShortcut.unregisterAll();});
app.on('window-all-closed',()=>{});
app.on('activate',showMain);
