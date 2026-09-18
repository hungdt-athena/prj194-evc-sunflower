const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Chỉ những trạng thái này mới vào thống kê. 'discarded' bị loại.
const COUNTED_STATUSES = ['pending', 'confirmed', 'reviewed'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meetings (
    meeting_id      TEXT PRIMARY KEY,
    meeting_name    TEXT,
    meeting_time    TEXT NOT NULL,
    team            TEXT,
    main_tag        TEXT,
    doc_url         TEXT,
    folder_url      TEXT,
    chat_thread     TEXT,
    attendees       TEXT,
    attendee_count  INTEGER DEFAULT 0,
    status          TEXT,
    confirmed       INTEGER DEFAULT 0,
    confirmed_at    TEXT,
    is_untagged     INTEGER DEFAULT 0,
    is_deleted      INTEGER DEFAULT 0,
    synced_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id                   TEXT PRIMARY KEY,
    meeting_id           TEXT NOT NULL,
    meeting_name         TEXT,
    meeting_time         TEXT,
    team                 TEXT,
    main_tag             TEXT,
    doc_url              TEXT,
    folder_url           TEXT,
    review_type          TEXT,
    reviewed_at          TEXT,
    attendees_granted    TEXT,
    sent_to_attendees_at TEXT,
    review_hours         REAL,
    is_untagged          INTEGER DEFAULT 0,
    is_deleted           INTEGER DEFAULT 0,
    synced_at            TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sync_meta (
    id              INTEGER PRIMARY KEY DEFAULT 1,
    last_synced_at  TEXT,
    rows_in_sheet   INTEGER DEFAULT 0,
    rows_in_db      INTEGER DEFAULT 0,
    last_new_rows   INTEGER DEFAULT 0,
    last_deleted    INTEGER DEFAULT 0,
    last_updated    INTEGER DEFAULT 0,
    fingerprint     TEXT DEFAULT NULL,
    last_status     TEXT DEFAULT 'ok'
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_m_team    ON meetings(team);
  CREATE INDEX IF NOT EXISTS idx_m_status  ON meetings(status);
  CREATE INDEX IF NOT EXISTS idx_m_time    ON meetings(meeting_time);
  CREATE INDEX IF NOT EXISTS idx_m_deleted ON meetings(is_deleted);
  CREATE INDEX IF NOT EXISTS idx_r_meeting ON reviews(meeting_id);
  CREATE INDEX IF NOT EXISTS idx_r_team    ON reviews(team);
  CREATE INDEX IF NOT EXISTS idx_r_at      ON reviews(reviewed_at);
  CREATE INDEX IF NOT EXISTS idx_r_type    ON reviews(review_type);
`;

// Tính thứ trong tuần từ chuỗi 'YYYY-MM-DD' mà không phụ thuộc timezone của máy chủ.
function dayOfWeek(dateStr) {
  return DAYS[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

function openDb(dbPath) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath === ':memory:' ? ':memory:' : path.resolve(dbPath));
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  if (db.prepare('SELECT COUNT(*) AS c FROM sync_meta').get().c === 0) {
    db.prepare('INSERT INTO sync_meta (id) VALUES (1)').run();
  }

  const stmts = {
    upsertMeeting: db.prepare(`
      INSERT INTO meetings (meeting_id, meeting_name, meeting_time, team, main_tag, doc_url,
                            folder_url, chat_thread, attendees, attendee_count, status,
                            confirmed, confirmed_at, is_untagged, is_deleted, synced_at)
      VALUES (@meeting_id, @meeting_name, @meeting_time, @team, @main_tag, @doc_url,
              @folder_url, @chat_thread, @attendees, @attendee_count, @status,
              @confirmed, @confirmed_at, @is_untagged, 0, datetime('now'))
      ON CONFLICT(meeting_id) DO UPDATE SET
        meeting_name = excluded.meeting_name, meeting_time = excluded.meeting_time,
        team = excluded.team, main_tag = excluded.main_tag, doc_url = excluded.doc_url,
        folder_url = excluded.folder_url, chat_thread = excluded.chat_thread,
        attendees = excluded.attendees, attendee_count = excluded.attendee_count,
        status = excluded.status, confirmed = excluded.confirmed,
        confirmed_at = excluded.confirmed_at, is_untagged = excluded.is_untagged,
        is_deleted = 0, synced_at = datetime('now')
    `),

    upsertReview: db.prepare(`
      INSERT INTO reviews (id, meeting_id, meeting_name, meeting_time, team, main_tag, doc_url,
                           folder_url, review_type, reviewed_at, attendees_granted,
                           sent_to_attendees_at, review_hours, is_untagged,
                           is_deleted, synced_at)
      VALUES (@id, @meeting_id, @meeting_name, @meeting_time, @team, @main_tag, @doc_url,
              @folder_url, @review_type, @reviewed_at, @attendees_granted,
              @sent_to_attendees_at, @review_hours, @is_untagged,
              0, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        meeting_name = excluded.meeting_name, meeting_time = excluded.meeting_time,
        team = excluded.team, main_tag = excluded.main_tag, doc_url = excluded.doc_url,
        folder_url = excluded.folder_url, review_type = excluded.review_type,
        attendees_granted = excluded.attendees_granted,
        sent_to_attendees_at = excluded.sent_to_attendees_at,
        review_hours = excluded.review_hours,
        is_untagged = excluded.is_untagged, is_deleted = 0, synced_at = datetime('now')
    `),

    markMeetingDeleted: db.prepare('UPDATE meetings SET is_deleted = 1 WHERE meeting_id = ?'),
    markReviewDeleted: db.prepare('UPDATE reviews SET is_deleted = 1 WHERE id = ?'),
    getActiveMeetingIds: db.prepare('SELECT meeting_id AS id FROM meetings WHERE is_deleted = 0'),
    getActiveReviewIds: db.prepare('SELECT id FROM reviews WHERE is_deleted = 0'),
    countActiveMeetings: db.prepare('SELECT COUNT(*) AS c FROM meetings WHERE is_deleted = 0'),
    existsMeeting: db.prepare('SELECT 1 AS v FROM meetings WHERE meeting_id = ?'),
    existsReview: db.prepare('SELECT 1 AS v FROM reviews WHERE id = ?'),

    getMeta: db.prepare('SELECT * FROM sync_meta WHERE id = 1'),
    updateMeta: db.prepare(`
      UPDATE sync_meta SET
        last_synced_at = datetime('now'),
        rows_in_sheet = @rows_in_sheet,
        rows_in_db = @rows_in_db,
        last_new_rows = @last_new_rows,
        last_deleted = @last_deleted,
        last_updated = @last_updated,
        fingerprint = @fingerprint,
        last_status = @last_status
      WHERE id = 1
    `),
  };

  const replaceAllTx = db.transaction((meetings, reviews) => {
    let inserted = 0;
    let updated = 0;
    let deleted = 0;

    for (const m of meetings) {
      if (stmts.existsMeeting.get(m.meeting_id)) updated++; else inserted++;
      stmts.upsertMeeting.run(m);
    }
    for (const r of reviews) {
      if (stmts.existsReview.get(r.id)) updated++; else inserted++;
      stmts.upsertReview.run(r);
    }

    const keepMeetings = new Set(meetings.map(m => m.meeting_id));
    for (const row of stmts.getActiveMeetingIds.all()) {
      if (!keepMeetings.has(row.id)) { stmts.markMeetingDeleted.run(row.id); deleted++; }
    }
    const keepReviews = new Set(reviews.map(r => r.id));
    for (const row of stmts.getActiveReviewIds.all()) {
      if (!keepReviews.has(row.id)) { stmts.markReviewDeleted.run(row.id); deleted++; }
    }

    return { inserted, updated, deleted };
  });

  function replaceAll(meetings, reviews) {
    return replaceAllTx(meetings, reviews);
  }

  const placeholders = COUNTED_STATUSES.map(() => '?').join(',');

  // Dòng chưa gắn tag vẫn vào mọi thống kê dưới nhãn UNTAGGED, để tổng của các
  // biểu đồ theo team luôn khớp với KPI tổng. untagged_raw giữ nguyên cho cảnh báo.
  const UNTAGGED = 'UNTAGGED';
  const teamLabel = row => (row.is_untagged || !row.team) ? UNTAGGED : row.team.toUpperCase();

  function getDashboardData() {
    const meetingRows = db.prepare(`
      SELECT meeting_time, status, team, is_untagged, meeting_name, main_tag, attendee_count
      FROM meetings
      WHERE is_deleted = 0 AND status IN (${placeholders})
    `).all(...COUNTED_STATUSES);

    const raw = meetingRows.map(r => {
      const dateStr = r.meeting_time.slice(0, 10);
      return {
        date_str: dateStr,
        status_clean: r.status,
        team: teamLabel(r),
        title: r.meeting_name || '(No title)',
        tags_norm: r.main_tag || 'uncategorized',
        dow: dayOfWeek(dateStr),
        attendee_count: r.attendee_count,
      };
    });

    // Chỉ lấy lần review đầu tiên của mỗi cuộc họp; 're-reviewed' bị loại để không đếm trùng.
    const reviewRows = db.prepare(`
      SELECT meeting_time, reviewed_at, team, is_untagged, meeting_name, main_tag, review_hours
      FROM reviews
      WHERE is_deleted = 0 AND review_type = 'reviewed'
    `).all();

    const reviewed = reviewRows.map(r => {
      const dateStr = (r.meeting_time || r.reviewed_at).slice(0, 10);
      return {
        date_str: dateStr,
        status_clean: 'reviewed',
        team: teamLabel(r),
        review_hours: r.review_hours,
        title: r.meeting_name || '(No title)',
        tags_norm: r.main_tag || 'uncategorized',
        dow: dayOfWeek(dateStr),
        attendee_count: 0,
      };
    });

    const team_n = {};
    for (const row of raw) {
      team_n[row.team] = (team_n[row.team] || 0) + 1;
    }

    const untagged_raw = db.prepare(`
      SELECT COUNT(*) AS c
      FROM meetings
      WHERE is_deleted = 0 AND is_untagged = 1 AND status IN (${placeholders})
    `).get(...COUNTED_STATUSES).c;

    return { raw, reviewed, team_n, untagged_raw };
  }

  // ── Settings ────────────────────────────────────────────────
  // Giá trị lưu dạng JSON để mảng (review_time_groups) cũng cất được.
  function readSettings() {
    const out = {};
    for (const r of db.prepare('SELECT key, value FROM settings').all()) {
      try { out[r.key] = JSON.parse(r.value) } catch { /* dòng hỏng thì bỏ qua */ }
    }
    return out;
  }

  function writeSettings(values) {
    const up = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    db.transaction(rows => { for (const r of rows) up.run(r) })(
      Object.entries(values).map(([key, value]) => ({ key, value: JSON.stringify(value) }))
    );
  }

  function deleteSettings(keys) {
    const del = db.prepare('DELETE FROM settings WHERE key = ?');
    db.transaction(ks => { for (const k of ks) del.run(k) })(keys);
  }

  return { db, stmts, replaceAll, getDashboardData, readSettings, writeSettings, deleteSettings };
}

// Instance mặc định dùng chung cho toàn app.
const defaultStore = openDb(process.env.DB_PATH || './data/sunflower.db');

module.exports = {
  openDb,
  COUNTED_STATUSES,
  db: defaultStore.db,
  stmts: defaultStore.stmts,
  replaceAll: defaultStore.replaceAll,
  getDashboardData: defaultStore.getDashboardData,
  readSettings: defaultStore.readSettings,
  writeSettings: defaultStore.writeSettings,
  deleteSettings: defaultStore.deleteSettings,
};
