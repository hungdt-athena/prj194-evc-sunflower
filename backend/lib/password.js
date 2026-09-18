// Băm mật khẩu bằng scrypt có sẵn trong Node — không kéo thêm dependency nào.
const crypto = require('crypto');

const KEYLEN = 32;
const SALT_BYTES = 16;

function hash(password, salt = crypto.randomBytes(SALT_BYTES).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verify(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  } catch {
    return false;
  }
  // So sánh theo thời gian cố định: so bằng === sẽ rò rỉ độ dài tiền tố khớp.
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { hash, verify, newToken };
