import { pinGlobal } from './utils/globalState';

/**
 * Milestones `Mochi.serve()` passes on its way up, recorded as they happen.
 *
 * Code that can be reached at any point in the boot sequence — `getQueue()`
 * most of all — needs to tell "you're too early" apart from "you got the name
 * wrong". Inferring that from whatever state happens to be populated (an empty
 * registry, a null config) guesses, and guesses wrong for the app that simply
 * declared nothing. Recording the milestones makes the answer a fact.
 *
 * Every milestone is a startup hook, recorded by `runHook` as it fires — there
 * is no second way to mark one, so the record can't drift from the hooks users
 * actually receive.
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

/** In milestone order, for diagnostics. */
export function reachedStartupMilestones(): MochiStartupMilestone[] {
  return [...milestones];
}

/** Called on shutdown so a fresh `serve()` in the same process starts clean. */
export function resetStartupMilestones(): void {
  milestones.clear();
}
