import type { Priority, Todo } from './db';
import { formatSingaporeDate, parseSingaporeDateTime } from './timezone';

export interface FilterState {
  search: string;
  priority: Priority | 'all';
  tagId: number | 'all';
  completion: 'all' | 'incomplete' | 'completed';
  dueDateFrom: string | null;
  dueDateTo: string | null;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '',
  priority: 'all',
  tagId: 'all',
  completion: 'all',
  dueDateFrom: null,
  dueDateTo: null,
};

export function hasActiveFilters(filters: FilterState): boolean {
  return filters.search.trim() !== '' || filters.priority !== 'all' ||
    filters.tagId !== 'all' || filters.completion !== 'all' ||
    filters.dueDateFrom !== null || filters.dueDateTo !== null;
}

export function applyFilters(todos: Todo[], filters: FilterState): Todo[] {
  const query = filters.search.trim().toLowerCase();
  return todos.filter((todo) => {
    if (query && !todo.title.toLowerCase().includes(query) &&
      !(todo.subtasks ?? []).some((subtask) => subtask.title.toLowerCase().includes(query))) {
      return false;
    }
    if (filters.priority !== 'all' && todo.priority !== filters.priority) return false;
    if (filters.tagId !== 'all' && !(todo.tags ?? []).some((tag) => tag.id === filters.tagId)) {
      return false;
    }
    if (filters.completion === 'incomplete' && todo.completed) return false;
    if (filters.completion === 'completed' && !todo.completed) return false;
    if (filters.dueDateFrom || filters.dueDateTo) {
      if (!todo.due_date) return false;
      const dueDate = parseSingaporeDateTime(todo.due_date);
      if (!dueDate) throw new RangeError('Todo due_date must be a valid ISO date-time');
      const date = formatSingaporeDate(dueDate);
      if (filters.dueDateFrom && date < filters.dueDateFrom) return false;
      if (filters.dueDateTo && date > filters.dueDateTo) return false;
    }
    return true;
  });
}
