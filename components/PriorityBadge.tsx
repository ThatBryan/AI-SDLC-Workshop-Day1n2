import type { CSSProperties } from 'react';
import type { Priority } from '@/lib/priority';

const PRIORITY_BADGE: Record<
  Priority,
  { label: string; color: string; text: string; darkText: string }
> = {
  high: {
    label: 'High',
    color: '#EF4444',
    text: '#991B1B',
    darkText: '#FECACA',
  },
  medium: {
    label: 'Medium',
    color: '#F59E0B',
    text: '#854D0E',
    darkText: '#FDE68A',
  },
  low: {
    label: 'Low',
    color: '#3B82F6',
    text: '#1E40AF',
    darkText: '#BFDBFE',
  },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const badge = PRIORITY_BADGE[priority];
  const style = {
    '--priority-color': badge.color,
    '--priority-text': badge.text,
    '--priority-dark-text': badge.darkText,
  } as CSSProperties;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--priority-color)]/40 bg-[var(--priority-color)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--priority-text)] dark:text-[var(--priority-dark-text)]"
      style={style}
      aria-label={`${badge.label} priority`}
    >
      <span className="size-2 rounded-full bg-[var(--priority-color)]" aria-hidden="true" />
      {badge.label}
    </span>
  );
}
