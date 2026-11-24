const fs = require('node:fs');
const path = require('node:path');
const MAX_BYTES = 20 * 1024 * 1024;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 10000) => typeof value === 'string' && value.length <= max;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const timestamp = value => text(value,100) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
function date(value) {
  if (!text(value, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === value;
}
function record(value, check, max = 50000) {
  return isObject(value) && Object.keys(value).length <= max && Object.entries(value).every(([k,v]) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && check(v,k));
}
function validateState(value) {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error('备份版本不受支持，需要 schemaVersion: 1。');
  const {tasks, notes, focusSessions, settings, reviews} = value;
  const noteTags=value.noteTags===undefined?[]:value.noteTags;
  if(!Array.isArray(noteTags)||noteTags.length>200||!noteTags.every(tag=>isObject(tag)&&text(tag.id,200)&&tag.id.length&&text(tag.name,60)&&tag.name.trim().length)||new Set(noteTags.map(tag=>tag.id)).size!==noteTags.length||new Set(noteTags.map(tag=>tag.name.trim())).size!==noteTags.length)throw new Error('便签标签格式不正确或存在重复标签。');
  const tagIds=new Set(noteTags.map(tag=>tag.id));
  if (!Array.isArray(tasks) || tasks.length > 50000 || !tasks.every(t =>
    isObject(t) && text(t.id,200) && t.id.length && text(t.title,1000) && (date(t.date)||(t.date===''&&t.repeat==='none'&&t.time===''&&t.reminder===false)) &&
    text(t.time,5) && (t.time === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)) &&
    ['high','medium','low'].includes(t.priority) && typeof t.done === 'boolean' && timestamp(t.createdAt) &&
    (t.completedAt === undefined || timestamp(t.completedAt)) && ['none','daily','weekly'].includes(t.repeat) &&
    finite(t.estimate,0,525600) && typeof t.reminder === 'boolean' && Array.isArray(t.steps) && t.steps.length <= 1000 &&
    t.steps.every(s => isObject(s) && text(s.id,200) && s.id.length && text(s.title,1000) && typeof s.done === 'boolean') && new Set(t.steps.map(s=>s.id)).size===t.steps.length &&
    (t.completedDates === undefined || (Array.isArray(t.completedDates) && t.completedDates.length <= 50000 && t.completedDates.every(date)))
  )) throw new Error('待办数据格式不正确。');
  if (new Set(tasks.map(t=>t.id)).size !== tasks.length) throw new Error('待办标识重复。');
  if (!Array.isArray(notes) || notes.length > 10000 || !notes.every(n=>isObject(n)&&text(n.id,200)&&n.id.length&&text(n.text,50000)&&['pink','lavender','mint','yellow'].includes(n.color)&&timestamp(n.createdAt)&&(n.archivedAt===undefined||timestamp(n.archivedAt))&&(n.tagIds===undefined||(Array.isArray(n.tagIds)&&n.tagIds.length<=200&&n.tagIds.every(id=>text(id,200)&&tagIds.has(id))&&new Set(n.tagIds).size===n.tagIds.length))) || new Set(notes.map(n=>n.id)).size!==notes.length) throw new Error('便签数据格式不正确，或引用了不存在的标签。');
  if (!Array.isArray(focusSessions) || focusSessions.length > 100000 || !focusSessions.every(s=>isObject(s)&&text(s.id,200)&&s.id.length&&date(s.date)&&finite(s.minutes,0,1440)&&(s.taskId===undefined||text(s.taskId,200))) || new Set(focusSessions.map(s=>s.id)).size!==focusSessions.length) throw new Error('专注记录格式不正确。');
  if (!record(reviews, (v,k)=>date(k)&&text(v,100000), 10000)) throw new Error('复盘数据格式不正确。');
  if (!isObject(settings) || !text(settings.name,100) || typeof settings.lastSaturdayWork !== 'boolean' ||
    !record(settings.dayOverrides,(v,k)=>date(k)&&['work','rest'].includes(v),10000) ||
    !finite(settings.focusMinutes,1,180) || !finite(settings.breakMinutes,1,60) || typeof settings.morningGreeting!=='boolean' ||
    typeof settings.autoLaunch!=='boolean' || !text(settings.aiEndpoint,2000) || !text(settings.aiModel,200)) throw new Error('设置数据格式不正确。');
  // Copy only the documented schema: unknown imported fields must never be saved/exported as credentials.
  return {
    schemaVersion:1,
    tasks:tasks.map(t=>({id:t.id,title:t.title,date:t.date,time:t.time,priority:t.priority,done:t.done,...(t.completedAt?{completedAt:t.completedAt}:{}),createdAt:t.createdAt,steps:t.steps.map(s=>({id:s.id,title:s.title,done:s.done})),repeat:t.repeat,estimate:t.estimate,reminder:t.reminder})),
    notes:notes.map(n=>({id:n.id,text:n.text,color:n.color,createdAt:n.createdAt,tagIds:n.tagIds?[...n.tagIds]:[],...(n.archivedAt?{archivedAt:n.archivedAt}:{})})),
    noteTags:noteTags.map(tag=>({id:tag.id,name:tag.name.trim()})),
    focusSessions:focusSessions.map(s=>({id:s.id,date:s.date,minutes:s.minutes,...(s.taskId?{taskId:s.taskId}:{})})),
    reviews:JSON.parse(JSON.stringify(reviews)),
    settings:{name:settings.name,lastSaturdayWork:settings.lastSaturdayWork,dayOverrides:JSON.parse(JSON.stringify(settings.dayOverrides)),focusMinutes:settings.focusMinutes,breakMinutes:settings.breakMinutes,morningGreeting:settings.morningGreeting,autoLaunch:settings.autoLaunch,aiEndpoint:settings.aiEndpoint,aiModel:settings.aiModel}
  };
}
function readState(file) {
  let primaryError;
  for (const candidate of [file,`${file}.bak`]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      if (fs.statSync(candidate).size > MAX_BYTES) throw new Error('数据文件超过 20 MB。');
      return { state: validateState(JSON.parse(fs.readFileSync(candidate,'utf8'))), recovered: candidate.endsWith('.bak') };
    } catch (error) { primaryError ||= error; }
  }
  if (primaryError) throw new Error(`本地数据无法读取：${primaryError.message}。请从备份恢复，原文件已保留。`);
  return { state:null, recovered:false };
}
function writeState(file, input) {
  const state = validateState(input);
  const content = JSON.stringify(state,null,2);
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('数据超过 20 MB，请先导出并整理历史记录。');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  // Preserve the exact old schema-1 bytes before the first real 1.1 save. Loading is read-only.
  if(fs.existsSync(file)) {
    const previousBytes=fs.readFileSync(file);let previous;
    try {previous=JSON.parse(previousBytes.toString('utf8'));validateState(previous);}catch{previous=null;}
    if(previous&&!Object.prototype.hasOwnProperty.call(previous,'noteTags')) {
      const backupDirectory=path.join(path.dirname(file),'backups');
      fs.mkdirSync(backupDirectory,{recursive:true});
      const snapshot=path.join(backupDirectory,'before-1.1.0.json');
      try{writeSnapshot(snapshot,previousBytes);}catch(error){
        if(error.code!=='EEXIST')throw error;
        // Never proceed on the strength of a partial or unreadable earlier snapshot.
        try{validateState(JSON.parse(fs.readFileSync(snapshot,'utf8')));}catch{throw new Error('升级前备份无法读取，当前数据未替换。请先检查 backups/before-1.1.0.json。');}
      }
    }
  }
  const temporary = `${file}.tmp`;
  const handle = fs.openSync(temporary,'w',0o600);
  try { fs.writeFileSync(handle,content,'utf8'); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  if (fs.existsSync(file)) {
    // Never overwrite a good recovery copy with a damaged primary file.
    try { validateState(JSON.parse(fs.readFileSync(file,'utf8'))); fs.copyFileSync(file,`${file}.bak`); } catch {}
  }
  fs.renameSync(temporary,file);
  return state;
}
function localDate(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
function occursOn(task,key) {
  if(!task.date||!date(task.date)||!date(key))return false;
  if (key < task.date) return false;
  if (task.repeat === 'none') return task.date === key;
  if (task.repeat === 'daily') return true;
  return new Date(`${task.date}T12:00:00`).getDay() === new Date(`${key}T12:00:00`).getDay();
}
function reminderKey(task,today) {
  const suffix=`::${today}`;
  const seriesId=task.id.endsWith(suffix)?task.id.slice(0,-suffix.length):task.id;
  return `task:${seriesId}:${today}`;
}
function normalizeAiEndpoint(input) {
  if(typeof input!=='string'||input.length>2000||!input.trim())throw new Error('请输入有效的 AI 服务地址。');
  let url;try{url=new URL(input);}catch{throw new Error('请输入有效的 AI 服务地址。');}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||url.username||url.password||url.hash||url.search)throw new Error('AI 地址须为 HTTPS；本机服务可使用 HTTP。不允许地址包含密钥或查询参数。');
  url.pathname=url.pathname.replace(/\/+$/,'');
  if(!url.pathname.endsWith('/chat/completions'))url.pathname=`${url.pathname}/chat/completions`;
  return url;
}
function normalizeApiKey(input) {
  if(typeof input!=='string'||input.length>4096)throw new Error('API 密钥格式不正确。');
  const key=input.trim();
  if(/[\u0000-\u001f\u007f]/.test(key))throw new Error('API 密钥不能包含换行或控制字符。');
  return key;
}
function validateReviewExport(input) {
  if(!isObject(input)||!date(input.weekStart)||!date(input.weekEnd)||!text(input.markdown,2*1024*1024)||!input.markdown.trim()||Buffer.byteLength(input.markdown,'utf8')>2*1024*1024||input.markdown.includes('\0'))throw new Error('周总结导出内容或日期格式不正确。');
  const start=new Date(`${input.weekStart}T12:00:00`),end=new Date(start);
  end.setDate(end.getDate()+6);
  if(start.getDay()!==1||localDate(end)!==input.weekEnd)throw new Error('请选择从周一到周日的完整一周。');
  return {weekStart:input.weekStart,weekEnd:input.weekEnd,markdown:input.markdown};
}
function samePath(a,b) {return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;}
function withinDirectory(file,directory) {
  const relative=path.relative(directory,file);
  return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));
}
function resolveExportLocation(file,seen=new Set()) {
  const target=path.resolve(file);
  if(seen.has(target)||seen.size>16)throw new Error('导出位置的链接无效。');
  seen.add(target);
  try {
    const stat=fs.lstatSync(target);
    // Resolve even a dangling link before deciding whether a destination is safe.
    if(stat.isSymbolicLink())return resolveExportLocation(path.resolve(path.dirname(target),fs.readlinkSync(target)),seen);
    return fs.realpathSync(target);
  }catch(error){if(error.code!=='ENOENT')throw error;return path.join(fs.realpathSync(path.dirname(target)),path.basename(target));}
}
function exportTarget(filename,dataDirectory,reservedFiles=[]) {
  if(!text(filename,32768)||!filename.trim())throw new Error('请选择有效的导出文件位置。');
  const target=path.resolve(filename),directory=fs.realpathSync(dataDirectory);
  const resolved=resolveExportLocation(target);let identity;
  try {const stat=fs.statSync(resolved,{bigint:true});if(!stat.isFile())throw new Error('导出位置必须是文件。');identity=stat;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(withinDirectory(resolved,directory))throw new Error('请选择其他位置，不能覆盖正在使用的本地数据目录。');
  for(const reserved of reservedFiles) {
    if(samePath(path.resolve(reserved),target)||samePath(path.resolve(reserved),resolved))throw new Error('请选择其他位置，不能覆盖正在使用的数据文件。');
    if(identity&&identity.ino!==0n) {
      try {const stat=fs.statSync(reserved,{bigint:true});if(stat.ino===identity.ino&&stat.dev===identity.dev)throw new Error('请选择其他位置，这个文件是本地数据文件的链接。');}catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  return resolved;
}
function backupBeforeImport(file,currentState) {
  if(!currentState)return null;
  const snapshot=validateState(currentState),directory=path.join(path.dirname(file),'backups');
  fs.mkdirSync(directory,{recursive:true});
  const filename=path.join(directory,`before-import-${new Date().toISOString().replace(/[:.]/g,'-')}-${require('node:crypto').randomUUID().slice(0,8)}.json`);
  writeSnapshot(filename,JSON.stringify(snapshot,null,2));
  return filename;
}
function writeSnapshot(filename,content) {
  const handle=fs.openSync(filename,'wx',0o600);
  let complete=false;
  try{fs.writeFileSync(handle,content,'utf8');fs.fsyncSync(handle);complete=true;}finally{
    try{fs.closeSync(handle);}finally{if(!complete){try{fs.unlinkSync(filename);}catch{}}}
  }
}
module.exports = {validateState,readState,writeState,localDate,occursOn,reminderKey,normalizeAiEndpoint,normalizeApiKey,validateReviewExport,exportTarget,backupBeforeImport,MAX_BYTES};
