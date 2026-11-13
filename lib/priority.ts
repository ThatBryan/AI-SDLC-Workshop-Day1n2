export type Priority = 'high' | 'medium' | 'low';

export const PRIORITY_VALUES: Priority[] = ['high', 'medium', 'low'];

export const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function validatePriority(value: unknown): Priority {
  if (value === undefined || value === null) return 'medium';
  if (value === 'high' || value === 'medium' || value === 'low') return value;

  throw new RangeError(
    `Invalid priority: ${String(value)}. Must be 'high', 'medium', or 'low'.`,
  );
}
