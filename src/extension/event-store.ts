import type { ObservedEvent } from "../core/types.js";

export class InMemoryEventStore {
  private readonly byTab = new Map<number, ObservedEvent[]>();
  private readonly allEvents: ObservedEvent[] = [];

  constructor(
    private readonly maxPerTab = 200,
    private readonly maxOverall = 2000
  ) {}

  add(event: ObservedEvent): void {
    this.allEvents.unshift(event);
    if (this.allEvents.length > this.maxOverall) {
      this.allEvents.length = this.maxOverall;
    }

    const tabId = event.context.tabId ?? -1;
    const bucket = this.byTab.get(tabId) ?? [];
    bucket.unshift(event);
    if (bucket.length > this.maxPerTab) {
      bucket.length = this.maxPerTab;
    }
    this.byTab.set(tabId, bucket);
  }

  getEvents(tabId?: number): ObservedEvent[] {
    if (typeof tabId === "number") {
      return [...(this.byTab.get(tabId) ?? [])];
    }
    return [...this.allEvents];
  }
}
