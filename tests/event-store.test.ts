import { describe, expect, it } from "vitest";
import { buildObservedEvent } from "../src/core/events.js";
import { InMemoryEventStore } from "../src/extension/event-store.js";

const makeEvent = (id: string, tabId?: number) =>
  buildObservedEvent({
    id,
    api: "fetch",
    destination: {
      url: "https://example.com/api",
      host: "example.com",
      protocol: "https:"
    },
    context: {
      url: "https://app.example.com",
      origin: "https://app.example.com",
      frameId: "0",
      tabId,
      timestamp: new Date().toISOString()
    },
    payloadSample: "email=analyst@company.example"
  });

describe("in-memory event store", () => {
  it("stores newest events first", () => {
    const store = new InMemoryEventStore();
    store.add(makeEvent("1", 1));
    store.add(makeEvent("2", 1));
    const events = store.getEvents(1);
    expect(events.map((event) => event.id)).toEqual(["2", "1"]);
  });

  it("supports multiple tabs", () => {
    const store = new InMemoryEventStore();
    store.add(makeEvent("a", 1));
    store.add(makeEvent("b", 2));
    expect(store.getEvents(1).map((event) => event.id)).toEqual(["a"]);
    expect(store.getEvents(2).map((event) => event.id)).toEqual(["b"]);
  });
});
