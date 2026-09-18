// Mọi ngưỡng đánh giá của dashboard sống ở đây, không rải trong frontend nữa.
// Metadata đi kèm từng khoá (label/unit/help/min/max) là thứ config panel dùng để
// tự dựng form — thêm ngưỡng mới chỉ cần thêm một mục ở dưới, không phải viết HTML.

const SCHEMA = {
  // ── Review speed ─────────────────────────────────────────────
  review_deadline_hours: {
    def: 4, type: 'number', min: 0.5, max: 168, group: 'speed',
    label: 'Review deadline', unit: 'hours',
    help: 'A review that takes longer than this counts as late.',
    viz: { kind: 'dots', source: 'hours' },
    msg: 'cDeadline',
  },
  slow_review_hours: {
    def: 8, type: 'number', min: 0.5, max: 720, group: 'speed',
    label: 'Slow review alert', unit: 'hours',
    help: 'Show an alert when the average review time goes above this.',
    viz: { kind: 'dots', source: 'hours', mark: 'avg' },
    msg: 'cAlerts',
  },
  review_time_groups: {
    def: [1, 4, 24], type: 'numbers', length: 3, min: 0.1, max: 8760, group: 'speed',
    label: 'Review time groups', unit: 'hours',
    help: 'Three cut-off points that split every review into the four groups shown on the Review Time Distribution chart.',
    viz: { kind: 'dots', source: 'hours' },
  },

  // ── Team health ──────────────────────────────────────────────
  good_rate_pct: {
    def: 80, type: 'number', min: 1, max: 100, group: 'team',
    label: 'Good review rate', unit: '%',
    help: 'A team at or above this is on target.',
    viz: { kind: 'bars', source: 'teamRate', pair: ['low_rate_pct', 'good_rate_pct'] },
    msg: 'cTeamRate',
  },
  low_rate_pct: {
    def: 50, type: 'number', min: 0, max: 99, group: 'team',
    label: 'Low review rate', unit: '%',
    help: 'A team below this is flagged as needing help.',
    viz: { kind: 'bars', source: 'teamRate', pair: ['low_rate_pct', 'good_rate_pct'] },
    msg: 'cTeamRate',
  },
  too_few_files: {
    def: 3, type: 'number', min: 1, max: 100, group: 'team',
    label: 'Too few files to judge', unit: 'files',
    help: 'Teams with this many files or fewer are marked as low data and left out of warnings.',
    viz: { kind: 'bars', source: 'teamCount' },
    msg: 'cTeamRateNote',
  },
  show_count_below: {
    def: 5, type: 'number', min: 1, max: 100, group: 'team',
    label: 'Show file count below', unit: 'files',
    help: 'Print the file count next to a team name when it has this many files or fewer.',
    viz: { kind: 'bars', source: 'teamCount' },
    msg: 'cTeamRateNote',
  },

  // ── Backlog ──────────────────────────────────────────────────
  unreviewed_high_pct: {
    def: 40, type: 'number', min: 1, max: 100, group: 'backlog',
    label: 'Recent unreviewed — high', unit: '%',
    help: 'Red warning when this share of recent files is still unreviewed.',
    viz: { kind: 'zones', source: 'recentUnreviewed', pair: ['unreviewed_medium_pct', 'unreviewed_high_pct'] },
    msg: 'cRecent',
  },
  unreviewed_medium_pct: {
    def: 20, type: 'number', min: 0, max: 99, group: 'backlog',
    label: 'Recent unreviewed — medium', unit: '%',
    help: 'Amber warning at this share.',
    viz: { kind: 'zones', source: 'recentUnreviewed', pair: ['unreviewed_medium_pct', 'unreviewed_high_pct'] },
    msg: 'cRecent',
  },
  waiting_high_pct: {
    def: 30, type: 'number', min: 1, max: 100, group: 'backlog',
    label: 'Waiting for review — high', unit: '%',
    help: 'Red warning when this share of the whole pipeline is waiting for a reviewer.',
    viz: { kind: 'zones', source: 'waitingShare', pair: ['waiting_medium_pct', 'waiting_high_pct'] },
    msg: 'cWaiting',
  },
  waiting_medium_pct: {
    def: 15, type: 'number', min: 0, max: 99, group: 'backlog',
    label: 'Waiting for review — medium', unit: '%',
    help: 'Amber warning at this share.',
    viz: { kind: 'zones', source: 'waitingShare', pair: ['waiting_medium_pct', 'waiting_high_pct'] },
    msg: 'cWaiting',
  },
  team_backlog_high_pct: {
    def: 50, type: 'number', min: 1, max: 100, group: 'backlog',
    label: 'Team backlog — high', unit: '%',
    help: 'Highlight a team whose waiting share goes above this.',
    viz: { kind: 'bars', source: 'teamWaiting' },
    msg: 'cTeamBacklog',
  },
  busiest_team_share_pct: {
    def: 40, type: 'number', min: 1, max: 100, group: 'backlog',
    label: 'Workload imbalance', unit: '%',
    help: 'Warn when the busiest team holds more than this share of all files.',
    viz: { kind: 'bars', source: 'teamShare' },
    msg: 'cWorkload',
  },

  // ── Display ──────────────────────────────────────────────────
  default_days: {
    def: 14, type: 'number', min: 1, max: 3650, group: 'display',
    label: 'Default date range', unit: 'days',
    help: 'The period selected when the dashboard opens.',
    viz: { kind: 'ticks', source: 'days' },
  },
  daily_to_weekly_days: {
    def: 31, type: 'number', min: 2, max: 3650, group: 'display',
    label: 'Switch to weekly after', unit: 'days',
    help: 'Longer ranges are grouped by week instead of by day.',
    viz: { kind: 'ticks', source: 'buckets' },
  },
  weekly_to_monthly_weeks: {
    def: 26, type: 'number', min: 2, max: 520, group: 'display',
    label: 'Switch to monthly after', unit: 'weeks',
    help: 'Longer ranges again are grouped by month.',
    viz: { kind: 'ticks', source: 'buckets' },
  },
};

