const api=window.utility;
let payload,zoom=1,start=null;
const get=id=>document.getElementById(id);
const close=()=>api.action('close');
document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
get('close').onclick=close;
get('dismiss-notification').onclick=close;
get('open-workbench').onclick=()=>api.action('open');
get('opacity').oninput=event=>api.action('opacity',Number(event.target.value)/100);
get('copy').onclick=()=>api.action('copy');
function updateZoom(delta){zoom=Math.max(0.1,Math.min(5,zoom+delta));get('image').style.width=`${Math.round(payload.width*zoom)}px`;}
get('smaller').onclick=()=>updateZoom(-0.1);
get('larger').onclick=()=>updateZoom(0.1);
get('content').addEventListener('wheel',event=>{if(payload?.type==='image'&&event.ctrlKey){event.preventDefault();updateZoom(event.deltaY>0?-0.1:0.1);}},{passive:false});
const capture=get('capture');
function rectangle(event){return{x:Math.min(start.x,event.clientX),y:Math.min(start.y,event.clientY),width:Math.abs(event.clientX-start.x),height:Math.abs(event.clientY-start.y)};}
capture.addEventListener('pointerdown',event=>{if(event.button!==0)return;start={x:event.clientX,y:event.clientY};capture.setPointerCapture(event.pointerId);get('selection').style.display='block';get('hint').style.display='none';});
capture.addEventListener('pointermove',event=>{if(!start)return;const rect=rectangle(event);Object.assign(get('selection').style,{left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`});});
capture.addEventListener('pointerup',async event=>{if(!start)return;const rect=rectangle(event);start=null;if(rect.width<4||rect.height<4){get('hint').style.display='block';get('selection').style.display='none';return;}try{await api.select(rect);}catch(error){get('hint').textContent=error.message;get('hint').style.display='block';}});
api.ready().then(value=>{payload=value;if(value.type==='capture'){get('screen').src=value.src;capture.style.display='block';return;}if(value.type==='notification'){get('notification').style.display='block';get('notification-title').textContent=value.title;get('notification-body').textContent=value.body;return;}get('pin').style.display='block';if(value.type==='note'){get('title').textContent='随手记 · 桌面便签';get('note').style.display='block';get('note').textContent=value.text;get('image').style.display='none';get('copy').style.display='none';get('smaller').style.display='none';get('larger').style.display='none';document.querySelector('footer').textContent='拖动顶部移动 · Esc 关闭';}else{const img=get('image');img.onload=()=>{payload.width=img.naturalWidth;zoom=Math.min(1,get('content').clientWidth/img.naturalWidth);updateZoom(0);};img.src=value.src;}});
