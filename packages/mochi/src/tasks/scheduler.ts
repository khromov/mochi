/**
 * Drives leader election for cluster-scoped tasks and keeps it converging.
 *
 * The invariant this exists to hold: **eventually exactly one node runs the
 * cluster tasks**, with no operator action, from any starting state — a cold
 * fleet booting together, a leader that died, a rolling deploy, a node that was
 * frozen long enough to lose its lease without noticing.
 *
 * Three mechanisms, in increasing order of importance:
 *
 *   1. Startup jitter, so N nodes booting at once don't all hit the store on the
 *      same millisecond. This narrows the race; it does NOT decide it, and must
 *      never be mistaken for the correctness mechanism.
 *   2. The atomic claim in `lease.ts`, which is what actually picks the winner.
 *   3. The heartbeat, which is what makes the whole thing self-correcting: a
 *      leader that fails to renew has been preempted and stands itself down
 *      immediately. Any split brain therefore collapses within one heartbeat
 *      interval, whatever caused it.
 *
 * Nothing here blocks `Mochi.serve()` from resolving. Election runs on detached,
 * unref'd timers, so a slow or unreachable lease store delays the tasks and
 * nothing else.
 */
import { mochiEvents } from '../events';
import { logger } from '../utils/log';
import { getBuildIdentity, getInstanceId } from './identity';
import { MemoryLeaseStore, SqlLeaseStore, type TaskLeaseStore } from './lease';
import { drainTasks, hasClusterTasks, setTaskGate, startTasks, stopAllTasks, stopClusterTasks } from './tasks';

export interface MochiSchedulerLeaseOptions {
  /**
   * Where the lease lives. `sqlite://…` (or a path ending in `.db`/`.sqlite`) or
   * `postgres://…`. Defaults to `MOCHI_SCHEDULER_URL`, then a SQLite file under
   * the app's `outDir`.
   *
   * For this to elect anything, every node must reach the SAME store — a SQLite
   * file on a volume shared by all replicas, or a Postgres database. A per-container
   * path elects each container its own leader, which is no election at all.
   */
  url?: string;
  /** Table name. Default `mochi_lease`. */
  table?: string;
  /** Lease row key, so several apps can share one database. Default `mochi:tasks:leader`. */
  name?: string;
}

export interface MochiSchedulerOptions {
  /**
   * Elect a single leader across processes. Default: `true` in production,
   * `false` in development (one process, and a dev restart shouldn't wait out a TTL).
   * With `false` every node runs every task — correct only when there is one node.
   */
  leader?: boolean;
  lease?: MochiSchedulerLeaseOptions;
  /** Supply a lease store directly, bypassing `lease.url`. Mainly for tests and custom backends. */
  store?: TaskLeaseStore;
  /** How long a lease survives without a heartbeat, ms. Default `60_000`. */
  leaseTtl?: number;
  /** Heartbeat period, ms. Default `leaseTtl / 3`. Must be comfortably below `leaseTtl`. */
  heartbeatInterval?: number;
  /** Upper bound of the random pre-election delay, ms. Default `30_000`; `0` disables it. */
  startupJitter?: number;
  /** How long shutdown waits for in-flight runs, ms. Default `5_000`. */
  drainTimeout?: number;
}

export interface SchedulerRuntime {
  /** Whether this node runs cluster-scoped tasks — by holding the lease, or because there is no election. */
  isLeader(): boolean;
  stop(): Promise<void>;
}

const DEFAULT_LEASE_TTL = 60_000;
const DEFAULT_STARTUP_JITTER = 30_000;
const DEFAULT_DRAIN_TIMEOUT = 5_000;

/**
 * Resolve where the lease lives, and say whether that was an actual decision or
 * just the fallback.
 *
 * The distinction matters because the fallback is the one configuration that can
 * be wrong *silently*. A SQLite file under `outDir` is container-local, so three
 * replicas each elect themselves, each runs the schedule, and nothing looks
 * broken — the nightly job simply runs three times. Every other misconfiguration
 * announces itself; this one doesn't, so the caller warns about it.
 */
