import type { Component } from 'svelte';
import Sprout from '@lucide/svelte/icons/sprout';
import PackageOpen from '@lucide/svelte/icons/package-open';
import Layers from '@lucide/svelte/icons/layers';
import Globe from '@lucide/svelte/icons/globe';
import Cookie from '@lucide/svelte/icons/cookie';
import MessageCircle from '@lucide/svelte/icons/message-circle';
import Webhook from '@lucide/svelte/icons/webhook';
import Share2 from '@lucide/svelte/icons/share-2';
import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
import ComponentIcon from '@lucide/svelte/icons/component';
import Telescope from '@lucide/svelte/icons/telescope';
import Package2 from '@lucide/svelte/icons/package-2';
import Boxes from '@lucide/svelte/icons/boxes';
import ClipboardPen from '@lucide/svelte/icons/clipboard-pen';
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import ShieldAlert from '@lucide/svelte/icons/shield-alert';
import Flame from '@lucide/svelte/icons/flame';
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import DatabaseZap from '@lucide/svelte/icons/database-zap';
import Type from '@lucide/svelte/icons/type';
import ListTodo from '@lucide/svelte/icons/list-todo';
import Dices from '@lucide/svelte/icons/dices';
import OctagonAlert from '@lucide/svelte/icons/octagon-alert';
import Signpost from '@lucide/svelte/icons/signpost';
import FileUp from '@lucide/svelte/icons/file-up';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import CircleX from '@lucide/svelte/icons/circle-x';
import ListTree from '@lucide/svelte/icons/list-tree';
import FileText from '@lucide/svelte/icons/file-text';
import Eye from '@lucide/svelte/icons/eye';
import Snowflake from '@lucide/svelte/icons/snowflake';
import Fingerprint from '@lucide/svelte/icons/fingerprint';
import Link from '@lucide/svelte/icons/link';
import ImageIcon from '@lucide/svelte/icons/image';

export interface DemoIconMeta {
  icon: Component;
  label: string;
}

export const demoIconFor: Record<string, DemoIconMeta> = {
  'Hello World': { icon: Sprout, label: 'Pure SSR' },
  MdSvex: { icon: FileText, label: 'Markdown route via mdsvex' },
  'Server Props': { icon: PackageOpen, label: 'Server-resolved props' },
  'Hydration Modes': { icon: Layers, label: 'All hydration modes' },
  'Data Loading': { icon: Globe, label: 'Server-side fetch' },
  Hydratable: { icon: Snowflake, label: 'Server-computed value reused on hydration' },
  Cookies: { icon: Cookie, label: 'Server + client cookies' },
  'Cache Events': { icon: DatabaseZap, label: 'Custom cache event subscriber' },
  'Real-time Chat': { icon: MessageCircle, label: 'WebSocket chat' },
  'API Endpoints': { icon: Webhook, label: 'JSON API routes' },
  'Shared State': { icon: Share2, label: 'Shared $state across islands' },
  'Real-time Streams': { icon: AudioWaveform, label: 'WebSocket + SSE streams' },
  'Server Island': { icon: ComponentIcon, label: 'Deferred server island' },
  'Lazy Islands': { icon: Telescope, label: 'Hydrate when visible' },
  'Lazy Server Islands': { icon: Eye, label: 'Fetch server island when visible' },
  'Font Loading': { icon: Type, label: 'Bundle fontsource + standalone fonts' },
  'Crossing the server-client boundary with props': { icon: Package2, label: 'Props serialized into the island — every devalue type' },
  'Nested Components': { icon: ListTree, label: 'Five-level deep tree under one island' },
  'Shared Props': { icon: Boxes, label: 'Auto-deduplicated island props' },
  Forms: { icon: ClipboardPen, label: 'Forms with action handlers' },
  'Using form return data': { icon: Dices, label: 'success({ value }) round-trip via {@attach enhance(...)}' },
  'Form Errors': { icon: OctagonAlert, label: 'Thrown server errors, inline or full-page' },
  'Form Redirects': { icon: Signpost, label: 'redirect() — intercepted JSON or followed natively' },
  'File Upload': { icon: FileUp, label: 'multipart/form-data with {@attach enhance(...)}' },
  'Reloading associated form data': { icon: RefreshCw, label: 'Refetch related state after a successful submit' },
  Cancelling: { icon: CircleX, label: 'cancel() and controller.abort() cancellation paths' },
  'Error Handling': { icon: TriangleAlert, label: 'Error pages and handleError' },
  'Error Boundaries': { icon: ShieldAlert, label: 'Walled-off island failures' },
  'Hacker News Clone': { icon: Flame, label: 'Hacker News reader (WIP)' },
  'Realtime Admin Panel': { icon: LayoutDashboard, label: 'Live admin dashboard' },
  'Tailwind Todo App': { icon: ListTodo, label: 'Todo app on Tailwind' },
  'Cookie Vary Test': { icon: Fingerprint, label: 'Response-driven Vary: Cookie' },
  'Isomorphic URL': { icon: Link, label: 'Same url import on server and client' },
  'Image Resizing': { icon: ImageIcon, label: 'Signed, cached image resizing on Bun.Image' },
};
