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
    title: 'Deploy (almost) anywhere',
    body: 'Runs on any host that runs Bun: Stateful cloud hosts, VPS, PaaS or big enterprise clouds.',
    href: '/docs/deployment-options/',
    cta: 'Deployment guide',
  },
  {
    id: 'libraries',
    icon: Blocks,
    title: 'Use your favourite Svelte libraries',
    body: 'Mochi compiles standard Svelte 5 and you can use any existing Svelte libraries. Find examples for LayerChart, Runed, Portable Text and more in the docs.',
    href: '/docs/coming-from-sveltekit/',
    cta: 'Coming from SvelteKit',
  },
  {
    id: 'dx',
    icon: Wrench,
    title: 'Great developer experience',
    body: 'Debug bar, error overlay, and live reload in development. svelte-check and TypeScript keeps your code in check.',
    href: '/docs/development-mode/',
    cta: 'Development mode',
  },
  {
    id: 'agent',
    icon: Bot,
    title: 'Agent-ready',
    body: 'A remote MCP server, an agent skill, and llms.txt bundles keep coding assistants updated and productive.',
    href: '/docs/docs-for-llms/',
    cta: 'Docs for LLMs',
  },
  {
    id: 'testing',
    icon: TestTube,
    title: 'Real app tests',
    body: 'Mochi provides both unit tests using bun:test and a helper script for booting your app and testing it for real.',
    href: '/docs/testing/',
    cta: 'Testing guide',
  },
];
