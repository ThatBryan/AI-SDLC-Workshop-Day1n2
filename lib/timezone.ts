const SINGAPORE_TIME_ZONE = 'Asia/Singapore';

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const singaporeDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SINGAPORE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getSingaporeDateTimeParts(date: Date): DateTimeParts {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Cannot format an invalid date');
  }

  const parts = singaporeDateTimeFormatter.formatToParts(date);
  const getPart = (type: keyof DateTimeParts): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) {
      throw new RangeError(`Missing ${type} in Singapore date-time parts`);
    }
    return Number(value);
  };

  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
    second: getPart('second'),
  };
}

function utcTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1];
}

function singaporeWallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date {
  const wallTimeAsUtc = utcTimestamp(
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  let timestamp = wallTimeAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = new Date(timestamp);
    const parts = getSingaporeDateTimeParts(candidate);
    const candidateWallTimeAsUtc =
      utcTimestamp(
        parts.year,
        parts.month,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
        0,
      ) + candidate.getUTCMilliseconds();
    const offset = candidateWallTimeAsUtc - timestamp;
    const nextTimestamp = wallTimeAsUtc - offset;

    if (nextTimestamp === timestamp) break;
    timestamp = nextTimestamp;
  }

  const result = new Date(timestamp);
  const resultParts = getSingaporeDateTimeParts(result);
  if (
    resultParts.year !== year ||
    resultParts.month !== month ||
    resultParts.day !== day ||
    resultParts.hour !== hour ||
    resultParts.minute !== minute ||
    resultParts.second !== second ||
    result.getUTCMilliseconds() !== millisecond
  ) {
    return new Date(Number.NaN);
  }

  return result;
}

export function getSingaporeNow(): Date {
  return new Date();
}

export function parseSingaporeDateTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;

  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? 0);

  if (
    !isValidCalendarDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  if (zone) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }

  const millisecond = Number((fraction ?? '').slice(0, 3).padEnd(3, '0'));
  const parsed = singaporeWallTimeToDate(
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
  );

  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function formatSingaporeDate(date: Date): string {
  const { year, month, day } = getSingaporeDateTimeParts(date);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatSingaporeDateTimeInput(date: Date): string {
  const { year, month, day, hour, minute } = getSingaporeDateTimeParts(date);

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
