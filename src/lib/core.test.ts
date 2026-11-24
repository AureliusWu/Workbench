import { describe,expect,it } from 'vitest';
import type { AppState,Settings,Task } from '../types';
import { addDays,countdowns,dateKey,getDayInfo,isLastSaturday,monthCells,parseDate,weekStart } from './calendar';
import { deleteTask,dueReminders,nextOccurrenceDate,planTask,tasksForDate,toggleTaskDone,toggleTaskStep,weeklyStats } from './tasks';

const settings:Settings={name:'朋友',lastSaturdayWork:true,dayOverrides:{},focusMinutes:25,breakMinutes:5,morningGreeting:true,autoLaunch:false,aiEndpoint:'',aiModel:''};
const makeTask=(patch:Partial<Task>={}):Task=>({id:'t1',title:'整理会议纪要',date:'2026-11-23',time:'09:00',priority:'medium',done:false,createdAt:'2026-11-23T01:00:00Z',steps:[{id:'s1',title:'确认结论',done:false}],repeat:'none',estimate:25,reminder:true,...patch});
const makeState=(tasks:Task[]):AppState=>({schemaVersion:1,tasks,notes:[],focusSessions:[],reviews:{},settings});

describe('civil calendar dates',()=>{
  it('uses local date components and crosses year/leap boundaries without UTC shifts',()=>{
    expect(dateKey(new Date(2026,10,24,0,1))).toBe('2026-11-24');
    expect(dateKey(parseDate('2026-11-24'))).toBe('2026-11-24');
    expect(addDays('2026-12-31',1)).toBe('2027-01-01');
    expect(addDays('2028-02-28',1)).toBe('2028-02-29');
    expect(addDays('2028-02-29',1)).toBe('2028-03-01');
    expect(weekStart('2026-11-29')).toBe('2026-11-23');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
  });
  it('rejects malformed/impossible dates instead of silently normalizing',()=>{
    expect(()=>parseDate('2026-02-29')).toThrow();
    expect(()=>parseDate('2026-2-09')).toThrow();
    expect(()=>parseDate('2026-13-01')).toThrow();
    expect(()=>addDays('2026-01-01',0.5)).toThrow();
  });
  it('always creates a Monday-first six-row grid spanning adjacent months',()=>{
    const dates=monthCells(2026,10);
    expect(dates).toHaveLength(42);
    expect(dates[0]).toBe('2026-10-26');
    expect(dates[41]).toBe('2026-12-06');
    expect(new Set(dates).size).toBe(42);
    expect(parseDate(dates[0]).getDay()).toBe(1);
  });
});

describe('workday precedence and official holiday coverage',()=>{
  it('adds the last Saturday, rather than every fourth Saturday',()=>{
    expect(isLastSaturday('2026-10-24')).toBe(false);
    expect(isLastSaturday('2026-10-31')).toBe(true);
    expect(getDayInfo('2026-10-31',settings).isWorkday).toBe(true);
    expect(getDayInfo('2026-10-24',settings).isWorkday).toBe(false);
    expect(getDayInfo('2026-10-31',{...settings,lastSaturdayWork:false}).isWorkday).toBe(false);
  });
  it('keeps the last Saturday in an official holiday as rest even after a manual work override',()=>{
    const info=getDayInfo('2026-09-26',{...settings,dayOverrides:{'2026-09-26':'work'}});
    expect(isLastSaturday('2026-09-26')).toBe(true);
    expect(info.isWorkday).toBe(false);
    expect(info.holiday).toBe('中秋节');
    expect(info.reason).toContain('官方放假');
  });
  it('recognizes 2026 and 2027 official compensating workdays and rest dates',()=>{
    expect(getDayInfo('2026-01-04',settings).isWorkday).toBe(true);
    expect(getDayInfo('2026-02-23',settings).holiday).toBe('春节');
    expect(getDayInfo('2027-01-31',settings).reason).toBe('官方调休上班');
    expect(getDayInfo('2027-02-13',settings).isWorkday).toBe(false);
    expect(getDayInfo('2027-02-14',settings).isWorkday).toBe(true);
    expect(getDayInfo('2027-06-09',settings).holiday).toBe('端午节');
    expect(getDayInfo('2027-06-10',settings).holiday).toBeUndefined();
  });
  it('allows manual rest on an ordinary/official workday, and marks unverified years',()=>{
    expect(getDayInfo('2027-01-31',{...settings,dayOverrides:{'2027-01-31':'rest'}}).isWorkday).toBe(false);
    const info=getDayInfo('2028-01-01',settings);
    expect(info.knownYear).toBe(false);
    expect(info.reason).toContain('待更新');
  });
  it('counts an ongoing holiday as today and includes genuine next solar terms',()=>{
    const list=countdowns('2026-09-26');
    expect(list.find(item=>item.name==='中秋节')?.days).toBe(0);
    expect(list.filter(item=>item.kind==='term')).toHaveLength(2);
    expect(list.every(item=>item.days>=0)).toBe(true);
    expect(list.map(item=>item.days)).toEqual([...list.map(item=>item.days)].sort((a,b)=>a-b));
  });
});

