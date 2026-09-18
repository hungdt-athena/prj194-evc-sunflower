const th = require('./lib/thresholds');
const pw = require('./lib/password');

const PASSWORD_KEY = 'config_password';
const DEFAULT_PASSWORD = 'evcsun@123';
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;   // 2 giờ
const MAX_FAILS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

function createSettings({ store, env = process.env, logger = console } = {}) {
  const tokens = new Map();   // token -> hạn dùng (ms)
  const fails = new Map();    // ip    -> { count, until }

  // ── Khởi tạo ──────────────────────────────────────────────
  // Mật khẩu đã lưu luôn thắng env, nếu không thì mỗi lần restart sẽ xoá mất mật khẩu
  // người dùng vừa đổi trong panel. Nhưng im lặng bỏ qua env là một cái bẫy khó chịu —
  // đúng cái bẫy đã làm mất thời gian ngay hôm triển khai — nên khi hai bên lệch nhau
  // thì phải nói rõ ra và chỉ luôn cách ghi đè.
  function bootstrap() {
    const stored = store.readSettings();
    const envPw = (env.CONFIG_PASSWORD || '').trim();
    const forceReset = env.CONFIG_PASSWORD_RESET === '1';

    if (!stored[PASSWORD_KEY] || forceReset) {
      const seed = envPw || DEFAULT_PASSWORD;
      store.writeSettings({ [PASSWORD_KEY]: pw.hash(seed) });
      logger.log(
        forceReset ? '[Config] Config password reset'
        : envPw ? '[Config] Config password set from CONFIG_PASSWORD'
        : `[Config] Config password set to the built-in default (${DEFAULT_PASSWORD}) — set CONFIG_PASSWORD to change it`);
    } else if (envPw && !pw.verify(envPw, stored[PASSWORD_KEY])) {
      logger.log('[Config] CONFIG_PASSWORD does not match the password already saved, so the saved one is still in use. Set CONFIG_PASSWORD_RESET=1 and restart to overwrite it.');
    }

    // SLA_HOURS cũ: chỉ còn là hạt giống lần đầu. Nói thẳng khi nó bị bỏ qua, vì cái
    // bẫy khó chịu nhất của bản trước đúng là sửa env mà không thấy gì đổi.
    const envSla = Number(env.SLA_HOURS);
    if (Number.isFinite(envSla) && envSla > 0) {
      if (stored.review_deadline_hours == null) {
        store.writeSettings({ review_deadline_hours: envSla });
        logger.log(`[Config] Review deadline seeded from SLA_HOURS=${envSla}`);
      } else if (stored.review_deadline_hours !== envSla) {
        logger.log(`[Config] SLA_HOURS=${envSla} ignored — the saved review deadline is ${stored.review_deadline_hours}h. Change it in the settings panel.`);
      }
    }
  }

  // ── Giá trị ───────────────────────────────────────────────
  function getValues() {
    return th.merge(store.readSettings());
  }

  function saveValues(patch) {
    const known = {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (th.KEYS.includes(k)) known[k] = v;
    }
    if (!Object.keys(known).length) return { fields: { _: 'Nothing to save.' } };

    const merged = th.merge({ ...store.readSettings(), ...known });
    const fields = th.validate(merged);
    if (fields) return { fields };

    store.writeSettings(known);
    return { values: getValues() };
  }

  function resetToDefaults() {
    store.deleteSettings(th.KEYS);
    return getValues();
  }

  // ── Mật khẩu & phiên ──────────────────────────────────────
  function isLocked() {
    return Boolean(store.readSettings()[PASSWORD_KEY]);
  }

  function lockoutLeft(ip) {
    const rec = fails.get(ip);
    if (!rec || !rec.until) return 0;
    const left = rec.until - Date.now();
    if (left <= 0) { fails.delete(ip); return 0 }
    return left;
  }

  function unlock(password, ip = 'unknown') {
    const left = lockoutLeft(ip);
    if (left > 0) return { lockedOutFor: Math.ceil(left / 1000) };

    const stored = store.readSettings()[PASSWORD_KEY];
    if (!stored) return { error: 'No config password is set on this server.' };

    if (!pw.verify(password, stored)) {
      const rec = fails.get(ip) || { count: 0, until: 0 };
      rec.count += 1;
      if (rec.count >= MAX_FAILS) { rec.until = Date.now() + LOCKOUT_MS; rec.count = 0 }
      fails.set(ip, rec);
      return rec.until
        ? { lockedOutFor: Math.ceil(LOCKOUT_MS / 1000) }
        : { error: 'Wrong password.', triesLeft: MAX_FAILS - rec.count };
    }

    fails.delete(ip);
    const token = pw.newToken();
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    tokens.set(token, expiresAt);
    return { token, expiresAt };
  }

  function checkToken(token) {
    const exp = tokens.get(token);
    if (!exp) return false;
    if (exp <= Date.now()) { tokens.delete(token); return false }
    return true;
  }

  function changePassword(current, next) {
    const stored = store.readSettings()[PASSWORD_KEY];
    if (!stored || !pw.verify(current, stored)) return { error: 'The current password is wrong.' };
    const val = String(next || '');
    if (val.length < 8) return { error: 'The new password must be at least 8 characters.' };
    store.writeSettings({ [PASSWORD_KEY]: pw.hash(val) });
    tokens.clear();   // đổi mật khẩu thì mọi phiên đang mở phải đăng nhập lại
    return { ok: true };
  }

  bootstrap();
  return {
    getValues, saveValues, resetToDefaults,
    isLocked, unlock, checkToken, changePassword,
    schema: th.publicSchema,
    _tokens: tokens,
  };
}

module.exports = { createSettings, PASSWORD_KEY, DEFAULT_PASSWORD, MAX_FAILS, TOKEN_TTL_MS, LOCKOUT_MS };
