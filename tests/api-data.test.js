const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../backend/db');
const { toMeeting, toReviews } = require('../backend/lib/transform');
const { rawRows, reviewedRows } = require('./fixtures/sheet-rows');

// Route chỉ là lớp mỏng bọc getDashboardData, nên test ở đây khẳng định hợp đồng JSON
// mà frontend phụ thuộc vào, không dựng cả server Express.
function seeded() {
  const store = openDb(':memory:');
  store.replaceAll(rawRows.map(r => toMeeting(r)).filter(Boolean), toReviews(reviewedRows));
  return store;
}

test('payload /api/data có đủ bốn khoá frontend cần', () => {
  const data = seeded().getDashboardData();
  assert.deepStrictEqual(Object.keys(data).sort(), ['raw', 'reviewed', 'team_n', 'untagged_raw']);
  assert.ok(Array.isArray(data.raw));
  assert.ok(Array.isArray(data.reviewed));
  assert.strictEqual(typeof data.untagged_raw, 'number');
});

test('mỗi phần tử raw có đủ field frontend đọc', () => {
  const [row] = seeded().getDashboardData().raw;
  assert.deepStrictEqual(
    Object.keys(row).sort(),
    ['attendee_count', 'date_str', 'dow', 'status_clean', 'tags_norm', 'team', 'title']
  );
});

test('mỗi phần tử reviewed có đủ field frontend đọc', () => {
  const [row] = seeded().getDashboardData().reviewed;
  assert.deepStrictEqual(
    Object.keys(row).sort(),
    ['attendee_count', 'date_str', 'dow', 'review_hours', 'status_clean', 'tags_norm', 'team', 'title']
  );
});
