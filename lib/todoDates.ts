import { getSingaporeNow, parseSingaporeDateTime } from './timezone.ts';

export const MINIMUM_DUE_DATE_LEAD_TIME_MS = 60_000;

function parseOptionalDueDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  const parsed = parseSingaporeDateTime(value);
  if (parsed === null) {
    throw new RangeError('Todo due_date must be a valid ISO date-time');
  }

  return parsed;
}

function getTimestamp(date: Date): number {
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new RangeError('Current time must be a valid date');
  }
  return timestamp;
}

export function isDueDateAtLeastOneMinuteAhead(
  value: unknown,
  now: Date = getSingaporeNow(),
): boolean {
  const nowTimestamp = getTimestamp(now);
  const dueDate = parseSingaporeDateTime(value);
  return (
    dueDate !== null &&
    dueDate.getTime() >= nowTimestamp + MINIMUM_DUE_DATE_LEAD_TIME_MS
  );
}

export function isTodoOverdue(
  dueDate: unknown,
  completed: boolean,
  now: Date = getSingaporeNow(),
): boolean {
  if (completed) return false;

  const parsedDueDate = parseOptionalDueDate(dueDate);
  return parsedDueDate !== null && parsedDueDate.getTime() < getTimestamp(now);
}

export function compareTodoDueDates(
  firstDueDate: unknown,
  secondDueDate: unknown,
): number {
  const first = parseOptionalDueDate(firstDueDate);
  const second = parseOptionalDueDate(secondDueDate);

  if (first === null && second === null) return 0;
  if (first === null) return 1;
  if (second === null) return -1;

  return first.getTime() - second.getTime();
}
