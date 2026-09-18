/**
 * Biến dòng thô của sheet thành bản ghi sẵn sàng ghi vào DB.
 * Toàn bộ hàm ở đây là hàm thuần: không đọc env, không chạm DB, không gọi mạng.
 */

const { parseSheetDate, parseBool, countAttendees } = require('./parse');

const MEETING_STATUSES = ['pending', 'confirmed', 'reviewed', 'discarded'];
const SHEET_STATUSES = ['pending', 'confirmed', 'reviewed', 'discarded'];
const DEFAULT_SLA_HOURS = 4;

function isUntagged(team, mainTag) {
  const t = (team || '').trim();
  const tag = (mainTag || '').trim().toLowerCase();
  return t === '' || tag === 'uncat' || tag === '';
}

function mapStatus(sheetStatus, confirmed, onWarn) {
  const s = (sheetStatus || '').trim().toLowerCase();
  if (s === 'discarded') return 'discarded';
  if (s === 'reviewed') return 'reviewed';
  // Sheet ghi thẳng 'confirmed' được: tin giá trị đó hơn cột confirm.
  if (s === 'confirmed') return 'confirmed';
  if (s !== '' && !SHEET_STATUSES.includes(s)) {
    if (onWarn) onWarn(`Trạng thái lạ trong tab raw: "${sheetStatus}"`);
    return s;
  }
  return confirmed ? 'confirmed' : 'pending';
}

function toMeeting(row, { onWarn } = {}) {
  const meetingId = (row.meeting_id || '').trim();
  const meetingTime = parseSheetDate(row.meeting_time);
  if (!meetingId || !meetingTime) return null;

  const confirmed = parseBool(row.confirm);

  return {
    meeting_id: meetingId,
    meeting_name: row.meeting_name || null,
    meeting_time: meetingTime,
    team: (row.team || '').trim().toLowerCase() || null,
    main_tag: (row.main_tag || '').trim() || null,
    doc_url: row.doc_url || null,
    folder_url: row.folder_url || null,
    chat_thread: row.chat_thread || null,
    attendees: row.attendees || null,
    attendee_count: countAttendees(row.attendees),
    status: mapStatus(row.status, confirmed, onWarn),
    confirmed: confirmed ? 1 : 0,
    confirmed_at: parseSheetDate(row.confirmed_at),
    is_untagged: isUntagged(row.team, row.main_tag) ? 1 : 0,
  };
}

function computeReviewHours(reviewedAtIso, meetingTimeIso) {
  if (!reviewedAtIso || !meetingTimeIso) return null;
  const diff = (new Date(reviewedAtIso).getTime() - new Date(meetingTimeIso).getTime()) / 3600000;
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.round(diff * 100) / 100;
}

function toReviews(rows, opts = {}) {
  const { slaHours = DEFAULT_SLA_HOURS, meetingTimeById = {} } = opts;

  const mapped = [];
  for (const row of rows) {
    const meetingId = (row.meeting_id || '').trim();
    const reviewedAt = parseSheetDate(row.reviewed_at);
    if (!meetingId || !reviewedAt) continue;

    const meetingTime = parseSheetDate(row.meeting_time) || meetingTimeById[meetingId] || null;
    const reviewHours = computeReviewHours(reviewedAt, meetingTime);

    mapped.push({
      id: `${meetingId}|${reviewedAt}`,
      meeting_id: meetingId,
      meeting_name: row.meeting_name || null,
      meeting_time: meetingTime,
      team: (row.team || '').trim().toLowerCase() || null,
      main_tag: (row.main_tag || '').trim() || null,
      doc_url: row.doc_url || null,
      folder_url: row.folder_url || null,
      review_type: 'reviewed',
      reviewed_at: reviewedAt,
      attendees_granted: row.attendees_granted || null,
      sent_to_attendees_at: parseSheetDate(row.sent_to_attendees_at),
      review_hours: reviewHours,
      is_sla_breach: reviewHours !== null && reviewHours > slaHours ? 1 : 0,
      is_untagged: isUntagged(row.team, row.main_tag) ? 1 : 0,
    });
  }

  // Lần review đầu tiên của mỗi cuộc họp là 'reviewed', các lần sau là 're-reviewed'.
  // Không tin cột review_type của sheet vì nó do n8n ghi và có thể lệch.
  const byMeeting = new Map();
  for (const r of mapped) {
    if (!byMeeting.has(r.meeting_id)) byMeeting.set(r.meeting_id, []);
    byMeeting.get(r.meeting_id).push(r);
  }
  for (const list of byMeeting.values()) {
    list.sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
    list.forEach((r, i) => { r.review_type = i === 0 ? 'reviewed' : 're-reviewed'; });
  }

  return mapped;
}

module.exports = {
  MEETING_STATUSES,
  isUntagged,
  toMeeting,
  toReviews,
  computeReviewHours,
  DEFAULT_SLA_HOURS,
};
