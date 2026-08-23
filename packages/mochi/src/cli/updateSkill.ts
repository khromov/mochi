import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_SKILL_URL = 'https://mochi.fast/SKILL.md';

// Where each agent looks for skills. antigravity and codex share the same
// `.agents/` convention, so they resolve to the same destination.
export const SKILL_DESTS = {
  'claude-code': path.join('.claude', 'skills', 'mochi', 'SKILL.md'),
  opencode: path.join('.opencode', 'skills', 'mochi', 'SKILL.md'),
  antigravity: path.join('.agents', 'skills', 'mochi', 'SKILL.md'),
  codex: path.join('.agents', 'skills', 'mochi', 'SKILL.md'),
} as const;

export type SkillTarget = keyof typeof SKILL_DESTS;

export const SKILL_TARGETS = Object.keys(SKILL_DESTS) as SkillTarget[];

export const DEFAULT_SKILL_TARGET: SkillTarget = 'claude-code';

type FetchLike = (url: string) => Promise<Response>;

export interface UpdateSkillOptions {
  cwd?: string;
  url?: string;
  target?: SkillTarget;
  fetchImpl?: FetchLike;
  confirmUpdate?: (preview: UpdateSkillPreview) => boolean | Promise<boolean>;
}

export interface UpdateSkillPreview {
  path: string;
  url: string;
  created: boolean;
  diff: string;
}

export interface UpdateSkillResult {
  path: string;
  created: boolean;
  action: 'created' | 'updated' | 'unchanged' | 'aborted';
  diff: string;
}

function lines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const result = text.split('\n');
  if (result.at(-1) === '') {
    result.pop();
  }
  return result;
}

const CONTEXT_LINES = 3;

// Above this the O(n*m) table stops being worth its memory; the whole file is then shown as one replacement.
const MAX_DIFF_CELLS = 4_000_000;

type DiffOp = { kind: ' ' | '-' | '+'; text: string };

function diffOps(before: string[], after: string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;
  if (n * m > MAX_DIFF_CELLS) {
    return [...before.map((text): DiffOp => ({ kind: '-', text })), ...after.map((text): DiffOp => ({ kind: '+', text }))];
  }

  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = before[i] === after[j] ? lcs[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: ' ', text: before[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * (m + 1) + j]! >= lcs[i * (m + 1) + j + 1]!) {
      ops.push({ kind: '-', text: before[i]! });
      i++;
    } else {
      ops.push({ kind: '+', text: after[j]! });
      j++;
    }
  }
  for (; i < n; i++) {
    ops.push({ kind: '-', text: before[i]! });
  }
  for (; j < m; j++) {
    ops.push({ kind: '+', text: after[j]! });
  }
  return ops;
}

/**
 * Unified diff with one hunk per cluster of changes — the reader is being asked to spot an injected instruction in an
 * unsigned update, so unrelated distant edits must not bury it under the whole file rewritten as remove-then-add.
 */
export function formatSkillDiff(previous: string, next: string, dest: string, url: string): string {
  const ops = diffOps(lines(previous), lines(next));
  const changed = ops.map((op) => op.kind !== ' ');

  const output = [`--- ${previous === '' ? '/dev/null' : dest}`, `+++ ${url}`];
  let oldLine = 1;
  let newLine = 1;
  for (let i = 0; i < ops.length;) {
    if (!changed[i]) {
      if (ops[i]!.kind !== '+') {
        oldLine++;
      }
      if (ops[i]!.kind !== '-') {
        newLine++;
      }
      i++;
      continue;
    }

    const start = Math.max(0, i - CONTEXT_LINES);
    let end = i;
    // Absorb the next change too when only context separates it, so neighbouring edits share one hunk.
    for (let scan = i; scan < ops.length; scan++) {
      if (changed[scan]) {
        end = scan;
      } else if (scan - end > CONTEXT_LINES * 2) {
        break;
      }
    }
    end = Math.min(ops.length - 1, end + CONTEXT_LINES);

    let oldStart = oldLine;
    let newStart = newLine;
    for (let back = i - 1; back >= start; back--) {
      if (ops[back]!.kind !== '+') {
        oldStart--;
      }
      if (ops[back]!.kind !== '-') {
        newStart--;
      }
    }

    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    for (let k = start; k <= end; k++) {
      const op = ops[k]!;
      body.push(`${op.kind}${op.text}`);
      if (op.kind !== '+') {
        oldCount++;
      }
      if (op.kind !== '-') {
        newCount++;
      }
    }
    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body);

    for (let k = i; k <= end; k++) {
      if (ops[k]!.kind !== '+') {
        oldLine++;
      }
      if (ops[k]!.kind !== '-') {
        newLine++;
      }
    }
    i = end + 1;
  }
  return `${output.join('\n')}\n`;
}

// Pulls the hosted Mochi SKILL.md into the consuming project so the agent
// guidance stays in sync with the framework version, rather than drifting from
// a copy scaffolded once at project creation.
export async function updateSkill(options: UpdateSkillOptions = {}): Promise<UpdateSkillResult> {
  // MOCHI_SKILL_URL overrides the source — primarily so the CLI can be exercised
  // end-to-end against a local server without hitting the network.
  const { cwd = process.cwd(), url = process.env.MOCHI_SKILL_URL || DEFAULT_SKILL_URL, target = DEFAULT_SKILL_TARGET, fetchImpl = fetch, confirmUpdate } = options;

  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach ${url}: ${msg}`, { cause: err });
  }

  if (!res.ok) {
    throw new Error(`Could not fetch SKILL.md from ${url} (HTTP ${res.status}). The hosted skill may not be published yet.`);
  }

  const body = await res.text();
  const dest = path.resolve(cwd, SKILL_DESTS[target]);
  const created = !existsSync(dest);
  const previous = created ? '' : await Bun.file(dest).text();
  if (!created && previous === body) {
    return { path: dest, created: false, action: 'unchanged', diff: '' };
  }
  const diff = formatSkillDiff(previous, body, dest, url);
  // A first-time write has no prior content to review, so there is nothing for the operator to approve.
  if (!created && confirmUpdate && !(await confirmUpdate({ path: dest, url, created, diff }))) {
    return { path: dest, created, action: 'aborted', diff };
  }
  await Bun.write(dest, body);

  return { path: dest, created, action: created ? 'created' : 'updated', diff };
}
