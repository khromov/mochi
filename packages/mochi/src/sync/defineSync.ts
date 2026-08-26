import type { SyncQueryMap } from 'reflectdb';
import type { MochiSyncOptions } from './types';

/**
 * Identity helper for `Mochi.serve({ sync })`. Preserves full query-map and db inference at the call site — so
 * `tables`/`views` callbacks are typed against the schema — while erasing the generics to the base
 * `MochiSyncOptions` that `MochiServeOptions.sync` stores, keeping that option non-generic.
 */
export function defineSync<TQueries extends SyncQueryMap, TDb = unknown>(options: MochiSyncOptions<TQueries, TDb>): MochiSyncOptions {
  return options as unknown as MochiSyncOptions;
}
