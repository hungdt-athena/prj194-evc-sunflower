# EVC Sunflower

Meeting review dashboard for EVC. The backend syncs a Google Sheet into SQLite on a
timer; the frontend is a single self-contained page that computes every KPI and chart
in the browser from one API call.

```
Google Sheets ──(service account, read-only)──> sync ──> SQLite ──> /api/data ──> dashboard
     tabs: raw + reviewed              every SYNC_INTERVAL_MINUTES
```

## Data model

The sheet keeps one row per meeting in the `raw` tab and one row per review in the
`reviewed` tab, joined on `meeting_id`. That key is what makes the numbers trustworthy:
review time is simply `reviewed_at − meeting_time`, with no guessing involved.

| Table | Source | Notes |
|---|---|---|
| `meetings` | `raw` tab | `status` is `pending` / `confirmed` / `reviewed` / `discarded`; `discarded` rows are excluded from every statistic |
| `reviews` | `reviewed` tab | the first review of a meeting is `reviewed`, later ones `re-reviewed` (derived from `reviewed_at` order, not from the sheet column) |
| `sync_meta` | — | last sync time, row counts, last status |

Rows whose `main_tag` is `uncat` or whose `team` is empty are labelled `UNTAGGED`. They
still count everywhere, so chart totals always reconcile with the KPI row, and the
dashboard raises an alert so somebody fixes the tag.

## Requirements

- Node 18 or newer (uses the built-in `fetch` and `node:test`)
- A Google Cloud service account with read access to the spreadsheet

## Setup

```bash
npm install
cp .env.example .env    # then fill in the values below
npm start               # or: npm run dev
```

Share the spreadsheet with the service account's `client_email` (Viewer is enough),
then put its JSON key somewhere the app can read it.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `SHEET_ID` | — | the spreadsheet to read |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | — | path to the service-account JSON key |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/sunflower.db` | SQLite file; the directory is created if missing |
| `SYNC_INTERVAL_MINUTES` | `5` | how often to pull the sheet |
| `SLA_HOURS` | `4` | a review beyond this counts as an SLA breach |
| `SYNC_API_KEY` | — | protects `POST /api/sync/manual`; leave unset only in development |
| `REFRESH_COOLDOWN_SECONDS` | `20` | minimum gap between dashboard Refresh presses |

Use `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` rather than the conventional
`GOOGLE_APPLICATION_CREDENTIALS`: dotenv will not override a variable the shell has
already exported, so the standard name silently picks up another project's credentials
and fails with a confusing `403 The caller does not have permission`.

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/data` | none | everything the dashboard renders |
| `GET /api/meta` | none | last sync time and counters |
| `POST /api/sync/refresh` | none, rate-limited | the dashboard's Refresh button |
| `POST /api/sync/manual` | `x-api-key` | sync on demand from outside |
| `GET /events` | none | server-sent events, emitted after each sync |

`/api/sync/refresh` carries no key because `/api/data` is already public, so it exposes
nothing further; the cooldown is there to protect the Sheets API quota.

## Tests

```bash
npm test
```

Pure `node:test`, no network. Fixtures are real rows captured from the sheet, covering
date parsing, review-time and SLA maths, status mapping, deletion marking, and the
`/api/data` contract.

## Deploying on Replit

1. Import the repository into a new Repl.
2. Add the environment variables above under **Secrets**.
3. Upload the service-account JSON and point `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` at it —
   never commit that file.
4. Set the run command to `npm start`, and leave `PORT` unset so Replit's own value is used.

SQLite lives on the Repl's disk. It is a cache of the sheet rather than a source of
truth, so losing it costs nothing: the next sync rebuilds it.
