# EVC Sunflower — Google Sheets ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay nguồn dữ liệu của dashboard từ webhook n8n sang đọc trực tiếp Google Sheets bằng service account, với schema `meetings` / `reviews` nối nhau bằng `meeting_id`.

**Architecture:** Một tầng đọc sheet thuần tuý (`sheets.js`) đưa dữ liệu thô cho một tầng biến đổi thuần hàm (`lib/parse.js`, `lib/transform.js`), rồi `sync.js` ghi kết quả vào SQLite trong một transaction. Route `/api/data` đọc từ DB và giữ nguyên hợp đồng JSON cũ để không phải đụng vào phần tính toán client-side của frontend.

**Tech Stack:** Node 22, Express 4, better-sqlite3 11, googleapis, `node:test` (built-in).

**Spec:** `docs/superpowers/specs/2026-09-18-sheets-ingest-design.md`

## Global Constraints

- Không thêm dependency nào ngoài `googleapis` (đã cài). Test dùng `node:test` built-in.
- Mọi mốc thời gian lưu trong DB là chuỗi ISO 8601 kèm offset `+07:00`.
- Ngưỡng SLA đọc từ `process.env.SLA_HOURS`, mặc định `4`. Không hardcode số 4 trong logic.
- Hợp đồng `GET /api/data` phải giữ đúng shape `{ raw[], reviewed[], team_n{}, untagged_raw }`; frontend không được sửa phần tính toán.
- Hàm biến đổi phải thuần: không đọc env, không chạm DB, không gọi mạng — nhận tham số và trả giá trị.
- Sync lỗi không được làm chết process.
- Tên team lưu trong DB là chữ thường; `/api/data` trả về chữ hoa.
- Không commit file key service account. `.gitignore` đã chặn `sunflower-alert-*.json`.

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/lib/parse.js` (mới) | Parse giá trị ô thô: ngày `dd/MM/yyyy HH:mm:ss`, boolean `TRUE/FALSE`, danh sách người dự. |
| `backend/lib/transform.js` (mới) | Biến dòng sheet thành bản ghi DB: map trạng thái, đánh dấu untagged, phân loại lần review, tính `review_hours` / SLA. |
| `backend/sheets.js` (mới) | Auth service account, `values.batchGet`, đổi mảng giá trị thành mảng object theo header. |
| `backend/db.js` (viết lại) | Schema `meetings` / `reviews` / `sync_meta`, prepared statements, `getDashboardData()`. |
| `backend/sync.js` (mới) | Điều phối: fetch → transform → ghi DB trong transaction → cập nhật `sync_meta` → emit SSE. Chạy theo interval. |
| `backend/routes/data.js` (sửa) | Trả `getDashboardData()`. |
| `backend/server.js` (sửa) | Bỏ mount `routes/sync`, khởi động vòng sync, thêm `POST /api/sync/manual`. |
| `backend/cron.js`, `backend/routes/sync.js` | Xoá. |
| `frontend/index.html` (sửa) | Gỡ tab Cross Check. |
| `tests/*.test.js` (mới) | Test cho parse, transform, db, sync, route. |
| `tests/fixtures/sheet-rows.js` (mới) | Dữ liệu thật đã dump từ sheet. |

---

### Task 1: Parse layer và test harness

**Files:**
- Create: `backend/lib/parse.js`
- Create: `tests/parse.test.js`
- Modify: `package.json` (thêm script `test`)

**Interfaces:**
- Consumes: không có.
- Produces:
  - `parseSheetDate(value: string) -> string | null` — `"12/09/2026 20:59:32"` → `"2026-09-12T20:59:32+07:00"`. Thiếu phần giờ thì mặc định `00:00:00`. Không parse được trả `null`.
  - `parseBool(value: string) -> boolean` — `"TRUE"` (không phân biệt hoa thường, có khoảng trắng thừa) → `true`, còn lại `false`.
  - `attendeeList(value: string) -> string[]` — tách theo dấu phẩy, bỏ khoảng trắng, bỏ phần tử rỗng.
  - `countAttendees(value: string) -> number`

- [ ] **Step 1: Thêm script test vào package.json**

Trong `package.json`, thêm vào khối `scripts`:

```json
"test": "node --test \"tests/*.test.js\""
```

- [ ] **Step 2: Viết test thất bại**

Tạo `tests/parse.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { parseSheetDate, parseBool, attendeeList, countAttendees } = require('../backend/lib/parse');

test('parseSheetDate đổi dd/MM/yyyy HH:mm:ss sang ISO +07:00', () => {
  assert.strictEqual(parseSheetDate('12/09/2026 20:59:32'), '2026-09-12T20:59:32+07:00');
});

test('parseSheetDate đệm số 0 cho ngày và tháng một chữ số', () => {
  assert.strictEqual(parseSheetDate('4/6/2026 8:05:01'), '2026-06-04T08:05:01+07:00');
});

test('parseSheetDate mặc định 00:00:00 khi thiếu phần giờ', () => {
  assert.strictEqual(parseSheetDate('26/05/2026'), '2026-05-26T00:00:00+07:00');
});

test('parseSheetDate trả null với giá trị rỗng hoặc sai định dạng', () => {
  assert.strictEqual(parseSheetDate(''), null);
  assert.strictEqual(parseSheetDate('   '), null);
  assert.strictEqual(parseSheetDate(undefined), null);
  assert.strictEqual(parseSheetDate('hôm qua'), null);
  assert.strictEqual(parseSheetDate('2026-09-12T20:59:32Z'), null);
});

test('parseBool chỉ nhận TRUE', () => {
  assert.strictEqual(parseBool('TRUE'), true);
  assert.strictEqual(parseBool(' true '), true);
  assert.strictEqual(parseBool('FALSE'), false);
  assert.strictEqual(parseBool(''), false);
  assert.strictEqual(parseBool(undefined), false);
});

test('attendeeList tách theo dấu phẩy và bỏ phần tử rỗng', () => {
  assert.deepStrictEqual(
    attendeeList('nam.tran@earth.vc, duc.pham@earth.vc ,, linh@earth.vc'),
    ['nam.tran@earth.vc', 'duc.pham@earth.vc', 'linh@earth.vc']
  );
  assert.deepStrictEqual(attendeeList(''), []);
  assert.deepStrictEqual(attendeeList(undefined), []);
});

test('countAttendees đếm số người dự', () => {
  assert.strictEqual(countAttendees('a@x.vc, b@x.vc'), 2);
  assert.strictEqual(countAttendees(''), 0);
});
```

- [ ] **Step 3: Chạy test để xác nhận nó fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../backend/lib/parse'`

- [ ] **Step 4: Viết implementation tối thiểu**

Tạo `backend/lib/parse.js`:

```js
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
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `npm test`
Expected: PASS, 6 test

- [ ] **Step 6: Commit**

```bash
git add package.json backend/lib/parse.js tests/parse.test.js
git commit -m "feat: thêm parse layer cho giá trị ô từ Google Sheets"
```

---

### Task 2: Fixture dữ liệu thật

**Files:**
- Create: `tests/fixtures/sheet-rows.js`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `rawRows: object[]` — 6 dòng tab `raw`, key đúng tên header của sheet.
  - `reviewedRows: object[]` — 2 dòng tab `reviewed`, key đúng tên header của sheet.

Các task sau dùng fixture này làm đầu vào cho transform và sync, nên không task nào được tự chế dữ liệu riêng.

- [ ] **Step 1: Tạo file fixture**

Tạo `tests/fixtures/sheet-rows.js`:

```js
/**
 * Dữ liệu thật dump từ spreadsheet [Sunflower] EVC_n8n_config, ngày 2026-09-18.
 * Webhook và token đã được thay bằng giá trị giả vì không cần cho test.
 */

