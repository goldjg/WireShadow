import { classifyPayload, hasPythonNetworking } from "../core/classifier.js";
import { parseJupyterFrame } from "../core/jupyter-protocol.js";
import type {
  JupyterParseFailureReason,
  JupyterProtocolObservation
} from "../core/jupyter-protocol.js";
import { redactValue } from "../core/redaction.js";
import type { DelegatedRiskInputs } from "../core/semantic.js";
import type {
  DelegatedExecutionPlatform,
  RecogniserFinding,
  WebSocketFrameType
} from "../core/types.js";
import {
  identifyJupyterSaasPlatform,
  isJupyterKernelChannelsUrl,
  jupyterPlatformLabel,
  jupyterRecogniserId
} from "./jupyter-saas.js";

const NOTEBOOK_DOCUMENT_RE = /(\.ipynb|google\.colab|notebook|cell_type|kernelspec)/i;
const NOTEBOOK_EDIT_RE = /(cell[_\s-]?edit|saveNotebook|insertCell|set_text|source"\s*:)/i;
const NOTEBOOK_EXECUTION_RE = /(run all|execute(cell| code)?|kernel\.invokeFunction|runCell)/i;
const PYTHON_CELL_RE = /(cell_type"\s*:\s*"code"|%%python|^\s*import\s+\w+)/im;
const MARKDOWN_CELL_RE = /(cell_type"\s*:\s*"markdown"|text\/markdown|^\s*#\s+\w+)/im;
const NOTEBOOK_METADATA_RE = /(metadata"\s*:|kernelspec|language_info|colab"\s*:)/i;

const NETWORKING_PATTERNS: Array<[RegExp, string]> = [
  [/\brequests\b/i, "requests"],
  [/\burllib\b/i, "urllib"],
  [/\burllib3\b/i, "urllib3"],
  [/\bhttpx\b/i, "httpx"],
  [/\baiohttp\b/i, "aiohttp"],
  [/\bsocket\b/i, "socket"],
  [/\bwebsocket-client\b/i, "websocket-client"]
];

const EXTERNAL_EXECUTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bsubprocess\b/i, "subprocess"],
  [/\bos\.system\b/i, "os.system"],
  [/\bcurl\b/i, "curl"],
  [/\bwget\b/i, "wget"]
];

const GITHUB_PATTERNS: Array<[RegExp, string]> = [
  [/\bgithub\.com\b/i, "github.com"],
  [/\bapi\.github\.com\b/i, "api.github.com"],
  [/\bgist\.github\.com\b/i, "gist.github.com"],
  [/\bPyGithub\b/i, "PyGithub"]
];

const CLOUD_STORAGE_PATTERNS: Array<[RegExp, string]> = [
  [/\bgoogleapiclient\.discovery\b|\bdrive\.google\.com\b|\bgoogle drive\b/i, "google-drive"],
  [/\bdropbox\b/i, "dropbox"],
  [/\bonedrive\b/i, "onedrive"],
  [/\bs3(?:\.amazonaws\.com)?\b/i, "s3"],
  [/\bazure\.blob\b|\bblob\.core\.windows\.net\b/i, "azure-blob"]
];

const HTTP_METHOD_INTENT_RE = /\b(GET|POST|PUT|PATCH|DELETE)\b/i;
const BEARER_TOKEN_HINT_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i;
const MAX_AST_CODE_CHARS = 128 * 1024;

const collectCapabilities = (content: string): string[] => {
  const hits: string[] = [];
  const addHits = (patterns: Array<[RegExp, string]>): void => {
    for (const [pattern, label] of patterns) {
      if (pattern.test(content)) {
        hits.push(label);
      }
    }
  };
  addHits(NETWORKING_PATTERNS);
  addHits(EXTERNAL_EXECUTION_PATTERNS);
  addHits(GITHUB_PATTERNS);
  addHits(CLOUD_STORAGE_PATTERNS);
  if (HTTP_METHOD_INTENT_RE.test(content)) {
    hits.push("http-method-intent");
  }
  return Array.from(new Set(hits));
};

const finding = (
  title: string,
  description: string,
  confidence: number,
  tags: string[],
  recogniserId = "colab"
): RecogniserFinding => ({
  recogniserId,
  title,
  description,
  severity: confidence >= 0.8 ? "high" : confidence >= 0.65 ? "medium" : "low",
  confidence,
  tags
});

export const isColabUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname === "colab.research.google.com";
  } catch {
    return false;
  }
};

