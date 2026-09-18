const test = require('node:test');
const assert = require('node:assert');
const { toMeeting, isUntagged } = require('../backend/lib/transform');
const { rawRows } = require('./fixtures/sheet-rows');

const byId = id => rawRows.find(r => r.meeting_id === id);

test('toMeeting map các field cơ bản và hạ team về chữ thường', () => {
  const m = toMeeting(byId('eMfgyZJDJuQecQrGQIlgs'));
  assert.strictEqual(m.meeting_id, 'eMfgyZJDJuQecQrGQIlgs');
  assert.strictEqual(m.meeting_time, '2026-09-12T20:59:32+07:00');
  assert.strictEqual(m.team, 'investment');
  assert.strictEqual(m.main_tag, 'Investment');
  assert.strictEqual(m.attendee_count, 5);
  assert.strictEqual(m.confirmed, 1);
  assert.strictEqual(m.confirmed_at, '2026-09-14T11:55:14+07:00');
  assert.strictEqual(m.is_untagged, 0);
});

test('toMeeting giữ trạng thái reviewed và discarded từ sheet', () => {
  assert.strictEqual(toMeeting(byId('eMfgyZJDJuQecQrGQIlgs')).status, 'reviewed');
  assert.strictEqual(toMeeting(byId('LpH4pNKtxuhqxeyMvN5qq')).status, 'discarded');
});

test('toMeeting cho ra pending khi chưa confirm', () => {
  const m = toMeeting(byId('CPD0DN4z8jQWJFCxlAoY1'));
  assert.strictEqual(m.status, 'pending');
  assert.strictEqual(m.confirmed, 0);
  assert.strictEqual(m.confirmed_at, null);
});

test('toMeeting cho ra confirmed khi đã confirm nhưng chưa review', () => {
  const m = toMeeting(byId('Wq7xTESTpendingconfirmed'));
  assert.strictEqual(m.status, 'confirmed');
  assert.strictEqual(m.confirmed, 1);
});

test('toMeeting đánh dấu untagged khi thiếu team hoặc main_tag là uncat', () => {
  assert.strictEqual(toMeeting(byId('CPD0DN4z8jQWJFCxlAoY1')).is_untagged, 1);
  assert.strictEqual(isUntagged('', 'Marcom'), true);
  assert.strictEqual(isUntagged('marcom', 'uncat'), true);
  assert.strictEqual(isUntagged('marcom', 'Marcom'), false);
});

test('toMeeting giữ nguyên status lạ và báo cảnh báo', () => {
  const warnings = [];
  const m = toMeeting(
    { ...byId('Wq7xTESTpendingconfirmed'), status: 'archived' },
    { onWarn: w => warnings.push(w) }
  );
  assert.strictEqual(m.status, 'archived');
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /archived/);
});

test('toMeeting trả null khi thiếu meeting_id hoặc meeting_time hỏng', () => {
  assert.strictEqual(toMeeting({ ...byId('4055170'), meeting_id: '' }), null);
  assert.strictEqual(toMeeting({ ...byId('4055170'), meeting_time: 'hôm qua' }), null);
});

test('toMeeting tin status confirmed ghi thẳng trong sheet, kể cả khi cột confirm là FALSE', () => {
  const warnings = [];
  const m = toMeeting(
    { ...byId('Wq7xTESTpendingconfirmed'), status: 'confirmed', confirm: 'FALSE' },
    { onWarn: w => warnings.push(w) }
  );
  assert.strictEqual(m.status, 'confirmed');
  assert.strictEqual(m.confirmed, 0);
  assert.deepStrictEqual(warnings, []);
});
