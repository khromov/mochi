import type { RssSample } from './sampler';

export type Regression = {
  slopeKbPerSec: number;
  slopeMbPerMin: number;
  intercept: number;
  r2: number;
  n: number;
};

export function leastSquares(samples: RssSample[]): Regression {
  const n = samples.length;
  const first = samples[0];
  if (n < 2 || !first) {
    return { slopeKbPerSec: 0, slopeMbPerMin: 0, intercept: 0, r2: 0, n };
  }
  const t0 = first.t;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const s of samples) {
    const x = (s.t - t0) / 1000; // seconds
    const y = s.rssKb;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  const slopeKbPerSec = denom === 0 ? 0 : (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slopeKbPerSec * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (const s of samples) {
    const x = (s.t - t0) / 1000;
    const yPred = slopeKbPerSec * x + intercept;
    ssRes += (s.rssKb - yPred) ** 2;
    ssTot += (s.rssKb - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return {
    slopeKbPerSec,
    slopeMbPerMin: (slopeKbPerSec * 60) / 1024,
    intercept,
    r2,
    n,
  };
}

export type Verdict = 'pass' | 'warn' | 'fail';

export type VerdictDetail = {
  verdict: Verdict;
  reasons: string[];
  slopeMbPerMin: number;
  r2: number;
  deltaMb: number;
  hadGcDip: boolean;
  errorRate: number;
  latencyCreepPct: number;
};

// Below this r², a linear fit explains so little of the RSS variance that the
// slope is statistical scatter, not a trend. Acting on a noisy slope produces
// false-positive FAILs (e.g. slope=2.88 MB/min, r²=0.10 alongside a *decrease*
// in baseline-vs-final RSS and improved latency).
const SLOPE_R2_FLOOR = 0.5;

export type VerdictInput = {
  workloadSamples: RssSample[]; // RSS samples during workload, post-warmup-tail trim
  baselineRssKb: number;
  finalRssKb: number;
  errorRate: number;
  latencyCreepPct: number; // (last-window p95 / first-window p95 - 1) * 100
};

export function judge(input: VerdictInput): VerdictDetail {
  const reg = leastSquares(input.workloadSamples);
  const slopeMbPerMin = reg.slopeMbPerMin;
  const r2 = reg.r2;
  const deltaMb = (input.finalRssKb - input.baselineRssKb) / 1024;

  let hadGcDip = false;
  for (let i = 1; i < input.workloadSamples.length; i++) {
    const cur = input.workloadSamples[i];
    const prev = input.workloadSamples[i - 1];
    if (cur && prev && cur.rssKb < prev.rssKb) {
      hadGcDip = true;
      break;
    }
  }

  const reasons: string[] = [];
  const severity: Record<Verdict, number> = { pass: 0, warn: 1, fail: 2 };
  let verdict: Verdict = 'pass';
  const escalate = (v: Verdict) => {
    if (severity[v] > severity[verdict]) {
      verdict = v;
    }
  };

  if (r2 < SLOPE_R2_FLOOR) {
    // Slope exists but the linear fit doesn't explain the data — note it as
    // informational and don't use it to escalate the verdict.
    if (Math.abs(slopeMbPerMin) > 0.3) {
      reasons.push(`slope ${slopeMbPerMin.toFixed(2)} MB/min ignored (r²=${r2.toFixed(2)} < ${SLOPE_R2_FLOOR}, fit too noisy to act on)`);
    }
  } else if (slopeMbPerMin > 1.0) {
    escalate('fail');
    reasons.push(`slope ${slopeMbPerMin.toFixed(2)} MB/min > 1.0 (r²=${r2.toFixed(2)})`);
  } else if (slopeMbPerMin > 0.3) {
    escalate('warn');
    reasons.push(`slope ${slopeMbPerMin.toFixed(2)} MB/min in 0.3–1.0 warn band (r²=${r2.toFixed(2)})`);
  }

  if (deltaMb > 40) {
    escalate('fail');
    reasons.push(`final-baseline delta ${deltaMb.toFixed(1)} MB > 40`);
  } else if (deltaMb > 15) {
    escalate('warn');
    reasons.push(`final-baseline delta ${deltaMb.toFixed(1)} MB in 15–40 warn band`);
  }

  if (input.workloadSamples.length >= 5 && !hadGcDip) {
    escalate('fail');
    reasons.push('strictly monotonic RSS growth — no GC dip observed during workload');
  }

  if (input.errorRate > 0.005) {
    escalate('fail');
    reasons.push(`error rate ${(input.errorRate * 100).toFixed(2)}% > 0.5%`);
  }

  if (input.latencyCreepPct > 50) {
    escalate('fail');
    reasons.push(`p95 latency creep ${input.latencyCreepPct.toFixed(0)}% > 50%`);
  }

  if (verdict === 'pass' && reasons.length === 0) {
    reasons.push(`slope ${slopeMbPerMin.toFixed(2)} MB/min, delta ${deltaMb.toFixed(1)} MB, GC dips observed`);
  }

  return {
    verdict,
    reasons,
    slopeMbPerMin,
    r2,
    deltaMb,
    hadGcDip,
    errorRate: input.errorRate,
    latencyCreepPct: input.latencyCreepPct,
  };
}
