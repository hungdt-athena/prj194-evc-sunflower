# EVC Sunflower — Config panel cho các ngưỡng

Ngày: 2026-09-18
Trạng thái: đã duyệt, chờ viết plan

## Bối cảnh

Dashboard đang đánh giá tốt/xấu dựa trên khoảng 20 con số nằm rải rác trong
`frontend/index.html`. Toàn bộ chúng được thừa kế từ project `sunflower` làm cho khách
hàng khác — chưa ai xác nhận 4 giờ là kỳ vọng thật của EVC, hay 80% review rate là mục
tiêu thật. Dashboard đang tô đỏ tô xanh theo một bộ tiêu chuẩn mượn.

Ba lỗi cụ thể phát hiện khi rà soát:

1. **`SLA_HOURS` không có tác dụng gì.** `backend/sync.js:34` đọc nó, truyền vào
   `toReviews()`, `transform.js:89` tính `is_sla_breach` rồi ghi vào cột
   `reviews.is_sla_breach`. Nhưng `getDashboardData()` không `SELECT` cột đó, nên nó
   không bao giờ tới `/api/data`. Frontend tự tính bằng số cứng. Đặt `SLA_HOURS=8`
   trên Replit hiện không đổi một pixel nào.
2. **Hai định nghĩa "trễ" mâu thuẫn.** KPI "On-time" dùng `review_hours <= 4`
   (`:1058`), còn card action của Review Time Distribution dùng `> 24`
   (`:1178`) và gọi cả hai là "SLA".
3. **Code chết.** Cột `is_sla_breach` và hàm `sl()` (`:1236`, chứa ngưỡng 60%/80% và
   "outliers > 3 ngày") không được đọc ở đâu cả.

Ngoài ra các câu kết luận đang nhúng cứng con số vào chuỗi, ví dụ
`'... team review rate <50%: ... đặt deadline review 48h'`. Đổi ngưỡng mà không sửa
chuỗi thì dashboard nói sai.

## Mục tiêu

Một chỗ duy nhất để đặt ngưỡng, và mọi kết luận suy ra từ ngưỡng phải đổi theo ngay.
Người của EVC tự đổi được, không phải qua dev.

## Không nằm trong phạm vi

- Bảo vệ dữ liệu. `/api/data` vẫn công khai; mật khẩu ở đây chỉ chặn việc **sửa**
  ngưỡng, không chặn việc **xem** tên cuộc họp và link Google Docs.
- SLA theo giờ làm việc (họp 18h thứ Sáu, review 9h thứ Hai vẫn tính 63 giờ). Đây là
  vấn đề thật nhưng đổi định nghĩa `review_hours`, để lần sau.
- Quản lý team, gộp alias, panel chẩn đoán sync.

## Quy ước chữ nghĩa

Mọi nhãn và câu chữ người dùng nhìn thấy: **tiếng Anh, từ thường ngày, không từ
chuyên ngành**. Đổi trong toàn dashboard:

| Đang dùng | Đổi thành |
|---|---|
| `SLA`, `SLA target`, `Within SLA` | `review deadline`, `On time` |
| `outside SLA (>24h)` | `past the deadline` |
| `WoW (7d)` | `vs last week` |
| `Backlog%` | `Waiting %` |

Tên khoá trong code cũng theo hướng đó: `review_deadline_hours`, không phải `sla_hours`.

## Thiết kế

### 1. Một nguồn sự thật — `backend/lib/thresholds.js`

Mỗi ngưỡng khai báo kèm metadata, và **form tự sinh ra từ metadata này**. Thêm ngưỡng
mới sau này chỉ là thêm một dòng, không phải viết thêm HTML.

```js
review_deadline_hours: {
  def: 4, type: 'number', min: 0.5, max: 168, group: 'speed',
  label: 'Review deadline',
  unit: 'hours',
  help: 'A review that takes longer than this counts as late.',
}
```

Bộ khoá đầy đủ — 16 cái, 4 nhóm:

**Group `speed` — Review speed**

| Key | Mặc định | Label | Thay cho |
|---|---|---|---|
| `review_deadline_hours` | 4 | Review deadline | `:1058` `<= 4`, `:1178` `> 24` |
| `slow_review_hours` | 8 | Slow review alert | `:1072` `> 8` |
| `review_time_groups` | `[1, 4, 24]` | Review time groups | `:1173` bins |

**Group `team` — Team health**

| Key | Mặc định | Label | Thay cho |
|---|---|---|---|
| `good_rate_pct` | 80 | Good review rate | `:1123`, `:1127`, `:1151` |
| `low_rate_pct` | 50 | Low review rate | `:1073`, `:1128` |
| `too_few_files` | 3 | Too few files to judge | `:904`, `:1073`, `:1128` |
| `show_count_below` | 5 | Show file count below | `:905`, `:1126` |

**Group `backlog` — Backlog**

