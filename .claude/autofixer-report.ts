import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Glob } from 'bun';

const MCP_URL = 'https://mcp.svelte.dev/mcp';

interface AutofixerResult {
  issues: string[];
  suggestions: string[];
}

interface FileReport {
  file: string;
  issues: string[];
  suggestions: string[];
}

let sessionId: string | null = null;
let requestId = 0;

function parseSSE(text: string): unknown {
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  throw new Error('No data line in SSE response');
}

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const id = ++requestId;
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  if (!res.ok) throw new Error(`MCP error ${res.status}: ${await res.text()}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return parseSSE(await res.text());
  }
  return res.json();
}

async function notify(method: string, params: Record<string, unknown> = {}) {
  await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params }),
  });
}

async function connect() {
  await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'autofixer-report', version: '1.0.0' },
  });
  await notify('notifications/initialized');
}

async function callTool(name: string, args: Record<string, unknown>): Promise<AutofixerResult> {
  const res = await rpc('tools/call', { name, arguments: args });
  const text = res.result?.content?.[0]?.text;
  if (text) return JSON.parse(text);
  return { issues: [], suggestions: [] };
}

function generateReport(files: string[], withIssues: FileReport[], withoutIssues: string[]): string {
  const lines: string[] = [
    '# Svelte Autofixer Report',
    '',
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Target version:** Svelte 5`,
    `**Files scanned:** ${files.length}`,
    `**Files with issues:** ${withIssues.length}`,
    `**Files without issues:** ${withoutIssues.length}`,
    '',
    '---',
    '',
  ];

  if (withIssues.length > 0) {
    lines.push('## Files with Issues', '');
    for (const { file, issues, suggestions } of withIssues) {
      lines.push(`### \`${file}\``, '');
      for (const issue of issues) {
        for (const part of issue.split('\n')) {
          lines.push(`- ${part}`);
        }
      }
      if (suggestions.length > 0) {
        lines.push('', '**Suggestions:**', '');
        for (const s of suggestions) {
          lines.push(`- ${s}`);
        }
      }
      lines.push('');
    }
  }

  if (withoutIssues.length > 0) {
    lines.push('## Files without Issues', '');
    for (const file of withoutIssues) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const glob = new Glob('**/*.svelte');
  const files = Array.from(glob.scanSync({ cwd: '.', dot: false })).sort();

  if (files.length === 0) {
    console.log('No .svelte files found.');
    process.exit(0);
  }

  console.log(`Found ${files.length} .svelte file(s)\n`);

  await connect();
  console.log('Connected to Svelte MCP server\n');

  const withIssues: FileReport[] = [];
  const withoutIssues: string[] = [];

  for (const file of files) {
    process.stdout.write(`Checking ${file}...`);
    const code = readFileSync(file, 'utf-8');

    const parsed = await callTool('svelte-autofixer', {
      code,
      desired_svelte_version: 5,
      filename: basename(file),
    });

    if (parsed.issues.length > 0) {
      withIssues.push({ file, issues: parsed.issues, suggestions: parsed.suggestions });
      console.log(` ${parsed.issues.length} issue(s)`);
    } else {
      withoutIssues.push(file);
      console.log(' OK');
    }
  }

  writeFileSync('REPORT.md', generateReport(files, withIssues, withoutIssues));
  console.log('\nReport written to REPORT.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