const rawRows = [
  {
    meeting_id: 'eMfgyZJDJuQecQrGQIlgs',
    meeting_name: 'IC Meeting: Frontier Computing - 12-09-2026 20:59',
    meeting_time: '12/09/2026 20:59:32',
    team: 'Investment',
    main_tag: 'Investment',
    doc_url: 'https://docs.google.com/document/d/17NJ00j2WPlunw9c15ecwJxbtAkM_b_g32G527AY0n0E/edit',
    folder_url: 'https://drive.google.com/drive/folders/1o6O4rc0_g07S8itVvHsjMoLia9Crky-T',
    space_chat_webhook: 'https://chat.googleapis.com/v1/spaces/FAKE/messages',
    chat_thread: 'spaces/FAKE/threads/kB9OaG0NGpY',
    attendees: 'nam.tran@earth.vc, duc.pham@earth.vc, linh@earth.vc, tien@earth.vc, hien.dao@earth.vc',
    status: 'reviewed',
    confirmed_at: '14/09/2026 11:55:14',
    confirm: 'TRUE',
  },
  {
    meeting_id: 'LpH4pNKtxuhqxeyMvN5qq',
    meeting_name: 'IC meeting: Syre - 04-06-2026 20:00',
    meeting_time: '04/06/2026 20:00:42',
    team: 'Investment',
    main_tag: 'Investment',
    doc_url: 'https://docs.google.com/document/d/1M-jz_SxfFszV_y55MD3W5cS-x6dRSQUv5rhYPQn7SnM/edit',
    folder_url: 'https://drive.google.com/drive/folders/1o6O4rc0_g07S8itVvHsjMoLia9Crky-T',
    space_chat_webhook: 'https://chat.googleapis.com/v1/spaces/FAKE/messages',
    chat_thread: 'spaces/FAKE/threads/9jHeYEa8_WE',
    attendees: 'nam.tran@earth.vc, duc.pham@earth.vc, linh@earth.vc, tien@earth.vc, hien.dao@earth.vc',
    status: 'discarded',
    confirmed_at: '14/09/2026 11:55:14',
    confirm: 'TRUE',
  },
  {
    meeting_id: 'YpeVKsm4HsSDcgcs3VuNy',
    meeting_name: 'IC meeting: Enerzolve - 26-05-2026 08:30',
    meeting_time: '26/05/2026 08:30:37',
    team: 'Investment',
    main_tag: 'Investment',
    doc_url: 'https://docs.google.com/document/d/1G3gFSma48_ZRJ5LXqNZrFSTSaZOVqPrE0aa3bNC2AMU/edit',
    folder_url: 'https://drive.google.com/drive/folders/1o6O4rc0_g07S8itVvHsjMoLia9Crky-T',
    space_chat_webhook: 'https://chat.googleapis.com/v1/spaces/FAKE/messages',
    chat_thread: 'spaces/FAKE/threads/dKmuub-GzIk',
    attendees: 'nam.tran@earth.vc, duc.pham@earth.vc, linh@earth.vc, tien@earth.vc, hien.dao@earth.vc',
    status: 'discarded',
    confirmed_at: '14/09/2026 11:55:14',
    confirm: 'TRUE',
  },
  {
    meeting_id: '4055170',
    meeting_name: 'IC Meeting: RLWRLD - 26-09-2025 21:30',
    meeting_time: '26/09/2025 21:30:44',
    team: 'Investment',
    main_tag: 'Investment',
    doc_url: 'https://docs.google.com/document/d/16ChsfwuSG2RjKMAP5YD4xwKdD4jfvG-bPXjJzarpokw/edit',
    folder_url: 'https://drive.google.com/drive/folders/1o6O4rc0_g07S8itVvHsjMoLia9Crky-T',
    space_chat_webhook: 'https://chat.googleapis.com/v1/spaces/FAKE/messages',
    chat_thread: 'spaces/FAKE/threads/K5Zrr6pEcoo',
    attendees: 'nam.tran@earth.vc, duc.pham@earth.vc, linh@earth.vc, tien@earth.vc, son.vu@earth.vc, tam.to@earth.vc, atlan.nguyen@earth.vc, an.ha@earth.vc',
    status: 'reviewed',
    confirmed_at: '14/09/2026 14:16:06',
    confirm: 'TRUE',
  },
  {
    meeting_id: 'CPD0DN4z8jQWJFCxlAoY1',
    meeting_name: '[Tentative] IC meeting: Enerzolve - 24-05-2026 20:59',
    meeting_time: '24/05/2026 20:59:56',
    team: '',
    main_tag: 'uncat',
    doc_url: 'https://docs.google.com/document/d/1mFdIlWIrPmnuFnijILnrxJZU2tn2GgKAbG8Y0qRQ0gQ/edit',
    folder_url: 'https://drive.google.com/drive/folders/1CICbq9_B5z8uA7wRuITACXcVaJoDDEYQ',
    space_chat_webhook: '',
    chat_thread: '',
    attendees: 'nam.tran@earth.vc, duc.pham@earth.vc, linh@earth.vc, tien@earth.vc, hien.dao@earth.vc',
    status: 'pending',
    confirmed_at: '',
    confirm: 'FALSE',
  },
  {
    meeting_id: 'Wq7xTESTpendingconfirmed',
    meeting_name: '[Marcom] Weekly Sync - 15-09-2026 09:00',
    meeting_time: '15/09/2026 09:00:00',
    team: 'Marcom',
    main_tag: 'Marcom',
    doc_url: 'https://docs.google.com/document/d/1MarcomWeeklySyncDocIdPlaceholder/edit',
    folder_url: 'https://drive.google.com/drive/folders/1i7y18RjESz4raRR3c-LQKaX3dDBQZBO4',
    space_chat_webhook: 'https://chat.googleapis.com/v1/spaces/FAKE/messages',
    chat_thread: 'spaces/FAKE/threads/marcomweekly',
    attendees: 'tam.to@earth.vc, phuong.ha@earth.vc',
    status: 'pending',
    confirmed_at: '15/09/2026 09:30:00',
    confirm: 'TRUE',
  },
];

