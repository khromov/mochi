import type { DebugBarRuntimeData } from '../requestContext';
import type { LogLevel } from '../log';

declare global {
  interface Window {
    __mochi_warn?: (msg: string) => void;
    __mochi_warnings?: string[];
    __mochi_debug?: DebugBarRuntimeData;
    __mochi_asset_prefix?: string;
    __mochi_reload_ws?: WebSocket;
    __mochi_log_level?: LogLevel;
    __mochi_page_entry?: string;
  }
}

export interface IslandInfo {
  /** The wrapper element itself — the stable identity for keying and locating. */
  el: HTMLElement;
  name: string;
  type: 'hydrated' | 'server';
  mode: string;
  propsSize: number;
  /** Hydratable islands: devalue JSON from the inline `props` attr or shared block. */
  rawProps: string | null;
  /** Server islands: the HMAC-signed props token, decoded client-side on demand. */
  signedProps: string | null;
  /** If set, props were deduplicated server-side into a shared <script> block. */
  propsRef: string | null;
  serverOptions: string | null;
}
