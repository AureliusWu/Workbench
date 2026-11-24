import { Solar } from 'lunar-javascript';
import type { Settings } from '../types';
import { HOLIDAYS, HOLIDAY_SOURCES, OFFICIAL_WORKDAYS } from './holidays';

/** Calendar keys always refer to local civil dates; never parse them as UTC. */
export function dateKey(date:Date):string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('日期无效');
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function parseDate(key:string):Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new RangeError('日期格式应为 YYYY-MM-DD');
  const [year,month,day] = key.split('-').map(Number);
  const date = new Date(year,month-1,day,12);
  if (dateKey(date)!==key) throw new RangeError('日期不存在');
  return date;
}
export function addDays(key:string,days:number):string {
  if (!Number.isInteger(days)) throw new RangeError('天数必须为整数');
  const date=parseDate(key); date.setDate(date.getDate()+days); return dateKey(date);
}
export function weekStart(key:string):string {
  const day=parseDate(key).getDay(); return addDays(key,-((day+6)%7));
}
export function daysBetween(start:string,end:string):number {
  const a=parseDate(start),b=parseDate(end);
  return Math.round((Date.UTC(b.getFullYear(),b.getMonth(),b.getDate())-Date.UTC(a.getFullYear(),a.getMonth(),a.getDate()))/86400000);
}
export function isLastSaturday(key:string):boolean {
  const date=parseDate(key);
  return date.getDay()===6 && parseDate(addDays(key,7)).getMonth()!==date.getMonth();
}
export interface DayInfo { isWorkday:boolean; label:string; reason:string; holiday?:string; knownYear:boolean; lunar:string }
export function getDayInfo(key:string,settings:Pick<Settings,'lastSaturdayWork'|'dayOverrides'>):DayInfo {
  const date=parseDate(key),year=date.getFullYear();
  const knownYear=HOLIDAY_SOURCES.some(source=>source.year===year);
  const lunarDate=Solar.fromYmd(year,date.getMonth()+1,date.getDate()).getLunar();
  const lunar=lunarDate.getJieQi() || `${lunarDate.getMonthInChinese()}月${lunarDate.getDayInChinese()}`;
  const holiday=HOLIDAYS.find(item=>item.start<=key && key<=item.end);
  // Holidays take precedence over both the user's month-end Saturday and manual work overrides.
  if (holiday) return {isWorkday:false,label:'休',reason:`${holiday.name} · 官方放假`,holiday:holiday.name,knownYear,lunar};
  const override=settings.dayOverrides[key];
  if (override) return {isWorkday:override==='work',label:override==='work'?'班':'休',reason:'手动调整',knownYear,lunar};
  if (OFFICIAL_WORKDAYS.has(key)) return {isWorkday:true,label:'班',reason:'官方调休上班',knownYear,lunar};
  if (settings.lastSaturdayWork && isLastSaturday(key)) return {isWorkday:true,label:'班',reason:knownYear?'月末周六上班':'月末周六上班 · 该年节假日待更新',knownYear,lunar};
  const isWorkday=date.getDay()!==0 && date.getDay()!==6;
  return {isWorkday,label:isWorkday?'':'休',reason:knownYear?(isWorkday?'工作日':'周末休息'):'该年节假日待更新，仅按周历与个人规则计算',knownYear,lunar};
}
/** Exactly six rows of seven days, with Monday as the first column. */
export function monthCells(year:number,month:number):string[] {
  if (!Number.isInteger(year)||!Number.isInteger(month)||month<0||month>11) throw new RangeError('年月无效');
  const first=dateKey(new Date(year,month,1,12));
  const start=weekStart(first);
  return Array.from({length:42},(_,index)=>addDays(start,index));
}
export interface Countdown { name:string; date:string; days:number; kind:'holiday'|'term' }
export function countdowns(todayKey:string):Countdown[] {
  parseDate(todayKey);
  const holidays=HOLIDAYS.filter(item=>item.end>=todayKey).slice(0,3).map(item=>({name:item.name,date:item.start,days:Math.max(0,daysBetween(todayKey,item.start)),kind:'holiday' as const}));
  const terms:Countdown[]=[];
  // Query the lunar library's civil-date solar terms rather than a fixed approximate formula.
  for (let i=0;i<80 && terms.length<2;i++) {
    const key=addDays(todayKey,i),date=parseDate(key);
    const name=Solar.fromYmd(date.getFullYear(),date.getMonth()+1,date.getDate()).getLunar().getJieQi();
    if (name) terms.push({name,date:key,days:i,kind:'term'});
  }
  return [...holidays,...terms].sort((a,b)=>a.days-b.days || a.kind.localeCompare(b.kind));
}
