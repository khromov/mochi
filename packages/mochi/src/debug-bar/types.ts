import type { DebugBarRuntimeData } from '../runtime/requestContext';
import type { LogLevel } from '../utils/log';

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
  element: HTMLElement;
  /** Raw `component-name` (`<localName>_<hash>`) — used for element matching, not display. */
  name: string;
  /** The bare local component name, recovered from `name` for a human-readable label. */
  displayName: string;
  type: 'hydrated' | 'server';
  mode: string;
  propsSize: number;
  /** Hydratable islands: devalue JSON from the inline `props` attr or shared block. */
  rawProps: string | null;
  /** Server islands: the HMAC-signed props token, decoded client-side on demand. */
  signedProps: string | null;
  /** If set, props live in a <script type="application/json" id="<propsRef>"> block. */
  propsRef: string | null;
  /** True when that block is reused by >=2 islands (server-stamped `data-shared`). */
  shared: boolean;
  serverOptions: string | null;
}
