const {contextBridge,ipcRenderer}=require('electron');
const invoke=(channel)=>(...args)=>ipcRenderer.invoke(channel,...args);
contextBridge.exposeInMainWorld('workbench',Object.freeze({
  load:invoke('state:load'),save:invoke('state:save'),notify:invoke('notify'),
  capture:invoke('capture'),pinClipboard:invoke('pin:clipboard'),pinNote:invoke('pin:note'),
  exportData:invoke('state:export'),importData:invoke('state:import'),exportReview:invoke('review:export'),
  selectFolder:invoke('files:select'),listFiles:invoke('files:list'),openPath:invoke('files:open'),
  windowAction:invoke('window:action'),setAutoLaunch:invoke('autoLaunch'),
  aiReview:invoke('ai:review'),saveApiKey:invoke('ai:key'),hasApiKey:invoke('ai:hasKey'),version:invoke('version'),
  getUpdate:invoke('update:get'),checkUpdate:invoke('update:check'),installUpdate:invoke('update:install'),setAutomaticUpdates:invoke('update:automatic'),
  onUpdate:listener=>{if(typeof listener!=='function')throw new TypeError('更新监听器无效。');const handler=(_event,value)=>listener(value);ipcRenderer.on('update:state',handler);return()=>ipcRenderer.removeListener('update:state',handler);}
}));
