import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB, type UpdateTagInput } from '@/lib/db';
import { isRecord } from '@/lib/todoValidation';

type RouteContext = { params: Promise<{ id: string }> };

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function parseUpdateInput(body: Record<string, unknown>): UpdateTagInput {
  const input: UpdateTagInput = {};
  if (Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      throw new RangeError('Tag name is required');
    }
    input.name = body.name.trim();
  }
  if (Object.hasOwn(body, 'color')) {
    if (typeof body.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      throw new RangeError('Color must be a valid hex code');
    }
    input.color = body.color.toUpperCase();
  }
  if (Object.keys(input).length === 0) {
    throw new RangeError('At least one tag field is required');
  }
  return input;
}

function isUniqueTagNameError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export async function PUT(
  request: NextRequest,
  { params }: RouteContext,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json({ error: 'Invalid tag ID' }, { status: 400 });
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

  let input: UpdateTagInput;
  try {
    input = parseUpdateInput(body);
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const tag = tagDB.update(id, session.userId, input);
    if (!tag) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    return NextResponse.json(tag);
  } catch (error) {
    if (isUniqueTagNameError(error)) {
      return NextResponse.json(
        { error: 'A tag with this name already exists' },
        { status: 409 },
      );
    }
    throw error;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json({ error: 'Invalid tag ID' }, { status: 400 });
  }
  if (!tagDB.delete(id, session.userId)) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
