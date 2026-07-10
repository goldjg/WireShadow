import { classifyPayload, hasPythonNetworking } from "../core/classifier.js";
import { redactValue } from "../core/redaction.js";
import type { DelegatedRiskInputs } from "../core/semantic.js";
import type { RecogniserFinding, WebSocketFrameType } from "../core/types.js";

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
const MAX_WS_FRAME_PARSE_CHARS = 256 * 1024;
const MAX_AST_CODE_CHARS = 128 * 1024;
const MAX_WS_PARSE_DEPTH = 5;
const MAX_WS_PARSE_NODES = 80;
const MAX_NESTED_JSON_STRING_CHARS = 128 * 1024;

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

export interface JupyterProtocolObservation {
  topLevelKeys: string[];
  headerMsgType?: string;
  parentHeaderMsgIdPresent: boolean;
  contentKeys: string[];
  contentCodeExists: boolean;
  codeType: string;
  codeLength: number;
  frameEncoding: WebSocketFrameType | "unknown";
  nestedOrWrapped: boolean;
  parseShape:
    | "none"
    | "direct"
    | "array"
    | "nested"
    | "stringified"
    | "prefixed"
    | "nested+array"
    | "nested+stringified"
    | "nested+prefixed";
}

export interface ColabWebSocketRecognitionResult {
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
  parseFailureReason?:
    | "frame-too-large"
    | "frame-truncated-before-parse"
    | "invalid-json"
    | "unsupported-envelope"
    | "code-missing"
    | "code-not-string"
    | "binary-decode-failed"
    | "ast-parse-failed"
    | "analysis-size-limit"
    | "unknown";
}

const KERNEL_CHANNELS_PATH_RE = /\/api\/kernels\/[^/]+\/channels/i;
const LSP_PATH_RE = /\/colab\/lsp/i;

interface ParseAttempt {
  value?: unknown;
  prefixed: boolean;
  failureReason?: "frame-too-large" | "invalid-json";
}

interface SearchNode {
  value: unknown;
  depth: number;
  shape: Set<"array" | "nested" | "stringified" | "prefixed">;
}

interface ExtractedJupyterFrame {
  messageType?: string;
  content?: Record<string, unknown>;
  parentHeader?: Record<string, unknown>;
  nestedOrWrapped: boolean;
  parseShape: JupyterProtocolObservation["parseShape"];
}

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

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const getString = (value: unknown, key: string): string | undefined => {
  const record = toRecord(value);
  const candidate = record?.[key];
  return typeof candidate === "string" ? candidate : undefined;
};

