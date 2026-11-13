'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { PriorityBadge } from '@/components/PriorityBadge';
import type { Priority, Todo } from '@/lib/db';
import { getSingaporeNow, formatSingaporeDateTimeInput, parseSingaporeDateTime } from '@/lib/timezone';
import { isDueDateAtLeastOneMinuteAhead } from '@/lib/todoDates';
import { sectionTodos } from '@/lib/todoSort';
import { validateTodoTitle } from '@/lib/todoValidation';

type PriorityFilter = Priority | 'all';
type TodoDraft = { title: string; due_date: string | null; priority: Priority };

const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

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
}: {
  todo: Todo;
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
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
}: {
  title: string;
  todos: Todo[];
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {title} <span className="text-sm font-normal text-slate-500">({todos.length})</span>
      </h2>
      {todos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No todos here.
        </p>
      ) : (
        <ul className="space-y-2">
          {todos.map((todo) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function HomePage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [draft, setDraft] = useState<TodoDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clockNow, setClockNow] = useState(getSingaporeNow);
  const optimisticId = useRef(0);

  useEffect(() => {
    let active = true;
    async function loadTodos() {
      try {
        const response = await fetch('/api/todos');
        if (!response.ok) {
          if (response.status === 401) throw new Error('You must sign in to manage todos.');
          throw new Error('Could not load todos. Please try again.');
        }
        const loadedTodos = (await response.json()) as Todo[];
        if (active) {
          setTodos(loadedTodos);
          setError(null);
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

  const visibleTodos = useMemo(
    () =>
      priorityFilter === 'all'
        ? todos
        : todos.filter((todo) => todo.priority === priorityFilter),
    [priorityFilter, todos],
  );
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
      tags: [],
    };
    setTodos((current) => [...current, optimisticTodo]);
    setTitle('');
    setDueDate('');
    setPriority('medium');
    setError(null);

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          due_date: dueDate || null,
          priority,
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
    if (Object.keys(patch).length === 0) {
      setEditingTodo(null);
      return;
    }

    const original = editingTodo;
    const updatedLocally = { ...original, ...patch } as Todo;
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
          Stay focused
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">My Todos</h1>
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
        <h2 className="text-lg font-semibold">Your list</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          Priority
          <select
            id="priority-filter"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="all">All Priorities</option>
            <option value="high">High Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="low">Low Priority</option>
          </select>
        </label>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500" role="status">Loading todos…</p>
      ) : error?.includes('sign in') ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          Sign-in is required. The authentication interface is managed by PRP 11.
        </div>
      ) : (
        <div className="space-y-8">
          <TodoSection title="Overdue" todos={sections.overdue} onToggle={handleToggle} onEdit={openEditor} onDelete={handleDelete} />
          <TodoSection title="Pending" todos={sections.pending} onToggle={handleToggle} onEdit={openEditor} onDelete={handleDelete} />
          <TodoSection title="Completed" todos={sections.completed} onToggle={handleToggle} onEdit={openEditor} onDelete={handleDelete} />
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
    </main>
  );
}
