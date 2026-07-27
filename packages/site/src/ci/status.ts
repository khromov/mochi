// Pure helpers — this module ships to the browser inside the CI island, so it must
// stay free of any server-only import.

export type Tone = 'success' | 'failure' | 'running' | 'neutral';

export type BadgeKind = 'default' | 'info' | 'success' | 'warning' | 'danger';

interface RunLike {
  status: string;
  conclusion: string | null;
}

/**
 * `conclusion` is null while a run is in flight, so status has to be checked first —
 * switching on conclusion alone silently labels every running job as unknown.
 */
export function runTone(run: RunLike): Tone {
  if (run.status !== 'completed') {
    return 'running';
  }
  switch (run.conclusion) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'failure';
    default:
      // cancelled / skipped / action_required / neutral — not a build break.
      return 'neutral';
  }
}

export function runLabel(run: RunLike): string {
  if (run.status === 'queued' || run.status === 'requested' || run.status === 'waiting' || run.status === 'pending') {
    return 'Queued';
  }
  if (run.status !== 'completed') {
    return 'Running';
  }
  return (run.conclusion ?? 'unknown').replace(/_/g, ' ');
}

export const toneToBadge: Record<Tone, BadgeKind> = {
  success: 'success',
  failure: 'danger',
  running: 'info',
  neutral: 'default',
};

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Coarse relative time. Clock skew between our `now` and GitHub's timestamps can put
 * an event slightly in the future, which must read as "just now", never "-3m ago". */
export function formatRelative(iso: string | number, now: number): string {
  const then = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(then)) {
    return 'unknown';
  }
  const delta = now - then;
  if (delta < MINUTE) {
    return 'just now';
  }
  if (delta < HOUR) {
    return `${Math.floor(delta / MINUTE)}m ago`;
  }
  if (delta < DAY) {
    return `${Math.floor(delta / HOUR)}h ago`;
  }
  return `${Math.floor(delta / DAY)}d ago`;
}

/** Same scale, phrased forwards — for a rate-limit reset that lies ahead. */
export function formatUntil(iso: string | number, now: number): string {
  const then = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(then)) {
    return 'unknown';
  }
  const delta = then - now;
  if (delta < MINUTE) {
    return 'any moment';
  }
  if (delta < HOUR) {
    return `in ${Math.floor(delta / MINUTE)}m`;
  }
  return `in ${Math.floor(delta / HOUR)}h`;
}

/** Passing share of the completed runs, or null when none have completed. */
export function successRate(runs: RunLike[]): { passed: number; total: number } | null {
  const completed = runs.filter((r) => r.status === 'completed');
  if (completed.length === 0) {
    return null;
  }
  return { passed: completed.filter((r) => runTone(r) === 'success').length, total: completed.length };
}
