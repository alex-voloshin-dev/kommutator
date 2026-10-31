export interface HubEvent {
  id: number;
  type: string;
  at: string;
  data: unknown;
}

/** Live events only; persistent delivery recovery is a separate, pending contract. */
export class HubEvents {
  private sequence = 0;
  private readonly listeners = new Set<(event: HubEvent) => void>();

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly onError: (error: unknown) => void = (error) => console.warn("hub event listener failed", error),
  ) {}

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(type: string, data: unknown): void {
    const event: HubEvent = { id: ++this.sequence, type, at: this.now(), data };
    for (const listener of this.listeners) {
      try { listener(event); } catch (error) { this.onError(error); }
    }
  }
}
