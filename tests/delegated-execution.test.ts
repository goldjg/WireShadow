import { describe, expect, it } from "vitest";
import { buildObservedEvent } from "../src/core/events.js";
import {
  buildDelegatedExecutionEvent,
  buildTrustBoundaryTimeline,
  computeDelegatedRiskScore
} from "../src/core/semantic.js";
import { recogniseColabSignals } from "../src/recognisers/colab.js";

describe("delegated execution event integration", () => {
  it("attaches delegated execution event, timeline, and score to observed event", () => {
    const sample = `
import requests
token = "Bearer abcdefghijklmnopqrstuvwxyz12345"
requests.post("https://api.github.com/repos/org/repo/issues")
run all
`;
    const recogniser = recogniseColabSignals("https://colab.research.google.com/drive/abc", sample);
    const riskScore = computeDelegatedRiskScore(recogniser.signals);
    const timeline = buildTrustBoundaryTimeline(recogniser.signals);
    const delegatedExecutionEvent = buildDelegatedExecutionEvent(
      recogniser.trigger,
      recogniser.confidence,
      recogniser.signals
    );

    const event = buildObservedEvent({
      id: "evt-1",
      api: "fetch",
      destination: {
        url: "https://colab.research.google.com/api/notebook",
        host: "colab.research.google.com",
        protocol: "https:"
      },
      context: {
        url: "https://colab.research.google.com/drive/abc",
        origin: "https://colab.research.google.com",
        frameId: "0",
        timestamp: new Date().toISOString()
      },
      payloadSample: sample,
      delegatedExecutionEvent,
      timeline,
      riskScore,
      detectedCapabilities: recogniser.detectedCapabilities,
      trustBoundaryCrossings: recogniser.trustBoundaryCrossings
    });

    expect(event.delegatedExecutionEvent?.executionPlatform).toBe("google-colab");
    expect(event.timeline.length).toBeGreaterThan(0);
    expect(event.riskScore?.total).toBeGreaterThan(0);
    expect(event.detectedCapabilities).toContain("requests");
    expect(event.trustBoundaryCrossings).toContain("saas-control-plane->managed-runtime");
  });
});
