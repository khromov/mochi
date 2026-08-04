export interface Backoff {
  type: 'fixed' | 'exponential';
  /** Base delay in ms; exponential doubles it per attempt: `delay * 2^(attempt - 1)`. */
  delay: number;
}

export function backoffDelay(backoff: Backoff | undefined, attempt: number): number {
  if (!backoff || backoff.delay <= 0) {
    return 0;
  }
  if (backoff.type === 'fixed') {
    return backoff.delay;
  }
  return backoff.delay * 2 ** (Math.max(attempt, 1) - 1);
}
