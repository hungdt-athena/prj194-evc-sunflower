/**
 * Điều phối một vòng đồng bộ: đọc sheet → biến đổi → ghi DB → cập nhật meta → phát SSE.
 * Một vòng sync hỏng không được làm chết process, và không được xoá dữ liệu đang có.
 */

const { fetchSheetRows } = require('./sheets');
const { toMeeting, toReviews, DEFAULT_SLA_HOURS } = require('./lib/transform');
const defaultStore = require('./db');

function emitSSE(sseClients, payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch (_) { /* client đã ngắt, bỏ qua */ }
  }
}

async function runSync(opts = {}) {
  const {
    store = defaultStore,
    sseClients = [],
    logger = console,
    slaHours = Number(process.env.SLA_HOURS) || DEFAULT_SLA_HOURS,
    sheetId = process.env.SHEET_ID,
    keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS,
    fetchRows = () => fetchSheetRows({ sheetId, keyFile }),
  } = opts;

  try {
    const { raw, reviewed } = await fetchRows();

    const warnings = [];
    const onWarn = w => { if (!warnings.includes(w)) warnings.push(w); };

    const meetings = raw.map(r => toMeeting(r, { onWarn })).filter(Boolean);
    const meetingTimeById = {};
    for (const m of meetings) meetingTimeById[m.meeting_id] = m.meeting_time;

    const reviews = toReviews(reviewed, { slaHours, meetingTimeById, onWarn });

    for (const w of warnings) logger.log(`[Sync] ${w}`);
    const skipped = raw.length - meetings.length;
    if (skipped > 0) logger.log(`[Sync] Bỏ qua ${skipped} dòng raw không hợp lệ`);

    const { inserted, updated, deleted } = store.replaceAll(meetings, reviews);
    const total = meetings.length + reviews.length;

    store.stmts.updateMeta.run({
      rows_in_sheet: raw.length + reviewed.length,
      rows_in_db: store.stmts.countActiveMeetings.get().c,
      last_new_rows: inserted,
      last_deleted: deleted,
      last_updated: updated,
      fingerprint: null,
      last_status: 'ok',
    });

    logger.log(`[Sync] Xong: +${inserted} ~${updated} -${deleted} (tổng ${total})`);
    emitSSE(sseClients, {
      type: 'sync',
      inserted, updated, deleted, total,
      timestamp: new Date().toISOString(),
    });

    return { ok: true, inserted, updated, deleted, total };
  } catch (err) {
    logger.error(`[Sync] Lỗi: ${err.message}`);
    try {
      store.stmts.updateMeta.run({
        rows_in_sheet: 0,
        rows_in_db: store.stmts.countActiveMeetings.get().c,
        last_new_rows: 0,
        last_deleted: 0,
        last_updated: 0,
        fingerprint: null,
        last_status: `error: ${err.message}`,
      });
    } catch (_) { /* không che lỗi gốc */ }
    return { ok: false, error: err.message };
  }
}

function startSyncLoop(app) {
  if (!process.env.SHEET_ID) {
    console.log('[Sync] Chưa cấu hình SHEET_ID. Bỏ qua auto-sync.');
    return;
  }
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES) || 5;
  console.log(`[Sync] Tự đồng bộ mỗi ${minutes} phút`);

  const tick = () => runSync({ sseClients: app.locals.sseClients || [] });
  tick();
  setInterval(tick, minutes * 60 * 1000);
}

module.exports = { runSync, startSyncLoop };
