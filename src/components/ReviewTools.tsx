import {useState} from 'react';
import {CalendarDays,Download,History} from 'lucide-react';
import type {AppState} from '../types';
import {addDays,parseDate,weekStart} from '../lib/calendar';
import {weeklyStats} from '../lib/tasks';
import {reviewMarkdown,savedReviewWeeks,type ReviewExportPayload} from '../lib/review';
import './calendar-review.css';

export interface ReviewToolsProps {
 selectedDate:string;
 onSelectDate:(date:string)=>void;
 state:AppState;
 onExport:(payload:ReviewExportPayload)=>Promise<boolean>;
 onNotice:(text:string)=>void;
 disabled?:boolean;
}
export function ReviewTools({selectedDate,onSelectDate,state,onExport,onNotice,disabled=false}:ReviewToolsProps){
 const [busy,setBusy]=useState(false);
 const stats=weeklyStats(state,selectedDate),history=savedReviewWeeks(state);
 function pickDate(value:string){
  if(!value)return;
  try{
   const date=parseDate(value);
   if(date.getFullYear()<1900||date.getFullYear()>2199)throw new Error('请选择 1900 至 2199 年内的日期。');
   onSelectDate(value);
  }catch(e){onNotice(e instanceof Error?e.message:'日期无效，请重新选择。')}
 }
 async function exportWeek(){
  setBusy(true);
  try{const payload=reviewMarkdown(state,selectedDate);const result=await onExport(payload);onNotice(result?`${payload.weekStart} — ${payload.weekEnd} 的总结已导出为 Markdown。`:'已取消导出。')}
  catch(e){onNotice(e instanceof Error?e.message:'导出失败，请重试。')}
  finally{setBusy(false)}
 }
 return <section className="card wb-review-tools" aria-label="复盘历史与导出" data-testid="review-tools">
  <div className="wb-review-controls">
   <label className="wb-review-date-label"><span><CalendarDays size={15} aria-hidden="true"/>跳到指定日期所在周</span><input type="date" aria-label="选择复盘日期" min="1900-01-01" max="2199-12-31" value={selectedDate} disabled={busy||disabled} onChange={e=>pickDate(e.target.value)}/></label>
   <label className="wb-review-history-label"><span><History size={15} aria-hidden="true"/>已保存的复盘</span><select aria-label="历史复盘周" disabled={busy||disabled} value={history.includes(weekStart(selectedDate))?weekStart(selectedDate):''} onChange={e=>pickDate(e.target.value)}><option value="">{history.length?'选择一周查看':'还没有保存复盘笔记'}</option>{history.map(start=><option value={start} key={start}>{start} — {addDays(start,6)}</option>)}</select></label>
   <button type="button" className="secondary-button wb-review-export" onClick={()=>void exportWeek()} disabled={busy} data-testid="export-review"><Download size={15} aria-hidden="true"/>{busy?'正在导出…':'导出所选周 Markdown'}</button>
  </div>
  <p className="wb-review-preview" aria-live="polite"><b>{stats.start} — {stats.end}</b><span>{stats.completed} 件已完成 · {stats.pending} 件未完成 · 专注 {stats.focusMinutes} 分钟</span><small>导出包含所选周的清单、步骤、复盘笔记与本地建议。</small></p>
 </section>;
}
