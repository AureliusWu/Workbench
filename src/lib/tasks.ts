import type { AppState, Settings, Task } from '../types';
import { addDays, dateKey, daysBetween, getDayInfo, parseDate, weekStart } from './calendar';

const OCCURRENCE_SEPARATOR='::';
function splitOccurrence(id:string):{templateId:string;date?:string} {
  const index=id.lastIndexOf(OCCURRENCE_SEPARATOR);
  return index<0?{templateId:id}:{templateId:id.slice(0,index),date:id.slice(index+2)};
}
export function taskTemplateId(id:string):string { return splitOccurrence(id).templateId; }
function isScheduled(task:Task,date:string):boolean {
  if (!task.date) return false;
  if (date<task.date) return false;
  if (task.repeat==='none') return task.date===date;
  return task.repeat==='daily' || parseDate(task.date).getDay()===parseDate(date).getDay();
}
/** Earliest occurrence on/after a local date; a past non-recurring task has no next occurrence. */
export function nextOccurrenceDate(task:Task,fromDate:string):string|null {
  parseDate(fromDate);
  if (!task.date) return null;
  const start=parseDate(task.date),from=parseDate(fromDate);
  if (task.date>=fromDate) return task.date;
  if (task.repeat==='none') return null;
  if (task.repeat==='daily') return fromDate;
  return addDays(fromDate,(start.getDay()-from.getDay()+7)%7);
}
/**
 * Recurrences are projected as id `templateId::YYYY-MM-DD`.
 * Completing an occurrence stores a non-recurring snapshot with that id. The recurring template
 * remains unchanged, so tomorrow/next week starts unchecked. Use mutation helpers below.
 */
