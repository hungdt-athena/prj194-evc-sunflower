/**
 * Parse các giá trị ô thô từ Google Sheets.
 * Sheet ghi giờ theo múi giờ Việt Nam nhưng không kèm offset, nên ta gắn +07:00 vào.
 */

const TZ = '+07:00';
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/;

function parseSheetDate(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(DATE_RE);
  if (!m) return null;
  const [, d, mo, y, h = '0', mi = '0', s = '0'] = m;
  const pad = n => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${TZ}`;
}

function parseBool(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function attendeeList(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function countAttendees(value) {
  return attendeeList(value).length;
}

module.exports = { parseSheetDate, parseBool, attendeeList, countAttendees };
