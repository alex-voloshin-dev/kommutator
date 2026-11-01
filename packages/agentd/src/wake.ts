export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** Each recipient has at most one trailing callback. Pending messages live in SQLite. */
export class WakeScheduler {
  private readonly timers = new Map<string, unknown>();
  constructor(private readonly clock: Clock, private readonly run: (key: string) => Promise<void>, public cooldown = 30_000) {}
  schedule(key: string, lastWake: number | undefined): void {
    if (this.timers.has(key)) return;
    const delay = lastWake === undefined ? 0 : Math.max(0, lastWake + this.cooldown - this.clock.now());
    this.timers.set(key, this.clock.setTimeout(() => {
      this.timers.delete(key);
      void this.run(key);
    }, delay));
  }
  cancel(key: string): void { const timer = this.timers.get(key); if (timer !== undefined) this.clock.clearTimeout(timer); this.timers.delete(key); }
  close(): void { for (const timer of this.timers.values()) this.clock.clearTimeout(timer); this.timers.clear(); }
}
