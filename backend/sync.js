/**
 * Điều phối một vòng đồng bộ: đọc sheet → biến đổi → ghi DB → cập nhật meta → phát SSE.
 * Một vòng sync hỏng không được làm chết process, và không được xoá dữ liệu đang có.
 */

const { fetchSheetRows } = require('./sheets');
const { toMeeting, toReviews, DEFAULT_SLA_HOURS } = require('./lib/transform');
const defaultStore = require('./db');

/**
 * Credential lấy từ biến môi trường: JSON thuần, hoặc base64 cho những nơi
 * làm hỏng chuỗi dài khi dán.
 */
function credentialsFromEnv() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) return raw.trim();
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (b64 && b64.trim()) return Buffer.from(b64.trim(), 'base64').toString('utf8');
  return null;
}

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
    credentialsJson = credentialsFromEnv(),
    fetchRows = () => fetchSheetRows({ sheetId, keyFile, credentialsJson }),
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
    if (skipped > 0) logger.log(`[Sync] Skipped ${skipped} unusable raw rows`);

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

    logger.log(`[Sync] Done: +${inserted} ~${updated} -${deleted} (total ${total})`);
    emitSSE(sseClients, {
      type: 'sync',
      inserted, updated, deleted, total,
      timestamp: new Date().toISOString(),
    });

    return { ok: true, inserted, updated, deleted, total };
  } catch (err) {
    logger.error(`[Sync] Failed: ${err.message}`);
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

/**
 * In ra cấu hình đang thấy được, không in giá trị. Deployment chỉ nạp biến môi
 * trường lúc khởi động, nên khi thiếu biến thì log này là chỗ nhìn đầu tiên.
 */
function describeConfig() {
  const json = credentialsFromEnv();
  const lines = [
    `SHEET_ID=${process.env.SHEET_ID ? 'set' : 'MISSING'}`,
    `credentials=${json ? json.length + ' chars' : 'MISSING'}`,
    `SLA_HOURS=${process.env.SLA_HOURS || DEFAULT_SLA_HOURS}`,
  ];
  // Khi credentials rỗng, thủ phạm thường là tên biến gõ sai — liệt kê tên
  // (không phải giá trị) các biến liên quan để lỗi chính tả tự lộ ra.
  if (!json) {
    const seen = Object.keys(process.env)
      .filter(k => /GOOGLE|SERVICE|ACCOUNT|SHEET|CREDENTIAL/i.test(k))
      .sort();
    lines.push(`env keys seen: ${seen.length ? seen.join(', ') : '(none)'}`);
  }
  return lines.join(' · ');
}

function startSyncLoop(app) {
  console.log(`[Config] ${describeConfig()}`);
  if (!process.env.SHEET_ID) {
    console.log('[Sync] SHEET_ID is not set. Skipping auto-sync.');
    return;
  }
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES) || 5;
  console.log(`[Sync] Auto-sync every ${minutes} minutes`);

  const tick = () => runSync({ sseClients: app.locals.sseClients || [] });
  tick();
  setInterval(tick, minutes * 60 * 1000);
}

module.exports = { runSync, startSyncLoop, describeConfig };
