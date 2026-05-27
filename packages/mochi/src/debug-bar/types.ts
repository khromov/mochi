import type { DebugBarRuntimeData } from '../requestContext';
import type { LogLevel } from '../log';

declare global {
  interface Window {
    __mochi_warn?: (msg: string) => void;
    __mochi_warnings?: string[];
    __mochi_debug?: DebugBarRuntimeData;
    __mochi_asset_prefix?: string;
    __mochi_log_level?: LogLevel;
  }
}

export interface IslandInfo {
  id: string;
  name: string;
  type: 'hydrated' | 'server';
  mode: string;
  propsSize: number;
  rawProps: string | null;
  /** If set, props were deduplicated server-side into a shared <script> block. */
  propsRef: string | null;
  serverOptions: string | null;
}
