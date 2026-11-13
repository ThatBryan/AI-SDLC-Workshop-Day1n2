import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB, todoDB } from '@/lib/db';
import { isRecord } from '@/lib/todoValidation';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

async function parseTagId(request: NextRequest): Promise<number> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new RangeError('Request body must be valid JSON');
  }
  if (!isRecord(body) || !Number.isSafeInteger(body.tag_id) || Number(body.tag_id) <= 0) {
    throw new RangeError('tag_id must be a positive integer');
  }
  return Number(body.tag_id);
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const todoId = parseId(rawId);
  if (todoId === null) {
    return NextResponse.json({ error: 'Invalid todo ID' }, { status: 400 });
  }

  let tagId: number;
  try {
    tagId = await parseTagId(request);
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if (!todoDB.findByIdForUser(todoId, session.userId) ||
      !tagDB.findById(tagId, session.userId)) {
    return NextResponse.json({ error: 'Todo or tag not found' }, { status: 404 });
  }
  tagDB.attachToTodo(todoId, tagId, session.userId);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const todoId = parseId(rawId);
  if (todoId === null) {
    return NextResponse.json({ error: 'Invalid todo ID' }, { status: 400 });
  }

  let tagId: number;
  try {
    tagId = await parseTagId(request);
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if (!todoDB.findByIdForUser(todoId, session.userId) ||
      !tagDB.findById(tagId, session.userId)) {
    return NextResponse.json({ error: 'Todo or tag not found' }, { status: 404 });
  }
  tagDB.detachFromTodo(todoId, tagId, session.userId);
  return NextResponse.json({ success: true });
}