| Key | Mặc định | Label | Thay cho |
|---|---|---|---|
| `unreviewed_high_pct` | 40 | Recent unreviewed — high | `:1145` |
| `unreviewed_medium_pct` | 20 | Recent unreviewed — medium | `:1146` |
| `waiting_high_pct` | 30 | Waiting for review — high | `:1155` |
| `waiting_medium_pct` | 15 | Waiting for review — medium | `:1156` |
| `team_backlog_high_pct` | 50 | Team backlog — high | `:1138`, `:1160` |
| `busiest_team_share_pct` | 40 | Workload imbalance | `:1199` |

**Group `display` — Display** (thu gọn mặc định, ít ai đụng)

| Key | Mặc định | Label | Thay cho |
|---|---|---|---|
| `default_days` | 14 | Default date range | `:938`, `:948` |
| `daily_to_weekly_days` | 31 | Switch to weekly after | `MAX_DAILY_BUCKETS` |
| `weekly_to_monthly_weeks` | 26 | Switch to monthly after | `MAX_WEEKLY_BUCKETS` |

Giữ nguyên dạng cứng, không đưa vào config vì không ai tune: "3 bucket gần nhất" của
card action đầu tiên, và số team tối đa 12 trong File Distribution.

### 2. Kiểm tra giá trị

Từng trường: đúng kiểu, nằm trong `[min, max]`. Ràng buộc chéo:

- `low_rate_pct < good_rate_pct`
- `unreviewed_medium_pct < unreviewed_high_pct`
- `waiting_medium_pct < waiting_high_pct`
- `too_few_files <= show_count_below`
- `review_time_groups`: đúng 3 số, tăng dần, đều > 0
- `daily_to_weekly_days < weekly_to_monthly_weeks * 7`

Sai thì trả 400 kèm `fields: { key: 'lý do' }` để form tô đỏ đúng ô.

### 3. Lưu trữ

```sql
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,   -- JSON, để mảng cũng lưu được
  updated_at TEXT NOT NULL
);
```

Lúc đọc **merge đè lên DEFAULTS**, nên thêm ngưỡng mới sau này thì DB cũ vẫn chạy,
không cần migration.

`SLA_HOURS` trong env chỉ còn là giá trị khởi tạo lần chạy đầu; sau đó DB thắng. Nếu
env có mà DB đã có giá trị khác, server log một dòng nói rõ env đang bị bỏ qua — để
không lặp lại đúng cái bẫy "sửa mà không thấy gì đổi" của hiện tại.

### 4. API

| Endpoint | Bảo vệ | Việc |
|---|---|---|
| `GET /api/settings` | không | `{ values, schema, locked }` |
| `POST /api/settings/unlock` | rate-limit | `{ password }` → `{ token, expires_at }` |
| `POST /api/settings` | `x-config-token` | validate rồi ghi |
| `POST /api/settings/password` | token + mật khẩu cũ | đổi mật khẩu |

`locked: false` nghĩa là chưa đặt `CONFIG_PASSWORD` → panel ở chế độ chỉ đọc.

`GET` không cần bảo vệ vì frontend phải có `values` mới vẽ được, và bản thân các
ngưỡng không phải bí mật.

### 5. Mật khẩu

- Băm bằng `crypto.scrypt` có sẵn trong Node — không thêm dependency. Lưu dạng
  `scrypt$<salt>$<hash>`, so sánh bằng `timingSafeEqual`.
- **Khởi tạo:** lần chạy đầu đọc `CONFIG_PASSWORD` từ env, băm, ghi vào `settings`.
  Nếu env không có thì panel chỉ đọc. Cố ý **không** làm màn "chưa ai đặt mật khẩu,
  mời đặt" — ai vào trước sẽ chiếm được.
- **Quên mật khẩu:** đặt `CONFIG_PASSWORD_RESET=1` cùng `CONFIG_PASSWORD` mới rồi
  restart, server ghi đè lại. Ghi trong README.
- Token: 32 byte ngẫu nhiên giữ trong `Map` ở RAM, TTL 2 giờ, client giữ ở
  `sessionStorage`. Server restart là mất — chấp nhận được.
- Chặn dò: sai 5 lần trong 15 phút thì khoá 15 phút, tính theo IP.

### 6. Giao diện

Nút bánh răng trên toolbar mở **panel trượt từ phải, rộng nửa màn hình** (`50vw`, tối
thiểu 460px; dưới 900px thì tràn toàn màn). Không dựng lại thanh tab đã cố ý bỏ trước đây.

- Chưa mở khoá: ô nhập mật khẩu, có nút Show. Sai thì báo còn bao nhiêu lần thử.
- Mở khoá rồi: 4 nhóm, **mỗi ngưỡng là một section** gồm tên, mô tả, ô số, thanh trượt,
  hình minh hoạ và một câu tóm tắt hậu quả.
- **Sửa là dashboard phía sau vẽ lại ngay, chưa lưu.**
- `Save` · `Cancel` (trả về giá trị đã lưu) · `Reset to defaults`.
- Đổi mật khẩu nằm cuối panel.

