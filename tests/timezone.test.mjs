import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSingaporeDate,
  formatSingaporeDateTimeInput,
  parseSingaporeDateTime,
} from '../lib/timezone.ts';
import {
  compareTodoDueDates,
  isDueDateAtLeastOneMinuteAhead,
  isTodoOverdue,
} from '../lib/todoDates.ts';

test('parses local datetime values in Asia/Singapore, independent of host timezone', () => {
  const parsed = parseSingaporeDateTime('2030-01-02T03:04');

  assert.equal(parsed?.toISOString(), '2030-01-01T19:04:00.000Z');
});

test('parses explicit ISO timezone offsets as absolute instants', () => {
  const parsed = parseSingaporeDateTime('2030-01-02T03:04:00+08:00');

  assert.equal(parsed?.toISOString(), '2030-01-01T19:04:00.000Z');
});

test('rejects malformed or impossible local date-times', () => {
  assert.equal(parseSingaporeDateTime('2030-02-30T12:00'), null);
  assert.equal(parseSingaporeDateTime('2030-01-01 12:00'), null);
  assert.equal(parseSingaporeDateTime('not-a-date'), null);
  assert.equal(parseSingaporeDateTime('2030-01-01T24:00'), null);
  assert.equal(parseSingaporeDateTime('0030-01-01T12:00')?.getUTCFullYear(), 30);
});

test('formats instants using Singapore calendar and datetime-local values', () => {
  const date = new Date('2030-01-01T19:04:00.000Z');

  assert.equal(formatSingaporeDate(date), '2030-01-02');
  assert.equal(formatSingaporeDateTimeInput(date), '2030-01-02T03:04');
});

test('enforces the inclusive one-minute due-date boundary', () => {
  const now = new Date('2030-01-01T00:00:00.000Z');

  assert.equal(
    isDueDateAtLeastOneMinuteAhead('2030-01-01T00:01:00Z', now),
    true,
  );
  assert.equal(
    isDueDateAtLeastOneMinuteAhead('2030-01-01T00:00:59.999Z', now),
    false,
  );
});

test('overdue detection excludes completed todos and uses a strict past boundary', () => {
  const now = new Date('2030-01-01T00:00:00.000Z');

  assert.equal(isTodoOverdue('2029-12-31T23:59:59Z', false, now), true);
  assert.equal(isTodoOverdue('2030-01-01T00:00:00Z', false, now), false);
  assert.equal(isTodoOverdue('2029-12-31T23:59:59Z', true, now), false);
});

test('due-date comparator puts undated todos last without mutating values', () => {
  assert.equal(
    compareTodoDueDates('2030-01-02T00:00:00Z', '2030-01-03T00:00:00Z') < 0,
    true,
  );
  assert.equal(compareTodoDueDates(null, '2030-01-03T00:00:00Z') > 0, true);
  assert.equal(compareTodoDueDates(null, null), 0);
  assert.throws(
    () => compareTodoDueDates('invalid', '2030-01-03T00:00:00Z'),
    /valid ISO date-time/,
  );
});
