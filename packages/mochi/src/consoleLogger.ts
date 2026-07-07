import nodePath from 'node:path';
import { styleText } from 'node:util';
import prettyBytes from './vendor/pretty-bytes';
import { pinGlobal } from './globalState';
import { mochiEvents } from './events';
import type { MochiEventMap, MochiRequestKind } from './events';
import { logger } from './log';
import { getEmailRuntime } from './email/config';
import { applyFilter, type ConsoleLoggerSource, type MochiFilterContext, type MochiFilterReturn } from './extensions';

export interface ConsoleLoggerOptions {
  /** Duration (ms) at which a request is marked slow — duration turns yellow and line uses warn level. */
  slowThreshold?: number;
  /** Duration (ms) at which duration is rendered red. */
  verySlowThreshold?: number;
  /**
   * Compile / HMR event verbosity:
   * - `true` (default) — log per-page `BUILD`, per-cycle `HMR`, and per-bundle `BNDL` lines.
   * - `false` — silence compile/HMR events entirely.
   */
  compile?: boolean;
}

const DEFAULT_SLOW = 500;
const DEFAULT_VERY_SLOW = 2000;

// Pinned on `globalThis` so a bundled SSR copy of this module can't double-subscribe
// to `mochiEvents` with its own private flag (matching every other cross-bundle singleton).
const state = pinGlobal<{ registered: boolean }>('__mochi_console_logger__', () => ({ registered: false }));

/**
 * Pre-built consumer of `mochiEvents` that prints one formatted line per HTTP
 * request, WebSocket frame, SSE message, server start/stop, and (optionally)
 * cache event. Lines are routed through `logger.info` / `logger.warn`, so they
 * inherit the active log level.
 *
 * This is **not** the logger primitive — that's `logger` (in `./log`). This
 * function is the *request/lifecycle formatter* that turns events on the bus
 * into the BOOT/GET/ERR/WS lines you see during development. Subscribe your
 * own observability pipeline (Sentry, OpenTelemetry, JSON stdout) directly to
 * `mochiEvents` and pass `logger: { enabled: false }` to `Mochi.serve()` if
 * you don't want the formatter on top.
 *
 * Normally called automatically by `Mochi.serve()` (enabled by default). Pass
 * `logger: { enabled: false }` to disable, or `logger: { slowThreshold }` to
 * customise. Safe to call manually — duplicate calls are a no-op.
 */
