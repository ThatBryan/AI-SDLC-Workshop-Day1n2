import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { formatSingaporeDate, getSingaporeNow } from '@/lib/timezone';
import { createTodoExport, serializeTodosCsv } from '@/lib/todoExport';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const format = request.nextUrl.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ error: 'format must be json or csv' }, { status: 400 });
  }

  const now = getSingaporeNow();
  const date = formatSingaporeDate(now);
  const todos = todoDB.findAllByUser(session.userId);

  if (format === 'csv') {
    return new NextResponse(serializeTodosCsv(todos), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="todos-${date}.csv"`,
      },
    });
  }

  return new NextResponse(
    JSON.stringify(createTodoExport(todos, now), null, 2),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="todos-${date}.json"`,
      },
    },
  );
}
