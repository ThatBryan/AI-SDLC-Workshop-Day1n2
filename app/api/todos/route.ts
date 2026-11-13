import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB, type CreateTodoInput, type RecurrencePattern } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';
import { validatePriority, type Priority } from '@/lib/priority';
import { isRecord, normalizeDueDate, validateTodoTitle } from '@/lib/todoValidation';

const RECURRENCE_PATTERNS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const REMINDER_MINUTES = [15, 30, 60, 120, 1440, 2880, 10080] as const;

function parseTagIds(value: unknown): number[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)
  ) {
    throw new RangeError('tag_ids must be an array of positive integer IDs');
  }
  return [...new Set(value as number[])];
}

function parseCreateInput(body: Record<string, unknown>, userId: number): CreateTodoInput {
  const title = validateTodoTitle(body.title);
  if (!title) throw new RangeError('Title is required');

  const priority = validatePriority(body.priority);
  const dueDate = normalizeDueDate(body.due_date, getSingaporeNow());
  const isRecurring = body.is_recurring ?? false;
  if (typeof isRecurring !== 'boolean') {
    throw new RangeError('is_recurring must be a boolean');
  }

  const recurrencePattern = body.recurrence_pattern ?? null;
  if (
    recurrencePattern !== null &&
    !RECURRENCE_PATTERNS.includes(recurrencePattern as (typeof RECURRENCE_PATTERNS)[number])
  ) {
    throw new RangeError('recurrence_pattern is invalid');
  }

  const reminderMinutes = body.reminder_minutes ?? null;
  if (
    reminderMinutes !== null &&
    !REMINDER_MINUTES.includes(reminderMinutes as (typeof REMINDER_MINUTES)[number])
  ) {
    throw new RangeError('reminder_minutes is invalid');
  }

  return {
    user_id: userId,
    title,
    due_date: dueDate,
    priority,
    is_recurring: isRecurring,
    recurrence_pattern: recurrencePattern as RecurrencePattern | null,
    reminder_minutes: reminderMinutes as CreateTodoInput['reminder_minutes'],
    tag_ids: parseTagIds(body.tag_ids),
  };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  try {
    const todo = todoDB.create(parseCreateInput(body, session.userId));
    return NextResponse.json(todo, { status: 201 });
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const priorityValue = request.nextUrl.searchParams.get('priority');
  let priority: Priority | undefined;
  if (priorityValue !== null) {
    try {
      priority = validatePriority(priorityValue);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }
  return NextResponse.json(todoDB.findAllByUser(session.userId, priority));
}