export interface ColabRecognitionResult {
  isColab: boolean;
  findings: RecogniserFinding[];
  signals: DelegatedRiskInputs & {
    isNotebookDocument: boolean;
    executablePythonCell: boolean;
    markdownCell: boolean;
    notebookMetadata: boolean;
  };
  detectedCapabilities: string[];
  trustBoundaryCrossings: string[];
  trigger: string;
  confidence: number;
}

export type { JupyterProtocolObservation } from "../core/jupyter-protocol.js";

export interface ColabWebSocketRecognitionResult {
  executionPlatform: DelegatedExecutionPlatform;
  isRecognisedRuntimeSocket: boolean;
  isColabRuntimeSocket: boolean;
  isKernelChannelsSocket: boolean;
  isLspSocket: boolean;
  messageType?: string;
  executeRequestObserved: boolean;
  executeRequestHasCode: boolean;
  kernelResetSignal: boolean;
  notebookContentSignal: boolean;
  findings: RecogniserFinding[];
  detectedCapabilities: string[];
  trustBoundaryCrossings: string[];
  trigger: string;
  confidence: number;
  codeLength?: number;
  codeHash?: string;
  codeSample?: string;
  protocolObservation?: JupyterProtocolObservation;
  jupyterEnvelopeParsed: boolean;
  parseFailureReason?: JupyterParseFailureReason;
}

const LSP_PATH_RE = /\/colab\/lsp/i;

export const isColabRuntimeSocketUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "wss:" && /\.prod\.colab\.dev$/i.test(parsed.host);
  } catch {
    return false;
  }
};

const isLspSocketUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return isColabRuntimeSocketUrl(url) && LSP_PATH_RE.test(parsed.pathname);
  } catch {
    return false;
  }
};

const getString = (value: unknown, key: string): string | undefined => {
  const record = typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
  const candidate = record?.[key];
  return typeof candidate === "string" ? candidate : undefined;
};

