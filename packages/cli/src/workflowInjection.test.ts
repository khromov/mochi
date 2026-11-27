import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const workflowsDir = path.join(import.meta.dir, '..', '..', '..', '.github', 'workflows');
const UNTRUSTED_EXPRESSION = /\$\{\{[^}]*\b(inputs\.|github\.event\.|github\.head_ref)/;

// Actions splices `${{ }}` into a run body before the shell parses it, so a quote in a dispatch input or PR field runs as script.
test('no workflow run body interpolates a caller-controlled expression', () => {
  const offenders: string[] = [];
  for (const file of readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))) {
    const workflow = Bun.YAML.parse(readFileSync(path.join(workflowsDir, file), 'utf8')) as {
      jobs: Record<string, { steps?: { name?: string; run?: string }[] }>;
    };
    for (const [job, { steps = [] }] of Object.entries(workflow.jobs)) {
      for (const step of steps) {
        if (step.run && UNTRUSTED_EXPRESSION.test(step.run)) {
          offenders.push(`${file} ${job}: ${step.name ?? step.run.split('\n')[0]}`);
        }
      }
    }
  }
  expect(offenders).toEqual([]);
});
