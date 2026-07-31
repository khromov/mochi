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
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import Palette from '@lucide/svelte/icons/palette';
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
import Droplets from '@lucide/svelte/icons/droplets';
import Fingerprint from '@lucide/svelte/icons/fingerprint';
import Link from '@lucide/svelte/icons/link';
import ImageIcon from '@lucide/svelte/icons/image';
import ImageOff from '@lucide/svelte/icons/image-off';
import CloudUpload from '@lucide/svelte/icons/cloud-upload';
import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
import Blend from '@lucide/svelte/icons/blend';
import FileDown from '@lucide/svelte/icons/file-down';
import Hash from '@lucide/svelte/icons/hash';
import Barcode from '@lucide/svelte/icons/barcode';
import Tornado from '@lucide/svelte/icons/tornado';
import Inbox from '@lucide/svelte/icons/inbox';
import SquareStack from '@lucide/svelte/icons/square-stack';
import Layers2 from '@lucide/svelte/icons/layers-2';
import Ampersand from '@lucide/svelte/icons/ampersand';
import Mail from '@lucide/svelte/icons/mail';
import Gauge from '@lucide/svelte/icons/gauge';
import Recycle from '@lucide/svelte/icons/recycle';
import TextQuote from '@lucide/svelte/icons/text-quote';

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
  'isHydratable()': { icon: Droplets, label: 'Will this subtree hydrate on this page load?' },
  Cookies: { icon: Cookie, label: 'Server + client cookies' },
  'Cache Events': { icon: DatabaseZap, label: 'Custom cache event subscriber' },
  'Request Cache': { icon: Recycle, label: 'Memoize repeated work within one request' },
  'Request ID': { icon: Barcode, label: 'Per-request correlation id' },
  'Real-time Chat': { icon: MessageCircle, label: 'WebSocket chat' },
  'API Endpoints': { icon: Webhook, label: 'JSON API routes' },
  'Rate Limiting': { icon: Gauge, label: 'Per-route request throttling by IP' },
  'Shared State': { icon: Share2, label: 'Shared $state across islands' },
  'Real-time Streams': { icon: AudioWaveform, label: 'WebSocket + SSE streams' },
  'Background jobs with queues': { icon: Inbox, label: 'Embedded job queue + worker' },
  'Server Islands': { icon: ComponentIcon, label: 'Deferred server island' },
  'Client-only Islands': { icon: MonitorSmartphone, label: 'No SSR — mounts in the browser' },
  'Lazy Islands': { icon: Telescope, label: 'Hydrate when visible' },
  'Lazy Server Islands': { icon: Eye, label: 'Fetch server island when visible' },
  'Font loading': { icon: Type, label: 'Bundle fontsource + standalone fonts' },
  'Crossing the server-client boundary with props': { icon: Package2, label: 'Props serialized into the island — every devalue type' },
  'HTML Entities in Props': { icon: Ampersand, label: 'HTML entities in static island props decode across SSR + hydration' },
  'Nested Components': { icon: ListTree, label: 'Five-level deep tree under one island' },
  'Nested Islands': { icon: SquareStack, label: 'Islands nested inside server islands' },
  'Nested Island Max Depth': { icon: Layers2, label: 'Server islands nested several levels deep' },
  'Shared Props': { icon: Boxes, label: 'Auto-deduplicated island props' },
  'Unique IDs': { icon: Hash, label: 'Native $props.id() in islands' },
  'Send Email': { icon: Mail, label: 'Send a transactional email' },
  'Form Actions': { icon: ClipboardPen, label: 'Forms with action handlers' },
  'Using form return data': { icon: Dices, label: 'success({ value }) round-trip via {@attach enhance(...)}' },
  Captcha: { icon: ShieldCheck, label: 'Slide-to-verify captcha with proof-of-work' },
  'Captcha Styling': { icon: Palette, label: 'Theming the captcha with CSS custom properties' },
  'Form Errors': { icon: OctagonAlert, label: 'Thrown server errors, inline or full-page' },
  'Form Redirects': { icon: Signpost, label: 'redirect() — intercepted JSON or followed natively' },
  'File Uploads via form actions': { icon: FileUp, label: 'multipart/form-data with {@attach enhance(...)}' },
  'Reloading associated form data': { icon: RefreshCw, label: 'Refetch related state after a successful submit' },
  'Cancelling form submissions': { icon: CircleX, label: 'cancel() and controller.abort() cancellation paths' },
  'Error Handling': { icon: TriangleAlert, label: 'Error pages and handleError' },
  'Error Boundaries': { icon: ShieldAlert, label: 'Walled-off island failures' },
  'Hacker News Clone': { icon: Flame, label: 'Hacker News reader (WIP)' },
  'Realtime Admin Panel': { icon: LayoutDashboard, label: 'Live admin dashboard' },
  'Tailwind Todo App': { icon: ListTodo, label: 'Todo app on Tailwind' },
  'Cookie Vary Test': { icon: Fingerprint, label: 'Response-driven Vary: Cookie' },
  'Isomorphic URL': { icon: Link, label: 'Same url import on server and client' },
  'Image: Component': { icon: ImageIcon, label: '<Image> with named sizes and blur-up placeholders' },
  'Image: Invalidation': { icon: ImageOff, label: 'Clear a cached image on demand with invalidateImage()' },
  'Image: Events': { icon: CloudUpload, label: 'Mirror the <Image> cache via image:store / image:delete' },
  'Image: Named sizes': { icon: WandSparkles, label: 'Declarative named Bun.Image transform sizes' },
  'View Transitions': { icon: Blend, label: 'Animated cross-document navigations' },
  'Custom Transitions': { icon: Tornado, label: 'Custom @keyframes spin via custom={{ in, out }}' },
  'File Routes': { icon: FileDown, label: 'Serve a file from disk with Mochi.file()' },
  'Portable Text': { icon: TextQuote, label: 'Render Portable Text JSON with your own Svelte components' },
};