export const recogniseJupyterSaasWebSocketFrame = (
  socketUrl: string,
  sample?: string,
  pageUrl = "https://colab.research.google.com",
  frameType: WebSocketFrameType | "unknown" = "unknown"
): ColabWebSocketRecognitionResult => {
  const findings: RecogniserFinding[] = [];
  const executionPlatform = identifyJupyterSaasPlatform(pageUrl, socketUrl);
  const isColabRuntimeSocket = isColabRuntimeSocketUrl(socketUrl);
  const isKernelSocket = isJupyterKernelChannelsUrl(socketUrl);
  const isLspSocketMessage = executionPlatform === "google-colab" && isLspSocketUrl(socketUrl);
  const isRuntimeSocket = executionPlatform !== "unknown" && (isKernelSocket || isLspSocketMessage);
  const platformLabel = jupyterPlatformLabel(executionPlatform);
  const recogniserId = jupyterRecogniserId(executionPlatform);

  if (!isRuntimeSocket || !sample) {
    return {
      executionPlatform,
      isRecognisedRuntimeSocket: isRuntimeSocket,
      isColabRuntimeSocket,
      isKernelChannelsSocket: isKernelSocket,
      isLspSocket: isLspSocketMessage,
      executeRequestObserved: false,
      executeRequestHasCode: false,
      kernelResetSignal: false,
      notebookContentSignal: false,
      findings,
      detectedCapabilities: [],
      trustBoundaryCrossings: [],
      trigger: "none",
      confidence: 0,
      jupyterEnvelopeParsed: false
    };
  }

  const extractedResult = parseJupyterFrame(sample, frameType);
  const extracted = extractedResult.frame;
  const protocolObservation = extractedResult.observation;
  const messageType = extracted?.messageType;
  const maybeCode = extracted?.content?.code;
  const executionState = getString(extracted?.content, "execution_state");
  const code = typeof maybeCode === "string" ? maybeCode : "";
  const executeRequestObserved = messageType === "execute_request";
  const executeRequestHasCode = executeRequestObserved && code.trim().length > 0;
  const kernelResetSignal =
    messageType === "status" && ["restarting", "starting", "dead"].includes(String(executionState ?? "").toLowerCase());

  if (isKernelSocket) {
    findings.push(
      finding(
        `${platformLabel} kernel WebSocket observed`,
        `A ${platformLabel} Jupyter kernel channels WebSocket was observed.`,
        0.9,
        [recogniserId, "websocket", "jupyter"],
        recogniserId
      )
    );
  }

  if (executeRequestObserved) {
    findings.push(
      finding(
        "Jupyter execute_request observed",
        "An outbound Jupyter execute_request message was observed on the kernel channel.",
        executeRequestHasCode ? 0.95 : 0.7,
        ["jupyter", "execute_request"],
        recogniserId
      )
    );
  }

  const notebookContentSignal =
    messageType === "textDocument/didOpen" || messageType === "textDocument/didChange";

  if (isLspSocketMessage && notebookContentSignal) {
    findings.push(
      finding(
        "Colab LSP notebook edit signal observed",
        "A Colab LSP didOpen/didChange message was observed.",
        0.8,
        ["colab", "lsp", "notebook-edit"]
      )
    );
  }

  if (!executeRequestHasCode) {
    const parseFailureReason = extractedResult.failureReason;
    const codeFailureReason =
      executeRequestObserved && !Object.prototype.hasOwnProperty.call(extracted?.content ?? {}, "code")
        ? "code-missing"
        : executeRequestObserved && typeof maybeCode !== "string"
          ? "code-not-string"
          : undefined;
    return {
      executionPlatform,
      isRecognisedRuntimeSocket: isRuntimeSocket,
      isColabRuntimeSocket,
      isKernelChannelsSocket: isKernelSocket,
      isLspSocket: isLspSocketMessage,
      messageType,
      executeRequestObserved,
      executeRequestHasCode: false,
      kernelResetSignal,
      notebookContentSignal,
      findings,
      detectedCapabilities: [],
      trustBoundaryCrossings: [],
      trigger: notebookContentSignal ? "lsp-notebook-edit" : "jupyter-websocket-observation",
      confidence: notebookContentSignal ? 0.75 : executeRequestObserved ? 0.7 : 0.55,
      protocolObservation,
      jupyterEnvelopeParsed: Boolean(extracted),
      parseFailureReason: parseFailureReason ?? codeFailureReason
    };
  }

  if (code.length > MAX_AST_CODE_CHARS) {
    return {
      executionPlatform,
      isRecognisedRuntimeSocket: isRuntimeSocket,
      isColabRuntimeSocket,
      isKernelChannelsSocket: isKernelSocket,
      isLspSocket: isLspSocketMessage,
      messageType,
      executeRequestObserved: true,
      executeRequestHasCode: true,
      kernelResetSignal,
      notebookContentSignal,
      findings,
      detectedCapabilities: [],
      trustBoundaryCrossings: [],
      trigger: "jupyter-execute-request",
      confidence: 0.7,
      codeLength: code.length,
      codeHash: redactValue("source-code", code).hash,
      protocolObservation,
      jupyterEnvelopeParsed: true,
      parseFailureReason: "analysis-size-limit"
    };
  }

  const semantic = recogniseColabSignals(pageUrl, code);
  const hasEgressPotential = semantic.signals.networkingCode;
  const trustBoundaryCrossings = [
    "browser->saas-control-plane",
    "saas-control-plane->managed-runtime",
    ...(hasEgressPotential ? ["managed-runtime->potential-external-egress"] : [])
  ];
  const codeHash = redactValue("source-code", code).hash;

  return {
    executionPlatform,
    isRecognisedRuntimeSocket: isRuntimeSocket,
    isColabRuntimeSocket,
    isKernelChannelsSocket: isKernelSocket,
    isLspSocket: isLspSocketMessage,
    messageType,
    executeRequestObserved: true,
    executeRequestHasCode: true,
    kernelResetSignal,
    notebookContentSignal,
    findings: [...findings, ...(executionPlatform === "google-colab" ? semantic.findings : [])],
    detectedCapabilities: semantic.detectedCapabilities,
    trustBoundaryCrossings,
    trigger: "jupyter-execute-request",
    confidence: Math.max(0.9, semantic.confidence),
    codeLength: code.length,
    codeHash,
    codeSample: code,
    protocolObservation,
    jupyterEnvelopeParsed: true
  };
};

export const recogniseColabWebSocketFrame = recogniseJupyterSaasWebSocketFrame;

