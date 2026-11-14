/**
 * Server-side collection for `mochi:defer={{ group: 'name' }}`: every grouped call site in one render registers its
 * envelope here instead of sealing its own token, and after the render `renderIslandGroupMarkup` seals the whole group
 * into as few tokens as fit under a URL budget and emits one `<mochi-island-group>` coordinator per group.
 *
 * Sealing once over the combined payload is what keeps the URL small: component names dedupe into an index and deflate
 * runs over the repetitive devalue text before encryption, so 100 islands with `{ repo }`-sized props fit in two ~1.1kB
 * URLs where 100 separately-sealed tokens need ~12.8kB.
 */
import { stringify as devalueStringify } from 'devalue';
import { encryptPayload } from './payloadCrypto';
import { encryptProps, recordServerProps } from './serverIslandCrypto';
import { requestContext } from '../runtime/requestContext';
import { escapeHtmlAttr } from '../utils/htmlEscape';
import { logger } from '../utils/log';

/**
 * Max characters of `?g=…` URL per group request. Well under the ~8kB request-line + header budget nginx, most CDNs and
 * old browsers agree on, and under the ~2kB every browser accepts, so a group that overflows it splits into several
 * requests rather than 414-ing somewhere in the middle of a deploy.
 */
export const DEFAULT_GROUP_URL_BUDGET = 1800;

/** One collected member: which island to render, its sealed-envelope props, and the wrapper id the response keys on. */
export interface IslandGroupEntry {
  islandKey: string;
  propsJson: string;
  iid: string;
}

export interface IslandGroupState {
  /** Render-scoped DOM id linking the coordinator element to its member wrappers; the first member's `iid`. */
  groupId: string;
  name: string;
  entries: IslandGroupEntry[];
  /** Merged `mochi:defer` options across the group in render order, minus `group` itself. */
  options: Record<string, unknown>;
  /** A group is lazy only while every member so far is `mochi:defer:visible`. */
  lazy: boolean;
}

/** What one `mochi:defer` call site stamps on its wrapper: group ids when it joined a group, its own sealed token otherwise. */
export interface GroupedIslandAttrs {
  token?: string;
  groupId?: string;
  member?: string;
  /** The wrapper's `server-options` JSON. A grouped member keeps only `name`; the rest moved to the coordinator. */
  options?: string;
}

/** The directive options a group owns rather than its members: the fetch is the group's, so the fetch policy is too. */
const GROUP_OWNED_OPTIONS = ['retries', 'rootMargin'] as const;

const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (!warned.has(key)) {
    warned.add(key);
    logger.warn(message);
  }
}

/** Same contract as `isReloadableIslandName`: anything but a non-empty string falls back to an ungrouped defer. */
export function isValidGroupName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0;
}

/**
 * Register one `mochi:defer` call site into its group, returning the wrapper attributes for it. Returns `null` when the
 * island is not grouped or no collector is armed (email/static renders), so the caller seals its own token as before.
 */
export function collectGroupedIsland(options: unknown, islandKey: string, propsJson: string, iid: string, visible: boolean): GroupedIslandAttrs | null {
  if (typeof options !== 'object' || options === null) {
    return null;
  }
  const opts = options as { group?: unknown; name?: unknown } & Record<string, unknown>;
  const group = opts.group;
  if (group === undefined) {
    return null;
  }
  if (!isValidGroupName(group)) {
    warnOnce(`group:${String(group)}`, `[mochi] mochi:defer group must be a non-empty string; ignoring ${JSON.stringify(group)} — the island will load on its own request.`);
    return null;
  }

  const groups = requestContext.getStore()?.islandGroups;
  if (!groups) {
    return null;
  }

  let state = groups.get(group);
  if (!state) {
    state = { groupId: `g${iid}`, name: group, entries: [], options: {}, lazy: visible };
    groups.set(group, state);
  }
  state.lazy &&= visible;
  // Last writer wins: a group's members normally come from one loop and carry identical options.
  for (const key of GROUP_OWNED_OPTIONS) {
    if (opts[key] !== undefined) {
      state.options[key] = opts[key];
    }
  }
  state.entries.push({ islandKey, propsJson, iid });
  // A grouped island has no `signed-props` token for the debug bar to key on, so its snapshot keys on the wrapper id.
  recordServerProps(iid, propsJson);

  return {
    groupId: state.groupId,
    member: iid,
    // Only `name` stays on the member, to register it for `reloadDeferredIsland`; the fetch policy moved to the group.
    ...(opts.name !== undefined ? { options: JSON.stringify({ name: opts.name }) } : {}),
  };
}

