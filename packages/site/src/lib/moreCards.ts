import type { Component } from 'svelte';
import Blocks from '@lucide/svelte/icons/blocks';
import Bot from '@lucide/svelte/icons/bot';
import Container from '@lucide/svelte/icons/container';
import TestTube from '@lucide/svelte/icons/test-tube';
import Wrench from '@lucide/svelte/icons/wrench';

export interface MoreCard {
  id: 'deploy' | 'libraries' | 'dx' | 'agent' | 'testing';
  icon: Component;
  title: string;
  body: string;
  href: string;
  cta: string;
}

export const moreCards: MoreCard[] = [
  {
    id: 'deploy',
    icon: Container,
    title: 'Deploy anywhere',
    body: 'One build command and one Docker image. Runs on any host that runs Bun: PaaS, VPS, or the big clouds.',
    href: '/docs/deployment-options/',
    cta: 'Deployment guide',
  },
  {
    id: 'libraries',
    icon: Blocks,
    title: 'Your Svelte libraries just work',
    body: 'Mochi compiles standard Svelte 5. LayerChart, Runed, Portable Text, and your own components drop in unchanged.',
    href: '/docs/coming-from-sveltekit/',
    cta: 'Coming from SvelteKit',
  },
  {
    id: 'dx',
    icon: Wrench,
    title: 'Developer experience',
    body: 'Debug bar, error overlay, and live reload in development. svelte-check and schema-validated env keep the rest honest.',
    href: '/docs/development-mode/',
    cta: 'Development mode',
  },
  {
    id: 'agent',
    icon: Bot,
    title: 'Agent-ready',
    body: 'A remote MCP server, an agent skill, and llms.txt bundles keep coding assistants on current docs.',
    href: '/docs/docs-for-llms/',
    cta: 'Docs for LLMs',
  },
  {
    id: 'testing',
    icon: TestTube,
    title: 'Tests that boot the real app',
    body: 'bun:test for units. runTests() starts the whole app in its own process per file, so routes, islands, and forms get exercised for real.',
    href: '/docs/testing/',
    cta: 'Testing guide',
  },
];
