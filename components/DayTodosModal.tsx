'use client';

import { useEffect } from 'react';
import type { Holiday, Todo } from '@/lib/db';
import { PriorityBadge } from '@/components/PriorityBadge';

export function DayTodosModal({
  date,
  todos,
  holiday,
  onClose,
}: {
  date: string;
  todos: Todo[];
  holiday?: Holiday;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/60 p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-day-heading"
        className="max-h-[85vh] w-full max-w-xl space-y-4 overflow-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="calendar-day-heading" className="text-xl font-semibold">{date}</h2>
            {holiday && <p className="mt-1 text-sm font-medium text-purple-800 dark:text-purple-200">{holiday.name}</p>}
          </div>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </header>
        {todos.length === 0 ? (
          <p className="muted">No todos due on this day.</p>
        ) : (
          <ul className="space-y-2">
            {todos.map((todo) => (
              <li key={todo.id} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="min-w-0">
                  <p className={todo.completed ? 'break-words line-through opacity-60' : 'break-words'}>{todo.title}</p>
                  <label className="mt-1 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={todo.completed} disabled readOnly />
                    {todo.completed ? 'Completed' : 'Incomplete'}
                  </label>
                </div>
                <PriorityBadge priority={todo.priority} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
