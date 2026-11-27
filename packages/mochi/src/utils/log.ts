import { pinGlobal } from './globalState';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'log' | 'debug';

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  log: 4,
  debug: 5,
};

const PREFIX = '[mochi]';

// Inline ANSI escapes — log.ts is isomorphic (bundled for both server and
// client), so it cannot import node:util whose browser polyfill lacks styleText.
const red = (s: string) => `\x1b[31m${s}\x1b[39m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;

export const DEFAULT_LOG_LEVEL: LogLevel = 'warn';

// Pinned on globalThis so all bundled copies share one level (see requestContext.ts / events.ts).
type LogState = { level: LogLevel };
const state = pinGlobal<LogState>('__mochi_log_state__', () => ({ level: DEFAULT_LOG_LEVEL }));

const CONTROL_CHARS = /\p{Cc}/gu;
const NAMED_ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

// Error messages can echo URL-decoded request input, where a raw CR/LF or ESC would forge log lines or inject terminal escapes.
export function escapeControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, (c) => NAMED_ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function setLogLevel(level: LogLevel): void {
  state.level = level;
}

export function getLogLevel(): LogLevel {
  return state.level;
}

export const logger = {
  error: (...args: unknown[]): void => {
    if (LEVELS[state.level] < LEVELS.error) {
      return;
    }
    console.error(red(PREFIX), ...args);
  },
  warn: (...args: unknown[]): void => {
    if (LEVELS[state.level] < LEVELS.warn) {
      return;
    }
    console.warn(yellow(PREFIX), ...args);
  },
  info: (...args: unknown[]): void => {
    if (LEVELS[state.level] < LEVELS.info) {
      return;
    }
    console.info(green(PREFIX), ...args);
  },
  log: (...args: unknown[]): void => {
    if (LEVELS[state.level] < LEVELS.log) {
      return;
    }
    console.log(dim(PREFIX), ...args);
  },
  debug: (...args: unknown[]): void => {
    if (LEVELS[state.level] < LEVELS.debug) {
      return;
    }
    console.debug(dim(PREFIX), ...args);
  },
};
