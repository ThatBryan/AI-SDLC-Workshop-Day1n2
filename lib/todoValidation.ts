import { isDueDateAtLeastOneMinuteAhead } from './todoDates.ts';
import { parseSingaporeDateTime } from './timezone.ts';

export const DUE_DATE_ERROR =
  'Due date must be at least 1 minute in the future';

export function validateTodoTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length > 0 ? title : null;
}

export function normalizeDueDate(value: unknown, now: Date): string | null {
  if (value === null || value === undefined) return null;
  const parsed = parseSingaporeDateTime(value);
  if (!parsed) throw new RangeError('Due date must be a valid ISO date-time');
  if (!isDueDateAtLeastOneMinuteAhead(value, now)) {
    throw new RangeError(DUE_DATE_ERROR);
  }

  return parsed.toISOString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
