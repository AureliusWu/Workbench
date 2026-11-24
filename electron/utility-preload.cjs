const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('utility',Object.freeze({
  ready:()=>ipcRenderer.invoke('utility:ready'),
  select:rect=>ipcRenderer.invoke('utility:select',rect),
  action:(action,value)=>ipcRenderer.invoke('utility:action',action,value)
}));
