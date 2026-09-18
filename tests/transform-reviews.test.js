const test = require('node:test');
const assert = require('node:assert');
const { toReviews, computeReviewHours } = require('../backend/lib/transform');
const { reviewedRows } = require('./fixtures/sheet-rows');

test('computeReviewHours tính chênh lệch giờ và làm tròn 2 chữ số', () => {
  assert.strictEqual(
    computeReviewHours('2026-09-12T23:59:32+07:00', '2026-09-12T20:59:32+07:00'),
    3
  );
  assert.strictEqual(
    computeReviewHours('2026-09-12T22:29:32+07:00', '2026-09-12T20:59:32+07:00'),
    1.5
  );
});

test('computeReviewHours trả null khi thiếu đầu vào hoặc kết quả âm', () => {
  assert.strictEqual(computeReviewHours(null, '2026-09-12T20:59:32+07:00'), null);
  assert.strictEqual(computeReviewHours('2026-09-12T20:59:32+07:00', null), null);
  assert.strictEqual(
    computeReviewHours('2026-09-12T19:00:00+07:00', '2026-09-12T20:59:32+07:00'),
    null
  );
});

test('toReviews tính review_hours từ meeting_time nằm sẵn trong dòng review', () => {
  const [r] = toReviews([reviewedRows[0]]);
  assert.strictEqual(r.id, 'eMfgyZJDJuQecQrGQIlgs|2026-09-14T14:26:45+07:00');
  assert.strictEqual(r.reviewed_at, '2026-09-14T14:26:45+07:00');
  assert.strictEqual(r.meeting_time, '2026-09-12T20:59:32+07:00');
  assert.strictEqual(r.review_hours, 41.45);
  assert.strictEqual(r.team, 'investment');
});

test('toReviews đánh SLA breach theo ngưỡng truyền vào', () => {
  const rows = [{ ...reviewedRows[0], reviewed_at: '12/09/2026 23:59:32' }];
  assert.strictEqual(toReviews(rows, { slaHours: 4 })[0].is_sla_breach, 0);
  assert.strictEqual(toReviews(rows, { slaHours: 2 })[0].is_sla_breach, 1);
});

test('toReviews dùng đúng ngưỡng biên: đúng 4 giờ không phải breach', () => {
  const rows = [{ ...reviewedRows[0], reviewed_at: '13/09/2026 00:59:32' }];
  const [r] = toReviews(rows, { slaHours: 4 });
  assert.strictEqual(r.review_hours, 4);
  assert.strictEqual(r.is_sla_breach, 0);
});

test('toReviews lấy meeting_time từ bảng tra cứu khi dòng review thiếu', () => {
  const rows = [{ ...reviewedRows[0], meeting_time: '' }];
  const [r] = toReviews(rows, {
    meetingTimeById: { eMfgyZJDJuQecQrGQIlgs: '2026-09-12T20:59:32+07:00' },
  });
  assert.strictEqual(r.review_hours, 41.45);
});

test('toReviews để review_hours null khi không có nguồn meeting_time nào', () => {
  const [r] = toReviews([{ ...reviewedRows[0], meeting_time: '' }]);
  assert.strictEqual(r.review_hours, null);
  assert.strictEqual(r.is_sla_breach, 0);
});

test('toReviews phân loại re-reviewed theo thứ tự reviewed_at, bỏ qua cột review_type của sheet', () => {
  const rows = [
    { ...reviewedRows[0], reviewed_at: '16/09/2026 09:00:00', review_type: 'reviewed' },
    { ...reviewedRows[0], reviewed_at: '14/09/2026 14:26:45', review_type: 're-reviewed' },
    { ...reviewedRows[0], reviewed_at: '15/09/2026 08:00:00', review_type: 'reviewed' },
  ];
  const out = toReviews(rows).sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
  assert.deepStrictEqual(out.map(r => r.review_type), ['reviewed', 're-reviewed', 're-reviewed']);
});

test('toReviews bỏ dòng thiếu meeting_id hoặc reviewed_at hỏng', () => {
  const out = toReviews([
    { ...reviewedRows[0], meeting_id: '' },
    { ...reviewedRows[1], reviewed_at: 'hôm qua' },
  ]);
  assert.strictEqual(out.length, 0);
});
