# EVC Sunflower — chuyển nguồn dữ liệu sang Google Sheets

Ngày: 2026-09-18
Trạng thái: đã duyệt, chờ implement

## Bối cảnh

Dashboard hiện tại kế thừa từ project `sunflower`. Nguồn dữ liệu là một webhook n8n
đẩy về một bảng log phẳng: mỗi dòng là một sự kiện với cột `type` (`raw` / `reviewed` /
`re-reviewed` / `raw-dup`). Vì bảng đó không có khoá nối giữa một cuộc họp và lần review
của nó, backend phải đoán cặp raw↔reviewed bằng cách so `docs_url` rồi đối chiếu ngày
trích từ chuỗi `status` (`parseDateFromStatus`, `datesMatch`, `linkReviewToRaw`,
`backfillRawToReview`), kèm cột `link_confidence` ghi nhận mức độ tin cậy của phép đoán.

EVC dùng mô hình dữ liệu khác, nằm trong spreadsheet
`[Sunflower] EVC_n8n_config` (`1rIlBUOG7T7rujdeQdAHrnBhwhD7gZ4Rh8C81xrVaVtY`):

| Tab | Vai trò |
|---|---|
| `raw` | 1 dòng / cuộc họp. Cột: `meeting_id, meeting_name, meeting_time, team, main_tag, doc_url, folder_url, space_chat_webhook, chat_thread, attendees, status, confirmed_at, confirm` |
| `reviewed` | 1 dòng / lần review, **cùng `meeting_id`**. Cột: `meeting_id, meeting_name, meeting_time, team, main_tag, doc_url, folder_url, review_type, reviewed_at, attendees_granted, sent_to_attendees_at` |
| `folders` | map `main_tag` → folder, parent team, key_participants, webhook |
| `Cross Check` | dữ liệu đối soát họp ↔ lịch ↔ phòng |
| `ALL Logging` | schema cũ, hiện rỗng |

`meeting_id` là khoá chung giữa `raw` và `reviewed`, nên toàn bộ tầng đoán cặp không còn
lý do tồn tại.

## Quyết định

1. Bỏ n8n hoàn toàn. Backend tự đọc Sheets bằng service account.
2. Bỏ tính năng Cross Check khỏi dashboard ở vòng này.
3. Ngưỡng SLA giữ 4 giờ nhưng đưa ra biến môi trường `SLA_HOURS`.
4. Giữ SQLite làm bản mirror; API đọc từ DB, không đọc thẳng Sheets.
5. Xoá ~500 dòng hàm analytics trong `db.js` không có route nào gọi.
6. Chưa sync tab `folders` — thêm khi có chỗ dùng thật.

## Ràng buộc đã xác minh

- Service account `sunflower-notification@sunflower-alert.iam.gserviceaccount.com`
  đọc được spreadsheet (đã thử `spreadsheets.get` + `values.batchGet`).
- Frontend chỉ gọi đúng một endpoint dữ liệu: `GET /api/data` (`frontend/index.html:1346`).
  Không dùng SSE, không gọi `/api/meta`. Mọi KPI được tính client-side.
  → Hợp đồng duy nhất phải giữ nguyên là shape `{ raw[], reviewed[], team_n{}, untagged_raw }`.
- `meeting_time`, `confirmed_at`, `reviewed_at` ở dạng `dd/MM/yyyy HH:mm:ss`, giờ VN.

## Kiến trúc

```
Google Sheets ──(service account, readonly)──> sheets.js ──> sync.js ──> SQLite ──> /api/data ──> frontend
     tab raw + reviewed                 poll mỗi SYNC_INTERVAL_MINUTES       (+ SSE broadcast)
```

| File | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `backend/sheets.js` (mới) | Auth service account, `values.batchGet` các range, map header→field, parse ngày sang ISO. Không biết gì về DB. | `googleapis` |
| `backend/sync.js` (mới, thay `cron.js` + `routes/sync.js`) | Upsert rows vào DB trong một transaction, tính `review_hours`, đánh dấu dòng biến mất, cập nhật `sync_meta`, emit SSE. Chạy theo interval và theo trigger tay. | `sheets.js`, `db.js` |
| `backend/db.js` (viết lại) | Schema + prepared statements + đúng các query phục vụ `/api/data`. | `better-sqlite3` |
| `backend/routes/data.js` | Giữ contract, đổi SQL bên dưới. | `db.js` |
| `backend/routes/meta.js` | Không đổi. | `db.js` |

