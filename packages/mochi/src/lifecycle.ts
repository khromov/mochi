import { pinGlobal } from './utils/globalState';

/**
 * Milestones `Mochi.serve()` passes on its way up, recorded as they happen. Code reachable at any point in the boot
 * sequence — `getQueue()` above all — must tell "you're too early" apart from "you got the name wrong", and inferring
 * that from whatever state is populated guesses wrong for an app that simply declared nothing.
 *
 * Every milestone is a startup hook recorded by `runHook` as it fires, the only way one gets marked, so the record can't
 * drift from the hooks users actually receive.
 */
export type MochiStartupMilestone = 'mochi:init' | 'mochi:listening' | 'mochi:queuesMounted' | 'mochi:ready';

// Pinned like the queue registry and the event bus: duplicate bundled copies of
// the framework must agree on how far startup got.
const milestones = pinGlobal<Set<MochiStartupMilestone>>('__mochi_startup_milestones__', () => new Set());

export function markStartupMilestone(milestone: MochiStartupMilestone): void {
  milestones.add(milestone);
}

export function startupMilestoneReached(milestone: MochiStartupMilestone): boolean {
  return milestones.has(milestone);
}

/** In milestone order; no runtime caller — exists for tests and ad-hoc diagnostics. */
export function reachedStartupMilestones(): MochiStartupMilestone[] {
  return [...milestones];
}

/**
 * Clears the record, wired into the SIGTERM/SIGINT shutdown path alone. A bare `server.stop()` leaves the milestones
 * set, so a test booting a second server in-process calls this itself — survivable, since `initMochiConfig` already
 * forbids two `serve()` calls per process.
 */
export function resetStartupMilestones(): void {
  milestones.clear();
}
