import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '../lib/db';
import { applyFilters, DEFAULT_FILTER_STATE, hasActiveFilters, type FilterState } from '../lib/filters';
import { loadPresets, PRESETS_KEY, writePresets, type FilterPreset } from '../lib/filterPresets';

function todo(id: number, patch: Partial<Todo> = {}): Todo {
  return {
    id, user_id: 1, title: 'Team meeting', completed: false, due_date: null,
    priority: 'medium', is_recurring: false, recurrence_pattern: null,
    reminder_minutes: null, last_notification_sent: null, created_at: '2026-01-01T00:00:00Z',
    updated_at: null, subtasks: [], tags: [], ...patch,
  };
}

const tag = { id: 1, user_id: 1, name: 'Work', color: '#000000', created_at: '2026-01-01T00:00:00Z' };
const fixtures = [
  todo(1, { title: 'Team meeting', priority: 'high', tags: [tag], due_date: '2026-11-01T16:30:00Z' }),
  todo(2, { title: 'Shopping', subtasks: [{ id: 1, todo_id: 2, title: 'MEETING notes', completed: false, position: 0, created_at: '' }], completed: true, priority: 'low', due_date: '2026-11-03T00:00:00Z' }),
  todo(3, { title: 'Other', priority: 'medium' }),
];
const filter = (patch: Partial<FilterState>) => applyFilters(fixtures, { ...DEFAULT_FILTER_STATE, ...patch }).map((item) => item.id);

describe('client-side filters', () => {
  it('searches title and subtask titles case-insensitively and trims whitespace', () => {
    expect(filter({ search: ' MEETING ' })).toEqual([1, 2]);
    expect(filter({ search: 'notes' })).toEqual([2]);
    expect(filter({ search: 'absent' })).toEqual([]);
    expect(filter({ search: '  ' })).toEqual([1, 2, 3]);
    expect(applyFilters([todo(4, { title: 'CAFÉ review' })], {
      ...DEFAULT_FILTER_STATE, search: 'café',
    }).map((item) => item.id)).toEqual([4]);
  });
  it('applies each priority, tag and completion condition', () => {
    expect(filter({ priority: 'high' })).toEqual([1]);
    expect(filter({ priority: 'low' })).toEqual([2]);
    expect(filter({ priority: 'medium' })).toEqual([3]);
    expect(filter({ priority: 'all' })).toEqual([1, 2, 3]);
    expect(filter({ tagId: 1 })).toEqual([1]);
    expect(filter({ tagId: 2 })).toEqual([]);
    expect(filter({ tagId: 'all' })).toEqual([1, 2, 3]);
    expect(filter({ completion: 'completed' })).toEqual([2]);
    expect(filter({ completion: 'incomplete' })).toEqual([1, 3]);
    expect(filter({ completion: 'all' })).toEqual([1, 2, 3]);
  });
  it('filters inclusive Singapore calendar dates, independently and together', () => {
    expect(filter({ dueDateFrom: '2026-11-02' })).toEqual([1, 2]);
    expect(filter({ dueDateTo: '2026-11-02' })).toEqual([1]);
    expect(filter({ dueDateFrom: '2026-11-02', dueDateTo: '2026-11-02' })).toEqual([1]);
    expect(filter({ dueDateFrom: '2026-11-03', dueDateTo: '2026-11-02' })).toEqual([]);
  });
  it('uses Singapore midnight for inclusive open-ended and closed date bounds', () => {
    const boundaryTodos = [
      todo(10, { due_date: '2026-11-01T15:59:59Z' }),
      todo(11, { due_date: '2026-11-01T16:00:00Z' }),
      todo(12, { due_date: '2026-11-02T15:59:59Z' }),
      todo(13, { due_date: '2026-11-02T16:00:00Z' }),
      todo(14),
    ];
    const apply = (patch: Partial<FilterState>) =>
      applyFilters(boundaryTodos, { ...DEFAULT_FILTER_STATE, ...patch })
        .map(({ id }) => id);

    expect(apply({ dueDateFrom: '2026-11-02' })).toEqual([11, 12, 13]);
    expect(apply({ dueDateTo: '2026-11-02' })).toEqual([10, 11, 12]);
    expect(apply({ dueDateFrom: '2026-11-02', dueDateTo: '2026-11-02' }))
      .toEqual([11, 12]);
    expect(apply({ dueDateFrom: '2026-11-03', dueDateTo: '2026-11-02' })).toEqual([]);
  });
  it('combines all conditions with AND', () => {
    expect(filter({ search: 'meeting', priority: 'high', tagId: 1, completion: 'incomplete',
      dueDateFrom: '2026-11-02', dueDateTo: '2026-11-02' })).toEqual([1]);
    expect(filter({ search: 'meeting', priority: 'high', tagId: 1, completion: 'completed' })).toEqual([]);
  });
  it('detects active dimensions without treating whitespace as active', () => {
    expect(hasActiveFilters(DEFAULT_FILTER_STATE)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTER_STATE, search: ' ' })).toBe(false);
    for (const value of [
      { search: 'x' }, { priority: 'low' }, { tagId: 1 }, { completion: 'completed' },
      { dueDateFrom: '2026-01-01' }, { dueDateTo: '2026-01-01' },
    ] satisfies Partial<FilterState>[]) {
      expect(hasActiveFilters({ ...DEFAULT_FILTER_STATE, ...value })).toBe(true);
    }
  });
  it('filters 1,000 dated todos in under 100ms', () => {
    const items = Array.from({ length: 1000 }, (_, index) =>
      todo(index, { due_date: '2026-11-01T16:30:00Z' }));
    const start = performance.now();
    const result = applyFilters(items, { ...DEFAULT_FILTER_STATE, dueDateFrom: '2026-11-02' });
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(1000);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('filter preset storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('round-trips all fields and deletes a preset', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    const preset: FilterPreset = { id: 'one', name: 'Work', createdAt: '2026-11-01T00:00:00.000Z',
      filters: { search: 'x', priority: 'high', tagId: 1, completion: 'completed',
        dueDateFrom: '2026-11-01', dueDateTo: '2026-11-02' } };
    writePresets([preset]);
    expect(data.has(PRESETS_KEY)).toBe(true);
    expect(loadPresets()).toEqual([preset]);
    writePresets([]);
    expect(loadPresets()).toEqual([]);
  });
  it('reports load failures and returns no presets, while write failures propagate', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => '{', setItem: () => { throw new Error('quota'); } });
    expect(loadPresets(onError)).toEqual([]);
    expect(onError).toHaveBeenCalledOnce();
    expect(() => writePresets([])).toThrow('quota');
    vi.stubGlobal('localStorage', { getItem: () => '[{"filters":{}}]' });
    expect(loadPresets(onError)).toEqual([]);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage unavailable'); } });
    expect(loadPresets(onError)).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(3);
  });
});
