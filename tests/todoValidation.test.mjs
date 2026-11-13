import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDueDate, validateTodoTitle } from '../lib/todoValidation.ts';

test('trims todo titles and rejects missing or whitespace-only titles', () => {
  assert.equal(validateTodoTitle('  Plan the week  '), 'Plan the week');
  assert.equal(validateTodoTitle(' \n\t '), null);
  assert.equal(validateTodoTitle(undefined), null);
});

test('normalizes Singapore local due dates and applies inclusive one-minute boundary', () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  assert.equal(
    normalizeDueDate('2030-01-01T08:01', now),
    '2030-01-01T00:01:00.000Z',
  );
  assert.equal(normalizeDueDate(null, now), null);
  assert.equal(normalizeDueDate(undefined, now), null);
  assert.throws(
    () => normalizeDueDate('2030-01-01T08:00:59.999', now),
    /at least 1 minute/,
  );
});

test('rejects malformed or past dates rather than treating them as undated', () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  assert.throws(() => normalizeDueDate('2030-02-30T12:00', now), /valid ISO date-time/);
  assert.throws(() => normalizeDueDate('not-a-date', now), /valid ISO date-time/);
  assert.throws(() => normalizeDueDate('2029-12-31T23:00Z', now), /at least 1 minute/);
});
