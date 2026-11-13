'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthenticatedShell } from '@/components/authenticated-shell';
import { PriorityBadge } from '@/components/PriorityBadge';
import type { CreateTagInput, Priority, Tag, Todo, UpdateTagInput } from '@/lib/db';
import { applyFilters, DEFAULT_FILTER_STATE, hasActiveFilters, type FilterState } from '@/lib/filters';
import { loadPresets, writePresets, type FilterPreset } from '@/lib/filterPresets';
import { getTagTextColor } from '@/lib/tagColor';
import { getSingaporeNow, formatSingaporeDateTimeInput, parseSingaporeDateTime } from '@/lib/timezone';
import { isDueDateAtLeastOneMinuteAhead } from '@/lib/todoDates';
import { sectionTodos } from '@/lib/todoSort';
import { validateTodoTitle } from '@/lib/todoValidation';

type TodoDraft = {
  title: string;
  due_date: string | null;
  priority: Priority;
  tag_ids: number[];
};

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
const DEFAULT_TAG_COLOR = '#3B82F6';

function TagPill({
  tag,
  selected = false,
  onClick,
  actionLabel,
}: {
  tag: Tag;
  selected?: boolean;
  onClick?: (tag: Tag) => void;
  actionLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={actionLabel}
      onClick={() => onClick?.(tag)}
      style={{ backgroundColor: tag.color, color: getTagTextColor(tag.color) }}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
        selected
          ? 'border-transparent ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900'
          : 'border-transparent opacity-90 hover:opacity-100'
      }`}
    >
      {selected && <span aria-hidden="true">✓</span>}
      <span className="max-w-[10rem] truncate">{tag.name}</span>
    </button>
  );
}

function ManageTagsModal({
  tags,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: {
  tags: Tag[];
  onClose: () => void;
  onCreate: (input: CreateTagInput) => Promise<void>;
  onUpdate: (id: number, input: UpdateTagInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_TAG_COLOR);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(DEFAULT_TAG_COLOR);
  const [error, setError] = useState<string | null>(null);

  async function createTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await onCreate({ name, color });
      setName('');
      setColor(DEFAULT_TAG_COLOR);
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create tag.');
    }
  }

  function startEditing(tag: Tag) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
    setError(null);
  }

  async function saveTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingId === null) return;
    try {
      await onUpdate(editingId, { name: editName, color: editColor });
      setEditingId(null);
      setError(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update tag.');
    }
  }

  async function deleteTag(tag: Tag) {
    if (!window.confirm(`Delete tag "${tag.name}"?`)) return;
    try {
      await onDelete(tag.id);
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete tag.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-tags-heading"
        className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="manage-tags-heading" className="text-xl font-semibold">Manage Tags</h2>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center justify-between gap-2">
              {editingId === tag.id ? (
                <form onSubmit={saveTag} className="flex w-full flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`edit-tag-name-${tag.id}`}>Tag name</label>
                  <input
                    id={`edit-tag-name-${tag.id}`}
                    aria-label="Tag name"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <label className="sr-only" htmlFor={`edit-tag-color-${tag.id}`}>Tag color</label>
                  <input
                    id={`edit-tag-color-${tag.id}`}
                    type="color"
                    value={editColor}
                    onChange={(event) => setEditColor(event.target.value)}
                  />
                  <input
                    aria-label="Tag color hex"
                    value={editColor}
                    onChange={(event) => setEditColor(event.target.value)}
                    className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                  <button type="submit" className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    Update
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-sm text-slate-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <TagPill tag={tag} selected />
                  <div className="flex gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => startEditing(tag)}
                      className="text-blue-700 dark:text-blue-300"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteTag(tag)}
                      className="text-red-700 dark:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={createTag} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="new-tag-name">New tag name</label>
          <input
            id="new-tag-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tag name"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
          />
          <label className="sr-only" htmlFor="new-tag-color">Tag color</label>
          <input
            id="new-tag-color"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
          <input
            aria-label="Tag color hex"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Create Tag
          </button>
        </form>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="text-sm text-slate-600 dark:text-slate-300">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDueDate(value: string): string {
  const date = parseSingaporeDateTime(value);
  if (!date) throw new RangeError('Todo due_date must be a valid ISO date-time');
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getDueDateInput(value: string | null): string {
  if (value === null) return '';
  const parsed = parseSingaporeDateTime(value);
  if (!parsed) throw new RangeError('Todo due_date must be a valid ISO date-time');
  return formatSingaporeDateTimeInput(parsed);
}

function ErrorMessage({ children }: { children: string }) {
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
      {children}
    </div>
  );
}

function TodoCard({
  todo,
  onToggle,
  onEdit,
  onDelete,
  onTagClick,
}: {
  todo: Todo;
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onTagClick: (tag: Tag) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <input
          type="checkbox"
          checked={todo.completed}
          onChange={(event) => onToggle(todo, event.target.checked)}
          className="mt-1 size-5 shrink-0 accent-blue-600"
          aria-label={`Mark "${todo.title}" as ${todo.completed ? 'incomplete' : 'complete'}`}
        />
        <div className="min-w-0">
          <p className={`break-words font-medium ${todo.completed ? 'text-slate-500 line-through dark:text-slate-400' : ''}`}>
            {todo.title}
          </p>
          {todo.due_date && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Due {formatDueDate(todo.due_date)}
            </p>
          )}
          {todo.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {todo.tags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  onClick={onTagClick}
                  actionLabel={`Filter by ${tag.name}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <PriorityBadge priority={todo.priority} />
        <button
          type="button"
          onClick={() => onEdit(todo)}
          className="rounded-md px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(todo)}
          aria-label={`Delete "${todo.title}"`}
          className="rounded-md px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function TodoSection({
  title,
  todos,
  onToggle,
  onEdit,
  onDelete,
  onTagClick,
}: {
  title: string;
  todos: Todo[];
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onTagClick: (tag: Tag) => void;
}) {
  if (todos.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {title} <span className="text-sm font-normal text-slate-500">({todos.length})</span>
      </h2>
      <ul className="space-y-2">
        {todos.map((todo) => (
          <TodoCard
            key={todo.id}
            todo={todo}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            onTagClick={onTagClick}
          />
        ))}
      </ul>
    </section>
  );
}

