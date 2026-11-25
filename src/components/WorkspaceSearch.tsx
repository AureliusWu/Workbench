import { useMemo, useState } from "react";
import { ArrowUpRight, Search, StickyNote, ListTodo, X } from "lucide-react";
import type { Note, Task } from "../types";

type Hit = { kind: "task"; data: Task } | { kind: "note"; data: Note };

export function WorkspaceSearch({
  tasks,
  notes,
  close,
  selectTask,
  selectNote,
}: {
  tasks: Task[];
  notes: Note[];
  close: () => void;
  selectTask: (task: Task) => void;
  selectNote: (note: Note) => void;
}) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return [];
    const includes = (value: string) =>
      value.toLocaleLowerCase().includes(term);
    const matchedTasks: Hit[] = tasks
      .filter(
        (task) =>
          includes(task.title) ||
          task.steps.some((step) => includes(step.title)),
      )
      .slice(0, 12)
      .map((data) => ({ kind: "task", data }));
    const matchedNotes: Hit[] = notes
      .filter((note) => includes(note.text))
      .slice(0, 8)
      .map((data) => ({ kind: "note", data }));
    return [...matchedTasks, ...matchedNotes];
  }, [query, tasks, notes]);
  function choose(hit: Hit) {
    if (hit.kind === "task") selectTask(hit.data);
    else selectNote(hit.data);
  }
  return (
    <div className="modal-backdrop search-backdrop" onClick={close}>
      <section
        className="modal search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="搜索工作台"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="search-dialog-field">
          <Search size={21} />
          <input
            autoFocus
            aria-label="搜索待办和便笺"
            placeholder="搜索待办和便笺…"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229
              )
                return;
              if (event.key === "Enter" && hits.length) {
                event.preventDefault();
                choose(hits[0]);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget
                  .closest("section")
                  ?.querySelector<HTMLButtonElement>(".search-hit")
                  ?.focus();
              }
            }}
          />
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="关闭搜索"
          >
            <X size={18} />
          </button>
        </div>
        <div className="search-results" aria-label="搜索结果">
          {!hits.length && (
            <p className="search-empty" role="status">
              {query.trim()
                ? "没有找到匹配的待办或便笺。"
                : "输入关键词查找待办、子步骤和便笺正文。"}
            </p>
          )}
          {hits.map((hit) => (
            <button
              key={`${hit.kind}:${hit.data.id}`}
              type="button"
              className="search-hit"
              onClick={() => choose(hit)}
            >
              <span className={`search-hit-icon ${hit.kind}`}>
                {hit.kind === "task" ? (
                  <ListTodo size={17} />
                ) : (
                  <StickyNote size={17} />
                )}
              </span>
              <span className="search-hit-copy">
                <strong>
                  {hit.kind === "task" ? hit.data.title : hit.data.text}
                </strong>
                <small>
                  {hit.kind === "task"
                    ? `${hit.data.date || "未排期"}${hit.data.done ? " · 已完成" : ""}`
                    : hit.data.archivedAt
                      ? "已归档便笺"
                      : "便笺"}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