export function tasksForDate(tasks:Task[],date:string):Task[] {
  parseDate(date);
  const snapshots=new Map(tasks.filter(task=>task.repeat==='none' && task.date===date).map(task=>[task.id,task]));
  const result:Task[]=[];
  for (const task of tasks) {
    if (!isScheduled(task,date)) continue;
    if (task.repeat==='none') { result.push(task); continue; }
    const id=`${task.id}${OCCURRENCE_SEPARATOR}${date}`;
    if (snapshots.has(id)) continue;
    result.push({...task,id,date,done:false,completedAt:undefined,steps:task.steps.map(step=>({...step,done:false}))});
  }
  const order={high:0,medium:1,low:2};
  return result.sort((a,b)=>Number(a.done)-Number(b.done)||order[a.priority]-order[b.priority]||a.time.localeCompare(b.time)||a.createdAt.localeCompare(b.createdAt));
}
function materialize(tasks:Task[],id:string):Task|undefined {
  const existing=tasks.find(task=>task.id===id);
  if (existing) return existing;
  const {templateId,date}=splitOccurrence(id);
  if (!date) return undefined;
  const template=tasks.find(task=>task.id===templateId && task.repeat!=='none');
  if (!template || !isScheduled(template,date)) return undefined;
  return {...template,id,date,repeat:'none',done:false,completedAt:undefined,steps:template.steps.map(step=>({...step,done:false}))};
}
function replaceTask(tasks:Task[],task:Task):Task[] {
  const exists=tasks.some(item=>item.id===task.id);
  return exists?tasks.map(item=>item.id===task.id?task:item):[...tasks,task];
}
export function toggleTaskDone(tasks:Task[],id:string,done?:boolean,now=new Date()):Task[] {
  const task=materialize(tasks,id); if (!task) return tasks;
  const nextDone=done ?? !task.done;
  return replaceTask(tasks,{...task,repeat:id.includes(OCCURRENCE_SEPARATOR)?'none':task.repeat,done:nextDone,completedAt:nextDone?now.toISOString():undefined});
}
export function toggleTaskStep(tasks:Task[],id:string,stepId:string,done?:boolean):Task[] {
  const task=materialize(tasks,id); if (!task) return tasks;
  const steps=task.steps.map(step=>step.id===stepId?{...step,done:done ?? !step.done}:step);
  return replaceTask(tasks,{...task,repeat:id.includes(OCCURRENCE_SEPARATOR)?'none':task.repeat,steps});
}
/** Deletes a task and its occurrence snapshots; recurring task deletion means the whole series. */
export function deleteTask(tasks:Task[],id:string):Task[] {
  const templateId=taskTemplateId(id);
  const template=tasks.find(task=>task.id===templateId);
  if (template && template.repeat!=='none') return tasks.filter(task=>taskTemplateId(task.id)!==templateId);
  return tasks.filter(task=>task.id!==id);
}
export interface DailyStats { date:string; total:number; completed:number; rate:number; focusMinutes:number }
export interface WeeklyStats {
  start:string;end:string;total:number;completed:number;pending:number;rate:number;
  focusMinutes:number;daily:DailyStats[];suggestions:string[];
}
export function weeklyStats(state:AppState,date:string):WeeklyStats {
  const start=weekStart(date),end=addDays(start,6);
  const daily=Array.from({length:7},(_,index)=>{
    const day=addDays(start,index),tasks=tasksForDate(state.tasks,day);
    const completed=tasks.filter(task=>task.done).length;
    return {date:day,total:tasks.length,completed,rate:tasks.length?Math.round(completed/tasks.length*100):0,focusMinutes:state.focusSessions.filter(session=>session.date===day).reduce((sum,session)=>sum+session.minutes,0)};
  });
  const total=daily.reduce((sum,day)=>sum+day.total,0),completed=daily.reduce((sum,day)=>sum+day.completed,0);
  const focusMinutes=daily.reduce((sum,day)=>sum+day.focusMinutes,0);
  const suggestions:string[]=[];
  const tasks=daily.flatMap(day=>tasksForDate(state.tasks,day.date));
  const overdue=tasks.filter(task=>!task.done && task.date<date).length;
  const highPending=tasks.filter(task=>task.priority==='high'&&!task.done).length;
  if (!total) suggestions.push('本周还没有安排待办。先选一件最重要的小事，让计划从可完成的一步开始。');
  if (total && completed===total) suggestions.push('本周安排的任务已全部完成。记录一个有效的方法，也为休息留出时间。');
  if (overdue) suggestions.push(`有 ${overdue} 项待办已过计划日。复盘时重新安排日期，或把范围缩成一个能开始的小步骤。`);
  if (highPending) suggestions.push(`本周还有 ${highPending} 项高优先级任务。下一次专注先完成其中最关键的一项。`);
  if (total && completed/total<0.5) suggestions.push('当前完成率低于 50%。检查计划是否过满，下周每天保留一段缓冲时间。');
  if (focusMinutes) suggestions.push(`本周已记录 ${focusMinutes} 分钟专注。回想哪段时间最少被打断，把难任务放在相同时间。`);
  else if (total) suggestions.push('本周还没有专注记录。可以用一个短番茄钟观察开始任务时最常见的阻碍。');
  if (suggestions.length<2 && total) suggestions.push('保留一件本周做得顺利的事，并写下一项下周想调整的具体做法。');
  return {start,end,total,completed,pending:total-completed,rate:total?Math.round(completed/total*100):0,focusMinutes,daily,suggestions};
}
/** Spread an estimate across eligible workdays; no network or AI is required. */
export function planTask(title:string,totalMinutes:number,dayLimit:number,startDate:string,settings:Pick<Settings,'lastSaturdayWork'|'dayOverrides'>):Task[] {
  if (!title.trim()) throw new Error('请先填写任务名称');
  if (!Number.isFinite(totalMinutes)||totalMinutes<=0||totalMinutes>60000) throw new RangeError('总时长应在 1 至 60000 分钟之间');
  if (!Number.isFinite(dayLimit)||dayLimit<=0||dayLimit>1440) throw new RangeError('每日上限应在 1 至 1440 分钟之间');
  parseDate(startDate);
  const total=Math.ceil(totalMinutes),limit=Math.floor(dayLimit);
  if (!limit) throw new RangeError('每日上限至少为 1 分钟');
  if (Math.ceil(total/limit)>366) throw new RangeError('拆分结果超过 366 个工作日，请调高每日上限');
  const count=Math.ceil(total/limit),createdAt=new Date().toISOString();
  const series=`plan-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  let day=startDate,remaining=total;
  const result:Task[]=[];
  for (let searched=0;remaining>0 && searched<1800;searched++,day=addDays(day,1)) {
    if (!getDayInfo(day,settings).isWorkday) continue;
    const estimate=Math.min(limit,remaining),index=result.length+1;
    result.push({id:`${series}-${index}`,title:`${title.trim()} · ${index}/${count}`,date:day,time:'09:00',priority:'medium',done:false,createdAt,steps:[],repeat:'none',estimate,reminder:true});
    remaining-=estimate;
  }
  if (remaining) throw new Error('无法找到足够工作日，请检查休息日设置');
  return result;
}

/** Local morning/afternoon/evening greeting, with no external request. */
export function greeting(date=new Date()):string {
  const hour=date.getHours();
  return hour<6?'夜深了':hour<11?'早上好':hour<14?'中午好':hour<18?'下午好':'晚上好';
}

export function dueReminders(tasks:Task[],now=new Date()):Task[] {
  const today=dateKey(now),minute=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  return tasksForDate(tasks,today).filter(task=>task.reminder&&!task.done&&task.time===minute);
}

export { daysBetween };
