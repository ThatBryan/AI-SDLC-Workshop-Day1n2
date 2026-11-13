import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCalendarGrid } from '../lib/calendar.ts';

const fixedNow = new Date('2028-02-29T16:30:00.000Z');

test('always emits six complete weeks with adjacent-month dates', () => {
  const days = generateCalendarGrid(2028, 2, fixedNow);

  assert.equal(days.length, 42);
  assert.equal(days[0].date, '2028-01-30');
  assert.equal(days.at(-1).date, '2028-03-11');
  assert.equal(days.filter((day) => day.isCurrentMonth).length, 29);
});

test('includes leap day and handles a non-leap February', () => {
  const leapDays = generateCalendarGrid(2028, 2, fixedNow);
  const nonLeapDays = generateCalendarGrid(2027, 2, fixedNow);

  assert.equal(
    leapDays.find((day) => day.date === '2028-02-29')?.isCurrentMonth,
    true,
  );
  assert.equal(nonLeapDays.filter((day) => day.isCurrentMonth).length, 28);
});

test('keeps 31-day months starting on Sunday and Saturday at six rows', () => {
  const sundayStart = generateCalendarGrid(2023, 10, fixedNow);
  const saturdayStart = generateCalendarGrid(2021, 5, fixedNow);

  assert.equal(sundayStart[0].date, '2023-10-01');
  assert.equal(sundayStart.length, 42);
  assert.equal(sundayStart.filter((day) => day.isCurrentMonth).length, 31);
  assert.equal(saturdayStart[0].date, '2021-04-25');
  assert.equal(saturdayStart.length, 42);
  assert.equal(saturdayStart.filter((day) => day.isCurrentMonth).length, 31);
});

test('uses Asia/Singapore for today and past flags near the UTC day boundary', () => {
  const days = generateCalendarGrid(2028, 3, new Date('2028-02-29T16:30:00.000Z'));

  assert.equal(days.find((day) => day.isToday)?.date, '2028-03-01');
  assert.equal(days.find((day) => day.date === '2028-02-29')?.isPast, true);
  assert.equal(days.find((day) => day.date === '2028-03-01')?.isPast, false);
});

test('marks weekends by grid weekday and today exactly once', () => {
  const days = generateCalendarGrid(2028, 2, new Date('2028-02-29T04:00:00.000Z'));

  assert.equal(days.filter((day) => day.isToday).length, 1);
  assert.equal(
    days.filter((day, index) => day.isWeekend !== (index % 7 === 0 || index % 7 === 6))
      .length,
    0,
  );
});

test('validates requested year and month', () => {
  assert.throws(() => generateCalendarGrid(2028, 0, fixedNow), /year.*month/i);
  assert.throws(() => generateCalendarGrid(10000, 1, fixedNow), /year.*month/i);
  assert.throws(
    () => generateCalendarGrid(2028, 2, new Date(Number.NaN)),
    /valid date/,
  );
});
