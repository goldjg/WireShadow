import { describe, expect, it } from "vitest";
import {
  buildDelegatedExecutionEvent,
  buildTrustBoundaryTimeline,
  computeDelegatedRiskScore
} from "../src/core/semantic.js";

describe("semantic timeline and scoring", () => {
  const inputs = {
    notebookEdited: true,
    networkingCode: true,
    embeddedData: true,
    bearerTokenPattern: true,
    githubOutbound: true,
    notebookExecuted: true
  } as const;

  it("computes additive risk score factors", () => {
    const risk = computeDelegatedRiskScore(inputs);
    expect(risk.total).toBe(140);
    expect(risk.factors.filter((factor) => factor.detected)).toHaveLength(6);
  });

  it("builds a deterministic trust-boundary timeline", () => {
    const timeline = buildTrustBoundaryTimeline(inputs);
    expect(timeline[0]?.title).toBe("User edited notebook");
    expect(timeline[timeline.length - 1]?.title).toBe("Managed runtime -> potential external egress");
  });

  it("builds a delegated execution event", () => {
    const event = buildDelegatedExecutionEvent("notebook-execution", 0.93, inputs);
    expect(event.executionPlatform).toBe("google-colab");
    expect(event.trustBoundaryCrossed).toBe(true);
    expect(event.outboundCapabilityDetected).toBe(true);
  });

  it("marks outbound capability when correlated egress evidence exists without generic networking signal", () => {
    const event = buildDelegatedExecutionEvent("jupyter-execute-request", 0.9, {
      notebookEdited: false,
      networkingCode: false,
      embeddedData: false,
      bearerTokenPattern: false,
      githubOutbound: true,
      notebookExecuted: true,
      knownOutboundSymbolInvoked: true
    });
    expect(event.outboundCapabilityDetected).toBe(true);
    expect(event.trustBoundaryCrossed).toBe(true);
  });
});
