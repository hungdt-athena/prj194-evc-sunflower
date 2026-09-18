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
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | the service-account key as raw JSON; use this where you cannot ship a file |
| `GOOGLE_SERVICE_ACCOUNT_B64` | — | the same key base64-encoded, for hosts that mangle long pasted values |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | — | path to the service-account JSON key; ignored when the variable above is set |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/sunflower.db` | SQLite file; the directory is created if missing |
| `SYNC_INTERVAL_MINUTES` | `5` | how often to pull the sheet |
| `SLA_HOURS` | `4` | seeds the review deadline on first run only; after that the saved value wins |
| `CONFIG_PASSWORD` | `evcsun@123` | unlocks the settings panel. Only applied on the first run — see below |
| `CONFIG_PASSWORD_RESET` | — | set to `1` with a new `CONFIG_PASSWORD` and restart to overwrite a forgotten password |
| `SYNC_API_KEY` | — | protects `POST /api/sync/manual`; leave unset only in development |
| `REFRESH_COOLDOWN_SECONDS` | `20` | minimum gap between dashboard Refresh presses |

Supply credentials one way or the other: a file path locally, the JSON itself on a
host that only offers environment variables.

Prefer `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` over the conventional
`GOOGLE_APPLICATION_CREDENTIALS`: dotenv will not override a variable the shell has
already exported, so the standard name silently picks up another project's credentials
and fails with a confusing `403 The caller does not have permission`.

## Thresholds

Every judgement the dashboard makes — what counts as a good review rate, when a
backlog is worth a red warning, how long a review may take — comes from one place:
`backend/lib/thresholds.js`. Values are stored in the `settings` table and edited
through the gear button in the toolbar (or `/#settings`). Changing one redraws the page
immediately, so you can see what a new number would have said before you save it.

Thresholds are applied when the page renders, not when the sheet is synced. There is no
need to resync after changing one, and history is never rewritten.

The panel opens with a password. Out of the box that password is **`evcsun@123`**; set
`CONFIG_PASSWORD` before the first run to use your own.

The saved password always wins over `CONFIG_PASSWORD`, so that changing it inside the
panel is not undone by the next restart. If the two disagree, startup says so and points
at the way out: set `CONFIG_PASSWORD_RESET=1` alongside the new `CONFIG_PASSWORD` and
restart. Wrong passwords lock that IP out for five minutes after five tries; a restart
clears the lockout.

The password only guards *changing* the thresholds — `/api/data` is still public, so
anyone with the link can read meeting titles and document URLs. Change the default before
this goes anywhere public.

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/data` | none | everything the dashboard renders |
| `GET /api/meta` | none | last sync time and counters |
| `POST /api/sync/refresh` | none, rate-limited | the dashboard's Refresh button |
| `POST /api/sync/manual` | `x-api-key` | sync on demand from outside |
| `GET /api/settings` | none | the thresholds in use, plus the form schema |
| `POST /api/settings/unlock` | rate-limited | exchanges the password for a session token |
| `POST /api/settings` | `x-config-token` | saves thresholds |
| `POST /api/settings/reset` | `x-config-token` | restores the defaults |
| `POST /api/settings/password` | `x-config-token` | changes the password |
| `GET /events` | none | server-sent events, emitted after each sync |

`/api/sync/refresh` carries no key because `/api/data` is already public, so it exposes
nothing further; the cooldown is there to protect the Sheets API quota.

## Tests

```bash
npm test
```

Pure `node:test`, no network. Fixtures are real rows captured from the sheet, covering
date parsing, review-time maths, threshold rules, passwords, status mapping, deletion marking, and the
`/api/data` contract.

## Deploying on Replit

1. Import the repository into a new Repl.
2. Under **Secrets**, set `SHEET_ID`, `SYNC_API_KEY`, and `GOOGLE_SERVICE_ACCOUNT_JSON`
   (paste the whole key file as one line). Leave `PORT` alone — Replit sets it.
3. Run command: `npm start`.
   Startup prints a `[Config]` line naming which variables it can see, and when
   credentials are missing it also lists the related variable names it did find,
   so a misspelled secret shows up immediately. A deployment reads its
   environment once at startup: after changing a secret, republish. Replit
   deploys the Repl's files, not the GitHub branch, so pull first.
4. Deploy as a **Reserved VM**. On Autoscale the process sleeps between requests, which
   stops the sync timer, so the dashboard would only be as fresh as its last visitor.

SQLite lives on the Repl's disk. It is a cache of the sheet rather than a source of
truth, so losing it costs nothing: the next sync rebuilds it.
