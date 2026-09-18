const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { openDb } = require('../backend/db');
const { createSettings } = require('../backend/settings');
const { createRouter } = require('../backend/routes/settings');

const silent = { log() {}, error() {} };

// Dựng server thật trên cổng ngẫu nhiên: mấy lỗi đáng quan tâm ở đây (mã trạng thái,
// header token) chỉ lộ ra khi đi qua Express chứ không thấy khi gọi hàm trực tiếp.
async function withServer(env, run) {
  const store = openDb(':memory:');
  const settings = createSettings({ store, env, logger: silent });
  const app = express();
  app.use(express.json());
  app.use('/api/settings', createRouter(settings));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/settings`;

  const call = async (path, opts = {}) => {
    const res = await fetch(base + path, opts);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const post = (path, body, token) => call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-config-token': token } : {}) },
    body: JSON.stringify(body),
  });

  try { await run({ call, post, settings }) } finally { server.close() }
}

test('GET trả values, schema và cờ locked mà không cần token', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ call }) => {
    const { status, body } = await call('/');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.locked, true);
    assert.strictEqual(body.values.review_deadline_hours, 4);
    assert.ok(body.schema.find(g => g.key === 'speed').fields.length);
  });
});

test('GET không bao giờ để lộ mật khẩu đã băm', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ call }) => {
    const { body } = await call('/');
    assert.ok(!JSON.stringify(body).includes('scrypt$'));
  });
});

test('POST không token bị chặn 401', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ post }) => {
    assert.strictEqual((await post('/', { values: { good_rate_pct: 90 } })).status, 401);
  });
});

test('unlock rồi lưu được, giá trị mới có hiệu lực ngay', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ call, post }) => {
    const un = await post('/unlock', { password: 'hunter22' });
    assert.strictEqual(un.status, 200);

    const saved = await post('/', { values: { review_deadline_hours: 6 } }, un.body.token);
    assert.strictEqual(saved.status, 200);
    assert.strictEqual(saved.body.values.review_deadline_hours, 6);
    assert.strictEqual((await call('/')).body.values.review_deadline_hours, 6);
  });
});

test('sai mật khẩu trả 401 kèm số lần còn lại', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ post }) => {
    const r = await post('/unlock', { password: 'sai' });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.body.triesLeft, 4);
  });
});

test('sai quá nhiều lần trả 429', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ post }) => {
    let last;
    for (let i = 0; i < 5; i++) last = await post('/unlock', { password: 'sai' });
    assert.strictEqual(last.status, 429);
    assert.ok(last.body.retryInSeconds > 0);
  });
});

test('giá trị ngoài khoảng trả 400 kèm đúng tên trường', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ post }) => {
    const { body: { token } } = await post('/unlock', { password: 'hunter22' });
    const r = await post('/', { values: { good_rate_pct: 999 } }, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.fields.good_rate_pct);
  });
});

test('reset đưa mọi ngưỡng về mặc định', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ post, call }) => {
    const { body: { token } } = await post('/unlock', { password: 'hunter22' });
    await post('/', { values: { good_rate_pct: 95 } }, token);
    await post('/reset', {}, token);
    assert.strictEqual((await call('/')).body.values.good_rate_pct, 80);
  });
});

test('đổi mật khẩu qua API rồi đăng nhập lại bằng mật khẩu mới', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ post }) => {
    const { body: { token } } = await post('/unlock', { password: 'hunter22' });
    assert.strictEqual((await post('/password', { current: 'hunter22', next: 'mat-khau-moi' }, token)).status, 200);
    assert.strictEqual((await post('/', { values: { good_rate_pct: 90 } }, token)).status, 401, 'token cũ phải hết hiệu lực');
    assert.ok((await post('/unlock', { password: 'mat-khau-moi' })).body.token);
  });
});

test('mật khẩu rỗng bị chặn 401', async () => {
  await withServer({ CONFIG_PASSWORD: 'hunter22' }, async ({ post }) => {
    assert.strictEqual((await post('/unlock', { password: '' })).status, 401);
  });
});