// Hai ngưỡng vẽ cùng một hình và sinh cùng một câu kết luận thì thực chất là một núm
// hai đầu, không phải hai mục. Tách ra chỉ làm người đọc phải so hai khối giống hệt.
const MERGES = {
  team_rate: {
    ordered: 'lt',
    group: 'team', label: 'Review rate targets',
    help: 'Two marks on every team\'s review rate: below the first a team is flagged as needing help, at or above the second it counts as on target.',
    parts: [['low_rate_pct', 'Needs help below'], ['good_rate_pct', 'On target from']],
  },
  small_team: {
    ordered: 'lte',
    group: 'team', label: 'Small teams',
    help: 'A team with a handful of files is easy to misread. At or below the first number a team is left out of warnings; at or below the second its file count is printed beside its name.',
    parts: [['too_few_files', 'Too few to judge'], ['show_count_below', 'Show the count']],
  },
  recent_unreviewed: {
    ordered: 'lt',
    group: 'backlog', label: 'Recent unreviewed',
    help: 'How much of the recent work may sit unreviewed before the chart warns.',
    parts: [['unreviewed_medium_pct', 'Amber from'], ['unreviewed_high_pct', 'Red from']],
  },
  waiting: {
    ordered: 'lt',
    group: 'backlog', label: 'Waiting for review',
    help: 'How much of the whole pipeline may be waiting for a reviewer before the chart warns.',
    parts: [['waiting_medium_pct', 'Amber from'], ['waiting_high_pct', 'Red from']],
  },
  axis_grouping: {
    group: 'display', label: 'Time axis grouping',
    help: 'Long date ranges get grouped so the axis stays readable.',
    parts: [['daily_to_weekly_days', 'Weekly after'], ['weekly_to_monthly_weeks', 'Monthly after']],
  },
};

const MERGE_OF = {};
for (const [id, m] of Object.entries(MERGES)) for (const [k] of m.parts) MERGE_OF[k] = id;

const GROUPS = [
  { key: 'speed', label: 'Review speed', collapsed: false },
  { key: 'team', label: 'Team health', collapsed: false },
  { key: 'backlog', label: 'Backlog', collapsed: false },
  { key: 'display', label: 'Display', collapsed: true },
];

const KEYS = Object.keys(SCHEMA);

function defaults() {
  const out = {};
  for (const k of KEYS) {
    const d = SCHEMA[k].def;
    out[k] = Array.isArray(d) ? d.slice() : d;
  }
  return out;
}