function resolveStore(options: MochiSchedulerOptions, defaultUrl: string): { store: TaskLeaseStore; configured: boolean } {
  const chosen = options.lease?.url ?? process.env.MOCHI_SCHEDULER_URL;
  return {
    store: new SqlLeaseStore({ url: chosen ?? defaultUrl, table: options.lease?.table, name: options.lease?.name }),
    configured: chosen !== undefined,
  };
}

/**
 * Start the scheduler. `defaultLeaseUrl` is the app-derived fallback location for
 * the SQLite lease file, used only when nothing more specific was configured.
 */
/**
 * Whether this app coordinates across processes at all. Shared with queue
 * recovery so both answer the question the same way — one switch, one mental
 * model, no app that elects a task leader but still recovers queues N times.
 */
export function resolveClusterCoordination(options: MochiSchedulerOptions, development: boolean): boolean {
  return options.leader ?? !development;
}

export function startScheduler(options: MochiSchedulerOptions, development: boolean, defaultLeaseUrl: string): SchedulerRuntime {
  // Election exists to pick one node for `cluster` tasks. With none registered
  // there is nothing to elect, and the cost of pretending otherwise is not zero:
  // `SqlLeaseStore` opens its SQLite file in its constructor, so a read-only
  // filesystem would turn "no tasks to coordinate" into a boot crash. Mochi
  // registers its own `node`-scoped image-cache sweep, which makes an app with
  // tasks but no cluster-scoped ones the common case rather than a curiosity.
  // Deliberately not folded into `resolveClusterCoordination` — queue recovery
  // shares that answer and must not change with the task registry's contents.
  const coordinate = resolveClusterCoordination(options, development);
  const leaderEnabled = coordinate && hasClusterTasks();
  const drainTimeout = options.drainTimeout ?? DEFAULT_DRAIN_TIMEOUT;

  if (!leaderEnabled) {
    if (coordinate) {
      logger.debug('[task] no cluster-scoped tasks registered — running every task on this node, no lease store opened.');
    }
    // Single-node mode: every task runs here, and the gate is a constant. Uses the
    // same start path as the elected case so there's no second untested branch.
    setTaskGate(() => true);
    startTasks(true);
    return {
      isLeader: () => true,
      stop: async () => {
        stopAllTasks();
        await drainTasks(drainTimeout);
      },
    };
  }

  const leaseTtl = options.leaseTtl ?? DEFAULT_LEASE_TTL;
  const heartbeatInterval = options.heartbeatInterval ?? Math.max(1_000, Math.floor(leaseTtl / 3));
  const startupJitter = options.startupJitter ?? DEFAULT_STARTUP_JITTER;
  const owner = getInstanceId();
  const resolved = options.store === undefined ? resolveStore(options, defaultLeaseUrl) : { store: options.store, configured: true };
  const store = resolved.store;
  const ownsStore = options.store === undefined;

  if (!resolved.configured) {
    // Fires once at boot, and only when election is on and nobody chose where the
    // lease lives. Single-instance apps see one line they can silence with
    // `leader: false`; a fleet running on the default sees the one warning that
    // tells them their nightly job is quietly running N times.
    logger.warn(
      `[task] no scheduler lease location configured — falling back to ${defaultLeaseUrl}. That file is local to this container, so every replica will elect itself and run cluster tasks. ` +
        `Set MOCHI_SCHEDULER_URL (or scheduler.lease.url) to storage every replica shares, or set scheduler.leader: false if this app only ever runs one instance.`,
    );
  }

  let leader = false;
  let lastGoodHeartbeat = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // The gate every cluster task consults immediately before firing. Being the
  // leader is not enough: the lease must also still be within its TTL by our own
  // clock, which is what stops a frozen-then-resumed process from acting on a
  // lease that expired while it was away.
  setTaskGate(() => leader && Date.now() - lastGoodHeartbeat < leaseTtl);

  // Node-scoped tasks are unconditional — they never touch the lease.
  startTasks(false);

  // Safe to unref here, unlike the cron timers in `tasks.ts`. The scheduler only
  // ever runs alongside a listening `Bun.serve()`, which keeps the loop alive, so
  // these always fire; unref'ing just means a stalled election can never be the
  // thing pinning a shutting-down process open. A cron timer has no such
  // guarantee — see the comment on `new Cron` for what unref'ing one costs.
  const schedule = (delay: number, fn: () => void) => {
    timer = setTimeout(fn, delay);
    timer.unref?.();
  };

  const standDown = (reason: string) => {
    if (leader) {
      leader = false;
      stopClusterTasks();
      logger.warn(`[task] lost the scheduler lease (${reason}) — stopped cluster tasks on this node.`);
      mochiEvents.emit('task:leader', { acquired: false, owner, holder: null });
    }
  };

  const beat = async () => {
    if (stopped) {
      return;
    }
    try {
      const renewed = await store.renew(owner, Date.now());
      if (renewed) {
        lastGoodHeartbeat = Date.now();
      } else {
        // Someone else owns the row now — a newer build, or we were gone long
        // enough to expire. Either way this node is no longer the leader.
        standDown('preempted by another node');
      }
    } catch (err) {
      // A transient store error is not proof we lost the lease, so don't stand
      // down on it. The TTL gate handles the case where it isn't transient: keep
      // failing to renew and `lastGoodHeartbeat` ages out on its own.
      logger.warn(`[task] lease heartbeat failed — ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!stopped) {
      schedule(leader ? heartbeatInterval : Math.floor(leaseTtl / 2), leader ? beat : elect);
    }
  };

  const elect = async () => {
    if (stopped) {
      return;
    }
    try {
      const { acquired, holder } = await store.tryAcquire({ owner, ...getBuildIdentity(), now: Date.now(), ttl: leaseTtl });
      if (acquired) {
        leader = true;
        lastGoodHeartbeat = Date.now();
        startTasks(true);
        logger.info(`[task] acquired the scheduler lease — running cluster tasks on this node.`);
        mochiEvents.emit('task:leader', { acquired: true, owner, holder: owner });
        schedule(heartbeatInterval, beat);
        return;
      }
      logger.info(`[task] another node holds the scheduler lease${holder ? ` (${holder.owner})` : ''} — cluster tasks stay idle here.`);
      mochiEvents.emit('task:leader', { acquired: false, owner, holder: holder?.owner ?? null });
    } catch (err) {
      logger.warn(`[task] could not reach the lease store — retrying. ${err instanceof Error ? err.message : String(err)}`);
    }
    // Re-contest on a cadence tied to the TTL, so a dead leader is replaced within
    // roughly one TTL rather than never. Jittered so followers don't sync up.
    schedule(Math.floor(leaseTtl / 2) + Math.floor(Math.random() * heartbeatInterval), elect);
  };

  // Jitter only the FIRST attempt. It exists to spread a simultaneous fleet boot,
  // and delaying every later retry by up to 30s would just slow failover down.
  schedule(startupJitter > 0 ? Math.floor(Math.random() * startupJitter) : 0, elect);

  return {
    isLeader: () => leader,
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      stopAllTasks();
      await drainTasks(drainTimeout);
      // Release before closing so a peer picks the work up immediately instead of
      // idling for a whole TTL. Best-effort: if it fails, the TTL still covers us.
      if (leader) {
        try {
          await store.release(owner);
        } catch (err) {
          logger.warn(`[task] could not release the scheduler lease — it will expire in ${leaseTtl}ms. ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      leader = false;
      if (ownsStore) {
        try {
          await store.close();
        } catch {
          // Shutting down anyway.
        }
      }
    },
  };
}

export { MemoryLeaseStore, SqlLeaseStore };
export type { TaskLeaseStore };
