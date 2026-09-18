const test = require('node:test');
const assert = require('node:assert');
const { parseSheetDate, parseBool, attendeeList, countAttendees } = require('../backend/lib/parse');

test('parseSheetDate đổi dd/MM/yyyy HH:mm:ss sang ISO +07:00', () => {
  assert.strictEqual(parseSheetDate('12/09/2026 20:59:32'), '2026-09-12T20:59:32+07:00');
});

test('parseSheetDate đệm số 0 cho ngày và tháng một chữ số', () => {
  assert.strictEqual(parseSheetDate('4/6/2026 8:05:01'), '2026-06-04T08:05:01+07:00');
});

test('parseSheetDate mặc định 00:00:00 khi thiếu phần giờ', () => {
  assert.strictEqual(parseSheetDate('26/05/2026'), '2026-05-26T00:00:00+07:00');
});

test('parseSheetDate trả null với giá trị rỗng hoặc sai định dạng', () => {
  assert.strictEqual(parseSheetDate(''), null);
  assert.strictEqual(parseSheetDate('   '), null);
  assert.strictEqual(parseSheetDate(undefined), null);
  assert.strictEqual(parseSheetDate('hôm qua'), null);
  assert.strictEqual(parseSheetDate('2026-09-12T20:59:32Z'), null);
});

test('parseBool chỉ nhận TRUE', () => {
  assert.strictEqual(parseBool('TRUE'), true);
  assert.strictEqual(parseBool(' true '), true);
  assert.strictEqual(parseBool('FALSE'), false);
  assert.strictEqual(parseBool(''), false);
  assert.strictEqual(parseBool(undefined), false);
});

test('attendeeList tách theo dấu phẩy và bỏ phần tử rỗng', () => {
  assert.deepStrictEqual(
    attendeeList('nam.tran@earth.vc, duc.pham@earth.vc ,, linh@earth.vc'),
    ['nam.tran@earth.vc', 'duc.pham@earth.vc', 'linh@earth.vc']
  );
  assert.deepStrictEqual(attendeeList(''), []);
  assert.deepStrictEqual(attendeeList(undefined), []);
});

test('countAttendees đếm số người dự', () => {
  assert.strictEqual(countAttendees('a@x.vc, b@x.vc'), 2);
  assert.strictEqual(countAttendees(''), 0);
});
