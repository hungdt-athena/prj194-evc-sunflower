const test = require('node:test');
const assert = require('node:assert');
const th = require('../backend/lib/thresholds');

test('defaults trả đủ mọi khoá và tách mảng ra bản sao riêng', () => {
  const a = th.defaults(), b = th.defaults();
  assert.strictEqual(Object.keys(a).length, th.KEYS.length);
  a.review_time_groups.push(99);
  assert.strictEqual(b.review_time_groups.length, 3, 'sửa bản này không được ảnh hưởng bản kia');
});

test('merge đè giá trị đã lưu lên mặc định', () => {
  const v = th.merge({ review_deadline_hours: 6 });
  assert.strictEqual(v.review_deadline_hours, 6);
  assert.strictEqual(v.good_rate_pct, 80);
});

test('merge bỏ qua khoá lạ thay vì làm hỏng cả bộ', () => {
  const v = th.merge({ config_password: 'scrypt$x$y', khoa_da_xoa: 1 });
  assert.strictEqual(v.config_password, undefined);
  assert.strictEqual(Object.keys(v).length, th.KEYS.length);
});

test('checkOne bắt sai kiểu và ngoài khoảng', () => {
  assert.ok(th.checkOne('review_deadline_hours', 'bốn'));
  assert.ok(th.checkOne('review_deadline_hours', 0));
  assert.ok(th.checkOne('good_rate_pct', 101));
  assert.strictEqual(th.checkOne('good_rate_pct', 100), null);
});

test('review_time_groups phải đúng 3 số và tăng dần', () => {
  assert.ok(th.checkOne('review_time_groups', [1, 4]));
  assert.ok(th.checkOne('review_time_groups', [4, 1, 24]));
  assert.ok(th.checkOne('review_time_groups', [1, 1, 24]));
  assert.strictEqual(th.checkOne('review_time_groups', [1, 4, 24]), null);
});

test('validate bắt ngưỡng "kém" không được cao hơn ngưỡng "tốt"', () => {
  const f = th.validate(th.merge({ good_rate_pct: 40, low_rate_pct: 50 }));
  assert.ok(f.low_rate_pct);
});

test('validate bắt mức medium phải thấp hơn mức high', () => {
  assert.ok(th.validate(th.merge({ unreviewed_medium_pct: 60 })).unreviewed_medium_pct);
  assert.ok(th.validate(th.merge({ waiting_medium_pct: 60 })).waiting_medium_pct);
});

test('validate bắt mốc gộp tuần phải nằm dưới mốc gộp tháng', () => {
  const f = th.validate(th.merge({ daily_to_weekly_days: 400 }));
  assert.ok(f.daily_to_weekly_days);
});

test('validate bắt "quá ít file" không được lớn hơn mốc hiện số đếm', () => {
  assert.ok(th.validate(th.merge({ too_few_files: 9, show_count_below: 5 })).too_few_files);
});

test('bộ mặc định tự nó phải hợp lệ', () => {
  assert.strictEqual(th.validate(th.defaults()), null);
});

test('publicSchema phủ hết mọi khoá qua các ô của section', () => {
  const parts = th.publicSchema().flatMap(g => g.fields).flatMap(f => f.parts);
  const keys = [...new Set(parts.map(p => p.key))];
  assert.deepStrictEqual(keys.sort(), th.KEYS.slice().sort());
  assert.ok(th.publicSchema().find(g => g.key === 'display').collapsed, 'nhóm display phải thu gọn sẵn');
});

test('mỗi ô trỏ về đúng nhóm của khoá gốc', () => {
  for (const g of th.publicSchema()) {
    for (const f of g.fields) {
      for (const p of f.parts) {
        assert.strictEqual(th.SCHEMA[p.key].group, g.key, p.key + ' nằm nhầm nhóm');
      }
    }
  }
});

test('ngưỡng được gộp gom đúng các khoá đã khai báo, mỗi khoá chỉ xuất hiện một lần', () => {
  const fields = th.publicSchema().flatMap(g => g.fields);
  for (const [id, m] of Object.entries(th.MERGES)) {
    const f = fields.find(x => x.key === id);
    assert.ok(f, 'thiếu section ' + id);
    assert.deepStrictEqual(f.parts.map(p => p.key), m.parts.map(([k]) => k));
    assert.ok(f.parts.every(p => p.label), 'ô trong section gộp phải có nhãn riêng');
  }
  const all = fields.flatMap(f => f.parts.map(p => p.key + ':' + p.index));
  assert.strictEqual(new Set(all).size, all.length, 'không được lặp ô');
});

test('khoá kiểu mảng tách thành đúng một ô cho mỗi vị trí', () => {
  const f = th.publicSchema().flatMap(g => g.fields).find(x => x.key === 'review_time_groups');
  assert.deepStrictEqual(f.parts.map(p => p.index), [0, 1, 2]);
  assert.deepStrictEqual(f.parts.map(p => p.def), [1, 4, 24]);
});

// Hai ngưỡng vẽ cùng một hình và sinh cùng một câu kết luận là một núm hai đầu; để
// rời ra thì panel hiện hai khối giống hệt nhau, đúng lỗi người dùng đã báo.
test('không còn hai section nào trùng cả hình lẫn câu kết luận', () => {
  const fields = th.publicSchema().flatMap(g => g.fields);
  const seen = new Map();
  for (const f of fields) {
    if (!f.msg) continue;
    const sig = [f.viz.kind, f.viz.source, f.msg].join('|');
    assert.ok(!seen.has(sig), f.key + ' trùng chữ ký với ' + seen.get(sig));
    seen.set(sig, f.key);
  }
});

// Panel kẹp giá trị theo `ordered` ngay lúc kéo; nếu schema khai thiếu thì Red có thể
// tụt xuống dưới Amber mà không gì chặn lại cho tới lúc bấm Save.
test('mọi section có ràng buộc thứ tự đều khai báo ordered', () => {
  const fields = th.publicSchema().flatMap(g => g.fields);
  const need = ['team_rate', 'small_team', 'recent_unreviewed', 'waiting', 'review_time_groups'];
  for (const key of need) {
    const f = fields.find(x => x.key === key);
    assert.ok(f, 'thiếu section ' + key);
    assert.ok(f.ordered === 'lt' || f.ordered === 'lte', key + ' phải khai ordered');
  }
});

test('thứ tự khai trong ordered khớp với ràng buộc validate thật sự chặn', () => {
  // low >= good phải sai, low < good phải đúng
  assert.ok(th.validate(th.merge({ low_rate_pct: 80, good_rate_pct: 80 })).low_rate_pct);
  assert.strictEqual(th.validate(th.merge({ low_rate_pct: 79, good_rate_pct: 80 })), null);
  assert.ok(th.validate(th.merge({ unreviewed_medium_pct: 40, unreviewed_high_pct: 40 })).unreviewed_medium_pct);
  assert.ok(th.validate(th.merge({ waiting_medium_pct: 30, waiting_high_pct: 30 })).waiting_medium_pct);
  // small_team dùng lte nên bằng nhau vẫn hợp lệ
  assert.strictEqual(th.validate(th.merge({ too_few_files: 5, show_count_below: 5 })), null);
  assert.ok(th.validate(th.merge({ too_few_files: 6, show_count_below: 5 })).too_few_files);
});
