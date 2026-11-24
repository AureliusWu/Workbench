import { addDays, parseDate, weekStart } from './calendar';

export interface QuickTaskResult { title:string; date:string; time:string; reminder:boolean; warning?:string }
type Span={start:number;end:number;value:string};
const weekdayNumber:Record<string,number>={'一':0,'二':1,'三':2,'四':3,'五':4,'六':5,'日':6,'天':6,'1':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6};
function chineseNumber(value:string):number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits:Record<string,number>={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if(value==='十')return 10;
  if(value.includes('十')){const [a,b]=value.split('十');return (a?digits[a]:1)*10+(b?digits[b]:0)}
  if(value.length===1 && value in digits)return digits[value];
  return NaN;
}
function checkedDate(year:number,month:number,day:number):string {
  if (!Number.isInteger(year)||year<1900||year>2199) throw new Error('日期年份请填写 1900 至 2199 年。');
  const key=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  try{parseDate(key)}catch{throw new Error(`“${year}年${month}月${day}日”不存在，请核对日期。`)}
  return key;
}

/** Offline conservative parser. It never invents a clock time for a vague period or an undated task. */
export function parseQuickTask(input:string,todayKey:string):QuickTaskResult {
  const today=parseDate(todayKey);
  if(today.getFullYear()<1900||today.getFullYear()>2199)throw new Error('当前日期超出支持范围，请核对电脑日期。');
  const original=input.trim().replace(/：/g,':');
  if(!original)throw new Error('先写一件要做的事，例如“明天下午三点开会”。');
  if(original.length>1000)throw new Error('这句话有点长，请精简到 1000 字以内。');
  if(/每(?:天|日|周|星期|月)|每日|工作日/.test(original))throw new Error('快速添加暂不解析重复规则，请在新建待办中设置重复。');
  if(/(?:\d+|[一二两三四五六七八九十]+)(?:分钟|小时|天|周)(?:后|前)/.test(original))throw new Error('相对时长需要当前钟点，快速添加不会猜测。请写明日期和时间，例如“明天下午三点”。');
  // RegExp indices are UTF-16 code units, as are split('') indices. Keep emoji before tokens intact.
  const chars=original.split(''),removed=chars.map(()=>false),dates:Span[]=[],times:Span[]=[],warnings:string[]=[];
  const mask=()=>chars.join('');
  function takeDate(pattern:RegExp,convert:(match:RegExpExecArray)=>string){
    let match:RegExpExecArray|null;
    const source=mask();
    while((match=pattern.exec(source))){
      dates.push({start:match.index,end:match.index+match[0].length,value:convert(match)});
      for(let i=match.index;i<match.index+match[0].length;i++){chars[i]=' ';removed[i]=true}
    }
  }
  takeDate(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g,m=>checkedDate(Number(m[1]),Number(m[2]),Number(m[3])));
  takeDate(/(\d{4})年(\d{1,2})月(\d{1,2})[日号]?/g,m=>checkedDate(Number(m[1]),Number(m[2]),Number(m[3])));
  takeDate(/(下下|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天1-7])/g,m=>{
    const weekday=weekdayNumber[m[2]],prefix=m[1];
    if(prefix)return addDays(weekStart(todayKey),weekday+(prefix==='下'?7:prefix==='下下'?14:0));
    const day=(today.getDay()+6)%7;return addDays(todayKey,(weekday-day+7)%7);
  });
  takeDate(/大后天|后天|明天|今日|今天|明日/g,m=>addDays(todayKey,({大后天:3,后天:2,明天:1,今日:0,今天:0,明日:1} as Record<string,number>)[m[0]]));
  takeDate(/(下个月|下月|本月|这个月)(\d{1,2})[日号]/g,m=>{
    const next=m[1].startsWith('下'),base=new Date(today.getFullYear(),today.getMonth()+(next?1:0),1,12);
    return checkedDate(base.getFullYear(),base.getMonth()+1,Number(m[2]));
  });
  takeDate(/(?<!\d)(\d{1,2})月(\d{1,2})[日号]?/g,m=>checkedDate(today.getFullYear(),Number(m[1]),Number(m[2])));
  takeDate(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g,m=>checkedDate(today.getFullYear(),Number(m[1]),Number(m[2])));
  takeDate(/(?<!\d)(\d{1,2})[日号]/g,m=>checkedDate(today.getFullYear(),today.getMonth()+1,Number(m[1])));
  takeDate(/不设日期|无日期|待安排/g,()=> '');
  if(dates.length>1)throw new Error('识别到多个日期，请每次只添加一件事，并保留一个明确日期。');
  if(/下下周|下周|本周|这周|周末|月底|月末|下个月|下月|过几天/.test(mask()))throw new Error('日期还不够明确，请写到具体一天，例如“下周一”或“12月5日”。');

  const number='(?:\\d{1,2}|[零〇一二两三四五六七八九十]{1,3})';
  const timePattern=new RegExp(`(?<![\\d零〇一二两三四五六七八九十])(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚间)?\\s*(${number})(?::(\\d{1,2})(?!\\d)|(?:点|时)(?:钟)?(半|一刻|三刻|${number}分?)?)(?![\\d零〇一二两三四五六七八九十])`,'g');
  let match:RegExpExecArray|null;const timeSource=mask();
  while((match=timePattern.exec(timeSource))){
    const period=match[1]||'',hourRaw=chineseNumber(match[2]),minuteRaw=match[3]!==undefined?Number(match[3]):match[4]==='半'?30:match[4]==='一刻'?15:match[4]==='三刻'?45:match[4]?chineseNumber(match[4].replace(/分$/,'')):0;
    const suffix=timeSource.slice(match.index+match[0].length),prefix=timeSource.slice(0,match.index);
    // “一点资料”“两点建议” are quantities, not clock times. Leave their wording untouched.
    if(!period&&match[3]===undefined&&!match[4]&&/^\s*(?:资料|材料|东西|时间|内容|笔记|预算|帮助|想法|工作|家务|事情|文件|建议|文字|文案|意见|问题|要求|注意事项)/.test(suffix)){
      for(let i=match.index;i<match.index+match[0].length;i++)chars[i]=' ';
      continue;
    }
    if(!Number.isFinite(hourRaw)||!Number.isFinite(minuteRaw)||hourRaw<0||hourRaw>23||minuteRaw<0||minuteRaw>59)throw new Error('时间无效，请使用 00:00 至 23:59，例如“下午三点半”。');
    let hour=hourRaw;
    if(period){
      if(['早上','早晨','上午','凌晨'].includes(period)){
        if(hourRaw>12||(period==='凌晨'&&hourRaw>5))throw new Error('时段与小时不一致，请用明确的 24 小时时间，例如“15:00”。');
        if(hourRaw===12)throw new Error('“上午12点”有歧义，请写“中午12点”或“00:00”。');
      }else if(period==='中午'){
        if(hourRaw===11||hourRaw===12)hour=hourRaw;else if(hourRaw>=1&&hourRaw<=2)hour=hourRaw+12;else throw new Error('中午的时间有歧义，请用明确的 24 小时时间。');
      }else{
        if(hourRaw===0||(['晚上','晚间'].includes(period)&&hourRaw===12))throw new Error('午夜跨日时间有歧义，请写明日期并使用“00:00”。');
        if((['晚上','晚间','傍晚'].includes(period)&&hourRaw>0&&hourRaw<6)||(period==='下午'&&hourRaw>6&&hourRaw<12))throw new Error('时段与小时有歧义，请用明确的 24 小时时间，例如“15:00”。');
        if(hourRaw<12)hour=hourRaw+12;
      }
    }
    let start=match.index,end=match.index+match[0].length,value=`${String(hour).padStart(2,'0')}:${String(minuteRaw).padStart(2,'0')}`;
    const approximatePrefix=prefix.match(/(?:大约|大概|约)\s*$/),relativeSuffix=suffix.match(/^\s*(?:左右|前后|以前|以后|之前|之后|前|后)/);
    if(approximatePrefix||relativeSuffix){
      value='';warnings.push('识别到大约或前后时间，未设置准确提醒时间；请确认后补充具体钟点。');
      if(approximatePrefix)start-=approximatePrefix[0].length;
      if(relativeSuffix)end+=relativeSuffix[0].length;
    }else if(!period&&match[3]===undefined&&hourRaw>=1&&hourRaw<=12){
      value='';warnings.push('钟点未说明上午或下午，未设置提醒时间；请补充时段或使用 24 小时格式。');
    }
    times.push({start,end,value});
    for(let i=start;i<end;i++){chars[i]=' ';removed[i]=true}
  }
  if(times.length>1)throw new Error('识别到多个时间，请每次只保留一个提醒时间。');
  if(/\d{1,2}\s*[:点时]/.test(mask()))throw new Error('时间格式未能识别，请改成“15:00”或“下午三点半”。');
  const fuzzy=/下班前|上班前|午饭后|午饭前|晚饭后|晚饭前|睡前|一早|凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚间/g;
  let vague=false;const beforeTitle=mask();
  while((match=fuzzy.exec(beforeTitle))){vague=true;for(let i=match.index;i<match.index+match[0].length;i++){chars[i]=' ';removed[i]=true}}
  const date=dates[0]?.value||'',time=times[0]?.value||'';
  if(date&&(Number(date.slice(0,4))<1900||Number(date.slice(0,4))>2199))throw new Error('识别出的日期超出 1900 至 2199 年，请修改日期。');
  if(time&&!date)throw new Error('识别到了时间，但没有明确日期。请补充“今天”“明天”或具体日期后再添加。');
  const reminderRequested=/^\s*(?:在|于)?\s*(?:请)?(?:帮我)?提醒(?:我|一下)?/.test(mask());
  let title=original.split('').filter((_,index)=>!removed[index]).join('').replace(/^\s*(?:在|于)\s*/,'').replace(/^\s*(?:请)?(?:帮我)?提醒(?:我|一下)?\s*/,'').trim().replace(/^[，,；;：:、\s]+|[，,；;：:、\s]+$/g,'').replace(/\s+/g,' ');
  if(!title)throw new Error('日期和时间已识别，还需要写要做的事，例如“明天下午三点开会”。');
  if(title.length>300)throw new Error('待办名称请精简到 300 字以内，详细内容可在小步骤中补充。');
  if(vague)warnings.push('时段没有具体钟点，未设置提醒时间；请确认后按需补充。');
  if(reminderRequested&&!time)warnings.push('还没有具体提醒时间，当前只安排日期，不会弹出到时提醒。');
  if(date&&date<todayKey)warnings.push('识别出的日期已经过去，请确认是否需要修改年份或日期。');
  return {title,date,time,reminder:!!(date&&time),...(warnings.length?{warning:[...new Set(warnings)].join(' ')}:{})};
}
