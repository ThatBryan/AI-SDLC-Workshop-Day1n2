import type { Todo } from './db.ts';
import { compareTodoDueDates, isTodoOverdue } from './todoDates.ts';
import { PRIORITY_ORDER } from './priority.ts';
import { parseSingaporeDateTime } from './timezone.ts';

export type TodoSections = {
  overdue: Todo[];
  pending: Todo[];
  completed: Todo[];
};

function getTimestamp(value: string): number {
  const parsed = parseSingaporeDateTime(value);
  if (!parsed) throw new RangeError('Todo timestamps must be valid ISO date-times');
  return parsed.getTime();
}

export function compareTodos(first: Todo, second: Todo): number {
  const priorityDifference =
    PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority];
  if (priorityDifference !== 0) return priorityDifference;

  const dueDateDifference = compareTodoDueDates(first.due_date, second.due_date);
  if (dueDateDifference !== 0) return dueDateDifference;

  return getTimestamp(second.created_at) - getTimestamp(first.created_at);
}

export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort(compareTodos);
}

export function sectionTodos(todos: Todo[], now: Date): TodoSections {
  const overdue: Todo[] = [];
  const pending: Todo[] = [];
  const completed: Todo[] = [];

  for (const todo of todos) {
    if (todo.completed) {
      completed.push(todo);
    } else if (isTodoOverdue(todo.due_date, false, now)) {
      overdue.push(todo);
    } else {
      pending.push(todo);
    }
  }

  completed.sort((first, second) => {
    const firstTimestamp = getTimestamp(first.updated_at ?? first.created_at);
    const secondTimestamp = getTimestamp(second.updated_at ?? second.created_at);
    return secondTimestamp - firstTimestamp;
  });

  return {
    overdue: sortTodos(overdue),
    pending: sortTodos(pending),
    completed,
  };
}
