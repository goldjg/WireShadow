import type { WebSocketFrameType } from "./types.js";

const MAX_WS_FRAME_PARSE_CHARS = 256 * 1024;
const MAX_WS_PARSE_DEPTH = 5;
const MAX_WS_PARSE_NODES = 80;
const MAX_NESTED_JSON_STRING_CHARS = 128 * 1024;

export type JupyterParseFailureReason =
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

export interface ExtractedJupyterFrame {
  messageType?: string;
  content?: Record<string, unknown>;
  parentHeader?: Record<string, unknown>;
  nestedOrWrapped: boolean;
  parseShape: JupyterProtocolObservation["parseShape"];
}

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

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const getString = (value: unknown, key: string): string | undefined => {
  const candidate = toRecord(value)?.[key];
  return typeof candidate === "string" ? candidate : undefined;
};

const parseJsonCandidate = (raw: string): ParseAttempt => {
  const safe = raw.trim();
  if (safe.length > MAX_WS_FRAME_PARSE_CHARS) {
    return { prefixed: false, failureReason: "frame-too-large" };
  }
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
    try {
      return { value: JSON.parse(safe.slice(firstJsonChar)), prefixed: true };
    } catch {
      return { prefixed: true, failureReason: "invalid-json" };
    }
  }
};

const asParseShape = (
  nestedOrWrapped: boolean,
  shape: Set<"array" | "nested" | "stringified" | "prefixed">
): JupyterProtocolObservation["parseShape"] => {
  if (!nestedOrWrapped && shape.size === 0) return "direct";
  if (shape.has("nested") && shape.has("array")) return "nested+array";
  if (shape.has("nested") && shape.has("stringified")) return "nested+stringified";
  if (shape.has("nested") && shape.has("prefixed")) return "nested+prefixed";
  if (shape.has("array")) return "array";
  if (shape.has("stringified")) return "stringified";
  if (shape.has("prefixed")) return "prefixed";
  if (shape.has("nested")) return "nested";
  return "none";
};

const extractJupyterFrame = (
  sample: string
): { frame?: ExtractedJupyterFrame; failureReason?: JupyterParseFailureReason } => {
  const top = parseJsonCandidate(sample);
  if (typeof top.value === "undefined") {
    return { failureReason: top.failureReason ?? "unknown" };
  }

  const queue: SearchNode[] = [{
    value: top.value,
    depth: 0,
    shape: new Set(top.prefixed ? (["prefixed"] as const) : [])
  }];
  let visited = 0;

  while (queue.length > 0 && visited < MAX_WS_PARSE_NODES) {
    const node = queue.shift();
    if (!node) break;
    visited += 1;
    if (node.depth > MAX_WS_PARSE_DEPTH) continue;

    const record = toRecord(node.value);
    if (record) {
      const messageType = getString(record.header, "msg_type") ?? getString(record, "method");
      if (messageType) {
        return {
          frame: {
            messageType,
            content: toRecord(record.content),
            parentHeader: toRecord(record.parent_header),
            nestedOrWrapped: node.depth > 0 || node.shape.size > 0,
            parseShape: asParseShape(node.depth > 0 || node.shape.size > 0, node.shape)
          }
        };
      }

      for (const value of Object.values(record)) {
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
          queue.push({ value, depth: node.depth + 1, shape: new Set([...node.shape, "nested"]) });
        }
      }
    }

    if (Array.isArray(node.value)) {
      for (const item of node.value) {
        queue.push({ value: item, depth: node.depth + 1, shape: new Set([...node.shape, "array"]) });
      }
    }
  }
  return { failureReason: "unsupported-envelope" };
};

const buildObservation = (
  sample: string,
  frameType: WebSocketFrameType | "unknown",
  extracted?: ExtractedJupyterFrame
): JupyterProtocolObservation => {
  const topParse = parseJsonCandidate(sample);
  const topRecord = toRecord(topParse.value);
  const topLevelKeys = topRecord ? Object.keys(topRecord).slice(0, 20) : [];
  const codeValue = extracted?.content?.code;
  const codeLength = typeof codeValue === "string"
    ? codeValue.length
    : typeof codeValue === "number" || typeof codeValue === "boolean"
      ? String(codeValue).length
      : 0;
  return {
    topLevelKeys,
    headerMsgType: extracted?.messageType,
    parentHeaderMsgIdPresent: typeof extracted?.parentHeader?.msg_id === "string",
    contentKeys: extracted?.content ? Object.keys(extracted.content).slice(0, 20) : [],
    contentCodeExists: Object.prototype.hasOwnProperty.call(extracted?.content ?? {}, "code"),
    codeType: typeof codeValue === "undefined" ? "undefined" : Array.isArray(codeValue) ? "array" : typeof codeValue,
    codeLength,
    frameEncoding: frameType,
    nestedOrWrapped: extracted?.nestedOrWrapped ?? false,
    parseShape: extracted?.parseShape ?? (topParse.prefixed ? "prefixed" : topLevelKeys.length > 0 ? "direct" : "none")
  };
};

export const parseJupyterFrame = (
  sample: string,
  frameType: WebSocketFrameType | "unknown" = "unknown"
): {
  frame?: ExtractedJupyterFrame;
  observation: JupyterProtocolObservation;
  failureReason?: JupyterParseFailureReason;
} => {
  const extracted = extractJupyterFrame(sample);
  return {
    frame: extracted.frame,
    observation: buildObservation(sample, frameType, extracted.frame),
    failureReason: extracted.failureReason
  };
};
