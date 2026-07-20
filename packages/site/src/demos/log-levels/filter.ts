import type { ConsoleLoggerLevel, ConsoleLoggerLine } from 'mochi-framework';

const LOUD = '/demos/log-levels/loud';
const QUIET = '/demos/log-levels/quiet';

// The site redirects to a trailing slash, so each endpoint shows up twice — once
// as the 301, once as the real response. Normalising catches both, which is the
// point: a level remap should hold for every line a path produces.
const withoutSlash = (path: string) => (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);

/**
 * Registered as the `consoleLogger:level` filter in the site's `Mochi.serve()`
 * call — see `src/index.ts`. Everything outside this demo keeps the level the
 * framework picked for it.
 */
export function logLevelsFilter(level: ConsoleLoggerLevel, { path }: ConsoleLoggerLine): ConsoleLoggerLevel {
  switch (withoutSlash(path)) {
    case LOUD:
      return 'warn';
    case QUIET:
      return 'debug';
    default:
      return level;
  }
}
