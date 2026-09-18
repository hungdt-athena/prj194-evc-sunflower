const test = require('node:test');
const assert = require('node:assert');
const { rowsToObjects, fetchSheetRows, createClient } = require('../backend/sheets');

test('rowsToObjects dùng dòng đầu làm header', () => {
  const out = rowsToObjects([
    ['meeting_id', 'team', 'status'],
    ['abc', 'Investment', 'reviewed'],
  ]);
  assert.deepStrictEqual(out, [{ meeting_id: 'abc', team: 'Investment', status: 'reviewed' }]);
});

test('rowsToObjects điền chuỗi rỗng cho ô thiếu ở cuối dòng', () => {
  const out = rowsToObjects([
    ['meeting_id', 'team', 'status'],
    ['abc'],
  ]);
  assert.deepStrictEqual(out, [{ meeting_id: 'abc', team: '', status: '' }]);
});

test('rowsToObjects trả mảng rỗng khi sheet không có dữ liệu', () => {
  assert.deepStrictEqual(rowsToObjects([]), []);
  assert.deepStrictEqual(rowsToObjects([['meeting_id', 'team']]), []);
});

test('fetchSheetRows đọc đúng hai range và trả về hai mảng object', async () => {
  const calls = [];
  const client = {
    spreadsheets: {
      values: {
        batchGet: async (params) => {
          calls.push(params);
          return {
            data: {
              valueRanges: [
                { values: [['meeting_id', 'status'], ['m1', 'reviewed']] },
                { values: [['meeting_id', 'reviewed_at'], ['m1', '14/09/2026 14:26:45']] },
              ],
            },
          };
        },
      },
    },
  };

  const out = await fetchSheetRows({ sheetId: 'SHEET', client });
  assert.deepStrictEqual(calls[0].ranges, ['raw!A:M', 'reviewed!A:K']);
  assert.strictEqual(calls[0].spreadsheetId, 'SHEET');
  assert.deepStrictEqual(out.raw, [{ meeting_id: 'm1', status: 'reviewed' }]);
  assert.deepStrictEqual(out.reviewed, [{ meeting_id: 'm1', reviewed_at: '14/09/2026 14:26:45' }]);
});

test('fetchSheetRows chịu được range rỗng', async () => {
  const client = {
    spreadsheets: {
      values: { batchGet: async () => ({ data: { valueRanges: [{}, {}] } }) },
    },
  };
  const out = await fetchSheetRows({ sheetId: 'SHEET', client });
  assert.deepStrictEqual(out, { raw: [], reviewed: [] });
});

test('createClient báo lỗi rõ ràng khi JSON trong biến môi trường hỏng', () => {
  assert.throws(
    () => createClient({ credentialsJson: '{not json' }),
    /GOOGLE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ/
  );
});

test('createClient báo lỗi khi không có credential nào', () => {
  assert.throws(() => createClient({}), /Thiếu credential/);
});

test('createClient ưu tiên JSON trong biến môi trường hơn đường dẫn file', () => {
  const creds = JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'x' });
  // không ném lỗi nghĩa là nó đã đi nhánh credentials, không đụng tới file không tồn tại
  assert.ok(createClient({ credentialsJson: creds, keyFile: '/khong/ton/tai.json' }));
});