Xoá: `backend/cron.js`, `backend/routes/sync.js`, và toàn bộ `parseDateFromStatus`,
`datesMatch`, `linkReviewToRaw`, `backfillRawToReview`, cột `link_confidence`.

## Schema

```sql
CREATE TABLE meetings (
  meeting_id      TEXT PRIMARY KEY,
  meeting_name    TEXT,
  meeting_time    TEXT NOT NULL,      -- ISO 8601 +07:00
  team            TEXT,               -- lowercase
  main_tag        TEXT,
  doc_url         TEXT,
  folder_url      TEXT,
  chat_thread     TEXT,
  attendees       TEXT,               -- nguyên chuỗi từ sheet
  attendee_count  INTEGER DEFAULT 0,
  status          TEXT,               -- pending | reviewed | discarded
  confirmed       INTEGER DEFAULT 0,
  confirmed_at    TEXT,
  is_untagged     INTEGER DEFAULT 0,
  is_deleted      INTEGER DEFAULT 0,
  synced_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE reviews (
  id                   TEXT PRIMARY KEY,   -- meeting_id || '|' || reviewed_at
  meeting_id           TEXT NOT NULL,
  meeting_name         TEXT,
  meeting_time         TEXT,
  team                 TEXT,
  main_tag             TEXT,
  doc_url              TEXT,
  folder_url           TEXT,
  review_type          TEXT,               -- reviewed | re-reviewed (suy ra)
  reviewed_at          TEXT,
  attendees_granted    TEXT,
  sent_to_attendees_at TEXT,
  review_hours         REAL,
  is_sla_breach        INTEGER DEFAULT 0,
  is_untagged          INTEGER DEFAULT 0,
  is_deleted           INTEGER DEFAULT 0,
  synced_at            TEXT DEFAULT (datetime('now'))
);
```

`sync_meta` giữ nguyên cấu trúc cũ.

Index: `meetings(team)`, `meetings(status)`, `meetings(meeting_time)`, `meetings(is_deleted)`,
`reviews(meeting_id)`, `reviews(team)`, `reviews(reviewed_at)`, `reviews(review_type)`.

## Quy tắc nghiệp vụ

**Thời gian review.** `review_hours = reviewed_at − meeting_time`, tính trong phạm vi một
dòng `reviews` vì tab `reviewed` tự mang sẵn `meeting_time`. Nếu dòng đó thiếu
`meeting_time`, lấy từ `meetings` theo `meeting_id`. Không có nguồn nào thì để `NULL`.
Giá trị âm bị coi là dữ liệu sai và để `NULL`.

**SLA.** `is_sla_breach = review_hours > SLA_HOURS` (mặc định 4). Dòng `review_hours IS NULL`
không tính vào cả tử số lẫn mẫu số của tỷ lệ breach.

**Phân loại lần review.** Với mỗi `meeting_id`, sắp theo `reviewed_at` tăng dần: dòng đầu là
`reviewed`, các dòng sau là `re-reviewed`. Không tin cột `review_type` của sheet.

**Trạng thái cuộc họp** — ánh xạ để giữ nguyên ngữ nghĩa frontend đang dùng:

| Sheet | `status` lưu trong DB | Ý nghĩa |
|---|---|---|
| `confirm` = FALSE | `pending` | chưa confirm |
| `status` = `confirmed` | `confirmed` | sheet ghi thẳng, tin giá trị này hơn cột `confirm` |
| `confirm` = TRUE, `status` ≠ `reviewed` | `confirmed` | đã confirm, chờ review |
| `status` = `reviewed` | `reviewed` | đã review |
| `status` = `discarded` | `discarded` | loại khỏi mọi thống kê |

Status lạ ngoài danh sách: ghi cảnh báo ra log, lưu nguyên giá trị, và loại khỏi thống kê.
Sync không được vỡ vì một giá trị không nhận diện được.

