import { CalendarDays, Check } from 'lucide-react';
import type { Settings, Task } from '../types';
import { addDays, getDayInfo, parseDate, weekStart } from '../lib/calendar';
import { tasksForDate } from '../lib/tasks';
import './calendar-review.css';

export interface WeekCalendarProps {
  start:string;
  tasks:Task[];
  settings:Settings;
  today:string;
  onTaskClick:(task:Task)=>void;
  onTaskToggle?:(task:Task)=>void;
  onDayClick?:(date:string)=>void;
}
const names=['周一','周二','周三','周四','周五','周六','周日'];
const priorities={high:'高优先级',medium:'中优先级',low:'低优先级'};

export function WeekCalendar({start,tasks,settings,today,onTaskClick,onTaskToggle,onDayClick}:WeekCalendarProps){
  const monday=weekStart(start);
  const days=Array.from({length:7},(_,index)=>addDays(monday,index));
  const knownYear=days.every(day=>getDayInfo(day,settings).knownYear);
  return <section className="card wb-week-calendar" data-testid="week-calendar" aria-label="周日历">
    <div className="card-heading wb-week-heading"><h2><CalendarDays size={17} aria-hidden="true"/>这一周的安排</h2></div>
    <div className="wb-week-scroll" tabIndex={0} role="region" aria-label="七天日历；可用键盘左右滚动查看">
      <div className="wb-week-grid">{days.map((date,index)=>{
        const info=getDayInfo(date,settings),dayTasks=tasksForDate(tasks,date),completed=dayTasks.filter(task=>task.done).length;
        const content=<><span className="wb-weekday-name">{names[index]}{date===today&&<b>今天</b>}<span className={`work-badge ${info.isWorkday?'work':'rest'}`}>{info.isWorkday?'班':'休'}</span></span><span className="wb-weekday-date">{parseDate(date).getMonth()+1}<small>/</small>{parseDate(date).getDate()}</span><span className="wb-weekday-lunar">{info.holiday||info.lunar}</span></>;
        return <div className={`wb-week-column ${date===today?'wb-week-today':''}`} key={date}>
          {onDayClick?<button type="button" className="wb-week-day-heading" title={`${date} ${info.reason}；点击添加待办`} aria-label={`${date} ${names[index]}，${info.reason}，添加待办`} onClick={()=>onDayClick(date)}>{content}</button>:<div className="wb-week-day-heading" title={`${date} ${info.reason}`}>{content}</div>}
          <div className="wb-week-task-list">{dayTasks.length?dayTasks.map(task=><div className={`wb-week-task wb-week-priority-${task.priority} ${task.done?'wb-week-task-done':''}`} key={task.id}>
            {onTaskToggle&&<input className="wb-week-task-checkbox" type="checkbox" checked={task.done} aria-label={`${task.done?'取消完成':'完成'} ${date} ${task.title}`} onChange={()=>onTaskToggle(task)}/>}
            <button type="button" className="wb-week-task-edit" onClick={()=>onTaskClick(task)} title={`${task.title}\n${task.time||'全天'} · ${priorities[task.priority]} · ${task.done?'已完成':'未完成'}`} aria-label={`${date} ${task.time||'全天'}，${task.title}，${priorities[task.priority]}，${task.done?'已完成':'未完成'}，查看或编辑`}>
            <span className="wb-week-task-time">{task.time||'全天'}{task.done&&<Check size={12} aria-hidden="true"/>}</span>
            {task.done?<s className="wb-week-task-title">{task.title}</s>:<span className="wb-week-task-title">{task.title}</span>}
            <span className="wb-week-task-status">{task.done?'已完成':priorities[task.priority]}</span>
            </button>
          </div>):<div className="wb-week-day-empty">暂无安排</div>}</div>
          {dayTasks.length>0&&<div className="wb-week-day-total">{completed} / {dayTasks.length} 件已完成</div>}
        </div>;
      })}</div>
    </div>
    <div className="calendar-foot wb-week-foot"><span>已完成待办保留划线，点击可查看</span><span>{settings.lastSaturdayWork?'月末周六上班，节假日优先休息':'月末周六规则已关闭，跟随官方调休与个人设置'}</span></div>
    {!knownYear&&<p className="notice">这一周包含尚未内置官方调休表的年份，仅按周历和自定义规则显示，请手动核对。</p>}
  </section>;
}
