const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../backend/db');
const { toMeeting, toReviews } = require('../backend/lib/transform');
const { rawRows, reviewedRows } = require('./fixtures/sheet-rows');

function seed() {
  const store = openDb(':memory:');
  const meetings = rawRows.map(r => toMeeting(r)).filter(Boolean);
  const reviews = toReviews(reviewedRows);
  const result = store.replaceAll(meetings, reviews);
  return { store, result };
}

test('replaceAll ghi toàn bộ meetings và reviews', () => {
  const { store, result } = seed();
  assert.strictEqual(result.inserted, 8); // 6 meetings + 2 reviews
  assert.strictEqual(result.updated, 0);
  assert.strictEqual(result.deleted, 0);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
});

test('replaceAll lần hai đếm là updated chứ không phải inserted', () => {
  const { store } = seed();
  const meetings = rawRows.map(r => toMeeting(r)).filter(Boolean);
  const reviews = toReviews(reviewedRows);
  const again = store.replaceAll(meetings, reviews);
  assert.strictEqual(again.inserted, 0);
  assert.strictEqual(again.updated, 8);
});

test('replaceAll đánh dấu is_deleted cho dòng biến mất khỏi sheet', () => {
  const { store } = seed();
  const fewer = rawRows.slice(0, 3).map(r => toMeeting(r)).filter(Boolean);
  const result = store.replaceAll(fewer, []);
  assert.strictEqual(result.deleted, 5); // 3 meetings + 2 reviews
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 3);
});

test('replaceAll hồi sinh dòng quay lại sheet', () => {
  const { store } = seed();
  store.replaceAll([], []);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 0);
  const meetings = rawRows.map(r => toMeeting(r)).filter(Boolean);
  store.replaceAll(meetings, []);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
});

test('getDashboardData loại dòng discarded nhưng giữ dòng untagged dưới nhãn UNTAGGED', () => {
  const { store } = seed();
  const data = store.getDashboardData();
  // 6 dòng: 2 discarded bị loại → còn 4, trong đó 1 là untagged
  assert.strictEqual(data.raw.length, 4);
  assert.strictEqual(data.untagged_raw, 1);
  assert.strictEqual(data.raw.filter(r => r.team === 'UNTAGGED').length, 1);
});

test('dòng untagged giữ nguyên trạng thái thật để vẫn vào đúng KPI', () => {
  const { store } = seed();
  const row = store.getDashboardData().raw.find(r => r.team === 'UNTAGGED');
  assert.strictEqual(row.status_clean, 'pending');
  assert.strictEqual(row.date_str, '2026-05-24');
});

test('getDashboardData trả team viết hoa và date_str theo ngày họp', () => {
  const { store } = seed();
  const row = store.getDashboardData().raw.find(r => r.title.includes('Frontier Computing'));
  assert.strictEqual(row.team, 'INVESTMENT');
  assert.strictEqual(row.date_str, '2026-09-12');
  assert.strictEqual(row.status_clean, 'reviewed');
  assert.strictEqual(row.dow, 'Saturday');
  assert.strictEqual(row.attendee_count, 5);
});

test('getDashboardData chỉ trả review_type reviewed, kèm review_hours', () => {
  const { store } = seed();
  const data = store.getDashboardData();
  assert.strictEqual(data.reviewed.length, 2);
  const r = data.reviewed.find(x => x.title.includes('Frontier Computing'));
  assert.strictEqual(r.date_str, '2026-09-12');
  assert.strictEqual(r.status_clean, 'reviewed');
  assert.strictEqual(r.review_hours, 41.45);
});

test('getDashboardData đếm team_n theo team viết hoa, kèm nhóm UNTAGGED', () => {
  const { store } = seed();
  const { team_n, raw } = store.getDashboardData();
  assert.strictEqual(team_n.INVESTMENT, 2);
  assert.strictEqual(team_n.MARCOM, 1);
  assert.strictEqual(team_n.UNTAGGED, 1);
  // tổng team_n phải khớp số dòng raw, nếu không các biểu đồ sẽ không cộng khớp KPI
  assert.strictEqual(Object.values(team_n).reduce((a, b) => a + b, 0), raw.length);
});
