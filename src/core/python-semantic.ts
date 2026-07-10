import { classifyPayload } from "./classifier.js";
import { redactValue } from "./redaction.js";
import type { EvidenceLevel } from "./types.js";

export type AssignmentProvenanceCategory =
  | "literal-string"
  | "large-string"
  | "token-like"
  | "url"
  | "repository-identifier"
  | "file-path"
  | "embedded-data"
  | "base64-like"
  | "unknown";

export type PythonCapability =
  | "network-http"
  | "github-target"
  | "file-read"
  | "subprocess"
  | "shell-execution"
  | "cloud-storage"
  | "token-use"
  | "data-upload"
  | "outbound-write";

export type ResolutionFailureReason =
  | "definition-not-seen"
  | "symbol-not-stored"
  | "session-mismatch"
  | "parser-failed"
  | "unsupported-call-shape"
  | "symbol-redefined"
  | "state-expired"
  | "state-reset"
  | "ambiguous-symbol"
  | "unknown";

export interface CorrelatedEvidence {
  level: EvidenceLevel;
  detail: string;
}

export interface StoredVariableProvenance {
  symbol: string;
  category: AssignmentProvenanceCategory;
  length: number;
  hash: string;
  confidence: number;
  updatedAt: string;
}

export interface StoredFunctionDefinition {
  name: string;
  async: boolean;
  params: string[];
  capabilities: PythonCapability[];
  destinations: string[];
  codeLength: number;
  codeHash: string;
  confidence: number;
  executionOrder: number;
  updatedAt: string;
}

export interface InvocationArgumentProvenance {
  parameter?: string;
  source: "positional" | "keyword";
  category: AssignmentProvenanceCategory;
  hash?: string;
}

export interface InvocationCorrelation {
  observedCall: string;
  knownSymbolInvoked?: string;
  inheritedCapabilities: PythonCapability[];
  knownDestinations: string[];
  argumentProvenance: InvocationArgumentProvenance[];
  evidence: CorrelatedEvidence[];
  egressPotential: boolean;
}

export interface SemanticExecutionSummary {
  imports: string[];
  aliases: Record<string, string>;
  functionDefinitions: StoredFunctionDefinition[];
  assignments: StoredVariableProvenance[];
  calls: string[];
  invocation?: InvocationCorrelation;
  resolutionFailureReason?: ResolutionFailureReason;
  diagnostics: {
    statementKinds: string[];
    importsDetected: number;
    functionDefinitionsDetected: number;
    assignmentsDetected: number;
    callsDetected: number;
    callResolved: boolean;
    semanticStoreFunctionsBefore: number;
    semanticStoreVariablesBefore: number;
    semanticStoreFunctionsAfter: number;
    semanticStoreVariablesAfter: number;
    semanticStoreSizeBefore: number;
    semanticStoreSizeAfter: number;
    latestFunctionDefined?: string;
    latestFunctionInvoked?: string;
    latestResolutionResult: "resolved" | "failed" | "none";
    latestResolutionFailureReason?: ResolutionFailureReason;
    functionDefNodesFound: number;
    asyncFunctionDefNodesFound: number;
    latestFunctionNameHash?: string;
    latestFunctionParameterCount?: number;
    latestFunctionDecoratorCount?: number;
    latestFunctionBodyStatementCount?: number;
    latestFunctionNestedCount?: number;
    latestFunctionCapabilityCount?: number;
    latestFunctionSemanticFactEmitted?: boolean;
    functionStoreInsertionAttempted?: boolean;
    functionStoreInsertionSucceeded?: boolean;
    functionStoreInsertionFailureReason?: FunctionAnalysisFailureReason;
    latestFunctionAnalysisFailureReason?: FunctionAnalysisFailureReason;
    stateResetReason?: "state-expired" | "state-reset";
    // cumulative function pipeline counters for this single applyExecution call
    functionExtractionAttemptedCount: number;
    functionExtractionSucceededCount: number;
    functionExtractionFailedCount: number;
    functionStoreInsertionAttemptedCount: number;
    functionStoreInsertionSucceededCount: number;
    functionStoreInsertionFailedCount: number;
    functionDroppedCount: number;
  };
}