const reviewedRows = [
  {
    meeting_id: 'eMfgyZJDJuQecQrGQIlgs',
    meeting_name: 'IC Meeting: Frontier Computing - 12-09-2026 20:59',
    meeting_time: '12/09/2026 20:59:32',
    team: 'Investment',
    main_tag: 'Investment',
    doc_url: 'https://docs.google.com/document/d/1MNMXr3Fho6VxmmoF3bgVShya8IJF1E8sWQ2tNVz8MK0/edit',
    folder_url: 'https://drive.google.com/drive/folders/1WkzY41rleM_ZdC5FFgX-IgIEsE5Ia5jI',
    review_type: 'reviewed',
    reviewed_at: '14/09/2026 14:26:45',
    attendees_granted: 'duc.pham@earth.vc, hien.dao@earth.vc, nam.tran@earth.vc, linh@earth.vc, tien@earth.vc',
    sent_to_attendees_at: '',
  },
  {
    meeting_id: '4055170',
    meeting_name: 'IC Meeting: RLWRLD - 26-09-2025 21:30',
    meeting_time: '26/09/2025 21:30:44',
    team: 'Investment',
    main_tag: 'Investment',
    doc_url: 'https://docs.google.com/document/d/1nHe5ZoYxDRjWRoxYgA1shBvlcHKLOnoKBqgt11Xs_Rk/edit',
    folder_url: 'https://drive.google.com/drive/folders/1WkzY41rleM_ZdC5FFgX-IgIEsE5Ia5jI',
    review_type: 'reviewed',
    reviewed_at: '14/09/2026 17:26:43',
    attendees_granted: 'duc.pham@earth.vc, nam.tran@earth.vc, linh@earth.vc, tien@earth.vc, tam.to@earth.vc, atlan.nguyen@earth.vc',
    sent_to_attendees_at: '',
  },
];

module.exports = { rawRows, reviewedRows };
```

Dòng `raw` cuối cùng (`Wq7xTESTpendingconfirmed`) là dòng dựng thêm để phủ trường hợp
`confirm = TRUE` nhưng `status` vẫn `pending` — sheet thật chưa có dòng nào như vậy nhưng
ánh xạ trạng thái bắt buộc phải xử lý được.

- [ ] **Step 2: Kiểm file load được**

Run: `node -e "const f=require('./tests/fixtures/sheet-rows'); console.log(f.rawRows.length, f.reviewedRows.length)"`
Expected: in ra `6 2`

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/sheet-rows.js
git commit -m "test: thêm fixture dữ liệu thật từ sheet EVC"
```

---

### Task 3: Transform layer cho `meetings`

**Files:**
- Create: `backend/lib/transform.js`
- Create: `tests/transform-meetings.test.js`

**Interfaces:**
- Consumes: `parseSheetDate`, `parseBool`, `countAttendees` từ `backend/lib/parse`; fixture `rawRows`.
- Produces:
  - `MEETING_STATUSES = ['pending', 'confirmed', 'reviewed', 'discarded']`
  - `toMeeting(row: object) -> object | null` — trả `null` nếu thiếu `meeting_id` hoặc `meeting_time` không parse được. Object trả về có đúng các field: `meeting_id, meeting_name, meeting_time, team, main_tag, doc_url, folder_url, chat_thread, attendees, attendee_count, status, confirmed, confirmed_at, is_untagged`.
  - `isUntagged(team: string, mainTag: string) -> boolean`

Quy tắc ánh xạ trạng thái, đúng theo spec: `status` của sheet là `discarded` → `discarded`;
là `reviewed` → `reviewed`; ngược lại `confirm` TRUE → `confirmed`, FALSE → `pending`.
Giá trị `status` lạ (không nằm trong `pending/reviewed/discarded`) thì giữ nguyên giá trị
gốc để `/api/data` lọc bỏ, và ghi cảnh báo qua callback `onWarn`.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/transform-meetings.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { toMeeting, isUntagged } = require('../backend/lib/transform');
const { rawRows } = require('./fixtures/sheet-rows');

const byId = id => rawRows.find(r => r.meeting_id === id);

test('toMeeting map các field cơ bản và hạ team về chữ thường', () => {
  const m = toMeeting(byId('eMfgyZJDJuQecQrGQIlgs'));
  assert.strictEqual(m.meeting_id, 'eMfgyZJDJuQecQrGQIlgs');
  assert.strictEqual(m.meeting_time, '2026-09-12T20:59:32+07:00');
  assert.strictEqual(m.team, 'investment');
  assert.strictEqual(m.main_tag, 'Investment');
  assert.strictEqual(m.attendee_count, 5);
  assert.strictEqual(m.confirmed, 1);
  assert.strictEqual(m.confirmed_at, '2026-09-14T11:55:14+07:00');
  assert.strictEqual(m.is_untagged, 0);
});

test('toMeeting giữ trạng thái reviewed và discarded từ sheet', () => {
  assert.strictEqual(toMeeting(byId('eMfgyZJDJuQecQrGQIlgs')).status, 'reviewed');
  assert.strictEqual(toMeeting(byId('LpH4pNKtxuhqxeyMvN5qq')).status, 'discarded');
});

test('toMeeting cho ra pending khi chưa confirm', () => {
  const m = toMeeting(byId('CPD0DN4z8jQWJFCxlAoY1'));
  assert.strictEqual(m.status, 'pending');
  assert.strictEqual(m.confirmed, 0);
  assert.strictEqual(m.confirmed_at, null);
});

test('toMeeting cho ra confirmed khi đã confirm nhưng chưa review', () => {
  const m = toMeeting(byId('Wq7xTESTpendingconfirmed'));
  assert.strictEqual(m.status, 'confirmed');
  assert.strictEqual(m.confirmed, 1);
});

test('toMeeting đánh dấu untagged khi thiếu team hoặc main_tag là uncat', () => {
  assert.strictEqual(toMeeting(byId('CPD0DN4z8jQWJFCxlAoY1')).is_untagged, 1);
  assert.strictEqual(isUntagged('', 'Marcom'), true);
  assert.strictEqual(isUntagged('marcom', 'uncat'), true);
  assert.strictEqual(isUntagged('marcom', 'Marcom'), false);
});

test('toMeeting giữ nguyên status lạ và báo cảnh báo', () => {
  const warnings = [];
  const m = toMeeting(
    { ...byId('Wq7xTESTpendingconfirmed'), status: 'archived' },
    { onWarn: w => warnings.push(w) }
  );
  assert.strictEqual(m.status, 'archived');
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /archived/);
});