const parseJsonCandidate = (raw: string): ParseAttempt => {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_WS_FRAME_PARSE_CHARS) {
    return { prefixed: false, failureReason: "frame-too-large" };
  }
  const safe = trimmed;
  if (safe.length === 0) {
    return { prefixed: false };
  }

  try {
    return { value: JSON.parse(safe), prefixed: false };
  } catch {
    const firstJsonChar = safe.search(/[\[{]/);
    if (firstJsonChar <= 0) {
      return { prefixed: false, failureReason: "invalid-json" };
    }
    const candidate = safe.slice(firstJsonChar);
    try {
      return { value: JSON.parse(candidate), prefixed: true };
    } catch {
      return { prefixed: true, failureReason: "invalid-json" };
    }
  }
};

const asParseShape = (
  nestedOrWrapped: boolean,
  shape: Set<"array" | "nested" | "stringified" | "prefixed">
): JupyterProtocolObservation["parseShape"] => {
  if (!nestedOrWrapped && shape.size === 0) {
    return "direct";
  }

  const hasNested = shape.has("nested");
  const hasArray = shape.has("array");
  const hasStringified = shape.has("stringified");
  const hasPrefixed = shape.has("prefixed");

  if (hasNested && hasArray) {
    return "nested+array";
  }
  if (hasNested && hasStringified) {
    return "nested+stringified";
  }
  if (hasNested && hasPrefixed) {
    return "nested+prefixed";
  }
  if (hasArray) {
    return "array";
  }
  if (hasStringified) {
    return "stringified";
  }
  if (hasPrefixed) {
    return "prefixed";
  }
  if (hasNested) {
    return "nested";
  }
  return "none";
};

const extractJupyterFrame = (
  sample: string
): { frame?: ExtractedJupyterFrame; failureReason?: ColabWebSocketRecognitionResult["parseFailureReason"] } => {
  const top = parseJsonCandidate(sample);
  if (typeof top.value === "undefined") {
    return {
      failureReason:
        top.failureReason === "frame-too-large"
          ? "frame-too-large"
          : top.failureReason === "invalid-json"
            ? "invalid-json"
            : "unknown"
    };
  }

  const queue: SearchNode[] = [
    {
      value: top.value,
      depth: 0,
      shape: new Set(top.prefixed ? (["prefixed"] as const) : [])
    }
  ];
  let visited = 0;

  while (queue.length > 0 && visited < MAX_WS_PARSE_NODES) {
    const node = queue.shift();
    if (!node) {
      break;
    }
    visited += 1;
    if (node.depth > MAX_WS_PARSE_DEPTH) {
      continue;
    }

    const asObject = toRecord(node.value);
    if (asObject) {
      const header = toRecord(asObject.header);
      const messageType = getString(header, "msg_type") ?? getString(asObject, "method");
      if (typeof messageType === "string") {
        return {
          frame: {
            messageType,
            content: toRecord(asObject.content),
            parentHeader: toRecord(asObject.parent_header),
            nestedOrWrapped: node.depth > 0 || node.shape.size > 0,
            parseShape: asParseShape(node.depth > 0 || node.shape.size > 0, node.shape)
          }
        };
      }

      for (const value of Object.values(asObject)) {
        if (typeof value === "string" && value.length <= MAX_NESTED_JSON_STRING_CHARS) {
          const nested = parseJsonCandidate(value);
          if (typeof nested.value !== "undefined") {
            queue.push({
              value: nested.value,
              depth: node.depth + 1,
              shape: new Set([
                ...node.shape,
                "nested",
                "stringified",
                ...(nested.prefixed ? (["prefixed"] as const) : [])
              ])
            });
            continue;
          }
        }

        if (typeof value === "object" && value !== null) {
          queue.push({
            value,
            depth: node.depth + 1,
            shape: new Set([...node.shape, "nested"])
          });
        }
      }
    }

    if (Array.isArray(node.value)) {
      for (const item of node.value) {
        queue.push({
          value: item,
          depth: node.depth + 1,
          shape: new Set([...node.shape, "array"])
        });
      }
    }
  }

  return { failureReason: "unsupported-envelope" };
};

const buildProtocolObservation = (
  sample: string | undefined,
  frameType: WebSocketFrameType | "unknown",
  extracted: ExtractedJupyterFrame | undefined
): JupyterProtocolObservation | undefined => {
  if (!sample) {
    return undefined;
  }

  const topParse = parseJsonCandidate(sample);
  const topAsRecord = toRecord(topParse.value);
  const topLevelKeys = topAsRecord ? Object.keys(topAsRecord).slice(0, 20) : [];
  const content = extracted?.content;
  const codeValue = content?.code;
  const codeLength =
    typeof codeValue === "string"
      ? codeValue.length
      : typeof codeValue === "number" || typeof codeValue === "boolean"
        ? String(codeValue).length
        : 0;

  return {
    topLevelKeys,
    headerMsgType: extracted?.messageType,
    parentHeaderMsgIdPresent: typeof extracted?.parentHeader?.msg_id === "string",
    contentKeys: content ? Object.keys(content).slice(0, 20) : [],
    contentCodeExists: typeof content !== "undefined" && Object.prototype.hasOwnProperty.call(content, "code"),
    codeType: typeof codeValue === "undefined" ? "undefined" : Array.isArray(codeValue) ? "array" : typeof codeValue,
    codeLength,
    frameEncoding: frameType,
    nestedOrWrapped: extracted?.nestedOrWrapped ?? false,
    parseShape: extracted?.parseShape ?? (topParse.prefixed ? "prefixed" : topLevelKeys.length > 0 ? "direct" : "none")
  };
};

export const recogniseColabWebSocketFrame = (
  socketUrl: string,
  sample?: string,
  pageUrl = "https://colab.research.google.com",
  frameType: WebSocketFrameType | "unknown" = "unknown"
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

  const extractedResult = extractJupyterFrame(sample);
  const extracted = extractedResult.frame;
  const protocolObservation = buildProtocolObservation(sample, frameType, extracted);
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
        ["jupyter", "execute_request"]
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
      isColabRuntimeSocket: isRuntimeSocket,
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
      trigger: notebookContentSignal ? "lsp-notebook-edit" : "colab-websocket-observation",
      confidence: notebookContentSignal ? 0.75 : executeRequestObserved ? 0.7 : 0.55,
      protocolObservation,
      jupyterEnvelopeParsed: Boolean(extracted),
      parseFailureReason: parseFailureReason ?? codeFailureReason
    };
  }

  if (code.length > MAX_AST_CODE_CHARS) {
    return {
      isColabRuntimeSocket: isRuntimeSocket,
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

  const semantic = recogniseColabSignals(isColabUrl(pageUrl) ? pageUrl : "https://colab.research.google.com", code);
  const hasEgressPotential = semantic.signals.networkingCode;
  const trustBoundaryCrossings = [
    "browser->saas-control-plane",
    "saas-control-plane->managed-runtime",
    ...(hasEgressPotential ? ["managed-runtime->potential-external-egress"] : [])
  ];
  const codeHash = redactValue("source-code", code).hash;

  return {
    isColabRuntimeSocket: isRuntimeSocket,
    isKernelChannelsSocket: isKernelSocket,
    isLspSocket: isLspSocketMessage,
    messageType,
    executeRequestObserved: true,
    executeRequestHasCode: true,
    kernelResetSignal,
    notebookContentSignal,
    findings: [...findings, ...semantic.findings],
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
