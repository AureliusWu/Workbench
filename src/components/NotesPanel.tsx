import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Pencil,
  Pin,
  Plus,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import type { AppState, Note, NoteTag } from "../types";
import { uid } from "../state";

export default function NotesPanel({
  state,
  change,
  composer,
  onEdit,
  onPin,
  tell,
}: {
  state: AppState;
  change: (update: (state: AppState) => AppState) => void;
  composer: ReactNode;
  onEdit: (note: Note) => void;
  onPin: (note: Note) => void;
  tell: (text: string) => void;
}) {
  const [archived, setArchived] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [manageTags, setManageTags] = useState(false);
  const composerRef = useRef<HTMLElement>(null);
  const tagsById = new Map(state.noteTags.map((tag) => [tag.id, tag.name]));
  const activeFilter = tagsById.has(tagFilter) ? tagFilter : "";
  const notes = state.notes.filter(
    (note) =>
      Boolean(note.archivedAt) === archived &&
      (!activeFilter || note.tagIds.includes(activeFilter)),
  );

  function changeArchive(note: Note) {
    const archivedAt = note.archivedAt ? undefined : new Date().toISOString();
    change((current) => ({
      ...current,
      notes: current.notes.map((item) =>
        item.id === note.id ? { ...item, archivedAt } : item,
      ),
    }));
    tell(archivedAt ? "便笺已归档，可在归档区恢复" : "便笺已恢复");
  }

  return (
    <div className="notes-workspace">
      <section className="card notes-toolbar">
        <div className="filter-tabs" aria-label="便笺范围">
          <button
            type="button"
            aria-pressed={!archived}
            className={!archived ? "active" : ""}
            onClick={() => setArchived(false)}
          >
            当前便笺
          </button>
          <button
            type="button"
            aria-pressed={archived}
            className={archived ? "active" : ""}
            onClick={() => setArchived(true)}
          >
            归档便笺{" "}
            <span className="count-tag">
              {state.notes.filter((note) => note.archivedAt).length}
            </span>
          </button>
        </div>
        <label className="notes-filter">
          按标签筛选
          <select
            value={activeFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            <option value="">全部标签</option>
            {state.noteTags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setManageTags(true)}
        >
          <Tags size={15} />
          管理标签
        </button>
      </section>
      <section className="note-card composer" ref={composerRef}>
        <div className="card-heading">
          <h2>编辑或新建便笺</h2>
          <Pencil size={16} />
        </div>
        {composer}
      </section>
      <div
        className="notes-grid"
        aria-label={archived ? "归档便笺" : "当前便笺"}
      >
        {notes.map((note) => (
          <article
            className={`note-card ${note.color}`}
            key={note.id}
            data-testid="note-card"
          >
            <p className="note-body">{note.text}</p>
            {note.tagIds.length > 0 && (
              <div className="note-tag-list">
                {note.tagIds.map((id) => (
                  <span className="note-tag" key={id}>
                    {tagsById.get(id)}
                  </span>
                ))}
              </div>
            )}
            <footer>
              <span title="创建日期">
                {new Date(note.createdAt).toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                })}
              </span>
              <div className="inline">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="编辑便笺"
                  title="编辑便笺"
                  onClick={() => {
                    onEdit(note);
                    composerRef.current?.querySelector("textarea")?.focus();
                    composerRef.current?.scrollIntoView({ block: "nearest" });
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="置顶便笺到桌面"
                  title="置顶便笺到桌面"
                  onClick={() => onPin(note)}
                >
                  <Pin size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={archived ? "恢复便笺" : "归档便笺"}
                  title={archived ? "恢复便笺" : "归档便笺"}
                  onClick={() => changeArchive(note)}
                >
                  {archived ? (
                    <ArchiveRestore size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="删除便笺"
                  title="删除便笺"
                  onClick={() => {
                    if (confirm("永久删除这条便笺？归档可保留正文和标签。")) {
                      change((current) => ({
                        ...current,
                        notes: current.notes.filter(
                          (item) => item.id !== note.id,
                        ),
                      }));
                      tell("便笺已删除");
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </footer>
          </article>
        ))}
        {!notes.length && (
          <p className="card note-empty">
            {activeFilter
              ? "没有带这个标签的便笺。"
              : archived
                ? "还没有归档便笺。"
                : "还没有便笺，可以在上面记下一个想法。"}
          </p>
        )}
      </div>
      {manageTags && (
        <TagManager
          tags={state.noteTags}
          close={() => setManageTags(false)}
          save={(tag) => {
            change((current) => ({
              ...current,
              noteTags: current.noteTags.some((item) => item.id === tag.id)
                ? current.noteTags.map((item) =>
                    item.id === tag.id ? tag : item,
                  )
                : [...current.noteTags, tag],
            }));
          }}
          remove={(id) => {
            if (tagFilter === id) setTagFilter("");
            change((current) => ({
              ...current,
              noteTags: current.noteTags.filter((tag) => tag.id !== id),
              notes: current.notes.map((note) =>
                note.tagIds.includes(id)
                  ? {
                      ...note,
                      tagIds: note.tagIds.filter((tagId) => tagId !== id),
                    }
                  : note,
              ),
            }));
          }}
        />
      )}
    </div>
  );
}

function TagManager({
  tags,
  close,
  save,
  remove,
}: {
  tags: NoteTag[];
  close: () => void;
  save: (tag: NoteTag) => void;
  remove: (id: string) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const reset = () => {
    setId("");
    setName("");
    setError("");
  };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal tag-manager"
        role="dialog"
        aria-modal="true"
        aria-label="管理标签"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>管理标签</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭标签管理"
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            if (
              tags.some(
                (tag) =>
                  tag.id !== id &&
                  tag.name.toLowerCase() === trimmed.toLowerCase(),
              )
            ) {
              setError("这个标签已经存在，请换一个名称。");
              return;
            }
            if (!id && tags.length >= 200) {
              setError("最多可创建 200 个标签。");
              return;
            }
            save({ id: id || uid(), name: trimmed });
            reset();
          }}
        >
          <label className="field">
            标签名称
            <input
              autoFocus
              ref={inputRef}
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              placeholder="例如：项目、个人"
            />
          </label>
          <div className="inline">
            <button className="primary-button" disabled={!name.trim()}>
              <Plus size={15} />
              {id ? "保存标签名称" : "新建标签"}
            </button>
            {id && (
              <button type="button" className="text-button" onClick={reset}>
                取消编辑
              </button>
            )}
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </form>
        <p className="subtle tag-manager-hint">
          删除标签会移除便笺上的关联，保留便笺内容。
        </p>
        <ul className="tag-manager-list">
          {tags.map((tag) => (
            <li key={tag.id}>
              <span>{tag.name}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`编辑标签 ${tag.name}`}
                onClick={() => {
                  setId(tag.id);
                  setName(tag.name);
                  setError("");
                  inputRef.current?.focus();
                }}
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`删除标签 ${tag.name}`}
                onClick={() => {
                  if (
                    confirm(`删除标签“${tag.name}”？所有便笺的正文都会保留。`)
                  ) {
                    remove(tag.id);
                    if (id === tag.id) reset();
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
