const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../backend/db');
const { createSettings, PASSWORD_KEY, DEFAULT_PASSWORD, MAX_FAILS } = require('../backend/settings');
const pw = require('../backend/lib/password');

const silent = { log() {}, error() {} };
const make = (env = {}) => {
  const store = openDb(':memory:');
  return { store, s: createSettings({ store, env, logger: silent }) };
};

// ── Lưu trữ ──────────────────────────────────────────────────
test('settings lưu rồi đọc lại đúng kiểu, kể cả mảng', () => {
  const { store } = make();
  store.writeSettings({ review_deadline_hours: 6, review_time_groups: [2, 5, 30] });
  const back = store.readSettings();
  assert.strictEqual(back.review_deadline_hours, 6);
  assert.deepStrictEqual(back.review_time_groups, [2, 5, 30]);
});

test('DB trống trả về đúng bộ mặc định', () => {
  const { s } = make();
  assert.strictEqual(s.getValues().review_deadline_hours, 4);
  assert.strictEqual(s.getValues().good_rate_pct, 80);
});

test('saveValues từ chối bộ giá trị mâu thuẫn và không ghi gì', () => {
  const { s } = make();
  const res = s.saveValues({ good_rate_pct: 30 });
  assert.ok(res.fields.low_rate_pct);
  assert.strictEqual(s.getValues().good_rate_pct, 80, 'giá trị cũ phải còn nguyên');
});

test('saveValues bỏ qua khoá lạ', () => {
  const { s, store } = make();
  s.saveValues({ good_rate_pct: 90, khong_ton_tai: 1 });
  assert.strictEqual(store.readSettings().khong_ton_tai, undefined);
  assert.strictEqual(s.getValues().good_rate_pct, 90);
});

test('resetToDefaults xoá giá trị đã lưu nhưng giữ lại mật khẩu', () => {
  const { s, store } = make({ CONFIG_PASSWORD: 'hunter22' });
  s.saveValues({ good_rate_pct: 90 });
  s.resetToDefaults();
  assert.strictEqual(s.getValues().good_rate_pct, 80);
  assert.ok(store.readSettings()[PASSWORD_KEY], 'reset ngưỡng không được thổi bay mật khẩu');
});

// ── Khởi tạo ─────────────────────────────────────────────────
test('không có CONFIG_PASSWORD thì rơi về mật khẩu mặc định sẵn có', () => {
  const { s } = make();
  assert.strictEqual(s.isLocked(), true);
  assert.ok(s.unlock(DEFAULT_PASSWORD, '1.1.1.1').token);
});

test('CONFIG_PASSWORD thay chỗ mật khẩu mặc định ngay lần chạy đầu', () => {
  const { s } = make({ CONFIG_PASSWORD: 'hunter22' });
  assert.ok(s.unlock('hunter22', '1.1.1.1').token);
  assert.ok(!s.unlock(DEFAULT_PASSWORD, '2.2.2.2').token);
});

test('CONFIG_PASSWORD lệch với mật khẩu đã lưu thì mật khẩu đã lưu vẫn thắng, và server nói rõ', () => {
  const store = openDb(':memory:');
  createSettings({ store, env: { CONFIG_PASSWORD: 'first-pass' }, logger: silent });

  const said = [];
  const s2 = createSettings({
    store, env: { CONFIG_PASSWORD: 'second-pass' },
    logger: { log: m => said.push(m), error() {} },
  });
  assert.ok(s2.unlock('first-pass', '1.1.1.1').token, 'mật khẩu đã lưu vẫn dùng được');
  assert.ok(said.some(m => m.includes('CONFIG_PASSWORD_RESET')), 'phải chỉ luôn cách ghi đè');
});

test('SLA_HOURS chỉ gieo hạt lần đầu, sau đó giá trị đã lưu thắng', () => {
  const store = openDb(':memory:');
  createSettings({ store, env: { SLA_HOURS: '6' }, logger: silent });
  assert.strictEqual(store.readSettings().review_deadline_hours, 6);

  const s2 = createSettings({ store, env: { SLA_HOURS: '99' }, logger: silent });
  assert.strictEqual(s2.getValues().review_deadline_hours, 6, 'env không được đè lên giá trị đã lưu');
});