describe('repeat task occurrence isolation',()=>{
  it('finds a weekly next occurrence on a non-occurrence date instead of hiding the series',()=>{
    const task=makeTask({repeat:'weekly'});
    const next=nextOccurrenceDate(task,'2026-11-24');
    expect(next).toBe('2026-11-30');
    expect(tasksForDate([task],next!)[0].id).toBe('t1::2026-11-30');
    expect(nextOccurrenceDate(task,'2026-11-30')).toBe('2026-11-30');
  });
  it('does not project weekly or daily tasks earlier than their future start date',()=>{
    expect(nextOccurrenceDate(makeTask({repeat:'weekly',date:'2027-01-04'}),'2026-12-31')).toBe('2027-01-04');
    expect(nextOccurrenceDate(makeTask({repeat:'daily',date:'2027-01-04'}),'2026-12-31')).toBe('2027-01-04');
    expect(nextOccurrenceDate(makeTask({repeat:'daily'}),'2026-12-31')).toBe('2026-12-31');
  });
  it('keeps future one-time tasks and handles the weekly cross-year boundary',()=>{
    expect(nextOccurrenceDate(makeTask({date:'2027-01-04'}),'2026-12-31')).toBe('2027-01-04');
    expect(nextOccurrenceDate(makeTask(),'2026-11-24')).toBeNull();
    expect(nextOccurrenceDate(makeTask({repeat:'weekly',date:'2026-12-28'}),'2026-12-31')).toBe('2027-01-04');
  });
  it('completes one weekly occurrence without checking next week',()=>{
    const initial=[makeTask({repeat:'weekly'})];
    const monday=tasksForDate(initial,'2026-11-23')[0];
    expect(monday.id).toBe('t1::2026-11-23');
    const changed=toggleTaskDone(initial,monday.id,true,new Date('2026-11-23T03:00:00Z'));
    expect(changed).toHaveLength(2);
    expect(changed[0].done).toBe(false);
    expect(tasksForDate(changed,'2026-11-23')).toHaveLength(1);
    expect(tasksForDate(changed,'2026-11-23')[0].done).toBe(true);
    expect(tasksForDate(changed,'2026-11-30')[0].done).toBe(false);
    expect(tasksForDate(changed,'2026-11-24')).toHaveLength(0);
    expect(tasksForDate(changed,'2026-11-16')).toHaveLength(0);
  });
  it('isolates daily step checkmarks and supports reopening a saved occurrence',()=>{
    let tasks=[makeTask({repeat:'daily'})];
    tasks=toggleTaskStep(tasks,'t1::2026-11-24','s1');
    expect(tasksForDate(tasks,'2026-11-24')[0].steps[0].done).toBe(true);
    expect(tasksForDate(tasks,'2026-11-25')[0].steps[0].done).toBe(false);
    tasks=toggleTaskDone(tasks,'t1::2026-11-24',true);
    tasks=toggleTaskDone(tasks,'t1::2026-11-24',false);
    expect(tasksForDate(tasks,'2026-11-24')[0].completedAt).toBeUndefined();
    expect(tasks).toHaveLength(2);
  });
  it('deletes the full series including any already materialized occurrences',()=>{
    let tasks=[makeTask({repeat:'daily'}),makeTask({id:'other'})];
    tasks=toggleTaskDone(tasks,'t1::2026-11-24',true);
    expect(deleteTask(tasks,'t1::2026-11-24').map(task=>task.id)).toEqual(['other']);
  });
  it('sorts pending high-priority work first and completed work last',()=>{
    const list=tasksForDate([makeTask({id:'low',priority:'low'}),makeTask({id:'done',priority:'high',done:true}),makeTask({id:'high',priority:'high'})],'2026-11-23');
    expect(list.map(task=>task.id)).toEqual(['high','low','done']);
  });
});