// Ngưỡng lạ trong DB bị bỏ qua thay vì làm hỏng cả bộ: một khoá đã xoá khỏi code
// không được phép làm dashboard trắng màn hình.
function merge(stored = {}) {
  const out = defaults();
  for (const k of KEYS) {
    if (Object.prototype.hasOwnProperty.call(stored, k) && stored[k] != null) out[k] = stored[k];
  }
  return out;
}

function checkOne(key, value) {
  const s = SCHEMA[key];
  if (!s) return 'Unknown setting.';

  if (s.type === 'numbers') {
    if (!Array.isArray(value) || value.length !== s.length) return `Needs exactly ${s.length} numbers.`;
    for (const v of value) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'Every entry must be a number.';
      if (v < s.min || v > s.max) return `Every entry must be between ${s.min} and ${s.max}.`;
    }
    for (let i = 1; i < value.length; i++) {
      if (value[i] <= value[i - 1]) return 'The numbers must rise from left to right.';
    }
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Must be a number.';
  if (value < s.min || value > s.max) return `Must be between ${s.min} and ${s.max}.`;
  return null;
}

// Ràng buộc chéo: từng giá trị hợp lệ riêng lẻ vẫn có thể vô nghĩa khi đứng cạnh nhau
// (ngưỡng "tốt" thấp hơn ngưỡng "kém" thì không câu kết luận nào đúng được).
const PAIRS = [
  ['low_rate_pct', 'good_rate_pct', 'Low review rate must be below the good review rate.'],
  ['unreviewed_medium_pct', 'unreviewed_high_pct', 'The medium level must be below the high level.'],
  ['waiting_medium_pct', 'waiting_high_pct', 'The medium level must be below the high level.'],
];

function validate(values) {
  const fields = {};
  for (const [k, v] of Object.entries(values)) {
    const err = checkOne(k, v);
    if (err) fields[k] = err;
  }
  if (Object.keys(fields).length) return fields;

  const all = merge(values);
  for (const [lo, hi, msg] of PAIRS) {
    if (all[lo] >= all[hi]) fields[lo] = msg;
  }
  if (all.too_few_files > all.show_count_below) {
    fields.too_few_files = 'Must not be above "Show file count below".';
  }
  if (all.daily_to_weekly_days >= all.weekly_to_monthly_weeks * 7) {
    fields.daily_to_weekly_days = 'Must be below the monthly switch point.';
  }
  return Object.keys(fields).length ? fields : null;
}

// Schema gửi cho frontend: bỏ `def` đi vì giá trị đang áp dụng đã nằm ở `values`,
// giữ lại thì form dễ hiển thị nhầm mặc định thành giá trị hiện tại.
// Mỗi mục trong form là một section có một hoặc nhiều ô (`parts`). Ô có thể là một
// khoá riêng, hoặc một vị trí trong khoá kiểu mảng — người vẽ form không cần phân biệt.
function part(key, label, index) {
  const s = SCHEMA[key];
  return {
    key, label: label || '', index: index == null ? null : index,
    unit: s.unit, type: s.type, min: s.min, max: s.max,
    def: Array.isArray(s.def) && index != null ? s.def[index] : s.def,
  };
}

function sectionFor(k) {
  const s = SCHEMA[k];
  const base = { viz: s.viz || null, msg: s.msg || null, unit: s.unit };
  const id = MERGE_OF[k];
  if (id) {
    const m = MERGES[id];
    return { ...base, key: id, label: m.label, help: m.help, ordered: m.ordered || null, parts: m.parts.map(([pk, pl]) => part(pk, pl)) };
  }
  if (s.type === 'numbers') {
    return { ...base, key: k, label: s.label, help: s.help, ordered: 'lt', parts: s.def.map((_, i) => part(k, '', i)) };
  }
  return { ...base, key: k, label: s.label, help: s.help, ordered: null, parts: [part(k, '')] };
}

function publicSchema() {
  return GROUPS.map(g => {
    const seen = new Set();
    const fields = [];
    for (const k of KEYS) {
      if (SCHEMA[k].group !== g.key) continue;
      const id = MERGE_OF[k] || k;
      if (seen.has(id)) continue;
      seen.add(id);
      fields.push(sectionFor(k));
    }
    return { ...g, fields };
  });
}

module.exports = { SCHEMA, GROUPS, KEYS, MERGES, defaults, merge, validate, checkOne, publicSchema };
