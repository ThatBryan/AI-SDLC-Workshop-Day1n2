import { formatSingaporeDate, getSingaporeNow } from './timezone.ts';

export interface CalendarDay {
  date: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
}

function formatUtcDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeUtcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function generateCalendarGrid(
  year: number,
  month: number,
  now: Date = getSingaporeNow(),
): CalendarDay[] {
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new RangeError('Calendar year must be 1–9999 and month must be 1–12');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError('Calendar reference time must be a valid date');
  }

  const firstOfMonth = makeUtcDate(year, month, 1);
  const startWeekday = firstOfMonth.getUTCDay();
  const daysInMonth = makeUtcDate(year, month + 1, 0).getUTCDate();
  const today = formatSingaporeDate(now);
  const cells: CalendarDay[] = [];

  for (let index = 0; index < 42; index += 1) {
    const dayOffset = index - startWeekday + 1;
    const cellDate = makeUtcDate(year, month, dayOffset);
    const date = formatUtcDate(cellDate);
    const weekday = cellDate.getUTCDay();

    cells.push({
      date,
      isCurrentMonth: dayOffset >= 1 && dayOffset <= daysInMonth,
      isToday: date === today,
      isPast: date < today,
      isWeekend: weekday === 0 || weekday === 6,
    });
  }

  return cells;
}
