import type { Component } from 'svelte';
import Database from '@lucide/svelte/icons/database';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Zap from '@lucide/svelte/icons/zap';
import ScrollText from '@lucide/svelte/icons/scroll-text';
import Radio from '@lucide/svelte/icons/radio';
import Rss from '@lucide/svelte/icons/rss';
import Layers from '@lucide/svelte/icons/layers';
import Puzzle from '@lucide/svelte/icons/puzzle';
import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import Gauge from '@lucide/svelte/icons/gauge';
import Cookie from '@lucide/svelte/icons/cookie';
import TreePalm from '@lucide/svelte/icons/tree-palm';
import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
import Image from '@lucide/svelte/icons/image';
import FileText from '@lucide/svelte/icons/file-text';
import { rows, rank, type Cell, type Row } from '../../../docs/_components/comparisonRows';

export interface BatteryNode {
  label: string;
  icon: Component;
  /** Exact `feature` names of the comparison-table rows this node summarises. */
  features: string[];
  href: string;
  note?: string;
  /** Shorter stand-in for the table's SvelteKit note, which is written for a wide column. */
  kitNote?: string;
}

export interface BatteryBranch {
  title: string;
  nodes: BatteryNode[];
}

export const branches: BatteryBranch[] = [
  {
    title: 'Data',
    nodes: [
      {
        label: 'Databases',
        icon: Database,
        features: ['Built-in SQLite database', 'Built-in Postgres & MySQL support'],
        href: '/docs/persistence/',
        note: 'bun:sqlite & Bun.sql()',
        kitNote: 'third party or sqlite with Node.js',
      },
      { label: 'Job queues', icon: ListChecks, features: ['Background job queues'], href: '/docs/queues/' },
      { label: 'Caching', icon: Zap, features: ['Built-in caching library'], href: '/docs/cache/' },
      {
        label: 'Logging',
        icon: ScrollText,
        features: ['Centralized logging system'],
        href: '/docs/logging/',
        kitNote: 'experimental OTel',
      },
    ],
  },
  {
    title: 'Server',
    nodes: [
      { label: 'WebSockets', icon: Radio, features: ['Real-time WebSockets'], href: '/docs/websocket-routes/', kitNote: 'custom server + package' },
      { label: 'Server-Sent Events', icon: Rss, features: ['Server-Sent Events'], href: '/docs/server-sent-events/', kitNote: 'manual setup' },
      { label: 'Middleware', icon: Layers, features: ['Middleware'], href: '/docs/middleware/', note: 'handle & sequence()' },
      { label: 'Hooks & filters', icon: Puzzle, features: ['Hooks & extension filters'], href: '/docs/extensions/' },
    ],
  },
  {
    title: 'Forms & safety',
    nodes: [
      {
        label: 'Form actions',
        icon: ClipboardCheck,
        features: ['Form actions + progressively enhanced forms'],
        href: '/docs/progressively-enhancing-forms-with-enhance/',
        note: 'use:enhance',
      },
      { label: 'Captcha', icon: ShieldCheck, features: ['Form captcha'], href: '/docs/captcha/' },
      { label: 'Rate limiting', icon: Gauge, features: ['Rate limiting'], href: '/docs/rate-limiting/', note: 'per-route rateLimit' },
      { label: 'Cookies', icon: Cookie, features: ['Cookie helpers'], href: '/docs/request-context/#cookies', note: 'cookies.get() & set()' },
    ],
  },
  {
    title: 'Frontend',
    nodes: [
      { label: 'Server islands', icon: TreePalm, features: ['Server islands & selective hydration'], href: '/docs/server-islands/' },
      { label: 'View Transitions', icon: ArrowRightLeft, features: ['View Transitions'], href: '/docs/view-transitions/' },
      {
        label: 'Image resizing',
        icon: Image,
        features: ['Image resizing'],
        href: '/docs/images/',
        note: 'runtime transforms',
        kitNote: 'build-time only',
      },
      { label: 'Markdown', icon: FileText, features: ['Built-in Markdown (mdsvex)'], href: '/docs/mdsvex/', kitNote: 'via sv add mdsvex' },
    ],
  },
];

export function rowsFor(node: BatteryNode): Row[] {
  return node.features.flatMap((feature) => rows.filter((row) => row.feature === feature));
}

// A node spanning several rows (Databases) is as supported as its best-supported row.
export function kitCell(node: BatteryNode): Cell {
  return rowsFor(node)
    .map((row) => row.kit)
    .reduce<Cell>((best, cell) => (rank[cell.status] >= rank[best.status] ? cell : best), { status: 'no' });
}

export function mochiNote(node: BatteryNode): string | undefined {
  return node.note ?? rowsFor(node)[0]?.mochi.note;
}

export function kitNote(node: BatteryNode): string {
  const cell = kitCell(node);
  return node.kitNote ?? cell.note ?? (cell.status === 'yes' ? 'Built in' : 'Not built in');
}
