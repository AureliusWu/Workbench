import {describe,expect,it} from 'vitest';
import type {Step,Task} from '../types';
import {reconcileTaskSteps,tasksForDate,toggleTaskDone,toggleTaskStep,upsertTasks} from './tasks';
const task=(extra:Partial<Task>={}):Task=>({id:'series',title:'周一归档',date:'2026-11-02',time:'09:00',priority:'medium',done:false,createdAt:'2026-11-01T00:00:00Z',steps:[{id:'s1',title:'核对资料',done:false}],repeat:'weekly',estimate:25,reminder:true,...extra});
describe('checklist identity while editing text lines',()=>{
 const old:Step[]=[{id:'a',title:'核对资料',done:true},{id:'b',title:'确认签字',done:false},{id:'c',title:'归档',done:true}];
 it('preserves checkmarks and ids after inserting, deleting and reordering lines',()=>{
  const result=reconcileTaskSteps(old,['新增步骤','归档','核对资料']);
  expect(result[0]).toMatchObject({title:'新增步骤',done:false});expect(old.some(item=>item.id===result[0].id)).toBe(false);
  expect(result[1]).toEqual(old[2]);expect(result[2]).toEqual(old[0]);
 });
 it('does not mark a rewritten step complete or reuse an id twice for duplicate titles',()=>{
  const duplicates=[{id:'x',title:'重复步骤',done:true},{id:'y',title:'重复步骤',done:false}];
  const result=reconcileTaskSteps(duplicates,['重复步骤','重复步骤','重复步骤']);
  expect(result.map(step=>step.done)).toEqual([true,false,false]);expect(new Set(result.map(step=>step.id)).size).toBe(3);
  const renamed=reconcileTaskSteps(old,['核对新的资料']);expect(renamed[0].done).toBe(false);expect(renamed[0].id).not.toBe('a');
 });
});
describe('recurring task edits preserve prior schedule history',()=>{
 it('freezes only actual earlier occurrences and preserves completed snapshots when changing weekday',()=>{
  const initial=toggleTaskDone([task()],'series::2026-11-16',true,new Date('2026-11-16T04:00:00Z'));
  const before=JSON.stringify(initial);
  const changed=upsertTasks(initial,[task({title:'周三归档',date:'2026-11-04'})],'2026-11-25',{expectedExistingIds:['series']});
  expect(JSON.stringify(initial)).toBe(before);
  expect(changed.find(item=>item.id==='series')?.date).toBe('2026-11-25');
  expect(tasksForDate(changed,'2026-11-16')[0]).toMatchObject({title:'周一归档',done:true});
  expect(tasksForDate(changed,'2026-11-23')[0]).toMatchObject({title:'周一归档',done:false});
  expect(tasksForDate(changed,'2026-11-18')).toEqual([]);
  expect(tasksForDate(changed,'2026-11-25')[0].title).toBe('周三归档');
  expect(tasksForDate(changed,'2026-12-02')[0].title).toBe('周三归档');
  expect(tasksForDate(changed,'2026-11-30')).toEqual([]);
 });
 it('does not materialize a history interval for a title-only edit or a future series',()=>{
  expect(upsertTasks([task()],[task({title:'改标题'})],'2026-11-25')).toHaveLength(1);
  const future=task({date:'2026-12-07'});
  expect(upsertTasks([future],[{...future,date:'2026-12-09'}],'2026-11-25')).toHaveLength(1);
 });
 it('stops recurrence without losing earlier completed records and avoids duplicating a past one-time item',()=>{
  const initial=toggleTaskDone([task()],'series::2026-11-23',true);
  expect(()=>upsertTasks(initial,[task({repeat:'none'})],'2026-11-25')).toThrow('今天或未来日期');
  const stopped=upsertTasks(initial,[task({repeat:'none',date:'',time:'',reminder:false})],'2026-11-25');
  expect(tasksForDate(stopped,'2026-11-23')[0].done).toBe(true);expect(tasksForDate(stopped,'2026-11-30')).toEqual([]);
 });
 it('accepts editing valid projected occurrences but rejects a deleted or changed template',()=>{
  const initial=[task()];const projected=tasksForDate(initial,'2026-11-30')[0];
  const edited={...projected,title:'仅此一次改标题',repeat:'none' as const};
  const result=upsertTasks(initial,[edited],'2026-11-25',{expectedExistingIds:[projected.id]});
  expect(tasksForDate(result,'2026-11-30')[0].title).toBe('仅此一次改标题');
  expect(tasksForDate(result,'2026-12-07')[0].title).toBe('周一归档');
  expect(()=>upsertTasks([], [edited],'2026-11-25',{expectedExistingIds:[projected.id]})).toThrow('已被删除');
  expect(()=>upsertTasks([task({date:'2026-11-04'})], [edited],'2026-11-25')).toThrow('已失效');
  expect(()=>upsertTasks([], [task()],'2026-11-25',{expectedExistingIds:['series']})).toThrow('已被删除');
 });
 it('preserves the original completion when a single item becomes a daily series',()=>{
  const single=task({repeat:'none',date:'2026-11-24',done:true,completedAt:'2026-11-24T05:00:00Z'});
  const result=upsertTasks([single],[{...single,repeat:'daily'}],'2026-11-25');
  expect(tasksForDate(result,'2026-11-24')[0].done).toBe(true);
  expect(tasksForDate(result,'2026-11-25')[0].done).toBe(false);
  expect(result.find(item=>item.id==='series')?.done).toBe(false);
 });
 it('refuses an oversized history without truncation or mutation',()=>{
  const initial=[task({repeat:'daily',date:'2026-11-01'}),...Array.from({length:49999},(_,index)=>task({id:`other-${index}`,repeat:'none',date:'' ,time:'',reminder:false}))];
  expect(()=>upsertTasks(initial,[{...initial[0],date:'2026-11-02'}],'2026-11-25')).toThrow('50000');
  expect(initial).toHaveLength(50000);expect(initial[0].date).toBe('2026-11-01');
 });
 it('preserves per-occurrence step progress when a schedule edit freezes the remaining past instances',()=>{
  const initial=toggleTaskStep([task()],'series::2026-11-23','s1',true);
  const result=upsertTasks(initial,[task({repeat:'daily',date:'2026-11-25'})],'2026-11-25');
  expect(tasksForDate(result,'2026-11-23')[0].steps[0].done).toBe(true);
  expect(tasksForDate(result,'2026-11-16')[0].steps[0].done).toBe(false);
  expect(tasksForDate(result,'2026-11-25')[0].steps[0].done).toBe(false);
 });
});
