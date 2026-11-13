import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TODO_DB_PATH = ':memory:';

const { getDB, holidayDB } = await import('../lib/db.ts');

test('holiday lookup includes the full six-week calendar grid range', () => {
  holidayDB.upsertMany([
    { date: '2026-03-28', name: 'Outside grid before' },
    { date: '2026-03-29', name: 'Leading grid day' },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-05-09', name: 'Trailing grid day' },
    { date: '2026-05-10', name: 'Outside grid after' },
  ]);

  assert.deepEqual(
    holidayDB.findByMonth(2026, 4).map(({ date, name }) => ({ date, name })),
    [
      { date: '2026-03-29', name: 'Leading grid day' },
      { date: '2026-04-03', name: 'Good Friday' },
      { date: '2026-05-09', name: 'Trailing grid day' },
    ],
  );
  assert.equal(holidayDB.findAll().length, 5);
});

test('holiday seeds upsert by unique date without creating duplicate rows', () => {
  holidayDB.upsertMany([{ date: '2026-12-25', name: 'Christmas Day' }]);
  const findChristmas = () =>
    getDB().prepare('SELECT id, date, name FROM holidays WHERE date = ?')
      .get('2026-12-25');
  const original = findChristmas();

  holidayDB.upsertMany([{ date: '2026-12-25', name: 'Christmas' }]);
  const updated = findChristmas();

  assert.equal(updated.id, original.id);
  assert.equal(updated.name, 'Christmas');
  assert.equal(
    getDB().prepare('SELECT COUNT(*) AS count FROM holidays WHERE date = ?')
      .get('2026-12-25').count,
    1,
  );
});

test('month lookup rejects invalid year or month values', () => {
  assert.throws(() => holidayDB.findByMonth(0, 1), /year.*month/i);
  assert.throws(() => holidayDB.findByMonth(2026, 13), /year.*month/i);
});