export function consoleLogger(options: ConsoleLoggerOptions = {}): void {
  if (state.registered) {
    // A second call can't re-subscribe, so any options it carries are silently
    // dropped. Warn rather than swallow — a common trap is calling `consoleLogger()`
    // at import time, which makes `Mochi.serve({ logger: {...} })` a no-op.
    if (Object.keys(options).length > 0) {
      logger.warn('consoleLogger() was already registered; the options passed to this call are ignored.');
    }
    return;
  }
  state.registered = true;

  const slow = options.slowThreshold ?? DEFAULT_SLOW;
  const verySlow = options.verySlowThreshold ?? DEFAULT_VERY_SLOW;

  const LEVEL_BY_KIND: Record<MochiRequestKind, 'info' | 'log' | 'debug'> = {
    page: 'info',
    api: 'info',
    file: 'info',
    asset: 'debug',
    image: 'debug',
    fallback: 'debug',
    error: 'log',
  };

  // `source` is auto-built from the event name + payload — call sites only
  // describe the formatted line, never repeat the event name or rebuild source.
  // The cast widens `{name: K; payload: M[K]}` to the distributed
  // `ConsoleLoggerSource` union, which TypeScript can't infer through a
  // generic closure.
  function subscribe<K extends keyof MochiEventMap>(name: K, format: (payload: MochiEventMap[K]) => Omit<EmitInput, 'source'>): void {
    mochiEvents.on(name, (payload) => {
      emit({ ...format(payload), source: { name, payload } as ConsoleLoggerSource });
    });
  }

  subscribe('request', (payload) => ({
    label: payload.warmup ? 'WARM' : payload.method.padEnd(4),
    kind: payload.kind,
    path: payload.path,
    status: payload.status,
    duration: payload.duration,
    slow,
    verySlow,
    level: LEVEL_BY_KIND[payload.kind],
  }));

  subscribe('ws:open', (payload) => ({
    label: 'WS  ',
    path: payload.path,
    note: styleText('cyan', 'open'),
    duration: payload.duration,
    slow,
    verySlow,
  }));

  subscribe('ws:message', (payload) => ({
    label: 'WS  ',
    path: payload.path,
    note: `${styleText('cyan', 'recv')} ${prettyBytes(payload.size)} ${styleText('dim', payload.type)}`,
  }));

  subscribe('ws:close', (payload) => ({
    label: 'WS  ',
    path: payload.path,
    note: styleText('dim', `close ${payload.code}`),
    duration: payload.duration,
    neutral: true,
  }));

  subscribe('sse:open', (payload) => ({
    label: 'SSE ',
    path: payload.path,
    note: styleText('cyan', 'open'),
  }));

  subscribe('sse:message', (payload) => {
    const parts = [styleText('cyan', 'send'), prettyBytes(payload.size)];
    if (payload.event) {
      parts.push(styleText('dim', `[${payload.event}]`));
    }
    return { label: 'SSE ', path: payload.path, note: parts.join(' ') };
  });

  subscribe('sse:close', (payload) => ({
    label: 'SSE ',
    path: payload.path,
    note: styleText('dim', 'close'),
    duration: payload.duration,
    neutral: true,
  }));

  subscribe('server:start', ({ port, hostname, development, routes }) => {
    const where = `${hostname ?? 'localhost'}:${port}`;
    const mode = styleText('dim', development ? 'dev' : 'prod');
    const counts = styleText('dim', `page=${routes.page} api=${routes.api} ws=${routes.ws} sse=${routes.sse} file=${routes.file}`);
    return { label: 'BOOT', path: where, note: `${mode} ${counts}` };
  });

  subscribe('server:stop', ({ reason, signal }) => {
    const tag = signal ? `${reason} ${signal.toLowerCase()}` : reason;
    return { label: 'STOP', path: '-', note: styleText('dim', tag) };
  });

  subscribe('warmup:start', ({ routeCount }) => ({
    label: 'WARM',
    path: `${routeCount} ${routeCount === 1 ? 'route' : 'routes'}`,
    note: styleText('cyan', 'start'),
  }));

  subscribe('warmup:complete', ({ routeCount, errorCount, durationMs }) => {
    const errors = errorCount > 0 ? styleText('yellow', ` ${errorCount} failed`) : '';
    return {
      label: 'WARM',
      path: `${routeCount} ${routeCount === 1 ? 'route' : 'routes'}`,
      note: styleText('dim', `warmed${errors}`),
      duration: durationMs,
      slow,
      verySlow,
    };
  });

  subscribe('error', ({ kind, method, path, status, message }) => ({
    label: 'ERR ',
    path,
    status,
    note: `${styleText('dim', `${method} ${kind}`)} ${styleText('red', message)}`,
  }));

  // Per-read cache lookups are high-volume; route them through `logger.debug`
  // so they only surface when the user opts into `level: 'debug'`.
  subscribe('cache:read', (payload) => ({
    label: 'CACHE',
    path: payload.key,
    note: colorCacheStatus(payload.status),
    level: 'debug',
  }));
  subscribe('cache:revalidate', (payload) => ({
    label: 'CACHE',
    path: payload.key,
    note: styleText('cyan', 'revalidate'),
  }));
  subscribe('cache:inflight:deferred', (payload) => ({
    label: 'CACHE',
    path: payload.key,
    note: styleText('dim', 'deferred to peer'),
    level: 'debug',
  }));
  subscribe('cache:delete', (payload) => ({
    label: 'CACHE',
    path: payload.key,
    note: styleText('dim', 'delete'),
    level: 'debug',
  }));
  subscribe('cache:sweep', ({ removed, durationMs }) => ({
    label: 'CACHE',
    path: 'sweep',
    note: styleText('dim', removed === 0 ? 'nothing expired' : `${removed} expired removed`),
    duration: durationMs,
    slow,
    verySlow,
    level: 'info',
  }));
  subscribe('image:cache-sweep', ({ removedVariants, removedOriginals, freedBytes, durationMs }) => {
    const removed = removedVariants + removedOriginals;
    const detail = removed === 0 ? 'nothing stale' : `${removed} stale (${removedVariants}v/${removedOriginals}o), freed ${prettyBytes(freedBytes)}`;
    return { label: 'CACHE', path: 'image:sweep', note: styleText('dim', detail), duration: durationMs, slow, verySlow, level: 'info' };
  });
  // Per-file image writes/deletes are high-volume relative to the aggregate
  // `image:cache-sweep` line above; route them through `logger.debug`.
  subscribe('image:store', ({ kind, path, size, format, width, height }) => {
    const dims = width && height ? `${width}x${height} ` : '';
    return {
      label: 'IMG ',
      path,
      note: `${styleText('cyan', `store ${kind}`)} ${format ? `${format} ` : ''}${dims}${prettyBytes(size)}`.trimEnd(),
      level: 'debug',
    };
  });
  subscribe('image:delete', ({ kind, path, size, reason }) => ({
    label: 'IMG ',
    path,
    note: `${styleText('dim', `delete ${kind} ${reason}`)} freed ${prettyBytes(size)}`,
    level: 'debug',
  }));
  subscribe('cache:revalidate:failed', (payload) => ({
    label: 'CACHE',
    path: payload.key,
    note: `${styleText('red', 'revalidate failed')} ${styleText('dim', errorMessage(payload.error))}`,
    level: 'warn',
  }));
  subscribe('cache:error', (payload) => ({
    label: 'CACHE',
    path: payload.key,
    note: `${styleText('red', `storage ${payload.operation} failed`)} ${styleText('dim', errorMessage(payload.error))}`,
    level: 'warn',
  }));

  // Enqueue and per-attempt start are high-volume; route them through
  // `logger.debug` so the default stream stays quiet. `completed` carries the
  // duration (escalated to warn when slow); `failed`/`error` always warn.
  subscribe('queue:added', ({ queue, jobName, jobId }) => ({
    label: 'QUEUE',
    path: `${queue}/${jobName}`,
    note: styleText('dim', `+ ${jobId}`),
    level: 'debug',
  }));
  subscribe('queue:active', ({ queue, jobName }) => ({
    label: 'QUEUE',
    path: `${queue}/${jobName}`,
    note: styleText('cyan', 'active'),
    level: 'debug',
  }));
  subscribe('queue:completed', ({ queue, jobName, duration }) => ({
    label: 'QUEUE',
    path: `${queue}/${jobName}`,
    note: styleText('green', 'done'),
    duration,
    slow,
    verySlow,
  }));
  subscribe('queue:failed', ({ queue, jobName, attempt, error }) => ({
    label: 'QUEUE',
    path: `${queue}/${jobName}`,
    note: `${styleText('red', `failed (attempt ${attempt})`)} ${styleText('dim', error)}`,
    level: 'warn',
  }));
  subscribe('queue:error', ({ queue, error }) => ({
    label: 'QUEUE',
    path: queue,
    note: `${styleText('red', 'queue error')} ${styleText('dim', error)}`,
    level: 'warn',
  }));

  subscribe('email:sent', ({ to, subject, transport, duration }) => {
    // Four delivery classes:
    //  - log:        did not send — warn (visible in production) and colour yellow
    //                so it never reads as a delivered-mail success line.
    //  - dev:        captured into the outbox — expected in development, so
    //                info-level and pointed at the viewer, not a warning.
    //  - suppressed: the `email:message` filter vetoed the send — magenta so it's
    //                distinct from a real delivery.
    //  - else:       actually delivered (smtp/custom) — green.
    const note =
      transport === 'log'
        ? styleText('yellow', 'logged (not sent)')
        : transport === 'dev'
          ? styleText('cyan', 'captured → /_mochi/email')
          : transport === 'suppressed'
            ? styleText('magenta', 'suppressed (filtered)')
            : styleText('green', `sent via ${transport}`);
    const { recipients, subject: subj } = redactMailPii(to, subject);
    return {
      label: 'MAIL',
      path: recipients,
      note: `${note} ${styleText('dim', subj)}`,
      duration,
      slow,
      verySlow,
      ...(transport === 'log' ? { level: 'warn' as const } : {}),
    };
  });
  subscribe('email:error', ({ to, cc, bcc, subject, transport, error }) => {
    const { recipients, subject: subj, scrub } = redactMailPii(to, subject, cc, bcc);
    return {
      label: 'MAIL',
      path: recipients,
      note: `${styleText('red', `send failed (${transport})`)} ${styleText('dim', `${subj} — ${scrub(error)}`)}`,
      level: 'warn',
    };
  });

  subscribe('preprocess-cache:hit', ({ filePath }) => ({
    label: 'PCACHE',
    path: relPath(filePath),
    note: styleText('green', 'hit'),
    level: 'debug',
  }));
  subscribe('preprocess-cache:miss', ({ filePath }) => ({
    label: 'PCACHE',
    path: relPath(filePath),
    note: styleText('yellow', 'miss'),
    level: 'debug',
  }));
  subscribe('preprocess-cache:summary', ({ hits, misses, files }) => {
    const rate = files === 0 ? '0.0' : ((hits / files) * 100).toFixed(1);
    return {
      label: 'PCACHE',
      path: '-',
      note: styleText('dim', `${hits} hit / ${misses} miss across ${files} files (${rate}%)`),
      level: 'log',
    };
  });
  subscribe('compile-cache:summary', ({ hits, misses, files }) => {
    const rate = files === 0 ? '0.0' : ((hits / files) * 100).toFixed(1);
    return {
      label: 'CCACHE',
      path: '-',
      note: styleText('dim', `${hits} hit / ${misses} miss across ${files} files (${rate}%)`),
      level: 'log',
    };
  });

  if (options.compile ?? true) {
    subscribe('compile:complete', ({ path, ssrSizeBytes, hydratableCount, serverIslandCount }) => ({
      label: 'BUILD',
      path: relPath(path),
      note: styleText('dim', `hyd=${hydratableCount} srv=${serverIslandCount} ssr=${prettyBytes(ssrSizeBytes)}`),
    }));
    subscribe('compile:batch-complete', ({ count, durationMs }) => ({
      label: 'BUILD',
      path: `${count} ${count === 1 ? 'file' : 'files'}`,
      duration: durationMs,
      slow,
      verySlow,
    }));
    subscribe('client-bundle:complete', ({ entryCount, outputBytes, durationMs }) => ({
      label: 'BNDL',
      path: '-',
      note: styleText('dim', `entries=${entryCount} ${prettyBytes(outputBytes)}`),
      duration: durationMs,
      slow,
      verySlow,
    }));
    subscribe('recompile:complete', ({ trigger, path, pageCount, clientBundleCount, durationMs }) => {
      const pages = `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;
      const bundles = `${clientBundleCount} ${clientBundleCount === 1 ? 'bundle' : 'bundles'}`;
      let action: string;
      if (trigger === 'css') {
        action = 'rebundled CSS';
      } else if (trigger === 'html-shell') {
        action = 'shell changed → reloading all tabs';
      } else if (trigger === 'svelte-config') {
        action = `config reload → rebuilt ${pages}, ${bundles}`;
      } else {
        action = `rebuilt ${pages}, ${bundles}`;
      }
      return { label: 'HMR ', path: relPath(path), note: styleText('dim', action), duration: durationMs, slow, verySlow };
    });
  }
}

/**
 * Built-in `consoleLogger:line` filter that silences framework-internal noise:
 * Chrome's `/.well-known/appspecific/com.chrome.devtools.json` probe,
 * framework admin routes (`/__mochi/admin/*`), framework asset/client routes
 * (`/_mochi/*`), and the dev WebSocket live-reload endpoint (`/__mochi_live_reload`).
 */
export const silenceInternalRoutes = (line: string, { path }: MochiFilterContext['consoleLogger:line']): MochiFilterReturn['consoleLogger:line'] => {
  if (path === '/.well-known/appspecific/com.chrome.devtools.json') {
    return null;
  }
  if (path.startsWith('/__mochi/admin')) {
    return null;
  }
  if (path.startsWith('/_mochi/')) {
    return null;
  }
  if (path.startsWith('/__mochi_live_reload')) {
    return null;
  }
  return line;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const REDACTED = '<redacted>';

// Recipients and subject are PII, and `email:error` lines log at `warn` (so they
// reach production logs). `email.filterPii: true` swaps them for a placeholder in
// the MAIL line. `scrub` also strips any recipient that leaked into a transport
// error string (e.g. an SMTP "550 no such user <addr>").
function redactMailPii(to: string[], subject: string, cc: string[] = [], bcc: string[] = []): { recipients: string; subject: string; scrub: (s: string) => string } {
  if (!getEmailRuntime().options.filterPii) {
    return { recipients: to.join(', '), subject: JSON.stringify(subject), scrub: (s) => s };
  }
  const recipients = [...to, ...cc, ...bcc];
  return {
    recipients: REDACTED,
    subject: REDACTED,
    scrub: (s) => recipients.reduce((out, addr) => out.replaceAll(addr, REDACTED), s),
  };
}

function relPath(p: string): string {
  if (!p) {
    return p;
  }
  const rel = nodePath.relative(process.cwd(), p);
  return rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel) ? rel : p;
}

function colorCacheStatus(status: 'fresh' | 'stale' | 'expired' | 'miss'): string {
  switch (status) {
    case 'fresh':
      return styleText('green', status);
    case 'stale':
      return styleText('yellow', status);
    case 'expired':
      return styleText('red', status);
    case 'miss':
      return styleText('dim', status);
  }
}

interface EmitInput {
  label: string;
  /** Optional event kind, rendered with a per-kind colour after the label. */
  kind?: MochiRequestKind;
  path: string;
  /** Numeric HTTP status — gets coloured by class. */
  status?: number;
  /** Pre-formatted status/note text used when `status` is absent. */
  note?: string;
  /** Elapsed time in ms. Coloured by threshold unless `neutral` is true. */
  duration?: number;
  /** Originating event payload, forwarded to the `consoleLogger:line` filter. */
  source: ConsoleLoggerSource;
  /** If true, duration is rendered dim and does not trigger a warn-level logger. */
  neutral?: boolean;
  slow?: number;
  verySlow?: number;
  /**
   * Default log level for the line. `'debug'` keeps high-volume request lines
   * (asset/fallback) hidden unless the user opts into the most verbose level;
   * `'log'` is for moderately verbose lines. `'warn'` is for degradations that
   * always warrant attention. Always escalated to `warn` for 5xx or slow
   * responses regardless of this value.
   */
  level?: 'info' | 'log' | 'debug' | 'warn';
}

const KIND_WIDTH = 'fallback'.length;

function colorKind(kind: MochiRequestKind): string {
  switch (kind) {
    case 'page':
      return styleText('cyan', kind.padEnd(KIND_WIDTH));
    case 'api':
      return styleText('magenta', kind.padEnd(KIND_WIDTH));
    case 'file':
      return styleText('green', kind.padEnd(KIND_WIDTH));
    case 'asset':
    case 'image':
      return styleText('dim', kind.padEnd(KIND_WIDTH));
    case 'fallback':
      return styleText('yellow', kind.padEnd(KIND_WIDTH));
    case 'error':
      return styleText('red', kind.padEnd(KIND_WIDTH));
  }
}

function emit({ label, kind, path, status, note, duration, neutral = false, slow = DEFAULT_SLOW, verySlow = DEFAULT_VERY_SLOW, level = 'info', source }: EmitInput): void {
  const ts = styleText('dim', formatTimestamp(new Date()));
  const labelStr = styleText('cyan', label);
  const kindStr = kind ? ' ' + colorKind(kind) : '';
  const pathStr = styleText('dim', path);
  const statusPart = status != null ? colorStatus(status) : '';
  const notePart = note ?? '';
  const middle = [statusPart, notePart].filter(Boolean).join(' ');
  const durationStr = duration != null ? ' ' + (neutral ? styleText('dim', formatMs(duration)) : colorDuration(duration, slow, verySlow)) : '';

  const line = `${ts} ${labelStr}${kindStr} ${pathStr} ${middle}${durationStr}`;

  const isServerError = status != null && status >= 500;
  const isSlow = !neutral && duration != null && duration >= slow;

  const resolvedLevel: 'info' | 'warn' | 'log' | 'debug' = isServerError || isSlow ? 'warn' : level;

  const filtered = applyFilter('consoleLogger:line', line, { level: resolvedLevel, label, path, status, kind, source });
  if (filtered == null) {
    return;
  }

  if (resolvedLevel === 'warn') {
    logger.warn(filtered);
  } else if (resolvedLevel === 'debug') {
    logger.debug(filtered);
  } else if (resolvedLevel === 'log') {
    logger.log(filtered);
  } else {
    logger.info(filtered);
  }
}

function formatTimestamp(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function colorStatus(status: number): string {
  const s = String(status);
  if (status >= 500) {
    return styleText('red', s);
  }
  if (status >= 400) {
    return styleText('yellow', s);
  }
  if (status >= 300) {
    return styleText('cyan', s);
  }
  if (status >= 200) {
    return styleText('green', s);
  }
  return styleText('dim', s);
}

function formatMs(duration: number): string {
  return `${Math.round(duration)}ms`;
}

function colorDuration(duration: number, slow: number, verySlow: number): string {
  const ms = formatMs(duration);
  if (duration >= verySlow) {
    return styleText('red', ms);
  }
  if (duration >= slow) {
    return styleText('yellow', ms);
  }
  return styleText('green', ms);
}
