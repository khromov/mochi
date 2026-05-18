import pc from 'picocolors';
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

export const DEFAULT_LOG_LEVEL: LogLevel = 'warn';

// Pinned on globalThis so all bundled copies share one level (see requestContext.ts / events.ts).
type LogState = { level: LogLevel };
const state = pinGlobal<LogState>('__mochi_log_state__', () => ({ level: DEFAULT_LOG_LEVEL }));

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
    console.error(pc.red(PREFIX), ...args);
  },
  warn: (...args: unknown[]): void => {
    if (LEVELS[state.level] < LEVELS.warn) {
      return;
    }
    console.warn(pc.yellow(PREFIX), ...args);
  },
  info: (...args: unknown[]): void => {
    if (LEVELS[state.level] < LEVELS.info) {
      return;
    }
    console.info(pc.green(PREFIX), ...args);
  },
  log: (...args: unknown[]): void => {
    if (LEVELS[state.level] < LEVELS.log) {
      return;
    }
    console.log(pc.dim(PREFIX), ...args);
  },
  debug: (...args: unknown[]): void => {
    if (LEVELS[state.level] < LEVELS.debug) {
      return;
    }
    console.debug(pc.dim(PREFIX), ...args);
  },
};
