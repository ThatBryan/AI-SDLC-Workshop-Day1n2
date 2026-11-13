import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB, type CreateTagInput } from '@/lib/db';
import { isRecord } from '@/lib/todoValidation';

function parseCreateInput(body: Record<string, unknown>): CreateTagInput {
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw new RangeError('Tag name is required');
  }
  if (Object.hasOwn(body, 'color') &&
      (typeof body.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(body.color))) {
    throw new RangeError('Color must be a valid hex code');
  }
  return {
    name: body.name.trim(),
    color: typeof body.color === 'string' ? body.color.toUpperCase() : undefined,
  };
}

function isUniqueTagNameError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json(tagDB.findAllByUser(session.userId));
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

  let input: CreateTagInput;
  try {
    input = parseCreateInput(body);
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    return NextResponse.json(tagDB.create(session.userId, input), { status: 201 });
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