#### Minh hoạ: bốn khối dùng lại, không phải 16 hình riêng

Mỗi ngưỡng khai báo `viz: { kind, source, pair? }` ngay trong schema, nên "thêm một
ngưỡng" vẫn chỉ phải sửa một chỗ. Bốn khối vẽ bằng SVG nội tuyến, không thêm thư viện:

| `kind` | Hình | Dùng cho |
|---|---|---|
| `dots` | mỗi review một chấm trên trục log giờ, vạch dọc tại ngưỡng, hai bên hai màu | deadline, cảnh báo chậm, 4 nhóm thời gian |
| `bars` | cột ngang từng team, vạch đứt tại ngưỡng, cột đổi màu theo phía | tỉ lệ review, số file, backlog, lệch tải |
| `zones` | dải 0–100% chia ba băng xanh/vàng/đỏ, ghim "now" tại giá trị thật | cặp ngưỡng medium/high |
| `ticks` | dãy vạch bằng số cột trục thời gian sẽ có | nhóm Display |

Ngưỡng đi theo cặp (`pair`) vẽ cả hai vạch, nên chỉnh cái này luôn thấy cái kia.

Trục giờ dùng thang log: review trải từ vài phút tới hàng trăm giờ, thang tuyến tính dồn
hết vào mép trái.

Màu không phải lúc nào cũng "vượt vạch là xấu". Với `teamCount`, vượt vạch nghĩa là đủ
dữ liệu để đánh giá, nên phía trên tô xanh còn phía dưới tô xám trung tính.

#### Dữ liệu cho hình

Ưu tiên **dữ liệu thật đang lọc trên dashboard** — câu "sẽ gắn cờ 3 trong 9 team của bạn"
quyết định được, biểu đồ bịa thì không. Khi bộ lọc còn dưới 6 review hoặc dưới 3 team,
hình vẽ bằng số thật không dạy được gì (một chấm trên trục thì không thấy ngưỡng cắt ở
đâu), nên chuyển sang bộ mẫu cố định và **ghi rõ "Example data"** trên từng câu tóm tắt.

#### Thanh trượt

Tầm trượt bám quanh giá trị mặc định (`def × 4`) chứ không trải hết `min…max`: deadline
mặc định 4h mà thanh chạy tới 168h thì núm nằm ở 2% chiều dài, không chỉnh nổi. Ô số vẫn
nhận trọn khoảng cho phép. `review_time_groups` tách thành **3 ô số và 3 thanh riêng**,
mỗi thanh có tầm riêng theo giá trị mặc định của nó.

### 7. Sinh lại câu kết luận

Khoảng 15 chuỗi kết luận chuyển từ chữ cứng sang template đọc từ `TH`. Kèm theo:

- Xoá cột `is_sla_breach`, bỏ `slaHours` khỏi `toReviews()`, xoá hàm `sl()`.
- Thống nhất: **past the deadline = `review_hours > review_deadline_hours`**. Bốn nhóm
  của donut là chuyện hiển thị riêng, cấu hình riêng, không còn định nghĩa "trễ" thứ hai.
- `"set a 48h review deadline"`, `"grows for 2 consecutive weeks"` — đây là lời khuyên
  chứ không phải ngưỡng. Viết lại cho khỏi nêu số, tránh đẻ thêm setting vô nghĩa.
- Nhãn KPI, tooltip, ô "How to Read", nhãn 4 nhóm của donut: nội suy từ giá trị.

Ngưỡng được áp **lúc hiển thị, không phải lúc sync**. Đổi ngưỡng là thấy kết quả ngay,
không phải chờ đồng bộ lại.

## Chia giai đoạn

| GĐ | Nội dung | Chạy được độc lập |
|---|---|---|
| 1 | `thresholds.js`, `/api/data` trả kèm ngưỡng, sinh lại toàn bộ câu chữ, xoá code chết | có — riêng nó đã sửa xong 3 lỗi ở trên |
| 2 | Bảng `settings`, 4 endpoint, mật khẩu | có — sửa được bằng `curl` |
| 3 | Panel + preview sống | có |

## Kiểm thử

Giữ nguyên 50 test đang có (bỏ phần khẳng định `is_sla_breach`).

- `thresholds`: DEFAULTS đầy đủ; merge từ DB đè đúng; khoá lạ bị bỏ qua; từng ràng
  buộc chéo có một test hỏng riêng.
- `settings`: ghi rồi đọc lại đúng kiểu, kể cả mảng; DB trống trả về DEFAULTS.
- `password`: băm rồi verify đúng; sai mật khẩu trả 401; khoá sau 5 lần sai; token
  hết hạn bị từ chối; đổi mật khẩu cần mật khẩu cũ.
- `api-settings`: `GET` trả đủ `values` + `schema`; `POST` không token → 401; giá trị
  ngoài khoảng → 400 kèm tên trường.
