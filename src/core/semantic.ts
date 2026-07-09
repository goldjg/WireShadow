import type {
  DelegatedExecutionEvent,
  RiskScore,
  RiskScoreFactor,
  TrustBoundaryTimelineEvent
} from "./types.js";

export interface DelegatedRiskInputs {
  notebookEdited: boolean;
  networkingCode: boolean;
  embeddedData: boolean;
  bearerTokenPattern: boolean;
  githubOutbound: boolean;
  notebookExecuted: boolean;
}

const BASE_FACTORS: Omit<RiskScoreFactor, "detected">[] = [
  { id: "notebook-edited", title: "Notebook edited", score: 5 },
  { id: "networking-code", title: "Networking code detected", score: 25 },
  { id: "embedded-data", title: "Embedded data detected", score: 20 },
  { id: "bearer-token-pattern", title: "Bearer token pattern detected", score: 30 },
  { id: "github-outbound", title: "GitHub outbound reference detected", score: 20 },
  { id: "notebook-executed", title: "Notebook execution observed", score: 40 }
];

export const computeDelegatedRiskScore = (inputs: DelegatedRiskInputs): RiskScore => {
  const factors: RiskScoreFactor[] = BASE_FACTORS.map((factor) => ({
    ...factor,
    detected:
      (factor.id === "notebook-edited" && inputs.notebookEdited) ||
      (factor.id === "networking-code" && inputs.networkingCode) ||
      (factor.id === "embedded-data" && inputs.embeddedData) ||
      (factor.id === "bearer-token-pattern" && inputs.bearerTokenPattern) ||
      (factor.id === "github-outbound" && inputs.githubOutbound) ||
      (factor.id === "notebook-executed" && inputs.notebookExecuted)
  }));

  return {
    total: factors.reduce((sum, factor) => sum + (factor.detected ? factor.score : 0), 0),
    factors
  };
};

export const buildTrustBoundaryTimeline = (inputs: DelegatedRiskInputs): TrustBoundaryTimelineEvent[] => {
  const timeline: TrustBoundaryTimelineEvent[] = [];
  let step = 1;

  if (inputs.notebookEdited) {
    timeline.push({
      step: step++,
      title: "User edited notebook",
      details: "Notebook-edit indicators were observed in Colab content."
    });
  }

  if (inputs.networkingCode) {
    timeline.push({
      step: step++,
      title: "Python networking capability detected",
      details: "Notebook content includes outbound networking capability patterns."
    });
  }

  if (inputs.embeddedData) {
    timeline.push({
      step: step++,
      title: "Embedded data detected",
      details: "Notebook content includes embedded blobs or base64-like material."
    });
  }

  if (inputs.notebookExecuted) {
    timeline.push({
      step: step++,
      title: "Notebook execution observed",
      details: "Execution intent markers indicate delegated code execution."
    });
  }

  timeline.push({
    step: step++,
    title: "Execution delegated to Google infrastructure",
    details: "Execution occurs in provider-managed runtime outside enterprise endpoint control."
  });
  timeline.push({
    step,
    title: "Potential downstream network activity outside browser visibility",
    details: "Runtime egress may occur without direct browser network visibility."
  });

  return timeline;
};

export const buildDelegatedExecutionEvent = (
  trigger: string,
  confidence: number,
  inputs: DelegatedRiskInputs
): DelegatedExecutionEvent => ({
  executionPlatform: "google-colab",
  confidence,
  trigger,
  executionLanguage: "python",
  outboundCapabilityDetected: inputs.networkingCode,
  embeddedDataDetected: inputs.embeddedData,
  trustBoundaryCrossed: inputs.notebookExecuted || inputs.networkingCode
});
