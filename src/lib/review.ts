import type {AppState,Task} from '../types';
import {addDays,parseDate,weekStart} from './calendar';
import {tasksForDate,weeklyStats} from './tasks';

export interface ReviewExportPayload { weekStart:string;weekEnd:string;markdown:string }
const priorityLabels={high:'高',medium:'中',low:'低'};
function escapeText(text:string):string{return text.replace(/\\/g,'\\\\').replace(/([`*_{}\[\]<>#|])/g,'\\$1')}
function taskLine(task:Task):string{
  const description=`${task.date} ${task.time||'全天'} · ${priorityLabels[task.priority]}优先级${task.estimate?` · 预计 ${task.estimate} 分钟`:''}`;
  const lines=[`- [${task.done?'x':' '}] ${escapeText(task.title.replace(/[\r\n]+/g,' '))}（${description}）`];
  for(const step of task.steps)lines.push(`  - [${step.done?'x':' '}] ${escapeText(step.title.replace(/[\r\n]+/g,' '))}`);
  return lines.join('\n');
}
/** Export only the selected Monday–Sunday plan and its real occurrence records, never all tasks. */
export function reviewMarkdown(state:AppState,selectedDate:string):ReviewExportPayload{
  parseDate(selectedDate);
  const stats=weeklyStats(state,selectedDate),dates=Array.from({length:7},(_,i)=>addDays(stats.start,i));
  const tasks=dates.flatMap(date=>tasksForDate(state.tasks,date)),done=tasks.filter(task=>task.done),open=tasks.filter(task=>!task.done);
  const lines=[`# 周总结 · ${stats.start} — ${stats.end}`,'',
    `- 计划完成率：${stats.rate}%（${stats.completed} / ${stats.total} 件）`,
    `- 已完成：${stats.completed} 件`, `- 未完成：${stats.pending} 件`,`- 累计专注：${stats.focusMinutes} 分钟`,'',
    '完成率按本周计划日期统计；重复待办按当次记录统计，未安排日期的待办不计入。','',
    '## 每日完成情况','','| 日期 | 计划 | 已完成 | 专注分钟 |','| --- | ---: | ---: | ---: |',
    ...stats.daily.map(day=>`| ${day.date} | ${day.total} | ${day.completed} | ${day.focusMinutes} |`),'',
    '## 已完成待办','',done.length?done.map(taskLine).join('\n'):'本周没有已完成的计划待办。','',
    '## 未完成待办','',open.length?open.map(taskLine).join('\n'):'本周没有未完成的计划待办。','',
    '## 复盘笔记',''];
  const note=state.reviews[stats.start]?.trim();
  lines.push(note?note.replace(/\r\n?/g,'\n').split('\n').map(line=>escapeText(line)).join('  \n'):'这一周还没有写下复盘笔记。','',
    '## 本地复盘建议','',...stats.suggestions.map(text=>`- ${text}`),'',
    '以上建议根据本周记录在本机生成；如需 AI 复盘，可在应用内主动生成。','');
  return {weekStart:stats.start,weekEnd:stats.end,markdown:lines.join('\n')};
}

/** Weeks with actual saved notes, newest first. Invalid imported keys are ignored defensively. */
export function savedReviewWeeks(state:Pick<AppState,'reviews'>):string[]{
  const result=new Set<string>();
  for(const [date,note] of Object.entries(state.reviews)){
    if(!note.trim())continue;
    try{parseDate(date);result.add(weekStart(date))}catch{/* Ignore an invalid history entry; do not break the picker. */}
  }
  return [...result].sort().reverse();
}