**Untagged.** `is_untagged = 1` khi `main_tag = 'uncat'` hoặc `team` rỗng. Thay cho
`tag_mismatch` cũ. Dòng untagged bị loại khỏi `raw`/`reviewed`/`team_n` và chỉ được đếm
vào `untagged_raw`.

**Xoá.** Sau mỗi lần sync, dòng có trong DB nhưng không còn `meeting_id` / `id` tương ứng
trong sheet được đánh `is_deleted = 1`. Không xoá vật lý.

**Bỏ khỏi hệ thống.** Khái niệm `raw-dup` và tỷ lệ trùng: format mới lấy `meeting_id` làm
khoá chính nên không còn dòng trùng. Frontend ẩn phần hiển thị dup rate.

## Hợp đồng `/api/data`

Giữ nguyên shape cũ để không phải đụng vào phần tính toán của frontend:

```json
{
  "raw": [{ "date_str", "status_clean", "team", "title", "tags_norm", "dow", "attendee_count" }],
  "reviewed": [{ "date_str", "status_clean", "team", "review_hours", "title", "tags_norm", "dow", "attendee_count" }],
  "team_n": { "<TEAM>": 12 },
  "untagged_raw": 3
}
```

Khác biệt bên trong:

- `date_str` của cả hai mảng lấy từ `meeting_time` → mọi biểu đồ lọc nhất quán theo ngày họp.
- `attendee_count` đếm thật từ cột `attendees` thay vì hằng số `5`.
- `reviewed` chỉ gồm `review_type = 'reviewed'`; `re-reviewed` bị loại để không đếm trùng.
- `team` viết hoa, `tags_norm` mặc định `uncategorized` — như cũ.

## Đồng bộ

Poll mỗi `SYNC_INTERVAL_MINUTES` (mặc định 5), chạy ngay một lần lúc khởi động.
`POST /api/sync/manual` (bảo vệ bằng `SYNC_API_KEY`) chạy một vòng sync ngay.
Mỗi vòng kết thúc phát SSE `{ type: 'sync', inserted, updated, deleted, total, timestamp }`.

Lỗi khi gọi Sheets (mạng, quyền, quota) không được làm chết process: ghi log, ghi
`sync_meta.last_status = 'error: …'`, giữ nguyên dữ liệu cũ trong DB, và thử lại ở vòng sau.

## Frontend

Gỡ tab Cross Check: khối CSS `.xc-*` (≈ dòng 314–360), markup `#t-xc` (≈ 1210–1325),
object `XC` cùng `xcRender` / `xcRefresh` / `xcSetView`, hằng `XC_BASE`, và nút chuyển tab
tương ứng. Phần còn lại không đổi.

## Config

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | — | đường dẫn file key service account |
| `SHEET_ID` | — | id spreadsheet |
| `SYNC_INTERVAL_MINUTES` | `5` | |
| `SLA_HOURS` | `4` | |
| `PORT` | `3000` | |
| `DB_PATH` | `./data/sunflower.db` | |
| `SYNC_API_KEY` | — | bảo vệ `/api/sync/manual` |

`N8N_WEBHOOK_URL` bị xoá khỏi `.env` và `.env.example`.

## Test

Repo chưa có test. Thêm `node:test` (built-in, không thêm dependency), chạy bằng `npm test`,
không gọi mạng. Fixture là dữ liệu thật đã dump từ sheet (6 dòng `raw`, 2 dòng `reviewed`).

Phạm vi kiểm:

- parse `dd/MM/yyyy HH:mm:ss` → ISO `+07:00`, gồm chuỗi rỗng và chuỗi sai định dạng
- `review_hours` và `is_sla_breach` quanh ngưỡng `SLA_HOURS`
- phân loại `reviewed` / `re-reviewed` theo thứ tự `reviewed_at`
- ánh xạ trạng thái, gồm một giá trị lạ không làm vỡ sync
- `is_untagged` và `untagged_raw`
- đánh dấu `is_deleted` khi một dòng biến mất khỏi sheet
- shape `/api/data` khớp hợp đồng

## Việc không làm ở vòng này

- Sync tab `folders` và `real-config`
- Metric dựa trên `attendees_granted` / `sent_to_attendees_at`
- Khôi phục tính năng Cross Check
- Expose các hàm analytics cũ thành API
