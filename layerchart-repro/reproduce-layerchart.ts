// Confirms the bug affects EVERY one of LayerChart's all-in-one chart shortcuts: each server-render
// (ssr) crashes with the same stack overflow. Run: `bun reproduce-layerchart.ts`
import { buildServer, renderToString } from './harness.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Every shortcut, with the minimal valid data needed to make it actually render its `marks`.
const CASES: Record<string, string> = {
  BarChart: `const data=[{a:'Jan',b:3},{a:'Feb',b:5},{a:'Mar',b:4}];</script>\n<BarChart ssr width={600} height={220} {data} x="a" y="b" />`,
  AreaChart: `const data=[{a:0,b:3},{a:1,b:5},{a:2,b:4}];</script>\n<AreaChart ssr width={600} height={220} {data} x="a" y="b" />`,
  LineChart: `const data=[{a:0,b:3},{a:1,b:5},{a:2,b:4}];</script>\n<LineChart ssr width={600} height={220} {data} x="a" y="b" />`,
  ScatterChart: `const data=[{a:0,b:3},{a:1,b:5},{a:2,b:4}];</script>\n<ScatterChart ssr width={600} height={220} {data} x="a" y="b" />`,
  PieChart: `const data=[{k:'a',v:3},{k:'b',v:5},{k:'c',v:4}];</script>\n<PieChart ssr width={600} height={220} {data} key="k" value="v" />`,
  ArcChart: `const data=[{k:'a',v:3},{k:'b',v:5},{k:'c',v:4}];</script>\n<ArcChart ssr width={600} height={220} {data} key="k" value="v" />`,
};

async function testCase(name: string, body: string): Promise<string> {
  const dir = join(import.meta.dir, '.out', name);
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, `${name}.svelte`);
  writeFileSync(entry, `<script lang="ts">\n  import { ${name} } from 'layerchart/svg';\n  ${body}\n`);
  let built: string;
  try {
    built = await buildServer(entry, join(dir, 'out'));
  } catch (e) {
    return `BUILD FAILED — ${(e as Error).message.split('\n')[0]}`;
  }
  try {
    await renderToString(built, name);
    return 'server-rendered OK (no crash)';
  } catch (e) {
    return `CRASH — ${(e as Error).constructor.name}: ${(e as Error).message}`;
  }
}

console.log('LayerChart shortcut components with `ssr`, server-rendered:\n');
for (const [name, body] of Object.entries(CASES)) {
  console.log(`  ${name.padEnd(13)} → ${await testCase(name, body)}`);
}