describe('weekly review and workday scheduling',()=>{
  it('uses scheduled occurrences as denominator and keeps focus in the same Monday–Sunday week',()=>{
    let tasks=[makeTask({repeat:'daily'}),makeTask({id:'single',date:'2026-11-24'})];
    tasks=toggleTaskDone(tasks,'t1::2026-11-23',true);
    tasks=toggleTaskDone(tasks,'single',true);
    const state=makeState(tasks);
    state.focusSessions=[{id:'f1',date:'2026-11-23',minutes:25},{id:'f2',date:'2026-11-29',minutes:15},{id:'f3',date:'2026-11-30',minutes:60}];
    const stats=weeklyStats(state,'2026-11-25');
    expect(stats.start).toBe('2026-11-23');
    expect(stats.end).toBe('2026-11-29');
    expect(stats.total).toBe(8);
    expect(stats.completed).toBe(2);
    expect(stats.rate).toBe(25);
    expect(stats.focusMinutes).toBe(40);
    expect(stats.daily[1].total).toBe(2);
    expect(stats.suggestions.length).toBeGreaterThan(0);
  });
  it('has a truthful empty week and an actionable local suggestion',()=>{
    const stats=weeklyStats(makeState([]),'2026-11-24');
    expect(stats.total).toBe(0); expect(stats.rate).toBe(0);
    expect(stats.suggestions[0]).toContain('还没有');
  });
  it('splits minutes without loss, skipping the month-end holiday and Sunday',()=>{
    const tasks=planTask('季度复盘',130,60,'2026-09-25',settings);
    expect(tasks.map(task=>task.date)).toEqual(['2026-09-28','2026-09-29','2026-09-30']);
    expect(tasks.map(task=>task.estimate)).toEqual([60,60,10]);
    expect(tasks.reduce((sum,task)=>sum+task.estimate,0)).toBe(130);
  });
  it('uses a configured month-end Saturday and rejects unbounded plans',()=>{
    expect(planTask('归档',60,60,'2026-11-28',settings)[0].date).toBe('2026-11-28');
    expect(planTask('归档',60,60,'2026-11-28',{...settings,lastSaturdayWork:false})[0].date).toBe('2026-11-30');
    expect(()=>planTask('任务',0,60,'2026-11-28',settings)).toThrow();
    expect(()=>planTask('任务',60000,1,'2026-11-28',settings)).toThrow();
  });
  it('only selects enabled, incomplete reminders due this local minute',()=>{
    const tasks=[makeTask(),makeTask({id:'no',reminder:false}),makeTask({id:'done',done:true})];
    expect(dueReminders(tasks,new Date(2026,10,23,9,0,15)).map(task=>task.id)).toEqual(['t1']);
    expect(dueReminders(tasks,new Date(2026,10,23,9,1))).toHaveLength(0);
  });
});