function TodoDashboard() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [showManageTags, setShowManageTags] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [draft, setDraft] = useState<TodoDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clockNow, setClockNow] = useState(getSingaporeNow);
  const optimisticId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    let active = true;
    async function loadTodos() {
      try {
        const [todoResponse, tagResponse] = await Promise.all([
          fetch('/api/todos'),
          fetch('/api/tags'),
        ]);
        if (!todoResponse.ok) {
          if (todoResponse.status === 401) throw new Error('You must sign in to manage todos.');
          throw new Error('Could not load todos. Please try again.');
        }
        if (!tagResponse.ok) throw new Error('Could not load tags. Please try again.');
        const [loadedTodos, loadedTags] = await Promise.all([
          todoResponse.json() as Promise<Todo[]>,
          tagResponse.json() as Promise<Tag[]>,
        ]);
        if (active) {
          setTodos(loadedTodos);
          setTags(loadedTags);
          setError(null);
          setPresets(loadPresets(() => {
            setPresetError('Could not load saved filters. Saving a new filter will replace invalid stored data.');
          }));
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load todos.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadTodos();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function refreshTags() {
      try {
        const response = await fetch('/api/tags');
        if (!response.ok) throw new Error('Could not refresh tags.');
        const currentTags = await response.json() as Tag[];
        if (!active) return;
        setTags(currentTags);
        setFilters((current) => current.tagId !== 'all' &&
          !currentTags.some((tag) => tag.id === current.tagId)
          ? { ...current, tagId: 'all' } : current);
      } catch (refreshError) {
        if (active) setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh tags.');
      }
    }
    const onFocus = () => { void refreshTags(); };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (!editingTodo) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditingTodo(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingTodo]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(getSingaporeNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const { priority: priorityFilter, tagId: tagFilter, completion, dueDateFrom, dueDateTo } = filters;
  const visibleTodos = useMemo(() => applyFilters(todos, {
    search: debouncedSearch, priority: priorityFilter, tagId: tagFilter,
    completion, dueDateFrom, dueDateTo,
  }), [todos, debouncedSearch, priorityFilter, tagFilter, completion, dueDateFrom, dueDateTo]);
  const sections = useMemo(
    () => sectionTodos(visibleTodos, clockNow),
    [visibleTodos, clockNow],
  );

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = validateTodoTitle(title);
    if (!trimmedTitle) {
      setError('Title is required');
      return;
    }
    let normalizedDueDate: string | null = null;
    if (dueDate) {
      if (!isDueDateAtLeastOneMinuteAhead(dueDate, getSingaporeNow())) {
        setError('Due date must be at least 1 minute in the future');
        return;
      }
      const parsed = parseSingaporeDateTime(dueDate);
      if (!parsed) {
        setError('Due date must be a valid date and time');
        return;
      }
      normalizedDueDate = parsed.toISOString();
    }

    const newTodoTags = tags.filter((tag) => selectedTagIds.includes(tag.id));
    const optimisticTodo: Todo = {
      id: --optimisticId.current,
      user_id: 0,
      title: trimmedTitle,
      completed: false,
      due_date: normalizedDueDate,
      priority,
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      last_notification_sent: null,
      created_at: getSingaporeNow().toISOString(),
      updated_at: null,
      subtasks: [],
      tags: newTodoTags,
    };
    setTodos((current) => [...current, optimisticTodo]);
    setTitle('');
    setDueDate('');
    setPriority('medium');
    setSelectedTagIds([]);
    setError(null);

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          due_date: dueDate || null,
          priority,
          tag_ids: selectedTagIds,
        }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error ?? 'Could not create todo. Please try again.');
      }
      const saved = (await response.json()) as Todo;
      setTodos((current) =>
        current.map((todo) => (todo.id === optimisticTodo.id ? saved : todo)),
      );
    } catch (createError) {
      setTodos((current) => current.filter((todo) => todo.id !== optimisticTodo.id));
      setError(createError instanceof Error ? createError.message : 'Could not create todo.');
    }
  }

  function openEditor(todo: Todo) {
    setEditingTodo(todo);
    setDraft({
      title: todo.title,
      due_date: getDueDateInput(todo.due_date),
      priority: todo.priority,
      tag_ids: todo.tags.map((tag) => tag.id),
    });
    setError(null);
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTodo || !draft) return;
    const trimmedTitle = validateTodoTitle(draft.title);
    if (!trimmedTitle) {
      setError('Title cannot be empty');
      return;
    }
    let normalizedDueDate: string | null = editingTodo.due_date;
    if (draft.due_date) {
      const parsed = parseSingaporeDateTime(draft.due_date);
      if (!parsed) {
        setError('Due date must be a valid date and time');
        return;
      }
      normalizedDueDate = parsed.toISOString();
    }
    if (
      normalizedDueDate !== editingTodo.due_date &&
      normalizedDueDate !== null &&
      !isDueDateAtLeastOneMinuteAhead(normalizedDueDate, getSingaporeNow())
    ) {
      setError('Due date must be at least 1 minute in the future');
      return;
    }

    const patch: Record<string, unknown> = {};
    if (trimmedTitle !== editingTodo.title) patch.title = trimmedTitle;
    if (normalizedDueDate !== editingTodo.due_date) patch.due_date = normalizedDueDate;
    if (draft.priority !== editingTodo.priority) patch.priority = draft.priority;
    if (
      draft.tag_ids.length !== editingTodo.tags.length ||
      draft.tag_ids.some((id) => !editingTodo.tags.some((tag) => tag.id === id))
    ) {
      patch.tag_ids = draft.tag_ids;
    }
    if (Object.keys(patch).length === 0) {
      setEditingTodo(null);
      return;
    }

    const original = editingTodo;
    const updatedLocally = {
      ...original,
      ...patch,
      tags: Object.hasOwn(patch, 'tag_ids')
        ? tags.filter((tag) => draft.tag_ids.includes(tag.id))
        : original.tags,
    } as Todo;
    setTodos((current) =>
      current.map((todo) => (todo.id === original.id ? updatedLocally : todo)),
    );
    setEditingTodo(null);
    setError(null);

    try {
      const response = await fetch(`/api/todos/${original.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error ?? 'Could not update todo. Please try again.');
      }
      const saved = (await response.json()) as Todo;
      setTodos((current) =>
        current.map((todo) => (todo.id === original.id ? saved : todo)),
      );
    } catch (updateError) {
      setTodos((current) =>
        current.map((todo) => (todo.id === original.id ? original : todo)),
      );
      setError(updateError instanceof Error ? updateError.message : 'Could not update todo.');
    }
  }

  async function handleToggle(todo: Todo, completed: boolean) {
    const original = todo;
    setTodos((current) =>
      current.map((item) =>
        item.id === todo.id
          ? {
              ...item,
              completed,
              updated_at: getSingaporeNow().toISOString(),
            }
          : item,
      ),
    );
    setError(null);
    try {
      const response = await fetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      if (!response.ok) throw new Error('Could not update todo. Please try again.');
      const saved = (await response.json()) as Todo;
      setTodos((current) => current.map((item) => (item.id === todo.id ? saved : item)));
    } catch (toggleError) {
      setTodos((current) => current.map((item) => (item.id === todo.id ? original : item)));
      setError(toggleError instanceof Error ? toggleError.message : 'Could not update todo.');
    }
  }

  async function handleDelete(todo: Todo) {
    setTodos((current) => current.filter((item) => item.id !== todo.id));
    setError(null);
    try {
      const response = await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete todo. Please try again.');
    } catch (deleteError) {
      setTodos((current) => [...current, todo]);
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete todo.');
    }
  }

  async function createTag(input: CreateTagInput) {
    const response = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const result = await response.json() as Tag | { error?: string };
    if (!response.ok) {
      throw new Error('error' in result && result.error ? result.error : 'Could not create tag.');
    }
    if (!('id' in result)) throw new Error('Tag response was invalid.');
    setTags((current) => [...current, result]);
  }

  async function updateTag(id: number, input: UpdateTagInput) {
    const response = await fetch(`/api/tags/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const result = await response.json() as Tag | { error?: string };
    if (!response.ok) {
      throw new Error('error' in result && result.error ? result.error : 'Could not update tag.');
    }
    if (!('id' in result)) throw new Error('Tag response was invalid.');
    setTags((current) => current.map((tag) => tag.id === id ? result : tag));
    setTodos((current) => current.map((todo) => ({
      ...todo,
      tags: todo.tags.map((tag) => tag.id === id ? result : tag),
    })));
  }

  async function deleteTag(id: number) {
    const response = await fetch(`/api/tags/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(result?.error ?? 'Could not delete tag.');
    }
    setTags((current) => current.filter((tag) => tag.id !== id));
    setTodos((current) => current.map((todo) => ({
      ...todo,
      tags: todo.tags.filter((tag) => tag.id !== id),
    })));
    setFilters((current) => current.tagId === id ? { ...current, tagId: 'all' } : current);
    setSelectedTagIds((current) => current.filter((tagId) => tagId !== id));
  }

  function toggleTagSelection(tag: Tag, selected: number[], onChange: (ids: number[]) => void) {
    onChange(
      selected.includes(tag.id)
        ? selected.filter((id) => id !== tag.id)
        : [...selected, tag.id],
    );
  }

  function changeSearch(value: string) {
    setFilters((current) => ({ ...current, search: value }));
    if (!value) setDebouncedSearch('');
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTER_STATE);
    setDebouncedSearch('');
    setPresetNotice(null);
  }

  function applyPreset(preset: FilterPreset) {
    const missingTag = preset.filters.tagId !== 'all' &&
      !tags.some((tag) => tag.id === preset.filters.tagId);
    const next = { ...preset.filters, tagId: missingTag ? 'all' as const : preset.filters.tagId };
    setFilters(next);
    setDebouncedSearch(next.search);
    setPresetNotice(missingTag ? 'The saved tag no longer exists; showing all tags.' : null);
  }

  function saveFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = presetName.trim();
    if (!name) {
      setPresetError('Enter a name for this filter.');
      return;
    }
    try {
      const preset: FilterPreset = {
        id: crypto.randomUUID(), name, filters: { ...filters },
        createdAt: getSingaporeNow().toISOString(),
      };
      const next = [...presets, preset];
      writePresets(next);
      setPresets(next);
      setPresetName('');
      setShowSavePreset(false);
      setAdvancedOpen(true);
      setPresetError(null);
    } catch (saveError) {
      console.error('Failed to save filter preset:', saveError);
      setPresetError(saveError instanceof DOMException && saveError.name === 'QuotaExceededError'
        ? 'Could not save preset — storage full.' : 'Could not save preset.');
    }
  }

  function deleteFilterPreset(preset: FilterPreset) {
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
    try {
      const next = presets.filter((item) => item.id !== preset.id);
      writePresets(next);
      setPresets(next);
      setPresetError(null);
    } catch (deleteError) {
      console.error('Failed to delete filter preset:', deleteError);
      setPresetError('Could not delete preset.');
    }
  }

  const filterPreview = [
    filters.search.trim() && `Search: "${filters.search.trim()}"`,
    filters.priority !== 'all' && `Priority: ${filters.priority}`,
    filters.tagId !== 'all' && `Tag: ${tags.find((tag) => tag.id === filters.tagId)?.name ?? 'Unknown'}`,
    filters.completion !== 'all' && `Completion: ${filters.completion}`,
    (filters.dueDateFrom || filters.dueDateTo) &&
      `Date: ${filters.dueDateFrom ?? 'Any'} to ${filters.dueDateTo ?? 'Any'}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
          Stay focused
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">My todos</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Capture tasks, set priorities, and keep your next steps clear.
        </p>
      </header>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      <form onSubmit={handleAdd} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <label className="sr-only" htmlFor="new-todo-title">Todo title</label>
        <input
          id="new-todo-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs to get done?"
          className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
          maxLength={500}
        />
        <label className="sr-only" htmlFor="new-todo-due-date">Due date and time</label>
        <input
          id="new-todo-due-date"
          type="datetime-local"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
        <label className="sr-only" htmlFor="new-todo-priority">Priority</label>
        <select
          id="new-todo-priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Add
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Tags</span>
          {tags.map((tag) => (
            <TagPill
              key={tag.id}
              tag={tag}
              selected={selectedTagIds.includes(tag.id)}
              onClick={(selectedTag) => toggleTagSelection(
                selectedTag,
                selectedTagIds,
                setSelectedTagIds,
              )}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowManageTags(true)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-slate-800"
        >
          + Manage Tags
        </button>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <label htmlFor="todo-search" className="sr-only">Search todos and subtasks</label>
          <input
            id="todo-search"
            type="search"
            value={filters.search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="Search todos and subtasks..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-12 dark:border-slate-700 dark:bg-slate-900"
          />
          {filters.search && (
            <button type="button" aria-label="Clear search" onClick={() => changeSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 dark:text-slate-300">
              ✕
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Your list</h2>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            Priority
            <select
              id="priority-filter"
              value={priorityFilter}
              onChange={(event) => setFilters((current) => ({
                ...current, priority: event.target.value as FilterState['priority'],
              }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">All Priorities</option>
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            Tag
            <select
              aria-label="All Tags"
              value={tagFilter}
              onChange={(event) => setFilters((current) => ({
                ...current, tagId: event.target.value === 'all' ? 'all' : Number(event.target.value),
              }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">All Tags</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>
        </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" aria-expanded={advancedOpen} aria-controls="advanced-filters"
            onClick={() => setAdvancedOpen((open) => !open)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${advancedOpen
              ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100'}`}>
            {advancedOpen ? '▼ Advanced' : '▶ Advanced'}
          </button>
          {hasActiveFilters(filters) && (
            <>
              <button type="button" onClick={clearFilters} className="text-sm font-medium text-red-700 dark:text-red-300">Clear All</button>
              <button type="button" onClick={() => { setPresetError(null); setShowSavePreset(true); }}
                className="text-sm font-medium text-green-700 dark:text-green-300">Save Filter</button>
            </>
          )}
        </div>
        {presetError && !showSavePreset && <ErrorMessage>{presetError}</ErrorMessage>}
        {presetNotice && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{presetNotice}</p>}
        {advancedOpen && (
          <div id="advanced-filters" className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex flex-wrap gap-4">
              <label className="space-y-1 text-sm">
                <span className="block">Completion Status</span>
                <select value={filters.completion} onChange={(event) => setFilters((current) => ({
                  ...current, completion: event.target.value as FilterState['completion'],
                }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                  <option value="all">All Todos</option>
                  <option value="incomplete">Incomplete Only</option>
                  <option value="completed">Completed Only</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block">Due Date From</span>
                <input type="date" value={filters.dueDateFrom ?? ''} onChange={(event) => setFilters((current) => ({
                  ...current, dueDateFrom: event.target.value || null,
                }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block">Due Date To</span>
                <input type="date" value={filters.dueDateTo ?? ''} onChange={(event) => setFilters((current) => ({
                  ...current, dueDateTo: event.target.value || null,
                }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </label>
            </div>
            {filters.dueDateFrom && filters.dueDateTo && filters.dueDateFrom > filters.dueDateTo && (
              <p className="text-sm text-amber-700 dark:text-amber-300">From date is after To date.</p>
            )}
            {presets.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Saved filters</span>
                {presets.map((preset) => (
                  <span key={preset.id} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-sm dark:border-slate-600">
                    <button type="button" onClick={() => applyPreset(preset)}>{preset.name}</button>
                    <button type="button" aria-label={`Delete preset ${preset.name}`} onClick={() => deleteFilterPreset(preset)}
                      className="text-red-700 dark:text-red-300">✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500" role="status">Loading todos…</p>
      ) : error?.includes('sign in') ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          Sign-in is required. The authentication interface is managed by PRP 11.
        </div>
      ) : todos.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-300">You have no todos yet.</p>
      ) : visibleTodos.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-300">No todos match your filters.</p>
      ) : (
        <div className="space-y-8">
          <TodoSection title="Overdue" todos={sections.overdue} onToggle={handleToggle} onEdit={openEditor} onDelete={handleDelete} onTagClick={(tag) => setFilters((current) => ({ ...current, tagId: tag.id }))} />
          <TodoSection title="Pending" todos={sections.pending} onToggle={handleToggle} onEdit={openEditor} onDelete={handleDelete} onTagClick={(tag) => setFilters((current) => ({ ...current, tagId: tag.id }))} />
          <TodoSection title="Completed" todos={sections.completed} onToggle={handleToggle} onEdit={openEditor} onDelete={handleDelete} onTagClick={(tag) => setFilters((current) => ({ ...current, tagId: tag.id }))} />
        </div>
      )}

      {showSavePreset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setShowSavePreset(false)}>
          <form role="dialog" aria-modal="true" aria-labelledby="save-filter-heading" onSubmit={saveFilter}
            onClick={(event) => event.stopPropagation()} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h2 id="save-filter-heading" className="text-xl font-semibold">Save Filter</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">{filterPreview}</p>
            {presetError && <ErrorMessage>{presetError}</ErrorMessage>}
            <label className="block space-y-1 text-sm font-medium">
              Filter name
              <input autoFocus value={presetName} onChange={(event) => setPresetName(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowSavePreset(false)} className="rounded-lg border border-slate-300 px-4 py-2 dark:border-slate-700">Cancel</button>
              <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">Save</button>
            </div>
          </form>
        </div>
      )}

      {editingTodo && draft && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-slate-950/60 p-4"
          onClick={() => setEditingTodo(null)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-todo-heading"
            onSubmit={handleUpdate}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
          >
            <div>
              <h2 id="edit-todo-heading" className="text-xl font-semibold">Edit todo</h2>
              <p className="mt-1 text-sm text-slate-500">Changes are saved to your list.</p>
            </div>
            <label className="block space-y-1 text-sm font-medium">
              Title
              <input
                autoFocus
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              Due date and time
              <input
                type="datetime-local"
                value={draft.due_date ?? ''}
                onChange={(event) => setDraft({ ...draft, due_date: event.target.value || null })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              Priority
              <select
                value={draft.priority}
                onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>
                ))}
              </select>
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Tags</legend>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <TagPill
                    key={tag.id}
                    tag={tag}
                    selected={draft.tag_ids.includes(tag.id)}
                    onClick={(selectedTag) => setDraft({
                      ...draft,
                      tag_ids: draft.tag_ids.includes(selectedTag.id)
                        ? draft.tag_ids.filter((id) => id !== selectedTag.id)
                        : [...draft.tag_ids, selectedTag.id],
                    })}
                  />
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditingTodo(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                Update
              </button>
            </div>
          </form>
        </div>
      )}
      {showManageTags && (
        <ManageTagsModal
          tags={tags}
          onClose={() => setShowManageTags(false)}
          onCreate={createTag}
          onUpdate={updateTag}
          onDelete={deleteTag}
        />
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <AuthenticatedShell>
      <TodoDashboard />
    </AuthenticatedShell>
  );
}
