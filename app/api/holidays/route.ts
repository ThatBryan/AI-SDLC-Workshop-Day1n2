import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { holidayDB } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const yearParam = request.nextUrl.searchParams.get('year');
  const monthParam = request.nextUrl.searchParams.get('month');
  if (yearParam === null && monthParam === null) {
    return NextResponse.json({ holidays: holidayDB.findAll() });
  }

  if (
    yearParam === null ||
    monthParam === null ||
    !/^\d{4}$/.test(yearParam) ||
    !/^(?:0?[1-9]|1[0-2])$/.test(monthParam)
  ) {
    return NextResponse.json(
      { error: 'year and month must identify a valid calendar month' },
      { status: 400 },
    );
  }

  const year = Number(yearParam);
  if (year < 1 || year > 9999) {
    return NextResponse.json(
      { error: 'year and month must identify a valid calendar month' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    holidays: holidayDB.findByMonth(year, Number(monthParam)),
  });
}
