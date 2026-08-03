/**
 * Concurrency gate for a queue's handler invocations, mirroring fedify's `ParallelMessageQueue` semantics: `run()`
 * resolves once the task has *started* (not finished), so the driver's listen loop can fetch the next message while up
 * to `limit` jobs are in flight, and blocks (back-pressure) once the cap is reached.
 */
export class WorkerPool {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly limit: number) {}

  async run(task: () => Promise<void>): Promise<void> {
    while (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    const job = task().finally(() => {
      this.active--;
      this.inFlight.delete(job);
      this.waiters.shift()?.();
    });
    this.inFlight.add(job);
  }

  /** Await every in-flight job; used by shutdown so stores close only after running handlers settle. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }
}