/**
 * The wrapper attributes for one `mochi:defer` call site carrying a directive-options object: the group id and member id
 * when the island joined a group, its own sealed token otherwise. Emitted by the preprocessor as `__mochi_island_attrs__`.
 */
export function serverIslandAttrs(options: unknown, islandKey: string, propsJson: string, iid: string, visible: boolean): GroupedIslandAttrs {
  const grouped = collectGroupedIsland(options, islandKey, propsJson, iid, visible);
  if (grouped) {
    return grouped;
  }
  return { token: encryptProps(propsJson, islandKey), options: JSON.stringify(options) };
}

/**
 * Seal `entries` into the fewest tokens whose `?g=` URLs each stay under `budget`, bisecting because deflate makes a
 * chunk's sealed length unpredictable until it is actually sealed. A single entry that overflows on its own is emitted
 * anyway — splitting further is impossible, and an over-long URL still beats dropping the island.
 */
export function sealGroupChunks(name: string, entries: IslandGroupEntry[], urlOverhead: number, budget = DEFAULT_GROUP_URL_BUDGET): string[] {
  if (entries.length === 0) {
    return [];
  }
  // Names are indexed per chunk, not once for the whole group, so a split never carries keys none of its members use.
  const seal = (chunk: IslandGroupEntry[]): string => {
    const names: string[] = [];
    const nameIndex = new Map<string, number>();
    const rows = chunk.map((entry) => {
      let i = nameIndex.get(entry.islandKey);
      if (i === undefined) {
        i = names.push(entry.islandKey) - 1;
        nameIndex.set(entry.islandKey, i);
      }
      return [i, entry.iid, entry.propsJson];
    });
    return encryptPayload(devalueStringify({ n: names, e: rows }), { aad: groupAad(name) });
  };

  const out: string[] = [];
  const pack = (chunk: IslandGroupEntry[]): void => {
    const token = seal(chunk);
    if (chunk.length === 1 || urlOverhead + token.length <= budget) {
      out.push(token);
      return;
    }
    const mid = Math.ceil(chunk.length / 2);
    pack(chunk.slice(0, mid));
    pack(chunk.slice(mid));
  };
  pack(entries);
  return out;
}

/** Binds a group token to its endpoint path, the way a single island's token binds to its component name. */
export function groupAad(name: string): string {
  return `mochi-island-group:${name}`;
}

/** The decrypted group payload: `n` is the component-name table, `e` is `[nameIndex, iid, propsJson]` per member. */
export interface IslandGroupPayload {
  n: string[];
  e: [number, string, string][];
}

export function parseGroupPayload(value: unknown): IslandGroupPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { n, e } = value as { n?: unknown; e?: unknown };
  if (!Array.isArray(n) || !Array.isArray(e) || !n.every((x) => typeof x === 'string')) {
    return null;
  }
  const rows: [number, string, string][] = [];
  for (const row of e) {
    if (!Array.isArray(row) || row.length !== 3) {
      return null;
    }
    const [index, iid, propsJson] = row as [unknown, unknown, unknown];
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= n.length || typeof iid !== 'string' || typeof propsJson !== 'string') {
      return null;
    }
    rows.push([index, iid, propsJson]);
  }
  return { n: n as string[], e: rows };
}

/**
 * The `<mochi-island-group>` coordinators for one finished render, appended after the body so each one upgrades only
 * once every wrapper it drives has been parsed — which is what lets the client fire a single fetch for the whole group.
 */
export function renderIslandGroupMarkup(groups: Map<string, IslandGroupState>, assetPrefix: string, budget = DEFAULT_GROUP_URL_BUDGET): string {
  let markup = '';
  for (const state of groups.values()) {
    const path = `${assetPrefix}/island-group/${encodeURIComponent(state.name)}?g=`;
    const chunks = sealGroupChunks(state.name, state.entries, path.length, budget);
    if (chunks.length === 0) {
      continue;
    }
    const options = Object.keys(state.options).length > 0 ? ` server-options="${escapeHtmlAttr(JSON.stringify(state.options))}"` : '';
    const lazy = state.lazy ? ' defer-on="visible"' : '';
    markup +=
      `<mochi-island-group group="${escapeHtmlAttr(state.name)}" group-id="${escapeHtmlAttr(state.groupId)}"` +
      ` chunks="${escapeHtmlAttr(chunks.join(' '))}" data-asset-prefix="${escapeHtmlAttr(assetPrefix)}"${options}${lazy}></mochi-island-group>`;
  }
  return markup;
}