test('toMeeting trả null khi thiếu meeting_id hoặc meeting_time hỏng', () => {
  assert.strictEqual(toMeeting({ ...byId('4055170'), meeting_id: '' }), null);
  assert.strictEqual(toMeeting({ ...byId('4055170'), meeting_time: 'hôm qua' }), null);
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- tests/transform-meetings.test.js`
Expected: FAIL — `Cannot find module '../backend/lib/transform'`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `backend/lib/transform.js`:

```js
/**
 * Biến dòng thô của sheet thành bản ghi sẵn sàng ghi vào DB.
 * Toàn bộ hàm ở đây là hàm thuần: không đọc env, không chạm DB, không gọi mạng.
 */

const { parseSheetDate, parseBool, countAttendees } = require('./parse');

const MEETING_STATUSES = ['pending', 'confirmed', 'reviewed', 'discarded'];
const SHEET_STATUSES = ['pending', 'reviewed', 'discarded'];

function isUntagged(team, mainTag) {
  const t = (team || '').trim();
  const tag = (mainTag || '').trim().toLowerCase();
  return t === '' || tag === 'uncat' || tag === '';
}

function mapStatus(sheetStatus, confirmed, onWarn) {
  const s = (sheetStatus || '').trim().toLowerCase();
  if (s === 'discarded') return 'discarded';
  if (s === 'reviewed') return 'reviewed';
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

module.exports = { MEETING_STATUSES, isUntagged, toMeeting };
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test`
Expected: PASS, toàn bộ test của Task 1 và Task 3

- [ ] **Step 5: Commit**

```bash
git add backend/lib/transform.js tests/transform-meetings.test.js
git commit -m "feat: transform dòng tab raw thành bản ghi meetings"
```

---

### Task 4: Transform layer cho `reviews`

**Files:**
- Modify: `backend/lib/transform.js`
- Create: `tests/transform-reviews.test.js`

**Interfaces:**
- Consumes: `parseSheetDate` từ `backend/lib/parse`; `isUntagged` từ chính `transform.js`; fixture `reviewedRows`.
- Produces:
  - `computeReviewHours(reviewedAtIso: string|null, meetingTimeIso: string|null) -> number | null` — chênh lệch giờ, làm tròn 2 chữ số. Trả `null` khi thiếu đầu vào hoặc kết quả âm.
  - `toReviews(rows: object[], opts?: { slaHours?: number, meetingTimeById?: Record<string,string>, onWarn?: fn }) -> object[]` — trả mảng bản ghi `reviews`, đã gán `review_type` theo thứ tự `reviewed_at` trong cùng `meeting_id`. `slaHours` mặc định `4`. Mỗi bản ghi có field: `id, meeting_id, meeting_name, meeting_time, team, main_tag, doc_url, folder_url, review_type, reviewed_at, attendees_granted, sent_to_attendees_at, review_hours, is_sla_breach, is_untagged`.

`id` của review là `` `${meeting_id}|${reviewed_at}` ``.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/transform-reviews.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { toReviews, computeReviewHours } = require('../backend/lib/transform');
const { reviewedRows } = require('./fixtures/sheet-rows');

test('computeReviewHours tính chênh lệch giờ và làm tròn 2 chữ số', () => {
  assert.strictEqual(
    computeReviewHours('2026-09-12T23:59:32+07:00', '2026-09-12T20:59:32+07:00'),
    3
  );
  assert.strictEqual(
    computeReviewHours('2026-09-12T22:29:32+07:00', '2026-09-12T20:59:32+07:00'),
    1.5
  );
});

test('computeReviewHours trả null khi thiếu đầu vào hoặc kết quả âm', () => {
  assert.strictEqual(computeReviewHours(null, '2026-09-12T20:59:32+07:00'), null);
  assert.strictEqual(computeReviewHours('2026-09-12T20:59:32+07:00', null), null);
  assert.strictEqual(
    computeReviewHours('2026-09-12T19:00:00+07:00', '2026-09-12T20:59:32+07:00'),
    null
  );
});

test('toReviews tính review_hours từ meeting_time nằm sẵn trong dòng review', () => {
  const [r] = toReviews([reviewedRows[0]]);
  assert.strictEqual(r.id, 'eMfgyZJDJuQecQrGQIlgs|2026-09-14T14:26:45+07:00');
  assert.strictEqual(r.reviewed_at, '2026-09-14T14:26:45+07:00');
  assert.strictEqual(r.meeting_time, '2026-09-12T20:59:32+07:00');
  assert.strictEqual(r.review_hours, 41.45);
  assert.strictEqual(r.team, 'investment');
});

test('toReviews đánh SLA breach theo ngưỡng truyền vào', () => {
  const rows = [{ ...reviewedRows[0], reviewed_at: '12/09/2026 23:59:32' }];
  assert.strictEqual(toReviews(rows, { slaHours: 4 })[0].is_sla_breach, 0);
  assert.strictEqual(toReviews(rows, { slaHours: 2 })[0].is_sla_breach, 1);
});

test('toReviews dùng đúng ngưỡng biên: đúng 4 giờ không phải breach', () => {
  const rows = [{ ...reviewedRows[0], reviewed_at: '13/09/2026 00:59:32' }];
  const [r] = toReviews(rows, { slaHours: 4 });
  assert.strictEqual(r.review_hours, 4);
  assert.strictEqual(r.is_sla_breach, 0);
});

test('toReviews lấy meeting_time từ bảng tra cứu khi dòng review thiếu', () => {
  const rows = [{ ...reviewedRows[0], meeting_time: '' }];
  const [r] = toReviews(rows, {
    meetingTimeById: { eMfgyZJDJuQecQrGQIlgs: '2026-09-12T20:59:32+07:00' },
  });
  assert.strictEqual(r.review_hours, 41.45);
});

test('toReviews để review_hours null khi không có nguồn meeting_time nào', () => {
  const [r] = toReviews([{ ...reviewedRows[0], meeting_time: '' }]);
  assert.strictEqual(r.review_hours, null);
  assert.strictEqual(r.is_sla_breach, 0);
});

test('toReviews phân loại re-reviewed theo thứ tự reviewed_at, bỏ qua cột review_type của sheet', () => {
  const rows = [
    { ...reviewedRows[0], reviewed_at: '16/09/2026 09:00:00', review_type: 'reviewed' },
    { ...reviewedRows[0], reviewed_at: '14/09/2026 14:26:45', review_type: 're-reviewed' },
    { ...reviewedRows[0], reviewed_at: '15/09/2026 08:00:00', review_type: 'reviewed' },
  ];
  const out = toReviews(rows).sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
  assert.deepStrictEqual(out.map(r => r.review_type), ['reviewed', 're-reviewed', 're-reviewed']);
});

test('toReviews bỏ dòng thiếu meeting_id hoặc reviewed_at hỏng', () => {
  const out = toReviews([
    { ...reviewedRows[0], meeting_id: '' },
    { ...reviewedRows[1], reviewed_at: 'hôm qua' },
  ]);
  assert.strictEqual(out.length, 0);
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- tests/transform-reviews.test.js`
Expected: FAIL — `toReviews is not a function`

- [ ] **Step 3: Viết implementation**

Thêm vào `backend/lib/transform.js`, ngay trước dòng `module.exports`:

```js
const DEFAULT_SLA_HOURS = 4;

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
```

Và đổi dòng export cuối file thành:

```js
module.exports = {
  MEETING_STATUSES,
  isUntagged,
  toMeeting,
  toReviews,
  computeReviewHours,
  DEFAULT_SLA_HOURS,
};
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/lib/transform.js tests/transform-reviews.test.js
git commit -m "feat: transform dòng tab reviewed, tính review_hours và SLA"
```

---

### Task 5: Viết lại `db.js`

**Files:**
- Modify: `backend/db.js` (thay toàn bộ nội dung)
- Create: `tests/db.test.js`

**Interfaces:**
- Consumes: bản ghi từ `toMeeting` / `toReviews`.
- Produces:
  - `openDb(dbPath: string) -> { db, stmts, getDashboardData, replaceAll }`
  - `stmts`: `upsertMeeting, upsertReview, markMeetingDeleted, markReviewDeleted, getActiveMeetingIds, getActiveReviewIds, getMeta, updateMeta, countActiveMeetings`
  - `replaceAll(meetings: object[], reviews: object[]) -> { inserted, updated, deleted }` — chạy trong một transaction, upsert tất cả và đánh `is_deleted = 1` cho bản ghi không còn trong sheet.
  - `getDashboardData() -> { raw, reviewed, team_n, untagged_raw }`
  - Module cũng export sẵn một instance mặc định mở theo `process.env.DB_PATH` để route dùng: `db`, `stmts`, `getDashboardData`, `replaceAll`.

Cho phép truyền `dbPath` để test mở DB in-memory (`:memory:`) thay vì đụng vào file thật.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/db.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../backend/db');
const { toMeeting, toReviews } = require('../backend/lib/transform');
const { rawRows, reviewedRows } = require('./fixtures/sheet-rows');

function seed() {
  const store = openDb(':memory:');
  const meetings = rawRows.map(r => toMeeting(r)).filter(Boolean);
  const reviews = toReviews(reviewedRows, { slaHours: 4 });
  const result = store.replaceAll(meetings, reviews);
  return { store, result };
}

test('replaceAll ghi toàn bộ meetings và reviews', () => {
  const { store, result } = seed();
  assert.strictEqual(result.inserted, 8); // 6 meetings + 2 reviews
  assert.strictEqual(result.updated, 0);
  assert.strictEqual(result.deleted, 0);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
});

test('replaceAll lần hai đếm là updated chứ không phải inserted', () => {
  const { store } = seed();
  const meetings = rawRows.map(r => toMeeting(r)).filter(Boolean);
  const reviews = toReviews(reviewedRows, { slaHours: 4 });
  const again = store.replaceAll(meetings, reviews);
  assert.strictEqual(again.inserted, 0);
  assert.strictEqual(again.updated, 8);
});

test('replaceAll đánh dấu is_deleted cho dòng biến mất khỏi sheet', () => {
  const { store } = seed();
  const fewer = rawRows.slice(0, 3).map(r => toMeeting(r)).filter(Boolean);
  const result = store.replaceAll(fewer, []);
  assert.strictEqual(result.deleted, 5); // 3 meetings + 2 reviews
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 3);
});

test('replaceAll hồi sinh dòng quay lại sheet', () => {
  const { store } = seed();
  store.replaceAll([], []);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 0);
  const meetings = rawRows.map(r => toMeeting(r)).filter(Boolean);
  store.replaceAll(meetings, []);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
});

test('getDashboardData loại dòng discarded và dòng untagged khỏi raw', () => {
  const { store } = seed();
  const data = store.getDashboardData();
  // 6 dòng: 2 discarded bị loại, 1 untagged bị loại → còn 3
  assert.strictEqual(data.raw.length, 3);
  assert.strictEqual(data.untagged_raw, 1);
  assert.ok(data.raw.every(r => r.team !== 'UNTAGGED'));
});

test('getDashboardData trả team viết hoa và date_str theo ngày họp', () => {
  const { store } = seed();
  const row = store.getDashboardData().raw.find(r => r.title.includes('Frontier Computing'));
  assert.strictEqual(row.team, 'INVESTMENT');
  assert.strictEqual(row.date_str, '2026-09-12');
  assert.strictEqual(row.status_clean, 'reviewed');
  assert.strictEqual(row.dow, 'Saturday');
  assert.strictEqual(row.attendee_count, 5);
});

test('getDashboardData chỉ trả review_type reviewed, kèm review_hours', () => {
  const { store } = seed();
  const data = store.getDashboardData();
  assert.strictEqual(data.reviewed.length, 2);
  const r = data.reviewed.find(x => x.title.includes('Frontier Computing'));
  assert.strictEqual(r.date_str, '2026-09-12');
  assert.strictEqual(r.status_clean, 'reviewed');
  assert.strictEqual(r.review_hours, 41.45);
});

test('getDashboardData đếm team_n theo team viết hoa', () => {
  const { store } = seed();
  const { team_n } = store.getDashboardData();
  assert.strictEqual(team_n.INVESTMENT, 2); // 2 discarded bị loại khỏi 4 dòng investment
  assert.strictEqual(team_n.MARCOM, 1);
  assert.ok(!('UNTAGGED' in team_n));
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- tests/db.test.js`
Expected: FAIL — `openDb is not a function`

- [ ] **Step 3: Thay toàn bộ nội dung `backend/db.js`**

```js
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
    is_sla_breach        INTEGER DEFAULT 0,
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
                           sent_to_attendees_at, review_hours, is_sla_breach, is_untagged,
                           is_deleted, synced_at)
      VALUES (@id, @meeting_id, @meeting_name, @meeting_time, @team, @main_tag, @doc_url,
              @folder_url, @review_type, @reviewed_at, @attendees_granted,
              @sent_to_attendees_at, @review_hours, @is_sla_breach, @is_untagged,
              0, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        meeting_name = excluded.meeting_name, meeting_time = excluded.meeting_time,
        team = excluded.team, main_tag = excluded.main_tag, doc_url = excluded.doc_url,
        folder_url = excluded.folder_url, review_type = excluded.review_type,
        attendees_granted = excluded.attendees_granted,
        sent_to_attendees_at = excluded.sent_to_attendees_at,
        review_hours = excluded.review_hours, is_sla_breach = excluded.is_sla_breach,
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

  function getDashboardData() {
    const meetingRows = db.prepare(`
      SELECT meeting_time, status, team, meeting_name, main_tag, attendee_count
      FROM meetings
      WHERE is_deleted = 0 AND is_untagged = 0 AND status IN (${placeholders})
    `).all(...COUNTED_STATUSES);

    const raw = meetingRows.map(r => {
      const dateStr = r.meeting_time.slice(0, 10);
      return {
        date_str: dateStr,
        status_clean: r.status,
        team: r.team.toUpperCase(),
        title: r.meeting_name || '(No title)',
        tags_norm: r.main_tag || 'uncategorized',
        dow: dayOfWeek(dateStr),
        attendee_count: r.attendee_count,
      };
    });

    // Chỉ lấy lần review đầu tiên của mỗi cuộc họp; 're-reviewed' bị loại để không đếm trùng.
    const reviewRows = db.prepare(`
      SELECT meeting_time, reviewed_at, team, meeting_name, main_tag, review_hours
      FROM reviews
      WHERE is_deleted = 0 AND is_untagged = 0 AND review_type = 'reviewed'
    `).all();

    const reviewed = reviewRows.map(r => {
      const dateStr = (r.meeting_time || r.reviewed_at).slice(0, 10);
      return {
        date_str: dateStr,
        status_clean: 'reviewed',
        team: r.team.toUpperCase(),
        review_hours: r.review_hours,
        title: r.meeting_name || '(No title)',
        tags_norm: r.main_tag || 'uncategorized',
        dow: dayOfWeek(dateStr),
        attendee_count: 0,
      };
    });

    const team_n = {};
    for (const row of db.prepare(`
      SELECT team, COUNT(*) AS c
      FROM meetings
      WHERE is_deleted = 0 AND is_untagged = 0 AND status IN (${placeholders})
      GROUP BY team
    `).all(...COUNTED_STATUSES)) {
      team_n[row.team.toUpperCase()] = row.c;
    }

    const untagged_raw = db.prepare(`
      SELECT COUNT(*) AS c
      FROM meetings
      WHERE is_deleted = 0 AND is_untagged = 1 AND status IN (${placeholders})
    `).get(...COUNTED_STATUSES).c;

    return { raw, reviewed, team_n, untagged_raw };
  }

  return { db, stmts, replaceAll, getDashboardData };
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
};
```

`attendee_count` của mảng `reviewed` để `0` vì tab `reviewed` không có cột người dự; frontend
không dùng field này cho nhánh reviewed.

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Xoá file DB cũ có schema không còn dùng**

```bash
rm -f data/sunflower.db data/sunflower.db-shm data/sunflower.db-wal
```

- [ ] **Step 6: Commit**

```bash
git add backend/db.js tests/db.test.js
git commit -m "feat: schema meetings/reviews thay bảng logs phẳng"
```

---

### Task 6: `sheets.js` — đọc Google Sheets

**Files:**
- Create: `backend/sheets.js`
- Create: `tests/sheets.test.js`

**Interfaces:**
- Consumes: `googleapis`.
- Produces:
  - `rowsToObjects(values: string[][]) -> object[]` — dòng đầu là header; ô thiếu trả `''`.
  - `fetchSheetRows({ sheetId, keyFile, client? }) -> Promise<{ raw: object[], reviewed: object[] }>` — `client` là tham số để test tiêm giả lập, có shape `{ spreadsheets: { values: { batchGet } } }`. Không truyền thì tự tạo client thật bằng service account.

Range đọc: `raw!A:M` và `reviewed!A:K`.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/sheets.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { rowsToObjects, fetchSheetRows } = require('../backend/sheets');

test('rowsToObjects dùng dòng đầu làm header', () => {
  const out = rowsToObjects([
    ['meeting_id', 'team', 'status'],
    ['abc', 'Investment', 'reviewed'],
  ]);
  assert.deepStrictEqual(out, [{ meeting_id: 'abc', team: 'Investment', status: 'reviewed' }]);
});

test('rowsToObjects điền chuỗi rỗng cho ô thiếu ở cuối dòng', () => {
  const out = rowsToObjects([
    ['meeting_id', 'team', 'status'],
    ['abc'],
  ]);
  assert.deepStrictEqual(out, [{ meeting_id: 'abc', team: '', status: '' }]);
});

test('rowsToObjects trả mảng rỗng khi sheet không có dữ liệu', () => {
  assert.deepStrictEqual(rowsToObjects([]), []);
  assert.deepStrictEqual(rowsToObjects([['meeting_id', 'team']]), []);
});

test('fetchSheetRows đọc đúng hai range và trả về hai mảng object', async () => {
  const calls = [];
  const client = {
    spreadsheets: {
      values: {
        batchGet: async (params) => {
          calls.push(params);
          return {
            data: {
              valueRanges: [
                { values: [['meeting_id', 'status'], ['m1', 'reviewed']] },
                { values: [['meeting_id', 'reviewed_at'], ['m1', '14/09/2026 14:26:45']] },
              ],
            },
          };
        },
      },
    },
  };

  const out = await fetchSheetRows({ sheetId: 'SHEET', client });
  assert.deepStrictEqual(calls[0].ranges, ['raw!A:M', 'reviewed!A:K']);
  assert.strictEqual(calls[0].spreadsheetId, 'SHEET');
  assert.deepStrictEqual(out.raw, [{ meeting_id: 'm1', status: 'reviewed' }]);
  assert.deepStrictEqual(out.reviewed, [{ meeting_id: 'm1', reviewed_at: '14/09/2026 14:26:45' }]);
});

test('fetchSheetRows chịu được range rỗng', async () => {
  const client = {
    spreadsheets: {
      values: { batchGet: async () => ({ data: { valueRanges: [{}, {}] } }) },
    },
  };
  const out = await fetchSheetRows({ sheetId: 'SHEET', client });
  assert.deepStrictEqual(out, { raw: [], reviewed: [] });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- tests/sheets.test.js`
Expected: FAIL — `Cannot find module '../backend/sheets'`

- [ ] **Step 3: Viết implementation**

Tạo `backend/sheets.js`:

```js
/**
 * Đọc dữ liệu thô từ Google Sheets bằng service account.
 * Tầng này không biết gì về DB hay nghiệp vụ: nó chỉ trả về mảng object theo header.
 */

const { google } = require('googleapis');

const RAW_RANGE = 'raw!A:M';
const REVIEWED_RANGE = 'reviewed!A:K';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

function rowsToObjects(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const [header, ...rows] = values;
  return rows.map(row => {
    const obj = {};
    header.forEach((key, i) => { obj[key] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

function createClient(keyFile) {
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
  return google.sheets({ version: 'v4', auth });
}

async function fetchSheetRows({ sheetId, keyFile, client }) {
  const sheets = client || createClient(keyFile);
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: [RAW_RANGE, REVIEWED_RANGE],
  });
  const [rawRange = {}, reviewedRange = {}] = res.data.valueRanges || [];
  return {
    raw: rowsToObjects(rawRange.values),
    reviewed: rowsToObjects(reviewedRange.values),
  };
}

module.exports = { rowsToObjects, fetchSheetRows, createClient, RAW_RANGE, REVIEWED_RANGE };
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/sheets.js tests/sheets.test.js
git commit -m "feat: đọc tab raw và reviewed từ Google Sheets"
```

---

### Task 7: `sync.js` — điều phối đồng bộ

**Files:**
- Create: `backend/sync.js`
- Create: `tests/sync.test.js`
- Delete: `backend/cron.js`, `backend/routes/sync.js`

**Interfaces:**
- Consumes: `fetchSheetRows` từ `backend/sheets`; `toMeeting`, `toReviews` từ `backend/lib/transform`; `replaceAll`, `stmts` từ `backend/db`.
- Produces:
  - `runSync(opts?) -> Promise<{ ok, inserted, updated, deleted, total, error? }>` — `opts` cho phép tiêm phụ thuộc khi test: `{ fetchRows, store, sseClients, slaHours, sheetId, keyFile, logger }`.
  - `startSyncLoop(app) -> void` — chạy `runSync` ngay một lần rồi lặp theo `SYNC_INTERVAL_MINUTES`.

`runSync` không bao giờ throw: lỗi được bắt, ghi vào `sync_meta.last_status` và trả về `{ ok: false, error }`.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/sync.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { runSync } = require('../backend/sync');
const { openDb } = require('../backend/db');
const { rawRows, reviewedRows } = require('./fixtures/sheet-rows');

const silent = { log() {}, error() {} };

test('runSync đưa dữ liệu sheet vào DB và trả số liệu', async () => {
  const store = openDb(':memory:');
  const res = await runSync({
    store,
    logger: silent,
    fetchRows: async () => ({ raw: rawRows, reviewed: reviewedRows }),
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.inserted, 8);
  assert.strictEqual(res.total, 8);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
  assert.strictEqual(store.stmts.getMeta.get().last_status, 'ok');
});

test('runSync bỏ qua dòng hỏng thay vì vỡ', async () => {
  const store = openDb(':memory:');
  const res = await runSync({
    store,
    logger: silent,
    fetchRows: async () => ({
      raw: [...rawRows, { meeting_id: '', meeting_time: 'hôm qua' }],
      reviewed: reviewedRows,
    }),
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
});

test('runSync dùng meeting_time từ tab raw khi dòng review thiếu', async () => {
  const store = openDb(':memory:');
  await runSync({
    store,
    logger: silent,
    fetchRows: async () => ({
      raw: rawRows,
      reviewed: [{ ...reviewedRows[0], meeting_time: '' }],
    }),
  });

  const row = store.db.prepare('SELECT review_hours FROM reviews').get();
  assert.strictEqual(row.review_hours, 41.45);
});

test('runSync áp ngưỡng SLA truyền vào', async () => {
  const countBreaches = async (slaHours) => {
    const store = openDb(':memory:');
    await runSync({
      store,
      logger: silent,
      slaHours,
      fetchRows: async () => ({ raw: rawRows, reviewed: reviewedRows }),
    });
    return store.db.prepare('SELECT COUNT(*) AS c FROM reviews WHERE is_sla_breach = 1').get().c;
  };

  // Cả hai review đều vượt 4 giờ; ngưỡng đủ lớn thì không còn dòng nào breach.
  assert.strictEqual(await countBreaches(4), 2);
  assert.strictEqual(await countBreaches(100000), 0);
});

test('runSync nuốt lỗi mạng, giữ nguyên dữ liệu cũ và ghi last_status', async () => {
  const store = openDb(':memory:');
  await runSync({
    store,
    logger: silent,
    fetchRows: async () => ({ raw: rawRows, reviewed: reviewedRows }),
  });

  const res = await runSync({
    store,
    logger: silent,
    fetchRows: async () => { throw new Error('quota exceeded'); },
  });

  assert.strictEqual(res.ok, false);
  assert.match(res.error, /quota exceeded/);
  assert.strictEqual(store.stmts.countActiveMeetings.get().c, 6);
  assert.match(store.stmts.getMeta.get().last_status, /quota exceeded/);
});

test('runSync phát SSE cho client đang kết nối', async () => {
  const store = openDb(':memory:');
  const written = [];
  const sseClients = [{ write: msg => written.push(msg) }];

  await runSync({
    store,
    logger: silent,
    sseClients,
    fetchRows: async () => ({ raw: rawRows, reviewed: reviewedRows }),
  });

  assert.strictEqual(written.length, 1);
  const payload = JSON.parse(written[0].replace(/^data: /, ''));
  assert.strictEqual(payload.type, 'sync');
  assert.strictEqual(payload.inserted, 8);
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- tests/sync.test.js`
Expected: FAIL — `Cannot find module '../backend/sync'`

- [ ] **Step 3: Viết implementation**

Tạo `backend/sync.js`:

```js
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
    keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
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
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Xoá hai file không còn dùng**

```bash
git rm -f backend/cron.js backend/routes/sync.js 2>/dev/null || rm -f backend/cron.js backend/routes/sync.js
```

- [ ] **Step 6: Commit**

```bash
git add backend/sync.js tests/sync.test.js
git add -A backend/cron.js backend/routes/sync.js
git commit -m "feat: vòng đồng bộ đọc thẳng Google Sheets, bỏ n8n"
```

---

### Task 8: Nối route và server

**Files:**
- Modify: `backend/routes/data.js` (thay toàn bộ)
- Modify: `backend/server.js:48-66`
- Create: `tests/api-data.test.js`

**Interfaces:**
- Consumes: `getDashboardData` từ `backend/db`; `runSync`, `startSyncLoop` từ `backend/sync`; `requireApiKey` từ `backend/middleware/auth`.
- Produces: `GET /api/data` trả `{ raw, reviewed, team_n, untagged_raw }`; `POST /api/sync/manual` (có `requireApiKey`) chạy một vòng sync.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/api-data.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../backend/db');
const { toMeeting, toReviews } = require('../backend/lib/transform');
const { rawRows, reviewedRows } = require('./fixtures/sheet-rows');

// Route chỉ là lớp mỏng bọc getDashboardData, nên test ở đây khẳng định hợp đồng JSON
// mà frontend phụ thuộc vào, không dựng cả server Express.
test('payload /api/data có đủ bốn khoá frontend cần', () => {
  const store = openDb(':memory:');
  store.replaceAll(rawRows.map(r => toMeeting(r)).filter(Boolean), toReviews(reviewedRows));
  const data = store.getDashboardData();

  assert.deepStrictEqual(Object.keys(data).sort(), ['raw', 'reviewed', 'team_n', 'untagged_raw']);
  assert.ok(Array.isArray(data.raw));
  assert.ok(Array.isArray(data.reviewed));
  assert.strictEqual(typeof data.untagged_raw, 'number');
});

test('mỗi phần tử raw có đủ field frontend đọc', () => {
  const store = openDb(':memory:');
  store.replaceAll(rawRows.map(r => toMeeting(r)).filter(Boolean), toReviews(reviewedRows));
  const [row] = store.getDashboardData().raw;

  assert.deepStrictEqual(
    Object.keys(row).sort(),
    ['attendee_count', 'date_str', 'dow', 'status_clean', 'tags_norm', 'team', 'title']
  );
});

test('mỗi phần tử reviewed có đủ field frontend đọc', () => {
  const store = openDb(':memory:');
  store.replaceAll(rawRows.map(r => toMeeting(r)).filter(Boolean), toReviews(reviewedRows));
  const [row] = store.getDashboardData().reviewed;

  assert.deepStrictEqual(
    Object.keys(row).sort(),
    ['attendee_count', 'date_str', 'dow', 'review_hours', 'status_clean', 'tags_norm', 'team', 'title']
  );
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- tests/api-data.test.js`
Expected: FAIL ở test thứ hai hoặc ba nếu tên field lệch; nếu Task 5 đã đúng thì cả ba PASS — trong trường hợp đó vẫn giữ test làm chốt chặn hồi quy cho hợp đồng.

- [ ] **Step 3: Thay toàn bộ `backend/routes/data.js`**

```js
const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../db');

router.get('/', (req, res) => {
  try {
    res.json(getDashboardData());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

module.exports = router;
```

- [ ] **Step 4: Sửa `backend/server.js`**

Thay khối từ `// ─── Auth middleware for sync routes ───` đến hết phần mount route (dòng 48–66 của bản hiện tại) bằng:

```js
// ─── Auth middleware ────────────────────────────────────
const { requireApiKey } = require('./middleware/auth');

// ─── Đồng bộ định kỳ từ Google Sheets ───────────────────
const { startSyncLoop, runSync } = require('./sync');
startSyncLoop(app);

app.post('/api/sync/manual', requireApiKey, async (req, res) => {
  const result = await runSync({ sseClients: app.locals.sseClients || [] });
  res.status(result.ok ? 200 : 500).json(result);
});

// ─── API Routes ─────────────────────────────────────────
app.use('/api/meta', require('./routes/meta'));
app.use('/api/data', require('./routes/data'));
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `npm test`
Expected: PASS toàn bộ

- [ ] **Step 6: Kiểm server khởi động được và không còn tham chiếu file đã xoá**

Run: `node -e "process.env.SHEET_ID=''; require('./backend/server.js')" & sleep 2; curl -s localhost:3000/api/data | head -c 200; kill %1`
Expected: in ra JSON có `"raw"`, không có lỗi `Cannot find module './cron'`

- [ ] **Step 7: Commit**

```bash
git add backend/routes/data.js backend/server.js tests/api-data.test.js
git commit -m "feat: /api/data đọc schema mới, thêm POST /api/sync/manual"
```

---

### Task 9: Gỡ tab Cross Check khỏi frontend

**Files:**
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: không có.
- Produces: không có. Đây là task xoá thuần.

Các khối cần gỡ, xác định bằng cách tìm chứ không bằng số dòng cố định (số dòng dịch chuyển sau mỗi lần xoá):

1. Khối CSS mở đầu bằng comment `/* ── Cross Check tab ─` cho tới ngay trước khối comment CSS kế tiếp.
2. Toàn bộ phần tử `<div class="tc" id="t-xc"> … </div>`.
3. Nút chuyển tab trỏ tới `t-xc`.
4. Hằng `XC_BASE`, object `XC`, và các hàm `xcRender`, `xcRefresh`, `xcSetView`, cùng mọi hàm chỉ được gọi từ trong chúng.
5. Mọi lời gọi tới các hàm trên từ chỗ khởi tạo tab.

- [ ] **Step 1: Chụp lại trạng thái trước khi xoá**

Run:
```bash
wc -l frontend/index.html
grep -c "xc-\|XC\.\|XC_BASE\|t-xc" frontend/index.html
```
Ghi lại hai số này để đối chiếu sau.

- [ ] **Step 2: Gỡ từng khối theo thứ tự trên**

Dùng Edit trên từng khối. Sau mỗi lần xoá, chạy lại:

```bash
grep -n "xc-\|XC\.\|XC_BASE\|t-xc" frontend/index.html | head -20
```

để thấy còn sót gì.

- [ ] **Step 3: Xác nhận không còn tham chiếu nào**

Run: `grep -c "xc-\|XC\.\|XC_BASE\|t-xc\|cross-check" frontend/index.html`
Expected: `0`

- [ ] **Step 4: Xác nhận không còn gọi ra ngoài n8n**

Run: `grep -n "n8n\|autoai9\|webhook" frontend/index.html backend/*.js backend/**/*.js`
Expected: không có kết quả nào

- [ ] **Step 5: Kiểm trang vẫn chạy**

Khởi động server, mở `http://localhost:3000`, xác nhận: các tab còn lại chuyển được, không có lỗi trong console trình duyệt, biểu đồ vẽ được từ dữ liệu thật.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html
git commit -m "refactor: gỡ tab Cross Check khỏi dashboard"
```

---

### Task 10: Cấu hình và chạy thật

**Files:**
- Modify: `.env`, `.env.example`
- Modify: `package.json` (mô tả script nếu cần)

**Interfaces:**
- Consumes: toàn bộ các task trước.
- Produces: hệ thống chạy được với dữ liệu thật từ sheet.

- [ ] **Step 1: Cập nhật `.env.example`**

```
PORT=3000
DB_PATH=./data/sunflower.db
SYNC_API_KEY=your-secret-key-here

# Google Sheets
SHEET_ID=1rIlBUOG7T7rujdeQdAHrnBhwhD7gZ4Rh8C81xrVaVtY
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./sunflower-alert-21611001cc3c.json

# Đồng bộ
SYNC_INTERVAL_MINUTES=5
SLA_HOURS=4
```

- [ ] **Step 2: Cập nhật `.env` thật**

Giữ nguyên `PORT`, `DB_PATH`, `SYNC_API_KEY` đang có. Xoá dòng `N8N_WEBHOOK_URL`.
Thêm `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, `SYNC_INTERVAL_MINUTES`, `SLA_HOURS`
với giá trị như trên.

- [ ] **Step 3: Chạy sync thật một lần**

Run: `npm start`
Expected trong log: `[Sync] Tự đồng bộ mỗi 5 phút` rồi `[Sync] Xong: +8 ~0 -0 (tổng 8)`

- [ ] **Step 4: Kiểm dữ liệu thật trong DB**

Run:
```bash
node -e "
const {openDb}=require('./backend/db');
const s=openDb(process.env.DB_PATH||'./data/sunflower.db');
const d=s.getDashboardData();
console.log('raw',d.raw.length,'reviewed',d.reviewed.length,'untagged',d.untagged_raw);
console.log(d.reviewed);
"
```
Expected: `raw 3 reviewed 2 untagged 1`, và hai dòng reviewed có `review_hours` là số dương.

- [ ] **Step 5: Kiểm endpoint**

Run: `curl -s localhost:3000/api/data | head -c 300` và `curl -s localhost:3000/api/meta`
Expected: `/api/data` trả bốn khoá; `/api/meta` có `last_status: "ok"` và `last_synced_at` vừa cập nhật.

- [ ] **Step 6: Kiểm sync tay có bảo vệ bằng API key**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/sync/manual
curl -s -X POST -H "x-api-key: $(grep SYNC_API_KEY .env | cut -d= -f2)" localhost:3000/api/sync/manual
```
Expected: lần đầu `401`, lần sau JSON `{"ok":true,...}`

- [ ] **Step 7: Chạy lại toàn bộ test**

Run: `npm test`
Expected: PASS toàn bộ

- [ ] **Step 8: Commit**

```bash
git add .env.example package.json
git commit -m "chore: cấu hình Google Sheets thay cho webhook n8n"
```

---

## Self-review

**Phủ spec:** Ingest (Task 6), schema (Task 5), review_hours + SLA (Task 4), ánh xạ trạng thái
(Task 3), untagged (Task 3, 5), đánh dấu xoá (Task 5), phân loại re-reviewed (Task 4), hợp đồng
`/api/data` (Task 5, 8), sync loop + chịu lỗi (Task 7), manual sync có auth (Task 8), gỡ Cross
Check (Task 9), config (Task 10), test (rải khắp). Không còn mục nào của spec chưa có task.

**Không làm ở vòng này**, đúng như spec ghi: tab `folders` / `real-config`, metric dựa trên
`attendees_granted` / `sent_to_attendees_at`, khôi phục Cross Check, expose analytics cũ thành API.
