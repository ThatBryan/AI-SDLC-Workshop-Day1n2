'use client';

import type { Holiday, Todo } from '@/lib/db';
import type { CalendarDay } from '@/lib/calendar';
import { PriorityBadge } from '@/components/PriorityBadge';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_TODOS = 3;

function monthLabel(year: number, month: number): string {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 15);
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function TodoPill({ todo }: { todo: Todo }) {
  const colors = {
    high: 'border-red-300 bg-red-100 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100',
    medium: 'border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100',
    low: 'border-blue-300 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100',
  } as const;

  return (
    <span
      className={`block truncate rounded border px-1.5 py-0.5 text-left text-xs ${colors[todo.priority]} ${todo.completed ? 'opacity-60 line-through' : ''}`}
      title={todo.title}
    >
      {todo.title}
    </span>
  );
}

function CalendarCell({
  day,
  todos,
  holiday,
  onSelect,
}: {
  day: CalendarDay;
  todos: Todo[];
  holiday?: Holiday;
  onSelect: (date: string) => void;
}) {
  const visibleTodos = todos.slice(0, MAX_VISIBLE_TODOS);
  const overflow = todos.length - visibleTodos.length;
  const classes = [
    'flex min-h-32 w-full flex-col items-stretch justify-start gap-1 overflow-hidden rounded-none border p-2 text-left font-normal',
    'border-slate-200 text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800',
    !day.isCurrentMonth ? 'bg-slate-100 dark:bg-slate-950' : day.isWeekend ? 'bg-slate-50 dark:bg-slate-950' : 'bg-white dark:bg-slate-900',
    day.isPast ? 'opacity-65' : '',
    !day.isCurrentMonth ? 'text-slate-500 dark:text-slate-500' : '',
    day.isToday ? 'relative z-[1] outline outline-2 outline-indigo-600 outline-offset-[-2px]' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      role="gridcell"
      aria-label={`${day.date}${day.isToday ? ', today' : ''}${holiday ? `, holiday: ${holiday.name}` : ''}`}
      className={classes}
      onClick={() => onSelect(day.date)}
    >
      <span className="self-end text-sm font-semibold">{Number(day.date.slice(-2))}</span>
      {holiday && (
        <span className="block truncate rounded bg-purple-100 px-1.5 py-0.5 text-left text-xs font-medium text-purple-950 dark:bg-purple-950 dark:text-purple-100" title={holiday.name}>
          {holiday.name}
        </span>
      )}
      {visibleTodos.map((todo) => <TodoPill key={todo.id} todo={todo} />)}
      {overflow > 0 && (
        <span className="px-1.5 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
          +{overflow} more
        </span>
      )}
    </button>
  );
}

export function CalendarGrid({
  year,
  month,
  days,
  todosByDate,
  holidaysByDate,
  onSelectDay,
  onNavigate,
}: {
  year: number;
  month: number;
  days: CalendarDay[];
  todosByDate: Map<string, Todo[]>;
  holidaysByDate: Map<string, Holiday>;
  onSelectDay: (date: string) => void;
  onNavigate: (year: number, month: number) => void;
}) {
  const weeks = Array.from({ length: 6 }, (_, index) =>
    days.slice(index * 7, index * 7 + 7),
  );

  return (
    <section className="space-y-4" aria-label="Monthly calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold" aria-live="polite">
          {monthLabel(year, month)}
        </h1>
        <div className="flex gap-2">
          <button type="button" className="secondary" aria-label="Previous month" onClick={() => onNavigate(year, month - 1)}>
            Previous
          </button>
          <button type="button" className="secondary" onClick={() => onNavigate(0, 0)}>
            Today
          </button>
          <button type="button" className="secondary" aria-label="Next month" onClick={() => onNavigate(year, month + 1)}>
            Next
          </button>
        </div>
      </div>
      <div role="grid" aria-label={monthLabel(year, month)} className="grid grid-cols-7 overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700">
        <div role="row" className="contents">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} role="columnheader" className="border-b border-slate-300 bg-slate-100 p-2 text-center text-sm font-semibold dark:border-slate-700 dark:bg-slate-800">
              {weekday}
            </div>
          ))}
        </div>
        {weeks.map((week, index) => (
          <div key={index} role="row" className="contents">
            {week.map((day) => (
              <CalendarCell
                key={day.date}
                day={day}
                todos={todosByDate.get(day.date) ?? []}
                holiday={holidaysByDate.get(day.date)}
                onSelect={onSelectDay}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-sm" aria-label="Priority legend">
        <span className="flex items-center gap-2"><PriorityBadge priority="high" /></span>
        <span className="flex items-center gap-2"><PriorityBadge priority="medium" /></span>
        <span className="flex items-center gap-2"><PriorityBadge priority="low" /></span>
        <span className="rounded bg-purple-100 px-2 py-1 text-purple-950 dark:bg-purple-950 dark:text-purple-100">Singapore public holiday</span>
      </div>
    </section>
  );
}
