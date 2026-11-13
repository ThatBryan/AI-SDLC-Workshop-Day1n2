import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB, type UpdateTodoInput, type RecurrencePattern } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';
import { validatePriority } from '@/lib/priority';
import { isRecord, normalizeDueDate, validateTodoTitle } from '@/lib/todoValidation';

type RouteContext = { params: Promise<{ id: string }> };
const RECURRENCE_PATTERNS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const REMINDER_MINUTES = [15, 30, 60, 120, 1440, 2880, 10080] as const;

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function parseTagIds(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)
  ) {
    throw new RangeError('tag_ids must be an array of positive integer IDs');
  }
  return [...new Set(value as number[])];
}

function parseUpdateInput(body: Record<string, unknown>): UpdateTodoInput {
  const input: UpdateTodoInput = {};
  const now = getSingaporeNow();

  if (Object.hasOwn(body, 'title')) {
    const title = validateTodoTitle(body.title);
    if (!title) throw new RangeError('Title cannot be empty');
    input.title = title;
  }
  if (Object.hasOwn(body, 'due_date')) {
    input.due_date = normalizeDueDate(body.due_date, now);
  }
  if (Object.hasOwn(body, 'priority')) {
    if (body.priority === null) {
      throw new RangeError("Invalid priority: null. Must be 'high', 'medium', or 'low'.");
    }
    input.priority = validatePriority(body.priority);
  }
  if (Object.hasOwn(body, 'completed')) {
    if (typeof body.completed !== 'boolean') {
      throw new RangeError('completed must be a boolean');
    }
    input.completed = body.completed;
  }
  if (Object.hasOwn(body, 'is_recurring')) {
    if (typeof body.is_recurring !== 'boolean') {
      throw new RangeError('is_recurring must be a boolean');
    }
    input.is_recurring = body.is_recurring;
  }
  if (Object.hasOwn(body, 'recurrence_pattern')) {
    const value = body.recurrence_pattern;
    if (
      value !== null &&
      !RECURRENCE_PATTERNS.includes(value as (typeof RECURRENCE_PATTERNS)[number])
    ) {
      throw new RangeError('recurrence_pattern is invalid');
    }
    input.recurrence_pattern = value as RecurrencePattern | null;
  }
  if (Object.hasOwn(body, 'reminder_minutes')) {
    const value = body.reminder_minutes;
    if (
      value !== null &&
      !REMINDER_MINUTES.includes(value as (typeof REMINDER_MINUTES)[number])
    ) {
      throw new RangeError('reminder_minutes is invalid');
    }
    input.reminder_minutes = value as UpdateTodoInput['reminder_minutes'];
  }
  if (Object.hasOwn(body, 'tag_ids')) {
    input.tag_ids = parseTagIds(body.tag_ids);
  }
  return input;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseId(rawId);
  const todo = id === null ? undefined : todoDB.findByIdForUser(id, session.userId);
  if (!todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  return NextResponse.json(todo);
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null || !todoDB.findByIdForUser(id, session.userId)) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
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
    const updated = todoDB.updateForUser(
      id,
      session.userId,
      parseUpdateInput(body),
      getSingaporeNow().toISOString(),
    );
    if (!updated) return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null || !todoDB.deleteForUser(id, session.userId)) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
