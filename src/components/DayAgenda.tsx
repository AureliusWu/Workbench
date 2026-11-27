import { useId, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CalendarClock, CalendarDays, ChevronDown, Inbox, Plus } from "lucide-react";
import { getDayInfo, parseDate } from "../lib/calendar";
import type { Settings, Task } from "../types";
import "./day-agenda.css";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

interface DayAgendaProps {
  today: string;
  tomorrow: string;
  todayTasks: Task[];
  tomorrowTasks: Task[];
  backlog: Task[];
  settings: Pick<Settings, "lastSaturdayWork" | "dayOverrides">;
  onAdd: (title: string, date: string) => void;
  renderTask: (task: Task, targetDate?: string) => ReactNode;
}

type DayPanelProps = Pick<DayAgendaProps, "settings" | "onAdd" | "renderTask"> & {
  date: string;
  targetDate: string;
  tasks: Task[];
  isToday: boolean;
};

function DayPanel({ date, targetDate, tasks, isToday, settings, onAdd, renderTask }: DayPanelProps) {
  const headingId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const day = useMemo(() => getDayInfo(date, settings), [date, settings]);
  const pending = tasks.filter((task) => !task.done);
  const completed = tasks.filter((task) => task.done);
  const label = isToday ? "今天" : "明天";
  const DayIcon = isToday ? CalendarDays : CalendarClock;
  const hasExtraDayInfo = day.reason !== "工作日" && day.reason !== "周末休息";

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    try {
      onAdd(title, date);
      setDraft("");
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "添加待办失败，请重试。");
    }
  }

  return (
    <section className="card day-agenda-card" aria-labelledby={headingId} data-testid={isToday ? "agenda-today" : "agenda-tomorrow"}>
      <div className="day-agenda-header">
        <span className={`day-agenda-icon${isToday ? "" : " tomorrow"}`}>
          <DayIcon size={21} aria-hidden="true" />
        </span>
        <div className="day-agenda-heading">
          <h2 id={headingId}>{label}</h2>
          <p>
            <time dateTime={date}>{dateFormatter.format(parseDate(date))}</time>
            {hasExtraDayInfo && <span> · {day.reason}</span>}
          </p>
        </div>
        <span className={`day-agenda-day-type ${day.isWorkday ? "work" : "rest"}`}>
          {day.isWorkday ? "工作日" : "休息日"}
        </span>
      </div>
      <form className="day-agenda-form" onSubmit={add}>
        <input
          aria-label={`${label}待办名称`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder="写下一件待办"
          maxLength={300}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
              event.preventDefault();
            }
          }}
        />
        <button className="primary-button" type="submit" disabled={!draft.trim()} aria-label={`添加${label}待办`}>
          <Plus size={14} aria-hidden="true" />
          添加
        </button>
        {error && <p className="day-agenda-error" id={errorId} role="alert">{error}</p>}
      </form>
      <div className="day-agenda-progress">
        <progress aria-label={`${label}完成进度`} value={completed.length} max={tasks.length || 1} />
        <span>{completed.length} / {tasks.length} 件已完成</span>
      </div>
      <div className="day-agenda-list" role="region" aria-label={`${label}清单`} tabIndex={tasks.length ? 0 : undefined}>
        <div className="day-agenda-group">
          <h3>待完成 <span className="count-tag">{pending.length}</span></h3>
          {pending.length ? pending.map((task) => renderTask(task, targetDate)) : <p className="subtle day-agenda-empty">暂无未完成待办</p>}
        </div>
        {completed.length > 0 && (
          <div className="day-agenda-group">
            <h3>已完成 <span className="count-tag">{completed.length}</span></h3>
            {completed.map((task) => renderTask(task))}
          </div>
        )}
      </div>
    </section>
  );
}

export function DayAgenda({ today, tomorrow, todayTasks, tomorrowTasks, backlog, settings, onAdd, renderTask }: DayAgendaProps) {
  return (
    <div className="day-agenda" data-testid="day-agenda">
      <DayPanel date={today} targetDate={tomorrow} tasks={todayTasks} isToday settings={settings} onAdd={onAdd} renderTask={renderTask} />
      <DayPanel date={tomorrow} targetDate={today} tasks={tomorrowTasks} isToday={false} settings={settings} onAdd={onAdd} renderTask={renderTask} />
      {backlog.length > 0 && (
        <details className="card day-agenda-backlog" data-testid="agenda-backlog">
          <summary>
            <span><Inbox size={17} aria-hidden="true" /> 待安排 <span className="count-tag">{backlog.length}</span></span>
            <ChevronDown className="day-agenda-disclosure" size={18} aria-hidden="true" />
          </summary>
          <div className="day-agenda-backlog-body">
            <p className="subtle">这里收录逾期或未排期的单次待办，可安排到今天。</p>
            <div className="day-agenda-list" role="region" aria-label="待安排清单" tabIndex={0}>
              {backlog.map((task) => renderTask(task, today))}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
