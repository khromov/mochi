/**
 * Leader election for cluster-scoped tasks, holding one invariant: eventually exactly one node runs
 * them, from any starting state, with no operator action.
 *
 * The atomic claim in `lease.ts` picks the winner and the heartbeat is what self-corrects — a leader
 * that fails to renew stands down, so any split brain collapses within one heartbeat interval. Startup
 * jitter only narrows the race and must never be mistaken for the correctness mechanism.
 */
import { mochiEvents } from '../events';
import { logger } from '../utils/log';
import { getBuildIdentity, getInstanceId } from './identity';
import { MemoryLeaseStore, SqlLeaseStore, type TaskLeaseStore } from './lease';
import { drainTasks, hasClusterTasks, setTaskGate, startTasks, stopAllTasks, stopClusterTasks } from './tasks';

export interface MochiSchedulerLeaseOptions {
  /**
   * Where the lease lives. `sqlite://…` (or a path ending in `.db`/`.sqlite`) or `postgres://…`.
   * Defaults to `MOCHI_SCHEDULER_URL`, then a SQLite file under the app's `outDir`.
   * Every node must reach the SAME store — a per-container path elects each container its own leader, which is no election at all.
   */
  url?: string;
  /** Table name. Default `mochi_lease`. */
  table?: string;
  /** Lease row key, so several apps can share one database. Default `mochi:tasks:leader`. */
  name?: string;
}

export interface MochiSchedulerOptions {
  /**
   * Elect a single leader across processes. Default: `true` in production, `false` in development.
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
 * `configured` tells the caller whether the location was chosen or fallen back to. The fallback is the
 * one setting that can be wrong *silently*: a container-local file means every replica elects itself
 * and the nightly job just runs N times, with nothing looking broken — hence the caller's warning.
 */
function resolveStore(options: MochiSchedulerOptions, defaultUrl: string): { store: TaskLeaseStore; configured: boolean } {
  const chosen = options.lease?.url ?? process.env.MOCHI_SCHEDULER_URL;
  return {
    store: new SqlLeaseStore({ url: chosen ?? defaultUrl, table: options.lease?.table, name: options.lease?.name }),
    configured: chosen !== undefined,
  };
}

/** Shared with queue recovery so both answer the question the same way — no app that elects a task leader but still recovers queues N times. */
export function resolveClusterCoordination(options: MochiSchedulerOptions, development: boolean): boolean {
  return options.leader ?? !development;
}

export function startScheduler(options: MochiSchedulerOptions, development: boolean, defaultLeaseUrl: string): SchedulerRuntime {
  // Gated on `hasClusterTasks()` because opening a lease store for nothing costs
  // real money — see `hasRecoverableQueues` in queue.ts. Deliberately not folded
  // into `resolveClusterCoordination`, which queue recovery shares and which must
  // not change with the task registry's contents.
  const coordinate = resolveClusterCoordination(options, development);
  const leaderEnabled = coordinate && hasClusterTasks();
  const drainTimeout = options.drainTimeout ?? DEFAULT_DRAIN_TIMEOUT;

  if (!leaderEnabled) {
    if (coordinate) {
      logger.debug('[task] no cluster-scoped tasks registered — running every task on this node, no lease store opened.');
    }
    // Same start path as the elected case, so there's no second untested branch.
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
    logger.warn(
      `[task] no scheduler lease location configured — falling back to ${defaultLeaseUrl}. That file is local to this container, so every replica will elect itself and run cluster tasks. ` +
        `Set MOCHI_SCHEDULER_URL (or scheduler.lease.url) to storage every replica shares, or set scheduler.leader: false if this app only ever runs one instance.`,
    );
  }

  let leader = false;
  let lastGoodHeartbeat = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Being the leader is not enough — the lease must still be within its TTL by our
  // own clock, which stops a frozen-then-resumed process acting on a lapsed one.
  setTaskGate(() => leader && Date.now() - lastGoodHeartbeat < leaseTtl);

  // Node-scoped tasks are unconditional — they never touch the lease.
  startTasks(false);

  // Safe to unref, unlike the cron timers in `tasks.ts`: the scheduler only runs
  // alongside a listening `Bun.serve()`, so these always fire anyway.
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
        standDown('preempted by another node');
      }
    } catch (err) {
      // A transient store error is not proof we lost the lease. If it isn't
      // transient, `lastGoodHeartbeat` ages past the TTL gate on its own.
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
    // Tied to the TTL so a dead leader is replaced within roughly one, and jittered so followers don't sync up.
    schedule(Math.floor(leaseTtl / 2) + Math.floor(Math.random() * heartbeatInterval), elect);
  };

  // Jitter only the FIRST attempt — it exists to spread a simultaneous fleet boot, and delaying later retries would just slow failover.
  schedule(startupJitter > 0 ? Math.floor(Math.random() * startupJitter) : 0, elect);

  return {
    isLeader: () => leader,
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      stopAllTasks();
      await drainTasks(drainTimeout);
      // Release so a peer takes over now rather than idling a whole TTL. Best-effort: if it fails, the TTL still covers us.
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
