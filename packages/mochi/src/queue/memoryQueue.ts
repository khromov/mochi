import type { MessageQueue, MessageQueueDepth, MessageQueueEnqueueOptions, MessageQueueListenOptions } from '@fedify/fedify';

// `delay` is typed as Temporal.Duration but duck-typed here (like the fedify drivers do), so any polyfill copy works.
function delayToMs(delay: MessageQueueEnqueueOptions['delay']): number {
  if (!delay) {
    return 0;
  }
  if (typeof (delay as { total?: unknown }).total === 'function') {
    return (delay as { total: (opts: { unit: string }) => number }).total({ unit: 'milliseconds' });
  }
  return Number((delay as { milliseconds?: number }).milliseconds ?? 0);
}

/**
 * The default queue backend: a fedify-compatible in-process `MessageQueue` with no persistence. Kept in-house rather
 * than using fedify's `InProcessMessageQueue` because importing that from `@fedify/fedify` drags the entire ActivityPub
 * runtime into the process; the drivers' `@fedify/fedify` peer stays type-only this way.
 */
export class MemoryMessageQueue implements MessageQueue {
  readonly nativeRetrial = false;

  private readonly ready: unknown[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private delayedCount = 0;
  private wake: (() => void) | null = null;
  private closed = false;

  async enqueue(message: unknown, options?: MessageQueueEnqueueOptions): Promise<void> {
    if (this.closed) {
      throw new Error('MemoryMessageQueue is closed.');
    }
    const ms = delayToMs(options?.delay);
    if (ms > 0) {
      this.delayedCount++;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.delayedCount--;
        this.push(message);
      }, ms);
      this.timers.add(timer);
      return;
    }
    this.push(message);
  }

  async enqueueMany(messages: readonly unknown[], options?: MessageQueueEnqueueOptions): Promise<void> {
    for (const message of messages) {
      await this.enqueue(message, options);
    }
  }

  private push(message: unknown): void {
    if (this.closed) {
      return;
    }
    this.ready.push(message);
    this.wake?.();
  }

  async getDepth(): Promise<MessageQueueDepth> {
    return { queued: this.ready.length + this.delayedCount, ready: this.ready.length, delayed: this.delayedCount };
  }

  async listen(handler: (message: unknown) => Promise<void> | void, options: MessageQueueListenOptions = {}): Promise<void> {
    const { signal } = options;
    while (!signal?.aborted && !this.closed) {
      if (this.ready.length > 0) {
        await handler(this.ready.shift());
        continue;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      this.wake = null;
    }
  }

  /** Clears pending delay timers (which are ref'd and would otherwise hold the process open) and wakes the listen loop. */
  close(): void {
    this.closed = true;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.delayedCount = 0;
    this.ready.length = 0;
    this.wake?.();
  }
}
