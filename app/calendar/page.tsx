'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarGrid } from '@/components/CalendarGrid';
import { DayTodosModal } from '@/components/DayTodosModal';
import { AuthenticatedShell } from '@/components/authenticated-shell';
import type { Holiday, Todo } from '@/lib/db';
import { generateCalendarGrid } from '@/lib/calendar';
import { formatSingaporeDate, getSingaporeNow, parseSingaporeDateTime } from '@/lib/timezone';
import { sortTodos } from '@/lib/todoSort';

type Month = { year: number; month: number };

function currentSingaporeMonth(): Month {
  const [yearText, monthText] = formatSingaporeDate(getSingaporeNow()).split('-');
  return { year: Number(yearText), month: Number(monthText) };
}

function parseMonthParam(raw: string | null): Month {
  if (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    const [year, month] = raw.split('-').map(Number);
    if (year >= 1 && year <= 9999) return { year, month };
  }
  return currentSingaporeMonth();
}

function formatMonthParam({ year, month }: Month): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function CalendarContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawMonth = searchParams.get('month');
  const { year, month } = useMemo(() => parseMonthParam(rawMonth), [rawMonth]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadCalendarData() {
      setIsLoading(true);
      setError(null);
      try {
        const [todosResponse, holidaysResponse] = await Promise.all([
          fetch('/api/todos', { cache: 'no-store', signal: controller.signal }),
          fetch(`/api/holidays?year=${year}&month=${month}`, {
            cache: 'no-store',
            signal: controller.signal,
          }),
        ]);
        if (!todosResponse.ok || !holidaysResponse.ok) {
          if (todosResponse.status === 401 || holidaysResponse.status === 401) {
            throw new Error('Your session expired. Sign in again to view the calendar.');
          }
          throw new Error('Could not load calendar data. Please try again.');
        }
        const [loadedTodos, holidayResponse] = await Promise.all([
          todosResponse.json() as Promise<Todo[]>,
          holidaysResponse.json() as Promise<{ holidays: Holiday[] }>,
        ]);
        if (!Array.isArray(loadedTodos) || !Array.isArray(holidayResponse.holidays)) {
          throw new Error('The calendar returned invalid data.');
        }
        setTodos(loadedTodos);
        setHolidays(holidayResponse.holidays);
      } catch (failure) {
        if (failure instanceof Error && failure.name === 'AbortError') return;
        setError(failure instanceof Error ? failure.message : 'Could not load calendar data.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadCalendarData();
    return () => controller.abort();
  }, [year, month]);

  const days = useMemo(() => generateCalendarGrid(year, month), [year, month]);
  const todosByDate = useMemo(() => {
    const grouped = new Map<string, Todo[]>();
    for (const todo of todos) {
      if (!todo.due_date) continue;
      const dueDate = parseSingaporeDateTime(todo.due_date);
      if (!dueDate) continue;
      const date = formatSingaporeDate(dueDate);
      const dueOnDate = grouped.get(date) ?? [];
      dueOnDate.push(todo);
      grouped.set(date, dueOnDate);
    }
    for (const [date, dueOnDate] of grouped) grouped.set(date, sortTodos(dueOnDate));
    return grouped;
  }, [todos]);
  const holidaysByDate = useMemo(
    () => new Map(holidays.map((holiday) => [holiday.date, holiday])),
    [holidays],
  );
  const selectedTodos = selectedDate ? todosByDate.get(selectedDate) ?? [] : [];
  const selectedHoliday = selectedDate ? holidaysByDate.get(selectedDate) : undefined;

  const navigate = useCallback((nextYear: number, nextMonth: number) => {
    const target = nextYear === 0 && nextMonth === 0
      ? currentSingaporeMonth()
      : nextMonth < 1
        ? { year: nextYear - 1, month: 12 }
        : nextMonth > 12
          ? { year: nextYear + 1, month: 1 }
          : { year: nextYear, month: nextMonth };
    const safeTarget = {
      year: Math.min(9999, Math.max(1, target.year)),
      month: target.month,
    };
    router.replace(`/calendar?month=${formatMonthParam(safeTarget)}`, { scroll: false });
    setSelectedDate(null);
  }, [router]);

  return (
    <AuthenticatedShell calendar>
      <div className="space-y-5">
        {error && <p role="alert" className="error">{error}</p>}
        {isLoading && <p role="status" className="muted">Loading calendar…</p>}
        {!error && (
          <CalendarGrid
            year={year}
            month={month}
            days={days}
            todosByDate={todosByDate}
            holidaysByDate={holidaysByDate}
            onSelectDay={setSelectedDate}
            onNavigate={navigate}
          />
        )}
      </div>
      {selectedDate && (
        <DayTodosModal
          date={selectedDate}
          todos={selectedTodos}
          holiday={selectedHoliday}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </AuthenticatedShell>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<p role="status" className="muted">Loading calendar…</p>}>
      <CalendarContent />
    </Suspense>
  );
}
