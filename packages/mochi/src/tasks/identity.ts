import { pinGlobal } from '../utils/globalState';

/** Pinned so duplicate bundled copies agree on who "we" are — a lease renewed under one id and checked under another deadlocks the fleet into permanent follower state. */
export function getInstanceId(): string {
  return pinGlobal<{ id: string }>('__mochi_instance_id__', () => ({ id: crypto.randomUUID() })).id;
}

export interface BuildIdentity {
  /** Human-readable build marker, for logs and the lease row. `null` when unknown. */
  buildId: string | null;
  /** When this build was produced, epoch ms. Drives one thing only: letting a newer deploy preempt an older node's lease instead of waiting out the TTL. `null` disables that comparison. */
  buildTime: number | null;
}

const seeded = pinGlobal<BuildIdentity>('__mochi_build_identity__', () => ({ buildId: null, buildTime: null }));

/** Record what the build manifest reported. Called by `Mochi.serve()`; env vars still win. */
export function setBuildIdentity(identity: Partial<BuildIdentity>): void {
  if (identity.buildId !== undefined) {
    seeded.buildId = identity.buildId;
  }
  if (identity.buildTime !== undefined) {
    seeded.buildTime = identity.buildTime;
  }
}

/**
 * Resolution order: `MOCHI_BUILD_ID` / `MOCHI_BUILD_TIME` env → build manifest → `null`. An unknown
 * build is ordinary (the dev-mode image writes no manifest) and just falls back to TTL expiry.
 * Never substitute the process start time — every restart would then look like a newer deploy and steal the lease on sight.
 */
export function getBuildIdentity(): BuildIdentity {
  const envId = process.env.MOCHI_BUILD_ID?.trim();
  const envTime = process.env.MOCHI_BUILD_TIME?.trim();
  const parsedTime = envTime ? Number(envTime) : NaN;
  return {
    buildId: envId || seeded.buildId,
    buildTime: Number.isFinite(parsedTime) ? parsedTime : seeded.buildTime,
  };
}

/** Test seam — drops the recorded manifest identity. */
export function resetBuildIdentity(): void {
  seeded.buildId = null;
  seeded.buildTime = null;
}