export interface SemanticSessionState {
  contextKey: string;
  lastUpdatedAt: string;
  executionOrder: number;
  imports: Set<string>;
  aliases: Map<string, string>;
  functions: Map<string, StoredFunctionDefinition>;
  variables: Map<string, StoredVariableProvenance>;
  lastMeaningfulExecution?: InvocationCorrelation;
  latestFunctionDefined?: string;
  latestFunctionInvoked?: string;
  latestResolutionResult?: "resolved" | "failed" | "none";
  latestResolutionFailureReason?: ResolutionFailureReason;
}

interface SessionStoreConfig {
  maxContexts: number;
  maxSymbolsPerContext: number;
  maxAgeMs: number;
}

const DEFAULT_CONFIG: SessionStoreConfig = {
  maxContexts: 50,
  maxSymbolsPerContext: 200,
  maxAgeMs: 30 * 60 * 1000
};

const IMPORT_RE = /^\s*import\s+([A-Za-z0-9_.,\s]+)$/;
const FROM_IMPORT_RE = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+([A-Za-z0-9_.,\s*]+)$/;
const FUNCTION_START_RE = /^\s*(async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const DECORATOR_RE = /^\s*@/;
const ASSIGNMENT_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/;
const CALL_START_RE = /^\s*([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/;
const REPOSITORY_ID_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FILE_PATH_RE = /[\\/]|\.txt$|\.csv$|\.json$|\.ipynb$/i;
const BASE64_LIKE_RE = /^(?:[A-Za-z0-9+/]{40,}={0,2})$/;
const QUOTED_RE = /^(['"])([\s\S]*)\1$/;

type FunctionAnalysisFailureReason =
  | "function-node-not-recognised"
  | "unsupported-parser-shape"
  | "function-name-missing"
  | "function-range-missing"
  | "function-body-missing"
  | "function-body-analysis-failed"
  | "function-metadata-construction-failed"
  | "function-result-not-appended"
  | "function-dropped-during-aggregation"
  | "function-fact-conversion-missing"
  | "function-fact-filtered"
  | "function-store-write-not-called"
  | "function-store-rejected"
  | "function-normalisation-failed"
  | "function-merge-failed"
  | "function-capabilities-empty"
  | "semantic-fact-not-created"
  | "symbol-store-write-failed"
  | "symbol-dropped-during-merge"
  | "session-state-unavailable"
  | "unknown";

const detectCapabilities = (value: string): PythonCapability[] => {
  const capabilities = new Set<PythonCapability>();
  if (
    /\brequests\b|\burllib\b|\burllib3\b|\bhttpx\b|\baiohttp\b|\bsocket\b|\bwebsocket-client\b/i.test(value)
  ) {
    capabilities.add("network-http");
  }
  if (/\bapi\.github\.com\b|\bgithub\.com\b|\bfrom\s+github\s+import\b|\bPyGithub\b/i.test(value)) {
    capabilities.add("github-target");
  }
  if (/\bopen\s*\(|\bread\s*\(/i.test(value)) {
    capabilities.add("file-read");
  }
  if (/\bsubprocess\b/i.test(value)) {
    capabilities.add("subprocess");
  }
  if (/\bos\.system\b|\bcurl\b|\bwget\b/i.test(value)) {
    capabilities.add("shell-execution");
  }
  if (/\bdrive\.google\.com\b|\bs3\b|\bdropbox\b|\bonedrive\b|\bblob\.core\.windows\.net\b/i.test(value)) {
    capabilities.add("cloud-storage");
  }
  if (/\btoken\b|\bauthorization\b|\bbearer\b/i.test(value)) {
    capabilities.add("token-use");
  }
  if (/\bpost\s*\(|\bput\s*\(|\bpatch\s*\(|\brequest\s*\(/i.test(value)) {
    capabilities.add("data-upload");
    capabilities.add("outbound-write");
  }
  return Array.from(capabilities);
};

const detectDestinations = (value: string): string[] => {
  const matches = value.match(/https?:\/\/[^\s'"<>]+/g) ?? [];
  return Array.from(new Set(matches.slice(0, 8).map((url) => redactValue("url", url).hash)));
};

const parseParams = (raw: string): string[] =>
  raw
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => chunk.split("=")[0]?.trim() ?? "")
    .map((chunk) => chunk.replace(/^\*+/, ""))
    .filter(Boolean);

const parseImports = (line: string): { imports: string[]; aliases: Record<string, string> } => {
  const aliases: Record<string, string> = {};
  const imports: string[] = [];

  const importMatch = line.match(IMPORT_RE);
  if (importMatch) {
    const segments = importMatch[1]?.split(",").map((part) => part.trim()) ?? [];
    for (const segment of segments) {
      const aliasParts = segment.split(/\s+as\s+/i).map((part) => part.trim());
      const moduleName = aliasParts[0];
      if (!moduleName) {
        continue;
      }
      imports.push(moduleName);
      const alias = aliasParts[1];
      if (alias) {
        aliases[alias] = moduleName;
      }
    }
    return { imports, aliases };
  }

  const fromMatch = line.match(FROM_IMPORT_RE);
  if (!fromMatch) {
    return { imports, aliases };
  }

  const moduleName = fromMatch[1]?.trim();
  const importedSymbols = fromMatch[2]?.split(",").map((part) => part.trim()) ?? [];
  if (!moduleName) {
    return { imports, aliases };
  }
  imports.push(moduleName);
  for (const symbol of importedSymbols) {
    const aliasParts = symbol.split(/\s+as\s+/i).map((part) => part.trim());
    const imported = aliasParts[0];
    if (!imported || imported === "*") {
      continue;
    }
    aliases[aliasParts[1] ?? imported] = `${moduleName}.${imported}`;
  }
  return { imports, aliases };
};

const splitArgs = (args: string): string[] => {
  const chunks: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of args) {
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      if (current.trim().length > 0) {
        chunks.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }
  return chunks;
};

const determineAssignmentCategory = (rawValue: string): AssignmentProvenanceCategory => {
  const value = rawValue.trim();
  const quoted = value.match(QUOTED_RE);
  const inner = quoted?.[2] ?? value;
  if (/^https?:\/\//i.test(inner)) {
    return "url";
  }
  if (REPOSITORY_ID_RE.test(inner)) {
    return "repository-identifier";
  }
  if (FILE_PATH_RE.test(inner)) {
    return "file-path";
  }
  if (BASE64_LIKE_RE.test(inner)) {
    return "base64-like";
  }
  const payload = classifyPayload(inner);
  if (payload.categories.includes("embedded-data")) {
    return "embedded-data";
  }
  if (
    payload.categories.includes("token-like") ||
    payload.categories.includes("bearer-token") ||
    payload.categories.includes("jwt") ||
    payload.categories.includes("api-key-like")
  ) {
    return "token-like";
  }
  if (quoted && inner.length >= 256) {
    return "large-string";
  }
  if (quoted) {
    return "literal-string";
  }
  return "unknown";
};

const describeCorrelatedEvidence = (
  invocation: InvocationCorrelation,
  correlatedFunction: StoredFunctionDefinition | undefined
): CorrelatedEvidence[] => {
  const evidence: CorrelatedEvidence[] = [{ level: "observed", detail: "Jupyter execute_request observed" }];
  if (correlatedFunction) {
    evidence.push({ level: "correlated", detail: "Function definition seen earlier in session" });
  }

  for (const provenance of invocation.argumentProvenance) {
    if (provenance.category === "embedded-data") {
      evidence.push({ level: "correlated", detail: "Embedded-data argument supplied" });
    }
    if (provenance.category === "token-like") {
      evidence.push({ level: "correlated", detail: "Token-like argument supplied" });
    }
    if (provenance.category === "repository-identifier") {
      evidence.push({ level: "correlated", detail: "Repository target argument supplied" });
    }
  }

  if (invocation.egressPotential) {
    evidence.push({
      level: "inferred",
      detail: "Managed runtime may perform external write based on correlated symbol capabilities"
    });
  }
  evidence.push({ level: "unknown", detail: "Downstream request success" });
  return evidence;
};

const extractFunctionBlock = (
  lines: string[],
  startIndex: number
): { endIndex: number; bodyText: string; rawText: string } => {
  const header = lines[startIndex] ?? "";
  const headerIndent = header.match(/^(\s*)/)?.[1]?.length ?? 0;
  const bodyLines: string[] = [];
  const rawLines: string[] = [header];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (line.trim().length > 0 && indent <= headerIndent) {
      break;
    }
    rawLines.push(line);
    bodyLines.push(line);
    index += 1;
  }

  return {
    endIndex: index - 1,
    bodyText: bodyLines.join("\n"),
    rawText: rawLines.join("\n")
  };
};

interface ParsedFunctionDefinition {
  name: string;
  async: boolean;
  params: string[];
  decoratorCount: number;
  bodyStatementCount: number;
  nestedFunctionCount: number;
  startIndex: number;
  endIndex: number;
  rawText: string;
  bodyText: string;
}

const extractSignature = (header: string): string => {
  const start = header.indexOf("(");
  if (start < 0) {
    return "";
  }
  let depth = 0;
  for (let index = start; index < header.length; index += 1) {
    const char = header[index];
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return header.slice(start + 1, index);
      }
    }
  }
  return "";
};

const countBodyStatements = (bodyText: string): number =>
  bodyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .length;

const parseFunctionDefinitionAt = (
  lines: string[],
  index: number
): { definition?: ParsedFunctionDefinition; nextIndex: number; failureReason?: FunctionAnalysisFailureReason } => {
  let cursor = index;
  let decoratorCount = 0;
  while (cursor < lines.length && DECORATOR_RE.test(lines[cursor] ?? "")) {
    decoratorCount += 1;
    cursor += 1;
  }

  const startLine = lines[cursor] ?? "";
  const startMatch = startLine.match(FUNCTION_START_RE);
  if (!startMatch) {
    return { nextIndex: index, failureReason: decoratorCount > 0 ? "unsupported-parser-shape" : undefined };
  }

  const fnName = startMatch[2]?.trim();
  if (!fnName) {
    return { nextIndex: cursor, failureReason: "function-name-missing" };
  }

  let header = startLine;
  let openParens = (header.match(/\(/g) ?? []).length;
  let closeParens = (header.match(/\)/g) ?? []).length;
  let headerEnd = cursor;
  while ((openParens > closeParens || !header.includes(":")) && headerEnd + 1 < lines.length) {
    headerEnd += 1;
    const continuation = lines[headerEnd] ?? "";
    header += `\n${continuation}`;
    openParens += (continuation.match(/\(/g) ?? []).length;
    closeParens += (continuation.match(/\)/g) ?? []).length;
  }
  if (openParens !== closeParens || !header.includes(":")) {
    return { nextIndex: headerEnd, failureReason: "unsupported-parser-shape" };
  }

  const block = extractFunctionBlock(lines, headerEnd);
  const rawText = [...lines.slice(cursor - decoratorCount, cursor), header, block.bodyText]
    .filter((value) => value.length > 0)
    .join("\n");
  const signature = extractSignature(header);
  const nestedFunctionCount = (block.bodyText.match(/^\s*(?:async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/gm) ?? [])
    .length;

  return {
    definition: {
      name: fnName,
      async: Boolean(startMatch[1]),
      params: parseParams(signature),
      decoratorCount,
      bodyStatementCount: countBodyStatements(block.bodyText),
      nestedFunctionCount,
      startIndex: cursor - decoratorCount,
      endIndex: block.endIndex,
      rawText,
      bodyText: block.bodyText
    },
    nextIndex: block.endIndex
  };
};

interface CallCollectionResult {
  calls: Array<{ callee: string; args: string[] }>;
  parserFailed: boolean;
  unsupportedCallShape: boolean;
}

const collectCalls = (lines: string[]): CallCollectionResult => {
  const calls: Array<{ callee: string; args: string[] }> = [];
  let parserFailed = false;
  let unsupportedCallShape = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const assignment = line.match(ASSIGNMENT_RE);
    const assignmentValue = assignment?.[2]?.trim() ?? "";
    const assignmentCallMatch = assignmentValue.match(CALL_START_RE);
    const startMatch = assignmentCallMatch ?? line.match(CALL_START_RE);
    if (!startMatch) {
      continue;
    }

    const statementStart =
      assignmentCallMatch && assignment
        ? line.indexOf(assignmentValue)
        : line.search(/[A-Za-z_][A-Za-z0-9_\.]*\s*\(/);
    if (statementStart < 0) {
      unsupportedCallShape = true;
      continue;
    }

    let statement = line.slice(statementStart).trim();
    let openParens = (statement.match(/\(/g) ?? []).length;
    let closeParens = (statement.match(/\)/g) ?? []).length;
    while (openParens > closeParens && index + 1 < lines.length) {
      index += 1;
      const next = lines[index] ?? "";
      statement += `\n${next.trim()}`;
      openParens += (next.match(/\(/g) ?? []).length;
      closeParens += (next.match(/\)/g) ?? []).length;
    }
    if (openParens !== closeParens) {
      parserFailed = true;
      continue;
    }

    const callee = startMatch[1] ?? "";
    const firstParen = statement.indexOf("(");
    const lastParen = statement.lastIndexOf(")");
    if (firstParen < 0 || lastParen <= firstParen) {
      unsupportedCallShape = true;
      continue;
    }
    const argsRaw = statement.slice(firstParen + 1, lastParen);
    calls.push({ callee, args: splitArgs(argsRaw) });
  }
  return { calls, parserFailed, unsupportedCallShape };
};

const toVariableEvidence = (symbol: string, rawValue: string, observedAt: string): StoredVariableProvenance => {
  const category = determineAssignmentCategory(rawValue);
  const inner = rawValue.trim().match(QUOTED_RE)?.[2] ?? rawValue.trim();
  return {
    symbol,
    category,
    length: inner.length,
    hash: redactValue("unknown", inner).hash,
    confidence: category === "unknown" ? 0.45 : 0.8,
    updatedAt: observedAt
  };
};

const resolveArgumentProvenance = (
  argument: string,
  variables: Map<string, StoredVariableProvenance>
): { category: AssignmentProvenanceCategory; hash?: string; name?: string } => {
  const trimmed = argument.trim();
  const keywordSplit = trimmed.split("=");
  const rawValue = keywordSplit.length > 1 ? keywordSplit.slice(1).join("=") : trimmed;
  const token = rawValue.trim();
  if (variables.has(token)) {
    const variable = variables.get(token);
    return {
      category: variable?.category ?? "unknown",
      hash: variable?.hash,
      name: keywordSplit.length > 1 ? keywordSplit[0]?.trim() : undefined
    };
  }
  return {
    category: determineAssignmentCategory(token),
    hash: redactValue("unknown", token).hash,
    name: keywordSplit.length > 1 ? keywordSplit[0]?.trim() : undefined
  };
};

export class PythonSemanticSessionStore {
  private readonly contexts = new Map<string, SemanticSessionState>();
  private readonly lastResetReason = new Map<string, "state-expired" | "state-reset">();

  constructor(private readonly config: SessionStoreConfig = DEFAULT_CONFIG) {}

  resetContext(contextKey: string): void {
    this.contexts.delete(contextKey);
    this.lastResetReason.set(contextKey, "state-reset");
  }

  resetTab(tabPrefix: string): void {
    for (const key of this.contexts.keys()) {
      if (key.startsWith(tabPrefix)) {
        this.contexts.delete(key);
        this.lastResetReason.set(key, "state-reset");
      }
    }
  }

  hasSymbolInSiblingContext(contextKey: string, symbol: string): boolean {
    const firstDelimiter = contextKey.indexOf("|");
    const tabPrefix = firstDelimiter >= 0 ? contextKey.slice(0, firstDelimiter + 1) : `${contextKey}|`;
    if (!tabPrefix) {
      return false;
    }
    for (const [key, context] of this.contexts.entries()) {
      if (key === contextKey || !key.startsWith(tabPrefix)) {
        continue;
      }
      if (context.functions.has(symbol)) {
        return true;
      }
    }
    return false;
  }

  private prune(now: number): void {
    for (const [key, context] of this.contexts.entries()) {
      const lastUpdated = new Date(context.lastUpdatedAt).getTime();
      if (Number.isFinite(lastUpdated) && now - lastUpdated > this.config.maxAgeMs) {
        this.contexts.delete(key);
        this.lastResetReason.set(key, "state-expired");
      }
    }

    if (this.contexts.size <= this.config.maxContexts) {
      return;
    }
    const ordered = Array.from(this.contexts.entries()).sort(
      (a, b) => new Date(a[1].lastUpdatedAt).getTime() - new Date(b[1].lastUpdatedAt).getTime()
    );
    const overflow = this.contexts.size - this.config.maxContexts;
    for (let index = 0; index < overflow; index += 1) {
      const key = ordered[index]?.[0];
      if (key) {
        this.contexts.delete(key);
        this.lastResetReason.set(key, "state-expired");
      }
    }
  }

  private getOrCreateContext(contextKey: string, observedAt: string): SemanticSessionState {
    const now = new Date(observedAt).getTime();
    this.prune(Number.isFinite(now) ? now : Date.now());

    const existing = this.contexts.get(contextKey);
    if (existing) {
      return existing;
    }
    const created: SemanticSessionState = {
      contextKey,
      lastUpdatedAt: observedAt,
      executionOrder: 0,
      imports: new Set<string>(),
      aliases: new Map<string, string>(),
      functions: new Map<string, StoredFunctionDefinition>(),
      variables: new Map<string, StoredVariableProvenance>()
    };
    this.contexts.set(contextKey, created);
    return created;
  }

  applyExecution(contextKey: string, code: string, observedAt: string): SemanticExecutionSummary {
    const context = this.getOrCreateContext(contextKey, observedAt);
    const stateResetReason = this.lastResetReason.get(contextKey);
    this.lastResetReason.delete(contextKey);
    context.executionOrder += 1;
    context.lastUpdatedAt = observedAt;

    const lines = code.split(/\r?\n/);
    const imports: string[] = [];
    const aliases: Record<string, string> = {};
    const functionDefinitions: StoredFunctionDefinition[] = [];
    const assignments: StoredVariableProvenance[] = [];
    let invocation: InvocationCorrelation | undefined;
    const semanticStoreFunctionsBefore = context.functions.size;
    const semanticStoreVariablesBefore = context.variables.size;
    const semanticStoreSizeBefore = semanticStoreFunctionsBefore + semanticStoreVariablesBefore;
    const statementKinds = new Set<string>();
    let resolutionFailureReason: ResolutionFailureReason | undefined;
    let functionDefNodesFound = 0;
    let asyncFunctionDefNodesFound = 0;
    let latestFunctionNameHash: string | undefined;
    let latestFunctionParameterCount: number | undefined;
    let latestFunctionDecoratorCount: number | undefined;
    let latestFunctionBodyStatementCount: number | undefined;
    let latestFunctionNestedCount: number | undefined;
    let latestFunctionCapabilityCount: number | undefined;
    let latestFunctionSemanticFactEmitted = false;
    let functionStoreInsertionAttempted = false;
    let functionStoreInsertionSucceeded = false;
    let functionStoreInsertionFailureReason: FunctionAnalysisFailureReason | undefined;
    let latestFunctionAnalysisFailureReason: FunctionAnalysisFailureReason | undefined;
    // cumulative per-call function pipeline counters
    let functionExtractionAttemptedCount = 0;
    let functionExtractionSucceededCount = 0;
    let functionExtractionFailedCount = 0;
    let functionStoreInsertionAttemptedCount = 0;
    let functionStoreInsertionSucceededCount = 0;
    let functionStoreInsertionFailedCount = 0;
    let functionDroppedCount = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const importResult = parseImports(line);
      if (importResult.imports.length > 0) {
        statementKinds.add("import");
        for (const moduleName of importResult.imports) {
          context.imports.add(moduleName);
          imports.push(moduleName);
        }
        for (const [alias, target] of Object.entries(importResult.aliases)) {
          context.aliases.set(alias, target);
          aliases[alias] = target;
        }
      }

      const looksLikeFunction =
        line.includes("def ") ||
        line.trimStart().startsWith("async def ") ||
        line.trimStart().startsWith("@");
      const parsedFunction = parseFunctionDefinitionAt(lines, index);
      if (parsedFunction.definition) {
        statementKinds.add("function-definition");
        const definitionModel = parsedFunction.definition;
        functionDefNodesFound += 1;
        functionExtractionAttemptedCount += 1;
        if (definitionModel.async) {
          asyncFunctionDefNodesFound += 1;
        }
        latestFunctionNameHash = redactValue("unknown", definitionModel.name).hash;
        latestFunctionParameterCount = definitionModel.params.length;
        latestFunctionDecoratorCount = definitionModel.decoratorCount;
        latestFunctionBodyStatementCount = definitionModel.bodyStatementCount;
        latestFunctionNestedCount = definitionModel.nestedFunctionCount;
        functionStoreInsertionAttempted = true;
        functionStoreInsertionAttemptedCount += 1;

        const capabilities = detectCapabilities(definitionModel.bodyText);
        const destinations = detectDestinations(definitionModel.bodyText);
        latestFunctionCapabilityCount = capabilities.length;
        // zero capabilities is not a failure — function must still be persisted
        if (capabilities.length === 0) {
          latestFunctionAnalysisFailureReason = "function-capabilities-empty";
        }
        const definition: StoredFunctionDefinition = {
          name: definitionModel.name,
          async: definitionModel.async,
          params: definitionModel.params,
          capabilities,
          destinations,
          codeLength: definitionModel.rawText.length,
          codeHash: redactValue("source-code", definitionModel.rawText).hash,
          confidence: capabilities.length > 0 ? 0.88 : 0.65,
          executionOrder: context.executionOrder,
          updatedAt: observedAt
        };
        functionExtractionSucceededCount += 1;
        context.functions.set(definitionModel.name, definition);
        const stored = context.functions.get(definitionModel.name);
        const insertionOk = stored?.codeHash === definition.codeHash;
        functionStoreInsertionSucceeded = insertionOk;
        if (insertionOk) {
          functionStoreInsertionSucceededCount += 1;
        } else {
          functionStoreInsertionFailedCount += 1;
          functionExtractionFailedCount += 1;
          functionDroppedCount += 1;
          functionStoreInsertionFailureReason = "symbol-store-write-failed";
          latestFunctionAnalysisFailureReason = "symbol-store-write-failed";
        }
        functionDefinitions.push(definition);
        context.latestFunctionDefined = definitionModel.name;
        latestFunctionSemanticFactEmitted = true;
        index = parsedFunction.nextIndex;
        continue;
      }
      if (looksLikeFunction && parsedFunction.failureReason) {
        latestFunctionAnalysisFailureReason = parsedFunction.failureReason;
        functionExtractionFailedCount += 1;
        functionDroppedCount += 1;
      }

      const assignMatch = line.match(ASSIGNMENT_RE);
      if (assignMatch) {
        statementKinds.add("assignment");
        const symbol = assignMatch[1] ?? "";
        const value = assignMatch[2] ?? "";
        const evidence = toVariableEvidence(symbol, value, observedAt);
        context.variables.set(symbol, evidence);
        assignments.push(evidence);
      }
    }

    const callCollection = collectCalls(lines);
    const calls = callCollection.calls;
    if (calls.length > 0) {
      statementKinds.add("call");
    } else if (callCollection.parserFailed) {
      resolutionFailureReason = "parser-failed";
    } else if (callCollection.unsupportedCallShape) {
      resolutionFailureReason = "unsupported-call-shape";
    }

    for (const call of calls) {
      const calleeParts = call.callee.split(".");
      const calleeSimple = calleeParts[calleeParts.length - 1] ?? call.callee;
      const functionDefinition = context.functions.get(calleeSimple);
      if (!functionDefinition) {
        resolutionFailureReason = "definition-not-seen";
        continue;
      }
      const argumentProvenance = call.args.map((argument, index) => {
        const resolved = resolveArgumentProvenance(argument, context.variables);
        return {
          parameter: functionDefinition.params[index] ?? resolved.name,
          source: argument.includes("=") ? ("keyword" as const) : ("positional" as const),
          category: resolved.category,
          hash: resolved.hash
        };
      });
      const egressPotential = functionDefinition.capabilities.some((capability) =>
        ["network-http", "data-upload", "outbound-write", "github-target", "cloud-storage"].includes(capability)
      );
      invocation = {
        observedCall: call.callee,
        knownSymbolInvoked: functionDefinition.name,
        inheritedCapabilities: functionDefinition.capabilities,
        knownDestinations: functionDefinition.destinations,
        argumentProvenance,
        evidence: [],
        egressPotential
      };
      invocation.evidence = describeCorrelatedEvidence(invocation, functionDefinition);
      context.lastMeaningfulExecution = invocation;
      context.latestFunctionInvoked = functionDefinition.name;
      context.latestResolutionResult = "resolved";
      context.latestResolutionFailureReason = undefined;
      break;
    }

    if (!invocation && calls.length > 0 && !resolutionFailureReason) {
      resolutionFailureReason = "symbol-not-stored";
    }
    if (!invocation && resolutionFailureReason) {
      context.latestResolutionResult = "failed";
      context.latestResolutionFailureReason = resolutionFailureReason;
    } else if (calls.length === 0) {
      context.latestResolutionResult = "none";
      context.latestResolutionFailureReason = undefined;
    }

    if (context.functions.size > this.config.maxSymbolsPerContext) {
      const ordered = Array.from(context.functions.values()).sort((a, b) => a.executionOrder - b.executionOrder);
      const overflow = context.functions.size - this.config.maxSymbolsPerContext;
      for (let index = 0; index < overflow; index += 1) {
        const candidate = ordered[index]?.name;
        if (candidate) {
          context.functions.delete(candidate);
        }
      }
    }

    if (context.variables.size > this.config.maxSymbolsPerContext) {
      const ordered = Array.from(context.variables.values()).sort(
        (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      );
      const overflow = context.variables.size - this.config.maxSymbolsPerContext;
      for (let index = 0; index < overflow; index += 1) {
        const candidate = ordered[index]?.symbol;
        if (candidate) {
          context.variables.delete(candidate);
        }
      }
    }

    const semanticStoreFunctionsAfter = context.functions.size;
    const semanticStoreVariablesAfter = context.variables.size;
    const semanticStoreSizeAfter = semanticStoreFunctionsAfter + semanticStoreVariablesAfter;

    return {
      imports,
      aliases,
      functionDefinitions,
      assignments,
      calls: calls.map((call) => call.callee),
      invocation,
      resolutionFailureReason,
      diagnostics: {
        statementKinds: Array.from(statementKinds),
        importsDetected: imports.length,
        functionDefinitionsDetected: functionDefinitions.length,
        assignmentsDetected: assignments.length,
        callsDetected: calls.length,
        callResolved: Boolean(invocation),
        semanticStoreFunctionsBefore,
        semanticStoreVariablesBefore,
        semanticStoreFunctionsAfter,
        semanticStoreVariablesAfter,
        semanticStoreSizeBefore,
        semanticStoreSizeAfter,
        latestFunctionDefined: context.latestFunctionDefined,
        latestFunctionInvoked: context.latestFunctionInvoked,
        latestResolutionResult: context.latestResolutionResult ?? "none",
        latestResolutionFailureReason: context.latestResolutionFailureReason,
        functionDefNodesFound,
        asyncFunctionDefNodesFound,
        latestFunctionNameHash,
        latestFunctionParameterCount,
        latestFunctionDecoratorCount,
        latestFunctionBodyStatementCount,
        latestFunctionNestedCount,
        latestFunctionCapabilityCount,
        latestFunctionSemanticFactEmitted,
        functionStoreInsertionAttempted,
        functionStoreInsertionSucceeded,
        functionStoreInsertionFailureReason,
        latestFunctionAnalysisFailureReason,
        stateResetReason,
        functionExtractionAttemptedCount,
        functionExtractionSucceededCount,
        functionExtractionFailedCount,
        functionStoreInsertionAttemptedCount,
        functionStoreInsertionSucceededCount,
        functionStoreInsertionFailedCount,
        functionDroppedCount
      }
    };
  }
}
