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
  knownOutboundSymbolInvoked?: boolean;
  writeCapableHttpBehavior?: boolean;
  knownExternalDestination?: boolean;
  tokenLikeArgument?: boolean;
  fileContentArgument?: boolean;
  shellOrSubprocessCapability?: boolean;
}

const BASE_FACTORS: Omit<RiskScoreFactor, "detected">[] = [
  { id: "notebook-edited", title: "Notebook edited", score: 5 },
  { id: "networking-code", title: "Networking code detected", score: 25 },
  { id: "embedded-data", title: "Embedded data detected", score: 20 },
  { id: "bearer-token-pattern", title: "Token pattern detected", score: 30 },
  { id: "github-outbound", title: "GitHub outbound reference detected", score: 20 },
  { id: "notebook-executed", title: "Notebook execution observed", score: 40 },
  { id: "known-symbol-invoked", title: "Known outbound-capable symbol invoked", score: 35 },
  { id: "write-capable-http", title: "Write-capable HTTP behavior correlated", score: 25 },
  { id: "known-external-destination", title: "Known external destination correlated", score: 20 },
  { id: "token-like-argument", title: "Token-like argument correlated", score: 30 },
  { id: "file-content-argument", title: "File-content argument correlated", score: 20 },
  { id: "shell-or-subprocess", title: "Shell/subprocess capability correlated", score: 30 }
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
      (factor.id === "notebook-executed" && inputs.notebookExecuted) ||
      (factor.id === "known-symbol-invoked" && inputs.knownOutboundSymbolInvoked === true) ||
      (factor.id === "write-capable-http" && inputs.writeCapableHttpBehavior === true) ||
      (factor.id === "known-external-destination" && inputs.knownExternalDestination === true) ||
      (factor.id === "token-like-argument" && inputs.tokenLikeArgument === true) ||
      (factor.id === "file-content-argument" && inputs.fileContentArgument === true) ||
      (factor.id === "shell-or-subprocess" && inputs.shellOrSubprocessCapability === true)
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

  if (inputs.knownOutboundSymbolInvoked) {
    timeline.push({
      step: step++,
      title: "Known outbound-capable symbol invoked",
      details: "Invocation resolved to a previously observed symbol with outbound capabilities."
    });
  }

  if (inputs.networkingCode) {
    timeline.push({
      step: step++,
      title: "Python networking capability detected",
      details: "Notebook content or correlated symbol metadata includes outbound networking capability patterns."
    });
  }

  if (inputs.embeddedData) {
    timeline.push({
      step: step++,
      title: "Embedded data detected",
      details: "Execution path includes embedded blobs or base64-like material."
    });
  }

  if (inputs.notebookExecuted) {
    timeline.push({
      step: step++,
      title: "Notebook execution observed",
      details: "Jupyter execute_request indicates delegated code execution."
    });
  }

  timeline.push({
    step: step++,
    title: "Browser -> SaaS control plane",
    details: "Browser observed execution request sent to Colab control-plane endpoint."
  });
  timeline.push({
    step: step++,
    title: "SaaS control plane -> managed runtime",
    details: "Execution is delegated to provider-managed runtime."
  });
  timeline.push({
    step,
    title: "Managed runtime -> potential external egress",
    details: "Potential external egress is inferred from correlated runtime capabilities."
  });

  return timeline;
};

export const buildDelegatedExecutionEvent = (
  trigger: string,
  confidence: number,
  inputs: DelegatedRiskInputs,
  options?: {
    knownSymbolInvoked?: string;
    inheritedCapabilities?: string[];
  }
): DelegatedExecutionEvent => ({
  executionPlatform: "google-colab",
  confidence,
  trigger,
  executionLanguage: "python",
  outboundCapabilityDetected: inputs.networkingCode,
  embeddedDataDetected: inputs.embeddedData,
  trustBoundaryCrossed: inputs.notebookExecuted || inputs.networkingCode,
  downstreamActivityObserved: "unknown",
  knownSymbolInvoked: options?.knownSymbolInvoked,
  inheritedCapabilities: options?.inheritedCapabilities
});

