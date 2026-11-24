import {describe,expect,it} from 'vitest';
import type {AppState,Task} from '../types';
import {reviewMarkdown,savedReviewWeeks} from './review';
import {toggleTaskDone} from './tasks';
const task=(extra:Partial<Task>={}):Task=>({id:'t',title:'准备会议',date:'2026-11-24',time:'10:00',priority:'high',done:false,createdAt:'2026-11-24T00:00:00Z',steps:[],repeat:'none',estimate:30,reminder:true,...extra});
const state=(tasks:Task[]):AppState=>({schemaVersion:1,tasks,notes:[],noteTags:[],focusSessions:[],reviews:{},settings:{name:'',lastSaturdayWork:true,dayOverrides:{},focusMinutes:25,breakMinutes:5,morningGreeting:true,autoLaunch:false,aiEndpoint:'',aiModel:''}});
describe('selected-week review Markdown',()=>{
 it('exports the exact selected Monday–Sunday with counts, actual tasks, steps, note and focus',()=>{
  const data=state([task({id:'done',title:'完成的合同',done:true,steps:[{id:'s',title:'确认签字',done:true}]}),task({id:'open',title:'剩余的发票'}),task({id:'outside',title:'不属于这周',date:'2026-11-30'}),task({id:'undated',title:'没有安排日期',date:'',time:'',reminder:false})]);
  data.reviews['2026-11-23']='这周完成了合同\n下周减少打断';
  data.focusSessions=[{id:'in',date:'2026-11-24',minutes:25},{id:'out',date:'2026-11-30',minutes:60}];
  const result=reviewMarkdown(data,'2026-11-25');
  expect(result.weekStart).toBe('2026-11-23');expect(result.weekEnd).toBe('2026-11-29');
  expect(result.markdown).toContain('计划完成率：50%（1 / 2 件）');
  expect(result.markdown).toContain('累计专注：25 分钟');
  expect(result.markdown).toContain('- [x] 完成的合同');
  expect(result.markdown).toContain('  - [x] 确认签字');
  expect(result.markdown).toContain('- [ ] 剩余的发票');
  expect(result.markdown).toContain('这周完成了合同');
  expect(result.markdown).not.toContain('不属于这周');expect(result.markdown).not.toContain('没有安排日期');
 });
 it('projects completed recurring occurrences once and does not apply completion to next week',()=>{
  const data=state(toggleTaskDone([task({repeat:'weekly',date:'2026-11-23'})],'t::2026-11-23',true));
  expect(reviewMarkdown(data,'2026-11-23').markdown).toContain('100%（1 / 1 件）');
  expect(reviewMarkdown(data,'2026-11-30').markdown).toContain('0%（0 / 1 件）');
 });
 it('handles an empty week and preserves text as text in Markdown',()=>{
  const data=state([task({title:'<script> *test* | [x]',date:'2026-11-24'})]);
  data.reviews['2026-11-23']='# 标题\n<script>内容</script>';
  const result=reviewMarkdown(data,'2026-11-24').markdown;
  expect(result).toContain('\\<script\\> \\*test\\* \\| \\[x\\]');
  expect(result).toContain('\\# 标题');
  expect(reviewMarkdown(state([]),'2026-11-24').markdown).toContain('本周没有已完成的计划待办');
 });
 it('builds newest-first nonempty saved-note history and skips invalid date keys',()=>{
  expect(savedReviewWeeks({reviews:{'2026-11-23':'写完的复盘','2026-11-16':'上一周','2026-11-30':'  ','bad':'损坏日期'}})).toEqual(['2026-11-23','2026-11-16']);
 });
});
