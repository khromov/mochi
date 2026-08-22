import path from 'node:path';
import { FileStorage, MochiCache, logger } from 'mochi-framework';
import { CI_ACTIONS_URL, CI_BRANCH, CI_REPO } from '../ci/repo';
import { SITE_ROOT } from './siteRoot';

// Reads the public GitHub Actions API unauthenticated (60 requests/hour per IP cap);
// set GITHUB_TOKEN to raise that to 5000/hour — entirely optional.

export const CI_API_BASE = 'https://api.github.com';

const RUNS_PER_WORKFLOW = 10;
const DEVELOPMENT = process.env.MODE === 'development';

export interface CiRun {
  id: number;
  runNumber: number;
  status: string;
  // `null` while the run is still in flight — always check `status` first.
  conclusion: string | null;
  event: string;
  title: string;
  sha: string;
  htmlUrl: string;
  createdAt: string;
  attempt: number;
}

export interface CiWorkflow {
  id: number;
  name: string;
  path: string;
  runsUrl: string;
  // Newest first. Empty is legitimate — a PR-only workflow never runs on main.
  runs: CiRun[];
  // Set when this one workflow's runs could not be fetched.
  error?: string;
}

export interface CiRateLimit {
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface CiDashboardData {
  repo: string;
  branch: string;
  fetchedAt: string;
  workflows: CiWorkflow[];
  rateLimit: CiRateLimit | null;
  // `null` when the repo's star count couldn't be fetched — the rest of the board is unaffected.
  stars: number | null;
  // At least one workflow failed to load but the rest of the board is usable.
  partial: boolean;
}

const ciCache = new MochiCache({
  minTimeToStale: 3_600_000, // 1h — after this, serve stale and refresh in the background
  maxTimeToLive: 21_600_000, // 6h — keep serving the last-good board through a GitHub outage
  // Warmup burns 8 of the 60 hourly GitHub calls on every dev restart, so persist to disk
  // to make restarts free; skipped outside dev since prod is long-lived and `bun test`
  // leaves MODE unset, keeping tests off the filesystem.
  ...(DEVELOPMENT
    ? {
        storage: new FileStorage({
          directory: path.join(SITE_ROOT, '.mochi', 'ci'),
          maxAge: 21_600_000,
        }),
      }
    : {}),
});

// Written on every response, read even after the cache callback throws — that's what
// lets a cold-cache 403 render "resets in 34m" instead of a bare failure.
let lastRateLimit: CiRateLimit | null = null;

export function getLastRateLimit(): CiRateLimit | null {
  return lastRateLimit;
}

// `Number(null)` is 0, so read the raw header and bail on a miss rather than
// letting an absent header masquerade as "0 requests left".
function headerInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function recordRateLimit(headers: Headers): void {
  const limit = headerInt(headers, 'x-ratelimit-limit');
  const remaining = headerInt(headers, 'x-ratelimit-remaining');
  const reset = headerInt(headers, 'x-ratelimit-reset');
  if (limit === null || remaining === null || reset === null) {
    return;
  }
  lastRateLimit = { limit, remaining, resetAt: new Date(reset * 1000).toISOString() };
}

async function ghFetch(pathname: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`${CI_API_BASE}${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mochi.fast-ci-dashboard',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // A hung GitHub must never stall an SSR render.
    signal: AbortSignal.timeout(10_000),
  });
  recordRateLimit(res.headers);
  // Throw rather than return, so a 403 rate-limit body or a 5xx HTML page is never cached.
  if (!res.ok) {
    throw new Error(`GitHub ${pathname} failed: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

interface RawWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

interface RawRepo {
  stargazers_count: number;
}

interface RawRun {
  id: number;
  run_number: number;
  status: string;
  conclusion: string | null;
  event: string;
  display_title: string;
  head_sha: string;
  html_url: string;
  created_at: string;
  run_attempt: number;
}

// The list response's `html_url` points at the workflow's YAML file, not its runs.
function workflowRunsUrl(workflowPath: string): string {
  const file = workflowPath.split('/').pop() ?? workflowPath;
  return `${CI_ACTIONS_URL}/workflows/${file}?query=branch%3A${CI_BRANCH}`;
}

function normalizeRun(raw: RawRun): CiRun {
  return {
    id: raw.id,
    runNumber: raw.run_number,
    status: raw.status,
    conclusion: raw.conclusion,
    event: raw.event,
    title: raw.display_title,
    sha: (raw.head_sha ?? '').slice(0, 7),
    htmlUrl: raw.html_url,
    createdAt: raw.created_at,
    attempt: raw.run_attempt,
  };
}

async function fetchWorkflowList(): Promise<RawWorkflow[]> {
  const body = (await ghFetch(`/repos/${CI_REPO}/actions/workflows?per_page=100`)) as { workflows?: RawWorkflow[] };
  // A deleted workflow lingers in the list as `deleted_workflow_state`; dropping the
  // non-active ones means the board prunes itself with no code change.
  return (body.workflows ?? []).filter((w) => w.state === 'active');
}

async function fetchRepoStars(): Promise<number> {
  const body = (await ghFetch(`/repos/${CI_REPO}`)) as RawRepo;
  return body.stargazers_count;
}

async function fetchRuns(workflowId: number): Promise<CiRun[]> {
  const body = (await ghFetch(`/repos/${CI_REPO}/actions/workflows/${workflowId}/runs?per_page=${RUNS_PER_WORKFLOW}&branch=${CI_BRANCH}`)) as {
    workflow_runs?: RawRun[];
  };
  return (body.workflow_runs ?? []).map(normalizeRun);
}

function buildDashboard(list: RawWorkflow[], settled: PromiseSettledResult<CiRun[]>[], stars: number | null): CiDashboardData {
  const workflows: CiWorkflow[] = list
    .map((raw, i): CiWorkflow => {
      const result = settled[i];
      const base = { id: raw.id, name: raw.name, path: raw.path, runsUrl: workflowRunsUrl(raw.path) };
      return result?.status === 'fulfilled' ? { ...base, runs: result.value } : { ...base, runs: [], error: String(result?.reason ?? 'unknown error') };
    })
    // A pull_request-only workflow never runs on this branch, so drop it rather than show
    // a permanently blank card — keyed off the empty result, not a workflow name, so it
    // holds for any future PR-only workflow. A fetch failure is different: that one keeps
    // its card and says so.
    .filter((w) => w.runs.length > 0 || w.error !== undefined);

  // Most-recently-active first.
  workflows.sort((a, b) => (b.runs[0]?.createdAt ?? '').localeCompare(a.runs[0]?.createdAt ?? ''));

  return {
    repo: CI_REPO,
    branch: CI_BRANCH,
    fetchedAt: new Date().toISOString(),
    workflows,
    rateLimit: lastRateLimit,
    stars,
    partial: workflows.some((w) => w.error !== undefined),
  };
}

const CACHE_KEY = 'ci:dashboard';

/** The CI board, or null when GitHub can't be reached and nothing is cached. */
export async function getCiDashboard(): Promise<CiDashboardData | null> {
  try {
    return await ciCache.fetch(CACHE_KEY, async () => {
      // The workflow list is the spine — without it there is nothing to render.
      const list = await fetchWorkflowList();
      // Stars ride alongside the runs; an isolated rejection just hides the tile.
      const [starsResult, ...settled] = await Promise.allSettled([fetchRepoStars(), ...list.map((w) => fetchRuns(w.id))]);
      const stars = starsResult.status === 'fulfilled' ? starsResult.value : null;

      // A rejection is a failure; an empty array is not. Caching an all-rejected board
      // would show a convincing "nothing has ever run" for the next hour.
      if (settled.length > 0 && settled.every((r) => r.status === 'rejected')) {
        throw new Error('every workflow runs fetch failed');
      }
      return buildDashboard(list, settled, stars);
    });
  } catch (err) {
    // GitHub being unreachable must never break the page — the route renders the
    // degraded state, explained by getLastRateLimit() when we were rate limited.
    logger.warn('[ci] fetch failed:', err);
    return null;
  }
}
