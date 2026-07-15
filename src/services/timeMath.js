// Pure, dependency-free time math for job duration tracking.
// Extracted so the app's core metric (active detail time) is unit-tested and so
// the negative-duration clamp (protecting against device clock skew) lives in
// one canonical place. CommonJS so Node's built-in test runner can require() it.
//
// NOTE: storage.js still computes these inline; adopting these helpers there is
// a follow-up (see docs/OVERNIGHT_FINAL_SUMMARY.md). Kept side-effect free.

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

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  const seconds = Math.floor((total % 60000) / 1000);
  return minutes > 0 ? `${minutes}m` : `${seconds}s`;
}

module.exports = {
  computePauseDuration,
  computeActiveTime,
  accumulateDetailerTime,
  formatDuration,
};