test('CONFIG_PASSWORD_RESET=1 ghi đè lại mật khẩu đã lưu', () => {
  const store = openDb(':memory:');
  createSettings({ store, env: { CONFIG_PASSWORD: 'first-pass' }, logger: silent });
  const s2 = createSettings({
    store, logger: silent,
    env: { CONFIG_PASSWORD: 'second-pass', CONFIG_PASSWORD_RESET: '1' },
  });
  assert.ok(s2.unlock('second-pass').token);
  assert.ok(!s2.unlock('first-pass').token);
});

// ── Mật khẩu ─────────────────────────────────────────────────
test('hash rồi verify khớp, sai một ký tự là trượt', () => {
  const h = pw.hash('hunter22');
  assert.ok(pw.verify('hunter22', h));
  assert.ok(!pw.verify('hunter23', h));
  assert.ok(!pw.verify('hunter22', 'chuỗi rác'));
});

test('hai lần băm cùng mật khẩu ra hai chuỗi khác nhau', () => {
  assert.notStrictEqual(pw.hash('hunter22'), pw.hash('hunter22'));
});

test('unlock đúng mật khẩu trả token dùng được', () => {
  const { s } = make({ CONFIG_PASSWORD: 'hunter22' });
  const { token } = s.unlock('hunter22', '1.1.1.1');
  assert.ok(token);
  assert.strictEqual(s.checkToken(token), true);
  assert.strictEqual(s.checkToken('token-bịa'), false);
});

test('token hết hạn bị từ chối', () => {
  const { s } = make({ CONFIG_PASSWORD: 'hunter22' });
  const { token } = s.unlock('hunter22', '1.1.1.1');
  s._tokens.set(token, Date.now() - 1);
  assert.strictEqual(s.checkToken(token), false);
});

test(`sai ${MAX_FAILS} lần thì bị khoá, và khoá theo từng IP`, () => {
  const { s } = make({ CONFIG_PASSWORD: 'hunter22' });
  for (let i = 0; i < MAX_FAILS - 1; i++) {
    assert.ok(s.unlock('sai', '1.1.1.1').error);
  }
  assert.ok(s.unlock('sai', '1.1.1.1').lockedOutFor, 'lần thứ 5 phải khoá');
  assert.ok(s.unlock('hunter22', '1.1.1.1').lockedOutFor, 'đang khoá thì mật khẩu đúng cũng chặn');
  assert.ok(s.unlock('hunter22', '2.2.2.2').token, 'IP khác không bị vạ lây');
});

test('đăng nhập đúng xoá sạch số lần sai đang đếm', () => {
  const { s } = make({ CONFIG_PASSWORD: 'hunter22' });
  s.unlock('sai', '1.1.1.1');
  s.unlock('hunter22', '1.1.1.1');
  assert.strictEqual(s.unlock('sai', '1.1.1.1').triesLeft, MAX_FAILS - 1);
});

test('đổi mật khẩu cần mật khẩu cũ và huỷ mọi phiên đang mở', () => {
  const { s } = make({ CONFIG_PASSWORD: 'hunter22' });
  const { token } = s.unlock('hunter22', '1.1.1.1');

  assert.ok(s.changePassword('sai', 'mat-khau-moi').error);
  assert.ok(s.changePassword('hunter22', 'ngắn').error, 'mật khẩu mới phải đủ dài');

  assert.ok(s.changePassword('hunter22', 'mat-khau-moi').ok);
  assert.strictEqual(s.checkToken(token), false, 'phiên cũ phải bị huỷ');
  assert.ok(s.unlock('mat-khau-moi', '1.1.1.1').token);
});

test('mật khẩu rỗng không bao giờ mở được panel', () => {
  const { s } = make({ CONFIG_PASSWORD: 'hunter22' });
  assert.ok(!s.unlock('', '1.1.1.1').token);
});
