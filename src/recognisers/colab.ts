import { classifyPayload, hasPythonNetworking } from "../core/classifier.js";
import type { DelegatedRiskInputs } from "../core/semantic.js";
import type { RecogniserFinding } from "../core/types.js";

const COLAB_HOST_RE = /^https?:\/\/colab\.research\.google\.com/i;
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

const HTTP_METHOD_INTENT_RE = /\b(GET|POST|PUT|PATCH|DELETE)\b/;
const BEARER_TOKEN_HINT_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i;

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
  tags: string[]
): RecogniserFinding => ({
  recogniserId: "colab",
  title,
  description,
  severity: confidence >= 0.8 ? "high" : confidence >= 0.65 ? "medium" : "low",
  confidence,
  tags
});

export const isColabUrl = (url: string): boolean => COLAB_HOST_RE.test(url);

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

export interface ColabWebSocketRecognitionResult {
  isColabRuntimeSocket: boolean;
  isKernelChannelsSocket: boolean;
  isLspSocket: boolean;
  messageType?: string;
  executeRequestObserved: boolean;
  executeRequestHasCode: boolean;
  notebookContentSignal: boolean;
  findings: RecogniserFinding[];
  detectedCapabilities: string[];
  trustBoundaryCrossings: string[];
  trigger: string;
  confidence: number;
  codeLength?: number;
  codeSample?: string;
}

const KERNEL_CHANNELS_PATH_RE = /\/api\/kernels\/[^/]+\/channels/i;
const LSP_PATH_RE = /\/colab\/lsp/i;

export const isColabRuntimeSocketUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "wss:" && /\.prod\.colab\.dev$/i.test(parsed.host);
  } catch {
    return false;
  }
};

const isKernelChannelsSocketUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return isColabRuntimeSocketUrl(url) && KERNEL_CHANNELS_PATH_RE.test(parsed.pathname);
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

const parseJsonFrame = (sample: string): unknown | undefined => {
  try {
    return JSON.parse(sample);
  } catch {
    return undefined;
  }
};

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const getString = (value: unknown, key: string): string | undefined => {
  const record = toRecord(value);
  const candidate = record?.[key];
  return typeof candidate === "string" ? candidate : undefined;
};

export const recogniseColabWebSocketFrame = (
  socketUrl: string,
  sample?: string,
  pageUrl = "https://colab.research.google.com"
): ColabWebSocketRecognitionResult => {
  const findings: RecogniserFinding[] = [];
  const isRuntimeSocket = isColabRuntimeSocketUrl(socketUrl);
  const isKernelSocket = isKernelChannelsSocketUrl(socketUrl);
  const isLspSocketMessage = isLspSocketUrl(socketUrl);

  if (!isRuntimeSocket || !sample) {
    return {
      isColabRuntimeSocket: isRuntimeSocket,
      isKernelChannelsSocket: isKernelSocket,
      isLspSocket: isLspSocketMessage,
      executeRequestObserved: false,
      executeRequestHasCode: false,
      notebookContentSignal: false,
      findings,
      detectedCapabilities: [],
      trustBoundaryCrossings: [],
      trigger: "none",
      confidence: 0
    };
  }

  const parsed = parseJsonFrame(sample);
  const header = toRecord(parsed && toRecord(parsed)?.header);
  const content = toRecord(parsed && toRecord(parsed)?.content);
  const messageType = getString(header, "msg_type") ?? getString(parsed, "method");
  const maybeCode = getString(content, "code");
  const executeRequestObserved = messageType === "execute_request";
  const executeRequestHasCode = executeRequestObserved && typeof maybeCode === "string" && maybeCode.trim().length > 0;

  if (isKernelSocket) {
    findings.push(
      finding(
        "Colab kernel WebSocket observed",
        "A Colab Jupyter kernel channels WebSocket was observed.",
        0.9,
        ["colab", "websocket", "jupyter"]
      )
    );
  }

  if (executeRequestObserved) {
    findings.push(
      finding(
        "Jupyter execute_request observed",
        "An outbound Jupyter execute_request message was observed on the kernel channel.",
        executeRequestHasCode ? 0.95 : 0.7,
        ["jupyter", "execute_request", "delegated-execution"]
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
    return {
      isColabRuntimeSocket: isRuntimeSocket,
      isKernelChannelsSocket: isKernelSocket,
      isLspSocket: isLspSocketMessage,
      messageType,
      executeRequestObserved,
      executeRequestHasCode: false,
      notebookContentSignal,
      findings,
      detectedCapabilities: [],
      trustBoundaryCrossings: [],
      trigger: notebookContentSignal ? "lsp-notebook-edit" : "colab-websocket-observation",
      confidence: notebookContentSignal ? 0.75 : executeRequestObserved ? 0.7 : 0.55
    };
  }

  const code = maybeCode ?? "";
  const semantic = recogniseColabSignals(isColabUrl(pageUrl) ? pageUrl : "https://colab.research.google.com", code);
  const trustBoundaryCrossings = [
    "browser->saas-control-plane",
    "saas-control-plane->managed-runtime",
    ...(semantic.signals.networkingCode ? ["managed-runtime->external-egress-potential"] : [])
  ];

  return {
    isColabRuntimeSocket: isRuntimeSocket,
    isKernelChannelsSocket: isKernelSocket,
    isLspSocket: isLspSocketMessage,
    messageType,
    executeRequestObserved: true,
    executeRequestHasCode: true,
    notebookContentSignal,
    findings: [...findings, ...semantic.findings],
    detectedCapabilities: semantic.detectedCapabilities,
    trustBoundaryCrossings,
    trigger: "jupyter-execute-request",
    confidence: Math.max(0.9, semantic.confidence),
    codeLength: code.length,
    codeSample: code
  };
};

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
