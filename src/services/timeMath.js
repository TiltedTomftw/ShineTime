// Pure, dependency-free time math and time formatting for job tracking.
// CommonJS so Node's built-in test runner can require() it. Negative spans are
// clamped to 0 everywhere to protect against device clock skew.

function computePauseDuration(pauseTimestamp, resumeTimestamp) {
  const d = Number(resumeTimestamp) - Number(pauseTimestamp);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function computeActiveTime(startTime, endTime, totalPauseTime) {
  const active = Number(endTime) - Number(startTime) - (Number(totalPauseTime) || 0);
  return Number.isFinite(active) && active > 0 ? active : 0;
}

function accumulateDetailerTime(existingMs, sessionStart, sessionEnd) {
  const session = Number(sessionEnd) - Number(sessionStart);
  const base = Number(existingMs) || 0;
  return base + (Number.isFinite(session) && session > 0 ? session : 0);
}

// Compact duration for summaries: "45s", "12 min", "1h 05m".
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes} min`;
  return `${Math.floor(total / 1000)}s`;
}

// Running-clock format for live timers, so they visibly tick: "4:07", "1:24:07".
function formatClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const DAY = 86400000;

function formatTimeOfDay(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Short "when" label: "3:45 PM" today, "Yesterday 3:45 PM", "Tue 3:45 PM"
// within the week, then a date. Replaces the full toLocaleString() stamps.
function formatWhen(ms, now = Date.now()) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '—';
  const today = startOfDay(now);
  const time = formatTimeOfDay(t);
  if (t >= today) return time;
  if (t >= today - DAY) return `Yesterday ${time}`;
  if (t >= today - 6 * DAY) {
    return `${new Date(t).toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  }
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear();
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// Day heading for grouped lists: "Today", "Yesterday", "Tuesday, Oct 6".
function formatDayHeading(ms, now = Date.now()) {
  const day = startOfDay(ms);
  const today = startOfDay(now);
  if (day === today) return 'Today';
  if (day === today - DAY) return 'Yesterday';
  const sameYear = new Date(day).getFullYear() === new Date(now).getFullYear();
  return new Date(day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// Group items into [{ title, key, data }] by local day, newest day first.
// `getTime(item)` picks the timestamp to group on.
function groupByDay(items, getTime, now = Date.now()) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const t = Number(getTime(item)) || 0;
    const key = startOfDay(t);
    if (!groups.has(key)) {
      groups.set(key, { key, title: formatDayHeading(t, now), data: [] });
    }
    groups.get(key).data.push(item);
  }
  return Array.from(groups.values()).sort((a, b) => b.key - a.key);
}

module.exports = {
  computePauseDuration,
  computeActiveTime,
  accumulateDetailerTime,
  formatDuration,
  formatClock,
  formatWhen,
  formatDayHeading,
  groupByDay,
  startOfDay,
};