export const recogniseColabSignals = (url: string, content: string): ColabRecognitionResult => {
  const findings: RecogniserFinding[] = [];
  const isColab = isColabUrl(url);
  const payload = classifyPayload(content);
  const detectedCapabilities = collectCapabilities(content);

  const signals = {
    isNotebookDocument: NOTEBOOK_DOCUMENT_RE.test(url) || NOTEBOOK_DOCUMENT_RE.test(content),
    notebookEdited: NOTEBOOK_EDIT_RE.test(content),
    notebookExecuted: NOTEBOOK_EXECUTION_RE.test(content),
    executablePythonCell: PYTHON_CELL_RE.test(content),
    markdownCell: MARKDOWN_CELL_RE.test(content),
    notebookMetadata: NOTEBOOK_METADATA_RE.test(content),
    networkingCode:
      hasPythonNetworking(content) ||
      detectedCapabilities.some((value) => NETWORKING_PATTERNS.some(([, label]) => label === value)),
    embeddedData:
      payload.categories.includes("embedded-data") || payload.categories.includes("base64-blob"),
    bearerTokenPattern:
      payload.categories.includes("bearer-token") ||
      payload.categories.includes("jwt") ||
      BEARER_TOKEN_HINT_RE.test(content),
    githubOutbound: detectedCapabilities.some((value) => value.includes("github"))
  };

  const trustBoundaryCrossings = signals.notebookExecuted
    ? ["saas-control-plane->managed-runtime", "managed-runtime->external-egress"]
    : signals.networkingCode
      ? ["saas-control-plane->managed-runtime"]
      : [];

  const confidenceSignals = [
    signals.isNotebookDocument,
    signals.notebookEdited,
    signals.notebookExecuted,
    signals.networkingCode,
    signals.embeddedData
  ].filter(Boolean).length;
  const confidence = Math.min(0.99, 0.55 + confidenceSignals * 0.08);

  if (!isColab) {
    return {
      isColab,
      findings,
      signals,
      detectedCapabilities,
      trustBoundaryCrossings,
      trigger: "none",
      confidence: 0
    };
  }

  findings.push(
    finding(
      "Google Colab page detected",
      "The active page is hosted on Google Colab.",
      0.95,
      ["spade", "colab", "saas-runtime"]
    )
  );

  if (signals.isNotebookDocument) {
    findings.push(
      finding(
        "Notebook document indicators detected",
        "Notebook-like document metadata and structure markers are present.",
        0.82,
        ["notebook"]
      )
    );
  }

  if (signals.notebookEdited) {
    findings.push(
      finding(
        "Notebook cell edit activity detected",
        "Notebook edit markers indicate user-authored or modified cell content.",
        0.8,
        ["edit", "cell"]
      )
    );
  }

  if (signals.executablePythonCell) {
    findings.push(
      finding(
        "Executable Python cell indicators detected",
        "Code-cell markers suggest executable Python content.",
        0.84,
        ["python", "execution"]
      )
    );
  }

  if (signals.markdownCell) {
    findings.push(
      finding(
        "Markdown cell indicators detected",
        "Markdown cell markers were observed in notebook content.",
        0.75,
        ["markdown", "cell"]
      )
    );
  }

  if (signals.notebookMetadata) {
    findings.push(
      finding(
        "Notebook metadata detected",
        "Notebook metadata fields were observed in Colab content.",
        0.72,
        ["metadata"]
      )
    );
  }

  if (signals.networkingCode) {
    findings.push(
      finding(
        "Python outbound networking code detected",
        "Notebook code references outbound networking capabilities.",
        0.9,
        ["python", "networking", "egress"]
      )
    );
  }

  if (signals.githubOutbound) {
    findings.push(
      finding(
        "GitHub outbound target references found",
        "Notebook content references GitHub outbound endpoints or libraries.",
        0.82,
        ["github", "outbound"]
      )
    );
  }

  if (signals.embeddedData) {
    findings.push(
      finding(
        "Embedded data marker detected",
        "Notebook content includes embedded blob or base64-like data.",
        0.78,
        ["embedded-data"]
      )
    );
  }

  if (signals.notebookExecuted) {
    findings.push(
      finding(
        "Delegated execution indicator detected",
        "Execution markers indicate browser intent that delegates execution to managed runtime.",
        0.9,
        ["delegated-execution", "spade"]
      )
    );
  }

  const trigger = signals.notebookExecuted
    ? "notebook-execution"
    : signals.notebookEdited
      ? "notebook-edit"
      : "colab-observation";

  return {
    isColab,
    findings,
    signals,
    detectedCapabilities,
    trustBoundaryCrossings,
    trigger,
    confidence
  };
};
