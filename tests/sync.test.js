const test = require('node:test');
const assert = require('node:assert');
const { runSync } = require('../backend/sync');
const { openDb } = require('../backend/db');
const { rawRows, reviewedRows } = require('./fixtures/sheet-rows');

const silent = { log() {}, error() {} };

test('runSync đưa dữ liệu sheet vào DB và trả số liệu', async () => {
  const store = openDb(':memory:');
  const res = await runSync({
    store,
    logger: silent,
    fetchRows: async () => ({ raw: rawRows, reviewed: reviewedRows }),
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.inserted, 8);
  assert.strictEqual(res.total, 8);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
  assert.strictEqual(store.stmts.getMeta.get().last_status, 'ok');
});

test('runSync bỏ qua dòng hỏng thay vì vỡ', async () => {
  const store = openDb(':memory:');
  const res = await runSync({
    store,
    logger: silent,
    fetchRows: async () => ({
      raw: [...rawRows, { meeting_id: '', meeting_time: 'hôm qua' }],
      reviewed: reviewedRows,
    }),
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
});

test('runSync dùng meeting_time từ tab raw khi dòng review thiếu', async () => {
  const store = openDb(':memory:');
  await runSync({
    store,
    logger: silent,
    fetchRows: async () => ({
      raw: rawRows,
      reviewed: [{ ...reviewedRows[0], meeting_time: '' }],
    }),
  });

  const row = store.db.prepare('SELECT review_hours FROM reviews').get();
  assert.strictEqual(row.review_hours, 41.45);
});



test('runSync nuốt lỗi mạng, giữ nguyên dữ liệu cũ và ghi last_status', async () => {
  const store = openDb(':memory:');
  await runSync({
    store,
    logger: silent,
    fetchRows: async () => ({ raw: rawRows, reviewed: reviewedRows }),
  });

  const res = await runSync({
    store,
    logger: silent,
    fetchRows: async () => { throw new Error('quota exceeded'); },
  });

  assert.strictEqual(res.ok, false);
  assert.match(res.error, /quota exceeded/);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
  assert.match(store.stmts.getMeta.get().last_status, /quota exceeded/);
});

test('runSync phát SSE cho client đang kết nối', async () => {
  const store = openDb(':memory:');
  const written = [];
  const sseClients = [{ write: msg => written.push(msg) }];

  await runSync({
    store,
    logger: silent,
    sseClients,
    fetchRows: async () => ({ raw: rawRows, reviewed: reviewedRows }),
  });

  assert.strictEqual(written.length, 1);
  const payload = JSON.parse(written[0].replace(/^data: /, ''));
  assert.strictEqual(payload.type, 'sync');
  assert.strictEqual(payload.inserted, 8);
});
