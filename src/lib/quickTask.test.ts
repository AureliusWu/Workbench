import {describe,it,expect} from 'vitest';
import {parseQuickTask} from './quickTask';
const today='2026-11-24';
describe('Chinese quick task parsing',()=>{
 it('parses the exact natural language examples without inventing vague times',()=>{
  expect(parseQuickTask('明天下午三点开会',today)).toEqual({title:'开会',date:'2026-11-25',time:'15:00',reminder:true});
  expect(parseQuickTask('周五下班前提交周报',today)).toMatchObject({title:'提交周报',date:'2026-11-27',time:'',reminder:false,warning:expect.stringContaining('未设置提醒时间')});
  expect(parseQuickTask('下周一提醒我缴纳物业费',today)).toMatchObject({title:'缴纳物业费',date:'2026-11-30',time:'',reminder:false,warning:expect.stringContaining('没有具体提醒时间')});
  expect(parseQuickTask('今天完成项目资料整理',today)).toEqual({title:'完成项目资料整理',date:today,time:'',reminder:false});
 });
 it('keeps undated tasks undated and refuses times without a date',()=>{
  expect(parseQuickTask('整理会议材料',today)).toEqual({title:'整理会议材料',date:'',time:'',reminder:false});
  expect(parseQuickTask('无日期 整理会议材料',today).date).toBe('');
  expect(()=>parseQuickTask('下午3点开会',today)).toThrow('没有明确日期');
  expect(()=>parseQuickTask('无日期 15:00开会',today)).toThrow('没有明确日期');
 });
 it('supports 24-hour clocks, Chinese minutes and week/year boundaries',()=>{
  expect(parseQuickTask('明天14：30提交 PR',today)).toMatchObject({title:'提交 PR',time:'14:30'});
  expect(parseQuickTask('后天早上九点半交材料',today).time).toBe('09:30');
  expect(parseQuickTask('本周六晚上七点一刻聚餐',today).time).toBe('19:15');
  expect(parseQuickTask('周一开会',today).date).toBe('2026-11-30');
  expect(parseQuickTask('明天开会','2026-12-31').date).toBe('2027-01-01');
  expect(parseQuickTask('下个月5号缴费','2026-12-31').date).toBe('2027-01-05');
  expect(parseQuickTask('2028年2月29日 09:00 开会',today).date).toBe('2028-02-29');
 });
 it('validates actual dates and flags past dates instead of silently changing the year',()=>{
  expect(()=>parseQuickTask('2027年2月29日开会',today)).toThrow('不存在');
  expect(()=>parseQuickTask('2月30号开会',today)).toThrow('不存在');
  expect(parseQuickTask('1月5日开会',today)).toMatchObject({date:'2026-01-05',warning:expect.stringContaining('已经过去')});
 });
 it('rejects conflicting dates, times and unsupported recurrence instead of choosing one',()=>{
  expect(()=>parseQuickTask('今天或明天开会',today)).toThrow('多个日期');
  expect(()=>parseQuickTask('明天9:00或14:00开会',today)).toThrow('多个时间');
  expect(()=>parseQuickTask('周末聚餐',today)).toThrow('不够明确');
  expect(()=>parseQuickTask('下周交报告',today)).toThrow('不够明确');
  expect(()=>parseQuickTask('每周五交周报',today)).toThrow('重复规则');
  expect(()=>parseQuickTask('明天上午15点开会',today)).toThrow('不一致');
  expect(()=>parseQuickTask('明天晚上12点开会',today)).toThrow('跨日');
  expect(()=>parseQuickTask('明天25:00开会',today)).toThrow('时间无效');
  expect(()=>parseQuickTask('明天15:75开会',today)).toThrow('时间无效');
 });
 it('requires an actual task title and preserves action verbs',()=>{
  expect(()=>parseQuickTask('明天下午三点',today)).toThrow('要做的事');
  expect(()=>parseQuickTask('',today)).toThrow('先写一件');
  expect(parseQuickTask('提醒我明天下午三点完成项目整理',today).title).toBe('完成项目整理');
 });
 it('preserves emoji and ordinary quantity phrases rather than creating false clock times',()=>{
  expect(parseQuickTask('📌明天下午三点开会🙂',today)).toMatchObject({title:'📌开会🙂',date:'2026-11-25',time:'15:00'});
  expect(parseQuickTask('今天整理一点资料',today)).toEqual({title:'整理一点资料',date:today,time:'',reminder:false});
  expect(parseQuickTask('明天写下两点建议',today)).toEqual({title:'写下两点建议',date:'2026-11-25',time:'',reminder:false});
  expect(parseQuickTask('今天整理1点资料',today)).toEqual({title:'整理1点资料',date:today,time:'',reminder:false});
  expect(parseQuickTask('明天制作提醒事项海报',today).warning).toBeUndefined();
 });
 it('does not infer an exact clock from bare, approximate or relative times',()=>{
  expect(parseQuickTask('明天三点开会',today)).toMatchObject({title:'开会',time:'',reminder:false,warning:expect.stringContaining('上午或下午')});
  expect(parseQuickTask('明天03:00开会',today)).toMatchObject({title:'开会',time:'03:00',reminder:true});
  for(const text of ['明天下午三点左右开会','明天15:00前提交报告','明天大约下午三点开会']){
   expect(parseQuickTask(text,today)).toMatchObject({time:'',reminder:false,warning:expect.stringContaining('未设置准确提醒时间')});
  }
  expect(()=>parseQuickTask('一小时后提醒我开会',today)).toThrow('不会猜测');
  expect(()=>parseQuickTask('明天下午3点到4点开会',today)).toThrow('多个时间');
  expect(()=>parseQuickTask('明天9点100分开会',today)).toThrow();
 });
});
