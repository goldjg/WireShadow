// src/core/redaction.ts
var MAX_EVIDENCE_LEN = 24;
var SENSITIVE_CATEGORIES = /* @__PURE__ */ new Set([
  "jwt",
  "bearer-token",
  "api-key-like",
  "token-like",
  "email",
  "uuid",
  "ip-address"
]);
var normalizeEvidence = (value) => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_EVIDENCE_LEN) {
    return compact;
  }
  return `${compact.slice(0, 12)}\u2026${compact.slice(-8)}`;
};
var toUtf8 = (value) => new TextEncoder().encode(value);
var rightRotate = (value, amount) => value >>> amount | value << 32 - amount;
var sha256Hex = (value) => {
  const bytes = toUtf8(value);
  const bitLength = bytes.length * 8;
  const withPaddingLength = (bytes.length + 9 + 63 >> 6 << 6) - bytes.length;
  const padded = new Uint8Array(bytes.length + withPaddingLength);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32), false);
  const K = [
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ];
  const H = [
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = (w[i - 16] + s0 | 0) + (w[i - 7] + s1 | 0) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = h + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
    H[5] = H[5] + f >>> 0;
    H[6] = H[6] + g >>> 0;
    H[7] = H[7] + h >>> 0;
  }
  return H.map((part) => part.toString(16).padStart(8, "0")).join("");
};
var safeEvidence = (category, value) => {
  if (!SENSITIVE_CATEGORIES.has(category)) {
    return normalizeEvidence(value);
  }
  return `[redacted:${category}]`;
};
var redactValue = (category, rawValue) => ({
  category,
  length: rawValue.length,
  hash: sha256Hex(rawValue),
  evidence: safeEvidence(category, rawValue)
});
var redactMany = (category, values) => values.map((value) => redactValue(category, value));

// src/core/classifier.ts
var EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
var JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8,}\b/g;
var BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
var UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
var URL_RE = /\bhttps?:\/\/[^\s'"<>]+/gi;
var IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
var API_KEY_LIKE_RE = /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{24,}|AIza[0-9A-Za-z\-_]{20,})\b/g;
var TOKEN_LIKE_RE = /\b[A-Za-z0-9_\-]{24,}\b/g;
var BASE64_RE = /\b(?:[A-Za-z0-9+/]{40,}={0,2})\b/g;
var EMBEDDED_DATA_RE = /\bdata:[^;]+;base64,[A-Za-z0-9+/=]{16,}\b/gi;
var SOURCE_CODE_RE = /\b(function|const|class|import|def|return|await)\b/;
var PY_NETWORK_RE = /\b(requests\.|urllib\.|httpx\.)/i;
var URLLIB3_RE = /\burllib3\b/i;
var AIOHTTP_RE = /\baiohttp\b/i;
var SOCKET_RE = /\bsocket\b/i;
var WEBSOCKET_CLIENT_RE = /\bwebsocket-client\b/i;
var REQUESTS_POST_RE = /\brequests\.post\s*\(/i;
var REQUESTS_GET_RE = /\brequests\.get\s*\(/i;
var URLLIB_RE = /\burllib(?:\.request|\.parse)?\b/i;
var HTTPX_RE = /\bhttpx\.(?:get|post|put|delete|patch|request)\b/i;
var SUBPROCESS_RE = /\bsubprocess\b/i;
var OS_SYSTEM_RE = /\bos\.system\s*\(/i;
var CURL_RE = /\bcurl(?:\s+-X\s+(?:GET|POST|PUT|PATCH|DELETE))?\b/i;
var WGET_RE = /\bwget\b/i;
var GITHUB_API_RE = /\bhttps?:\/\/api\.github\.com\b/i;
var GIST_API_RE = /\bhttps?:\/\/api\.github\.com\/gists\b|\bgist\.github\.com\b/i;
var PYGITHUB_RE = /\bPyGithub\b/i;
var CLOUD_STORAGE_RE = /\b(?:drive\.google\.com|google drive|dropbox|onedrive|s3(?:\.amazonaws\.com)?|blob\.core\.windows\.net|azure\.blob)\b/i;
var HTTP_METHOD_RE = /\b(?:GET|POST|PUT|PATCH|DELETE)\b/;
var NOTEBOOK_METADATA_RE = /\b(?:metadata|kernelspec|language_info|google\.colab)\b/i;
var TRANSPORT_METADATA_KEY_RE = /\b(?:runtime|session|kernel|notebook|proxy|transport|channel)[_-]?(?:id|token|host|name)?\b/i;
var COLAB_RUNTIME_HOST_RE = /\.prod\.colab\.dev$/i;
var extractMatches = (input, pattern) => Array.from(input.matchAll(pattern)).map((m) => m[0]);
var looksLikeRuntimeTransportMetadata = (token, input) => {
  if (UUID_RE.test(token)) {
    UUID_RE.lastIndex = 0;
    return true;
  }
  UUID_RE.lastIndex = 0;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenContextRe = new RegExp(
    `(?:${TRANSPORT_METADATA_KEY_RE.source})\\s*[:=]\\s*["']?${escaped}["']?`,
    "i"
  );
  if (tokenContextRe.test(input)) {
    return true;
  }
  const hostContextRe = new RegExp(`https?:\\/\\/[^\\s"'<>]*${escaped}[^\\s"'<>]*`, "i");
  const hostMatch = input.match(hostContextRe)?.[0];
  if (hostMatch) {
    try {
      const parsed = new URL(hostMatch);
      if (COLAB_RUNTIME_HOST_RE.test(parsed.host)) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
};
var addEvidence = (categories, evidence, category, values, cap = 3) => {
  if (values.length === 0) {
    return;
  }
  categories.push(category);
  evidence.push(...redactMany(category, values.slice(0, cap)));
};
var classifyUrl = (value) => {
  let host = value;
  try {
    host = new URL(value).host;
  } catch {
    host = value;
  }
  return redactValue("url", host);
};
var hasPythonNetworking = (value) => PY_NETWORK_RE.test(value) || URLLIB3_RE.test(value) || AIOHTTP_RE.test(value) || SOCKET_RE.test(value) || WEBSOCKET_CLIENT_RE.test(value);
var classifyPayload = (input) => {
  const categories = [];
  const evidence = [];
  addEvidence(categories, evidence, "email", extractMatches(input, EMAIL_RE));
  addEvidence(categories, evidence, "jwt", extractMatches(input, JWT_RE));
  addEvidence(categories, evidence, "bearer-token", extractMatches(input, BEARER_RE), 2);
  addEvidence(categories, evidence, "uuid", extractMatches(input, UUID_RE));
  addEvidence(categories, evidence, "url", extractMatches(input, URL_RE), 2);
  addEvidence(categories, evidence, "ip-address", extractMatches(input, IPV4_RE), 2);
  addEvidence(categories, evidence, "api-key-like", extractMatches(input, API_KEY_LIKE_RE));
  const tokens = extractMatches(input, TOKEN_LIKE_RE).filter(
    (token) => token.length >= 32 && !looksLikeRuntimeTransportMetadata(token, input)
  );
  addEvidence(categories, evidence, "token-like", tokens);
  addEvidence(categories, evidence, "base64-blob", extractMatches(input, BASE64_RE), 2);
  addEvidence(categories, evidence, "embedded-data", extractMatches(input, EMBEDDED_DATA_RE), 2);
  if (SOURCE_CODE_RE.test(input)) {
    categories.push("source-code");
    evidence.push(redactValue("source-code", input.slice(0, 120)));
  }
  if (hasPythonNetworking(input) || REQUESTS_POST_RE.test(input) || REQUESTS_GET_RE.test(input)) {
    categories.push("python-networking");
    evidence.push(redactValue("python-networking", input.slice(0, 180)));
  }
  if (GITHUB_API_RE.test(input)) {
    categories.push("github-api");
    evidence.push(redactValue("github-api", "api.github.com"));
  }
  if (GIST_API_RE.test(input)) {
    categories.push("gist-api");
    evidence.push(redactValue("gist-api", "gist-api"));
  }
  if (REQUESTS_POST_RE.test(input)) {
    categories.push("requests-post");
    evidence.push(redactValue("requests-post", "requests.post"));
  }
  if (REQUESTS_GET_RE.test(input)) {
    categories.push("requests-get");
    evidence.push(redactValue("requests-get", "requests.get"));
  }
  if (URLLIB_RE.test(input)) {
    categories.push("urllib");
    evidence.push(redactValue("urllib", "urllib"));
  }
  if (HTTPX_RE.test(input)) {
    categories.push("httpx");
    evidence.push(redactValue("httpx", "httpx"));
  }
  if (URLLIB3_RE.test(input)) {
    categories.push("urllib3");
    evidence.push(redactValue("urllib3", "urllib3"));
  }
  if (AIOHTTP_RE.test(input)) {
    categories.push("aiohttp");
    evidence.push(redactValue("aiohttp", "aiohttp"));
  }
  if (SOCKET_RE.test(input)) {
    categories.push("socket");
    evidence.push(redactValue("socket", "socket"));
  }
  if (WEBSOCKET_CLIENT_RE.test(input)) {
    categories.push("websocket-client");
    evidence.push(redactValue("websocket-client", "websocket-client"));
  }
  if (SUBPROCESS_RE.test(input)) {
    categories.push("subprocess");
    evidence.push(redactValue("subprocess", "subprocess"));
  }
  if (OS_SYSTEM_RE.test(input)) {
    categories.push("os-system");
    evidence.push(redactValue("os-system", "os.system"));
  }
  if (CURL_RE.test(input)) {
    categories.push("curl");
    evidence.push(redactValue("curl", "curl"));
  }
  if (WGET_RE.test(input)) {
    categories.push("wget");
    evidence.push(redactValue("wget", "wget"));
  }
  if (categories.length === 0) {
    categories.push("unknown");
    evidence.push(redactValue("unknown", input.slice(0, 40)));
  }
  if (PYGITHUB_RE.test(input)) {
    categories.push("pygithub");
    evidence.push(redactValue("pygithub", "PyGithub"));
  }
  if (CLOUD_STORAGE_RE.test(input)) {
    categories.push("cloud-storage-api");
    evidence.push(redactValue("cloud-storage-api", "cloud-storage"));
  }
  if (HTTP_METHOD_RE.test(input)) {
    categories.push("http-method-intent");
    evidence.push(redactValue("http-method-intent", "HTTP method marker"));
  }
  if (NOTEBOOK_METADATA_RE.test(input)) {
    categories.push("notebook-metadata");
    evidence.push(redactValue("notebook-metadata", "notebook metadata"));
  }
  return {
    categories: Array.from(new Set(categories)),
    evidence,
    confidence: Math.min(1, 0.25 + categories.length * 0.12)
  };
};

// src/core/events.ts
var buildObservedEvent = ({
  id,
  eventSource = "page-world",
  api,
  destination,
  context,
  observedAt = (/* @__PURE__ */ new Date()).toISOString(),
  requestMethod,
  payloadByteLength,
  initiatorLocation,
  payloadSample = "",
  metadata = {},
  findings = [],
  riskFlags = [],
  trustBoundaryEvents = [],
  delegatedExecutionEvent,
  evidenceSummary,
  timeline = [],
  riskScore,
  detectedCapabilities = [],
  trustBoundaryCrossings = [],
  causes = []
}) => {
  const payload = classifyPayload(payloadSample);
  const destinationEvidence = classifyUrl(destination.url);
  return {
    id,
    observedAt,
    eventSource,
    api,
    destination,
    context,
    method: requestMethod,
    metadata: {
      ...metadata,
      ...typeof payloadByteLength === "number" ? { requestBodyLength: payloadByteLength } : {},
      ...initiatorLocation ? { initiatorHash: classifyUrl(initiatorLocation).hash } : {},
      destinationHash: destinationEvidence.hash
    },
    classification: payload,
    riskFlags: Array.from(new Set(riskFlags)),
    recogniserFindings: findings,
    trustBoundaryEvents,
    delegatedExecutionEvent,
    evidenceSummary,
    timeline,
    riskScore,
    detectedCapabilities: Array.from(new Set(detectedCapabilities)),
    trustBoundaryCrossings: Array.from(new Set(trustBoundaryCrossings)),
    causalRefs: causes.map((eventId) => ({
      eventId,
      relation: "preceded-by"
    }))
  };
};

// src/core/python-semantic.ts
var DEFAULT_CONFIG = {
  maxContexts: 50,
  maxSymbolsPerContext: 200,
  maxAgeMs: 30 * 60 * 1e3
};
var IMPORT_RE = /^\s*import\s+([A-Za-z0-9_.,\s]+)$/;
var FROM_IMPORT_RE = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+([A-Za-z0-9_.,\s*]+)$/;
var FUNCTION_START_RE = /^\s*(async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
var DECORATOR_RE = /^\s*@/;
var ASSIGNMENT_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/;
var CALL_START_RE = /^\s*([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/;
var REPOSITORY_ID_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
var FILE_PATH_RE = /[\\/]|\.txt$|\.csv$|\.json$|\.ipynb$/i;
var BASE64_LIKE_RE = /^(?:[A-Za-z0-9+/]{40,}={0,2})$/;
var QUOTED_RE = /^(['"])([\s\S]*)\1$/;
var detectCapabilities = (value) => {
  const capabilities = /* @__PURE__ */ new Set();
  if (/\brequests\b|\burllib\b|\burllib3\b|\bhttpx\b|\baiohttp\b|\bsocket\b|\bwebsocket-client\b/i.test(value)) {
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
  if (/\b(create_file|update_file|create_issue|create_pull|create_release|create_comment|upload_file|upload_blob|push)\s*\(/i.test(
    value
  )) {
    capabilities.add("github-target");
    capabilities.add("data-upload");
    capabilities.add("outbound-write");
  }
  return Array.from(capabilities);
};
var detectDestinations = (value) => {
  const matches = value.match(/https?:\/\/[^\s'"<>]+/g) ?? [];
  return Array.from(new Set(matches.slice(0, 8).map((url) => redactValue("url", url).hash)));
};
var parseParams = (raw) => raw.split(",").map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => chunk.split("=")[0]?.trim() ?? "").map((chunk) => chunk.replace(/^\*+/, "")).filter(Boolean);
var parseImports = (line) => {
  const aliases = {};
  const imports = [];
  const importMatch = line.match(IMPORT_RE);
  if (importMatch) {
    const segments = importMatch[1]?.split(",").map((part) => part.trim()) ?? [];
    for (const segment of segments) {
      const aliasParts = segment.split(/\s+as\s+/i).map((part) => part.trim());
      const moduleName2 = aliasParts[0];
      if (!moduleName2) {
        continue;
      }
      imports.push(moduleName2);
      const alias = aliasParts[1];
      if (alias) {
        aliases[alias] = moduleName2;
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
var splitArgs = (args) => {
  const chunks = [];
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
var determineAssignmentCategory = (rawValue) => {
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
  if (payload.categories.includes("token-like") || payload.categories.includes("bearer-token") || payload.categories.includes("jwt") || payload.categories.includes("api-key-like")) {
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
var describeCorrelatedEvidence = (invocation, correlatedFunction) => {
  const evidence = [{ level: "observed", detail: "Jupyter execute_request observed" }];
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
var extractFunctionBlock = (lines, startIndex) => {
  const header = lines[startIndex] ?? "";
  const headerIndent = header.match(/^(\s*)/)?.[1]?.length ?? 0;
  const bodyLines = [];
  const rawLines = [header];
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
var extractSignature = (header) => {
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
var countBodyStatements = (bodyText) => bodyText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#")).length;
var parseFunctionDefinitionAt = (lines, index) => {
  let cursor = index;
  let decoratorCount = 0;
  while (cursor < lines.length && DECORATOR_RE.test(lines[cursor] ?? "")) {
    decoratorCount += 1;
    cursor += 1;
  }
  const startLine = lines[cursor] ?? "";
  const startMatch = startLine.match(FUNCTION_START_RE);
  if (!startMatch) {
    return { nextIndex: index, failureReason: decoratorCount > 0 ? "unsupported-parser-shape" : void 0 };
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
    header += `
${continuation}`;
    openParens += (continuation.match(/\(/g) ?? []).length;
    closeParens += (continuation.match(/\)/g) ?? []).length;
  }
  if (openParens !== closeParens || !header.includes(":")) {
    return { nextIndex: headerEnd, failureReason: "unsupported-parser-shape" };
  }
  const block = extractFunctionBlock(lines, headerEnd);
  const rawText = [...lines.slice(cursor - decoratorCount, cursor), header, block.bodyText].filter((value) => value.length > 0).join("\n");
  const signature = extractSignature(header);
  const nestedFunctionCount = (block.bodyText.match(/^\s*(?:async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/gm) ?? []).length;
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
var collectCalls = (lines) => {
  const calls = [];
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
    const statementStart = assignmentCallMatch && assignment ? line.indexOf(assignmentValue) : line.search(/[A-Za-z_][A-Za-z0-9_\.]*\s*\(/);
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
      statement += `
${next.trim()}`;
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
var toVariableEvidence = (symbol, rawValue, observedAt) => {
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
var resolveArgumentProvenance = (argument, variables) => {
  const trimmed = argument.trim();
  const keywordSplit = trimmed.split("=");
  const rawValue = keywordSplit.length > 1 ? keywordSplit.slice(1).join("=") : trimmed;
  const token = rawValue.trim();
  if (variables.has(token)) {
    const variable = variables.get(token);
    return {
      category: variable?.category ?? "unknown",
      hash: variable?.hash,
      name: keywordSplit.length > 1 ? keywordSplit[0]?.trim() : void 0
    };
  }
  return {
    category: determineAssignmentCategory(token),
    hash: redactValue("unknown", token).hash,
    name: keywordSplit.length > 1 ? keywordSplit[0]?.trim() : void 0
  };
};
var buildDirectCallInvocation = (call, variables) => {
  const callExpression = `${call.callee}(${call.args.join(", ")})`;
  const inferredCapabilities = detectCapabilities(callExpression);
  if (inferredCapabilities.length === 0) {
    return void 0;
  }
  const argumentProvenance = call.args.map((argument) => {
    const resolved = resolveArgumentProvenance(argument, variables);
    return {
      parameter: resolved.name,
      source: argument.includes("=") ? "keyword" : "positional",
      category: resolved.category,
      hash: resolved.hash
    };
  });
  const egressPotential = inferredCapabilities.some(
    (capability) => ["network-http", "data-upload", "outbound-write", "github-target", "cloud-storage"].includes(capability)
  );
  if (!egressPotential) {
    return void 0;
  }
  return {
    observedCall: call.callee,
    inheritedCapabilities: inferredCapabilities,
    knownDestinations: detectDestinations(callExpression),
    argumentProvenance,
    evidence: [
      { level: "observed", detail: "Jupyter execute_request observed" },
      {
        level: "inferred",
        detail: "Direct outbound-capable call pattern detected without prior user-defined symbol definition"
      },
      { level: "unknown", detail: "Downstream request success" }
    ],
    egressPotential
  };
};
var PythonSemanticSessionStore = class {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
  }
  config;
  contexts = /* @__PURE__ */ new Map();
  lastResetReason = /* @__PURE__ */ new Map();
  resetContext(contextKey) {
    this.contexts.delete(contextKey);
    this.lastResetReason.set(contextKey, "state-reset");
  }
  resetTab(tabPrefix) {
    for (const key of this.contexts.keys()) {
      if (key.startsWith(tabPrefix)) {
        this.contexts.delete(key);
        this.lastResetReason.set(key, "state-reset");
      }
    }
  }
  hasSymbolInSiblingContext(contextKey, symbol) {
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
  prune(now) {
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
  getOrCreateContext(contextKey, observedAt) {
    const now = new Date(observedAt).getTime();
    this.prune(Number.isFinite(now) ? now : Date.now());
    const existing = this.contexts.get(contextKey);
    if (existing) {
      return existing;
    }
    const created = {
      contextKey,
      lastUpdatedAt: observedAt,
      executionOrder: 0,
      imports: /* @__PURE__ */ new Set(),
      aliases: /* @__PURE__ */ new Map(),
      functions: /* @__PURE__ */ new Map(),
      variables: /* @__PURE__ */ new Map()
    };
    this.contexts.set(contextKey, created);
    return created;
  }
  applyExecution(contextKey, code, observedAt) {
    const context = this.getOrCreateContext(contextKey, observedAt);
    const stateResetReason = this.lastResetReason.get(contextKey);
    this.lastResetReason.delete(contextKey);
    context.executionOrder += 1;
    context.lastUpdatedAt = observedAt;
    const lines = code.split(/\r?\n/);
    const imports = [];
    const aliases = {};
    const functionDefinitions = [];
    const assignments = [];
    let invocation;
    const semanticStoreFunctionsBefore = context.functions.size;
    const semanticStoreVariablesBefore = context.variables.size;
    const semanticStoreSizeBefore = semanticStoreFunctionsBefore + semanticStoreVariablesBefore;
    const statementKinds = /* @__PURE__ */ new Set();
    let resolutionFailureReason;
    let functionDefNodesFound = 0;
    let asyncFunctionDefNodesFound = 0;
    let latestFunctionNameHash;
    let latestFunctionParameterCount;
    let latestFunctionDecoratorCount;
    let latestFunctionBodyStatementCount;
    let latestFunctionNestedCount;
    let latestFunctionCapabilityCount;
    let latestFunctionSemanticFactEmitted = false;
    let functionStoreInsertionAttempted = false;
    let functionStoreInsertionSucceeded = false;
    let functionStoreInsertionFailureReason;
    let latestFunctionAnalysisFailureReason;
    let latestAttemptedFunction;
    let latestResolvedFunction;
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
      const looksLikeFunction = line.includes("def ") || line.trimStart().startsWith("async def ") || line.trimStart().startsWith("@");
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
        if (capabilities.length === 0) {
          latestFunctionAnalysisFailureReason = "function-capabilities-empty";
        }
        const definition = {
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
      if (!latestAttemptedFunction) {
        latestAttemptedFunction = calleeSimple;
      }
      const functionDefinition = context.functions.get(calleeSimple);
      if (!functionDefinition) {
        const directInvocation = buildDirectCallInvocation(call, context.variables);
        if (directInvocation) {
          invocation = directInvocation;
          context.lastMeaningfulExecution = invocation;
          context.latestFunctionInvoked = void 0;
          latestResolvedFunction = void 0;
          resolutionFailureReason = "definition-not-seen";
          context.latestResolutionResult = "failed";
          context.latestResolutionFailureReason = resolutionFailureReason;
          break;
        }
        resolutionFailureReason = "definition-not-seen";
        continue;
      }
      const argumentProvenance = call.args.map((argument, index) => {
        const resolved = resolveArgumentProvenance(argument, context.variables);
        return {
          parameter: functionDefinition.params[index] ?? resolved.name,
          source: argument.includes("=") ? "keyword" : "positional",
          category: resolved.category,
          hash: resolved.hash
        };
      });
      const egressPotential = functionDefinition.capabilities.some(
        (capability) => ["network-http", "data-upload", "outbound-write", "github-target", "cloud-storage"].includes(capability)
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
      latestResolvedFunction = functionDefinition.name;
      context.latestResolutionResult = "resolved";
      context.latestResolutionFailureReason = void 0;
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
      context.latestResolutionFailureReason = void 0;
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
        executionSequenceId: context.executionOrder,
        latestAttemptedFunction,
        latestResolvedFunction,
        storedFunctionNames: Array.from(context.functions.keys()),
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
};

// src/core/semantic.ts
var hasEgressPotential = (inputs) => inputs.networkingCode || inputs.githubOutbound || inputs.knownOutboundSymbolInvoked === true || inputs.writeCapableHttpBehavior === true || inputs.knownExternalDestination === true || inputs.shellOrSubprocessCapability === true;
var BASE_FACTORS = [
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
var computeDelegatedRiskScore = (inputs) => {
  const factors = BASE_FACTORS.map((factor) => ({
    ...factor,
    detected: factor.id === "notebook-edited" && inputs.notebookEdited || factor.id === "networking-code" && inputs.networkingCode || factor.id === "embedded-data" && inputs.embeddedData || factor.id === "bearer-token-pattern" && inputs.bearerTokenPattern || factor.id === "github-outbound" && inputs.githubOutbound || factor.id === "notebook-executed" && inputs.notebookExecuted || factor.id === "known-symbol-invoked" && inputs.knownOutboundSymbolInvoked === true || factor.id === "write-capable-http" && inputs.writeCapableHttpBehavior === true || factor.id === "known-external-destination" && inputs.knownExternalDestination === true || factor.id === "token-like-argument" && inputs.tokenLikeArgument === true || factor.id === "file-content-argument" && inputs.fileContentArgument === true || factor.id === "shell-or-subprocess" && inputs.shellOrSubprocessCapability === true
  }));
  return {
    total: factors.reduce((sum, factor) => sum + (factor.detected ? factor.score : 0), 0),
    factors
  };
};
var buildTrustBoundaryTimeline = (inputs) => {
  const timeline = [];
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
var buildDelegatedExecutionEvent = (trigger, confidence, inputs, options) => ({
  executionPlatform: "google-colab",
  confidence,
  trigger,
  executionLanguage: "python",
  outboundCapabilityDetected: hasEgressPotential(inputs),
  embeddedDataDetected: inputs.embeddedData,
  trustBoundaryCrossed: inputs.notebookExecuted || hasEgressPotential(inputs),
  downstreamActivityObserved: "unknown",
  knownSymbolInvoked: options?.knownSymbolInvoked,
  inheritedCapabilities: options?.inheritedCapabilities
});

// src/recognisers/colab.ts
var COLAB_HOST_RE = /^https?:\/\/colab\.research\.google\.com/i;
var NOTEBOOK_DOCUMENT_RE = /(\.ipynb|google\.colab|notebook|cell_type|kernelspec)/i;
var NOTEBOOK_EDIT_RE = /(cell[_\s-]?edit|saveNotebook|insertCell|set_text|source"\s*:)/i;
var NOTEBOOK_EXECUTION_RE = /(run all|execute(cell| code)?|kernel\.invokeFunction|runCell)/i;
var PYTHON_CELL_RE = /(cell_type"\s*:\s*"code"|%%python|^\s*import\s+\w+)/im;
var MARKDOWN_CELL_RE = /(cell_type"\s*:\s*"markdown"|text\/markdown|^\s*#\s+\w+)/im;
var NOTEBOOK_METADATA_RE2 = /(metadata"\s*:|kernelspec|language_info|colab"\s*:)/i;
var NETWORKING_PATTERNS = [
  [/\brequests\b/i, "requests"],
  [/\burllib\b/i, "urllib"],
  [/\burllib3\b/i, "urllib3"],
  [/\bhttpx\b/i, "httpx"],
  [/\baiohttp\b/i, "aiohttp"],
  [/\bsocket\b/i, "socket"],
  [/\bwebsocket-client\b/i, "websocket-client"]
];
var EXTERNAL_EXECUTION_PATTERNS = [
  [/\bsubprocess\b/i, "subprocess"],
  [/\bos\.system\b/i, "os.system"],
  [/\bcurl\b/i, "curl"],
  [/\bwget\b/i, "wget"]
];
var GITHUB_PATTERNS = [
  [/\bgithub\.com\b/i, "github.com"],
  [/\bapi\.github\.com\b/i, "api.github.com"],
  [/\bgist\.github\.com\b/i, "gist.github.com"],
  [/\bPyGithub\b/i, "PyGithub"]
];
var CLOUD_STORAGE_PATTERNS = [
  [/\bgoogleapiclient\.discovery\b|\bdrive\.google\.com\b|\bgoogle drive\b/i, "google-drive"],
  [/\bdropbox\b/i, "dropbox"],
  [/\bonedrive\b/i, "onedrive"],
  [/\bs3(?:\.amazonaws\.com)?\b/i, "s3"],
  [/\bazure\.blob\b|\bblob\.core\.windows\.net\b/i, "azure-blob"]
];
var HTTP_METHOD_INTENT_RE = /\b(GET|POST|PUT|PATCH|DELETE)\b/;
var BEARER_TOKEN_HINT_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i;
var MAX_WS_FRAME_PARSE_CHARS = 256 * 1024;
var MAX_AST_CODE_CHARS = 128 * 1024;
var MAX_WS_PARSE_DEPTH = 5;
var MAX_WS_PARSE_NODES = 80;
var MAX_NESTED_JSON_STRING_CHARS = 128 * 1024;
var collectCapabilities = (content) => {
  const hits = [];
  const addHits = (patterns) => {
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
var finding = (title, description, confidence, tags) => ({
  recogniserId: "colab",
  title,
  description,
  severity: confidence >= 0.8 ? "high" : confidence >= 0.65 ? "medium" : "low",
  confidence,
  tags
});
var isColabUrl = (url) => COLAB_HOST_RE.test(url);
var KERNEL_CHANNELS_PATH_RE = /\/api\/kernels\/[^/]+\/channels/i;
var LSP_PATH_RE = /\/colab\/lsp/i;
var isColabRuntimeSocketUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "wss:" && /\.prod\.colab\.dev$/i.test(parsed.host);
  } catch {
    return false;
  }
};
var isKernelChannelsSocketUrl = (url) => {
  try {
    const parsed = new URL(url);
    return isColabRuntimeSocketUrl(url) && KERNEL_CHANNELS_PATH_RE.test(parsed.pathname);
  } catch {
    return false;
  }
};
var isLspSocketUrl = (url) => {
  try {
    const parsed = new URL(url);
    return isColabRuntimeSocketUrl(url) && LSP_PATH_RE.test(parsed.pathname);
  } catch {
    return false;
  }
};
var toRecord = (value) => typeof value === "object" && value !== null ? value : void 0;
var getString = (value, key) => {
  const record = toRecord(value);
  const candidate = record?.[key];
  return typeof candidate === "string" ? candidate : void 0;
};
var parseJsonCandidate = (raw) => {
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
var asParseShape = (nestedOrWrapped, shape) => {
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
var extractJupyterFrame = (sample) => {
  const top = parseJsonCandidate(sample);
  if (typeof top.value === "undefined") {
    return {
      failureReason: top.failureReason === "frame-too-large" ? "frame-too-large" : top.failureReason === "invalid-json" ? "invalid-json" : "unknown"
    };
  }
  const queue = [
    {
      value: top.value,
      depth: 0,
      shape: new Set(top.prefixed ? ["prefixed"] : [])
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
              shape: /* @__PURE__ */ new Set([
                ...node.shape,
                "nested",
                "stringified",
                ...nested.prefixed ? ["prefixed"] : []
              ])
            });
            continue;
          }
        }
        if (typeof value === "object" && value !== null) {
          queue.push({
            value,
            depth: node.depth + 1,
            shape: /* @__PURE__ */ new Set([...node.shape, "nested"])
          });
        }
      }
    }
    if (Array.isArray(node.value)) {
      for (const item of node.value) {
        queue.push({
          value: item,
          depth: node.depth + 1,
          shape: /* @__PURE__ */ new Set([...node.shape, "array"])
        });
      }
    }
  }
  return { failureReason: "unsupported-envelope" };
};
var buildProtocolObservation = (sample, frameType, extracted) => {
  if (!sample) {
    return void 0;
  }
  const topParse = parseJsonCandidate(sample);
  const topAsRecord = toRecord(topParse.value);
  const topLevelKeys = topAsRecord ? Object.keys(topAsRecord).slice(0, 20) : [];
  const content = extracted?.content;
  const codeValue = content?.code;
  const codeLength = typeof codeValue === "string" ? codeValue.length : typeof codeValue === "number" || typeof codeValue === "boolean" ? String(codeValue).length : 0;
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
var recogniseColabWebSocketFrame = (socketUrl, sample, pageUrl = "https://colab.research.google.com", frameType = "unknown") => {
  const findings = [];
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
  const kernelResetSignal = messageType === "status" && ["restarting", "starting", "dead"].includes(String(executionState ?? "").toLowerCase());
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
  const notebookContentSignal = messageType === "textDocument/didOpen" || messageType === "textDocument/didChange";
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
    const codeFailureReason = executeRequestObserved && !Object.prototype.hasOwnProperty.call(extracted?.content ?? {}, "code") ? "code-missing" : executeRequestObserved && typeof maybeCode !== "string" ? "code-not-string" : void 0;
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
  const hasEgressPotential2 = semantic.signals.networkingCode;
  const trustBoundaryCrossings = [
    "browser->saas-control-plane",
    "saas-control-plane->managed-runtime",
    ...hasEgressPotential2 ? ["managed-runtime->potential-external-egress"] : []
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
var recogniseColabSignals = (url, content) => {
  const findings = [];
  const isColab = isColabUrl(url);
  const payload = classifyPayload(content);
  const detectedCapabilities = collectCapabilities(content);
  const signals = {
    isNotebookDocument: NOTEBOOK_DOCUMENT_RE.test(url) || NOTEBOOK_DOCUMENT_RE.test(content),
    notebookEdited: NOTEBOOK_EDIT_RE.test(content),
    notebookExecuted: NOTEBOOK_EXECUTION_RE.test(content),
    executablePythonCell: PYTHON_CELL_RE.test(content),
    markdownCell: MARKDOWN_CELL_RE.test(content),
    notebookMetadata: NOTEBOOK_METADATA_RE2.test(content),
    networkingCode: hasPythonNetworking(content) || detectedCapabilities.some((value) => NETWORKING_PATTERNS.some(([, label]) => label === value)),
    embeddedData: payload.categories.includes("embedded-data") || payload.categories.includes("base64-blob"),
    bearerTokenPattern: payload.categories.includes("bearer-token") || payload.categories.includes("jwt") || BEARER_TOKEN_HINT_RE.test(content),
    githubOutbound: detectedCapabilities.some((value) => value.includes("github"))
  };
  const trustBoundaryCrossings = signals.notebookExecuted ? ["saas-control-plane->managed-runtime", "managed-runtime->external-egress"] : signals.networkingCode ? ["saas-control-plane->managed-runtime"] : [];
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
  const trigger = signals.notebookExecuted ? "notebook-execution" : signals.notebookEdited ? "notebook-edit" : "colab-observation";
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

// src/extension/contracts.ts
var isObject = (value) => typeof value === "object" && value !== null;
var isObservedPayload = (value) => {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.api === "string" && typeof value.url === "string" && typeof value.pageUrl === "string";
};
var isWebSocketFrameType = (value) => value === "text" || value === "arraybuffer" || value === "typed-array" || value === "blob" || value === "unknown";
var isWebSocketFramePayload = (value) => {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.socketUrl === "string" && typeof value.timestamp === "string" && typeof value.pageUrl === "string" && isWebSocketFrameType(value.frameType) && typeof value.frameByteLength === "number" && (typeof value.payloadSample === "undefined" || typeof value.payloadSample === "string") && (typeof value.payloadSampleLength === "undefined" || typeof value.payloadSampleLength === "number") && (typeof value.payloadSampleTruncated === "undefined" || typeof value.payloadSampleTruncated === "boolean") && (typeof value.analysisFrameText === "undefined" || typeof value.analysisFrameText === "string") && (typeof value.analysisFrameTextLength === "undefined" || typeof value.analysisFrameTextLength === "number") && (typeof value.analysisEligibilityFailureReason === "undefined" || typeof value.analysisEligibilityFailureReason === "string") && (typeof value.initiatorLocation === "undefined" || typeof value.initiatorLocation === "string");
};
var isInstrumentationState = (value) => value === "active" || value === "failed" || value === "unknown";
var isContentStatusPayload = (value) => {
  if (!isObject(value)) {
    return false;
  }
  return isInstrumentationState(value.pageInstrumentation) && typeof value.contentBridgeReady === "boolean" && typeof value.timestamp === "string" && (typeof value.pageUrl === "undefined" || typeof value.pageUrl === "string") && (typeof value.reason === "undefined" || typeof value.reason === "string");
};
var isRuntimeObservedEventMessage = (value) => {
  if (!isObject(value)) {
    return false;
  }
  return value.type === "wireshadow-observed-event" && isObservedPayload(value.payload);
};
var isRuntimeWebSocketFrameMessage = (value) => isObject(value) && value.type === "wireshadow-websocket-frame" && isWebSocketFramePayload(value.payload);
var isRuntimeContentStatusMessage = (value) => isObject(value) && value.type === "wireshadow-content-status" && isContentStatusPayload(value.payload);
var isPanelGetEventsMessage = (value) => isObject(value) && value.type === "wireshadow-panel-get-events";

// src/extension/event-store.ts
var InMemoryEventStore = class {
  constructor(maxPerTab = 200, maxOverall = 2e3) {
    this.maxPerTab = maxPerTab;
    this.maxOverall = maxOverall;
  }
  maxPerTab;
  maxOverall;
  byTab = /* @__PURE__ */ new Map();
  allEvents = [];
  add(event) {
    this.allEvents.unshift(event);
    if (this.allEvents.length > this.maxOverall) {
      this.allEvents.length = this.maxOverall;
    }
    const tabId = event.context.tabId ?? -1;
    const bucket = this.byTab.get(tabId) ?? [];
    bucket.unshift(event);
    if (bucket.length > this.maxPerTab) {
      bucket.length = this.maxPerTab;
    }
    this.byTab.set(tabId, bucket);
  }
  getEvents(tabId) {
    if (typeof tabId === "number") {
      return [...this.byTab.get(tabId) ?? []];
    }
    return [...this.allEvents];
  }
};

// src/extension/background.ts
var getRuntime = () => globalThis.chrome?.runtime;
var getTabsApi = () => globalThis.chrome?.tabs;
var eventStore = new InMemoryEventStore();
var semanticStore = new PythonSemanticSessionStore();
var KNOWN_APIS = /* @__PURE__ */ new Set(["fetch", "xhr", "sendBeacon", "websocket", "eventsource"]);
var observerStateByTab = /* @__PURE__ */ new Map();
var MAX_PROTOCOL_SHAPE_LOGS_PER_TAB = 40;
var SENSITIVE_CATEGORIES2 = /* @__PURE__ */ new Set([
  "jwt",
  "bearer-token",
  "api-key-like",
  "token-like"
]);
var parseDestination = (url, baseUrl) => {
  const parsed = new URL(url, baseUrl);
  return {
    url: parsed.toString(),
    host: parsed.host,
    protocol: parsed.protocol,
    port: parsed.port === "" ? void 0 : Number(parsed.port)
  };
};
var hashStable = (value) => redactValue("unknown", value).hash;
var extractKernelId = (socketUrl) => {
  try {
    const parsed = new URL(socketUrl);
    return parsed.pathname.match(/\/api\/kernels\/([^/]+)\/channels/i)?.[1];
  } catch {
    return void 0;
  }
};
var extractNotebookId = (pageUrl) => {
  try {
    const parsed = new URL(pageUrl);
    const driveMatch = parsed.pathname.match(/\/drive\/([^/?#]+)/i);
    if (driveMatch?.[1]) {
      return driveMatch[1];
    }
    const githubMatch = parsed.pathname.match(/\/github\/([^/?#].*)/i);
    if (githubMatch?.[1]) {
      return githubMatch[1];
    }
  } catch {
    return void 0;
  }
  return void 0;
};
var buildSemanticContextKey = (_socketUrl, pageUrl, sender) => {
  const tab = sender.tab?.id ?? -1;
  const pageOriginPath = (() => {
    try {
      const parsed = new URL(pageUrl);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return pageUrl;
    }
  })();
  const notebookHash = hashStable(extractNotebookId(pageUrl) ?? pageOriginPath);
  return `tab:${tab}|notebook:${notebookHash}`;
};
var getOrCreateTabState = (tabId) => {
  const existing = observerStateByTab.get(tabId);
  if (existing) {
    return existing;
  }
  const created = {
    pageInstrumentation: "unknown",
    contentBridge: "unavailable",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    websocketConnectionsObserved: 0,
    websocketOutboundFramesObserved: 0,
    jupyterExecutionRequestsObserved: 0,
    recogniserState: "inactive",
    protocolShapeLogsEmitted: 0,
    knownSymbolsCount: 0,
    knownFunctionsCount: 0,
    knownVariablesCount: 0,
    totalWebSocketFramesObserved: 0,
    textWebSocketFramesObserved: 0,
    binaryWebSocketFramesObserved: 0,
    jupyterParseSuccesses: 0,
    jupyterParseFailures: 0,
    codeExtractionAttempts: 0,
    codeExtractionSuccesses: 0,
    codeExtractionFailures: 0,
    astAnalysisAttempts: 0,
    astAnalysisSuccesses: 0,
    astAnalysisFailures: 0,
    importsDiscovered: 0,
    functionsDiscovered: 0,
    assignmentsDiscovered: 0,
    callsDiscovered: 0,
    semanticFactsEmitted: 0,
    displaySamplesTruncatedCount: 0,
    functionDefNodesFound: 0,
    asyncFunctionDefNodesFound: 0,
    functionExtractionAttempted: 0,
    functionExtractionSucceeded: 0,
    functionExtractionFailed: 0,
    functionStoreInsertionSucceededCumulative: 0,
    functionStoreInsertionFailedCumulative: 0,
    functionDroppedCumulative: 0,
    kernelEpochChanges: 0
  };
  observerStateByTab.set(tabId, created);
  return created;
};
var hasConcreteSensitivePattern = (payloadSample) => {
  if (!payloadSample || payloadSample.trim().length === 0) {
    return false;
  }
  const classification = classifyPayload(payloadSample);
  return classification.categories.some((category) => SENSITIVE_CATEGORIES2.has(category));
};
var normalizeApi = (value) => KNOWN_APIS.has(value) ? value : "unknown";
var mergeInstrumentationState = (existing, incoming) => {
  if (incoming === "active" || existing === "active") {
    return "active";
  }
  if (incoming === "failed" || existing === "failed") {
    return "failed";
  }
  return "unknown";
};
var inferCorrelatedRiskInputs = (semanticFromCode, invocation) => {
  const inheritedCapabilities = invocation?.inheritedCapabilities ?? [];
  const argumentCategories = new Set(
    invocation?.argumentProvenance.map((value) => value.category) ?? []
  );
  const networkingCode = Boolean(semanticFromCode?.signals.networkingCode || invocation?.egressPotential);
  const githubOutbound = Boolean(
    semanticFromCode?.signals.githubOutbound || inheritedCapabilities.includes("github-target") || (invocation?.knownDestinations.length ?? 0) > 0
  );
  const embeddedData = Boolean(
    semanticFromCode?.signals.embeddedData || argumentCategories.has("embedded-data")
  );
  return {
    notebookEdited: semanticFromCode?.signals.notebookEdited ?? false,
    networkingCode,
    embeddedData,
    bearerTokenPattern: semanticFromCode?.signals.bearerTokenPattern ?? argumentCategories.has("token-like"),
    githubOutbound,
    notebookExecuted: true,
    knownOutboundSymbolInvoked: Boolean(invocation?.knownSymbolInvoked && invocation.egressPotential),
    writeCapableHttpBehavior: inheritedCapabilities.includes("data-upload") || inheritedCapabilities.includes("outbound-write"),
    knownExternalDestination: (invocation?.knownDestinations.length ?? 0) > 0,
    tokenLikeArgument: argumentCategories.has("token-like"),
    fileContentArgument: argumentCategories.has("file-path") || argumentCategories.has("embedded-data"),
    shellOrSubprocessCapability: inheritedCapabilities.includes("shell-execution") || inheritedCapabilities.includes("subprocess")
  };
};
var hasCorrelatedEgressPotential = (inputs) => inputs.networkingCode || inputs.githubOutbound || inputs.knownOutboundSymbolInvoked || inputs.writeCapableHttpBehavior || inputs.knownExternalDestination || inputs.shellOrSubprocessCapability;
var buildDefaultEvidenceSummary = () => [
  { level: "observed", detail: "Jupyter execute_request observed" },
  { level: "unknown", detail: "Downstream request success" }
];
var applyWebSocketSemanticToTabState = (state, semantic, observedAt, frameType, frameByteLength, displaySampleLength, displaySampleTruncated) => {
  const next = {
    ...state,
    websocketOutboundFramesObserved: state.websocketOutboundFramesObserved + 1,
    totalWebSocketFramesObserved: state.totalWebSocketFramesObserved + 1,
    textWebSocketFramesObserved: state.textWebSocketFramesObserved + (frameType === "text" ? 1 : 0),
    binaryWebSocketFramesObserved: state.binaryWebSocketFramesObserved + (frameType === "arraybuffer" || frameType === "typed-array" ? 1 : 0),
    recogniserState: semantic.isColabRuntimeSocket ? "active" : state.recogniserState,
    updatedAt: observedAt,
    latestFrameByteLength: frameByteLength,
    latestDisplaySampleLength: displaySampleLength,
    latestDisplaySampleTruncated: displaySampleTruncated,
    displaySamplesTruncatedCount: state.displaySamplesTruncatedCount + (displaySampleTruncated ? 1 : 0)
  };
  if (semantic.jupyterEnvelopeParsed) {
    next.jupyterParseSuccesses += 1;
  } else if (semantic.parseFailureReason) {
    next.jupyterParseFailures += 1;
    next.latestAnalysisFailureReason = semantic.parseFailureReason;
  }
  if (semantic.executeRequestObserved) {
    next.jupyterExecutionRequestsObserved += 1;
    next.codeExtractionAttempts += 1;
    if (semantic.executeRequestHasCode) {
      next.codeExtractionSuccesses += 1;
    } else {
      next.codeExtractionFailures += 1;
      if (semantic.parseFailureReason) {
        next.latestAnalysisFailureReason = semantic.parseFailureReason;
      }
    }
    next.latestProtocolEvent = semantic.executeRequestHasCode ? "Jupyter execute_request observed (code present)" : "Jupyter execute_request observed (empty code)";
    if (semantic.executeRequestHasCode) {
      next.latestMeaningfulExecutionEvent = "Notebook execution observed (Jupyter execute_request)";
    }
  } else if (semantic.notebookContentSignal) {
    next.latestProtocolEvent = "Colab LSP notebook content signal observed";
  } else if (semantic.messageType) {
    next.latestProtocolEvent = `Jupyter protocol message observed (${semantic.messageType})`;
  }
  return next;
};
var ingestObservedMessage = (message, sender) => {
  const observedAt = message.payload.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  const recogniser = recogniseColabSignals(message.payload.pageUrl, message.payload.payloadSample ?? "");
  const destination = parseDestination(message.payload.url, message.payload.pageUrl);
  const riskScore = computeDelegatedRiskScore(recogniser.signals);
  const timeline = buildTrustBoundaryTimeline(recogniser.signals);
  const delegatedExecutionEvent = recogniser.isColab ? buildDelegatedExecutionEvent(recogniser.trigger, recogniser.confidence, recogniser.signals) : void 0;
  const event = buildObservedEvent({
    id: crypto.randomUUID(),
    eventSource: "page-world",
    api: normalizeApi(message.payload.api),
    destination,
    context: {
      url: message.payload.pageUrl,
      origin: new URL(message.payload.pageUrl).origin,
      frameId: String(sender.frameId ?? "0"),
      tabId: sender.tab?.id,
      timestamp: observedAt
    },
    observedAt,
    requestMethod: message.payload.method,
    payloadByteLength: message.payload.bodyLength,
    initiatorLocation: message.payload.initiatorLocation,
    payloadSample: message.payload.payloadSample ?? "",
    findings: recogniser.findings,
    riskFlags: [...hasConcreteSensitivePattern(message.payload.payloadSample) ? ["sensitive-pattern"] : []],
    trustBoundaryEvents: [
      {
        boundaryId: "browser-to-remote-runtime",
        boundaryType: "managed-runtime",
        direction: "out-of",
        details: "Browser-observed request intent may execute beyond enterprise-controlled endpoint."
      }
    ],
    delegatedExecutionEvent,
    timeline,
    riskScore,
    detectedCapabilities: recogniser.detectedCapabilities,
    trustBoundaryCrossings: recogniser.trustBoundaryCrossings
  });
  eventStore.add(event);
  console.info("[WireShadow] background event stored");
  if (typeof sender.tab?.id === "number" && event.api === "websocket") {
    const tabState = getOrCreateTabState(sender.tab.id);
    tabState.websocketConnectionsObserved += 1;
    tabState.updatedAt = observedAt;
    tabState.recogniserState = "active";
    observerStateByTab.set(sender.tab.id, tabState);
  }
};
var ingestWebSocketFrameMessage = (message, sender) => {
  const observedAt = message.payload.timestamp;
  const destination = parseDestination(message.payload.socketUrl, message.payload.pageUrl);
  const semanticInput = message.payload.analysisFrameText;
  const wsSemantic = recogniseColabWebSocketFrame(
    message.payload.socketUrl,
    semanticInput,
    message.payload.pageUrl,
    message.payload.frameType
  );
  const semanticContextKey = buildSemanticContextKey(
    message.payload.socketUrl,
    message.payload.pageUrl,
    sender
  );
  if (wsSemantic.kernelResetSignal) {
    semanticStore.resetContext(semanticContextKey);
    if (typeof sender.tab?.id === "number") {
      const resetState = getOrCreateTabState(sender.tab.id);
      resetState.lastStateResetReason = "state-reset";
      resetState.lastKernelRestartAt = observedAt;
      observerStateByTab.set(sender.tab.id, resetState);
    }
  }
  if (typeof sender.tab?.id === "number") {
    const epochState = getOrCreateTabState(sender.tab.id);
    const observedKernelId = extractKernelId(message.payload.socketUrl);
    if (observedKernelId !== void 0 && observedKernelId !== epochState.currentKernelId) {
      epochState.kernelEpochChanges += 1;
      epochState.currentKernelId = observedKernelId;
      observerStateByTab.set(sender.tab.id, epochState);
    }
  }
  const semanticFromCode = wsSemantic.executeRequestHasCode && wsSemantic.codeSample ? recogniseColabSignals(message.payload.pageUrl, wsSemantic.codeSample) : void 0;
  const codeAnalysisAttempted = wsSemantic.executeRequestHasCode;
  const semanticExecution = wsSemantic.executeRequestHasCode && wsSemantic.codeSample ? semanticStore.applyExecution(semanticContextKey, wsSemantic.codeSample, observedAt) : void 0;
  const invocation = semanticExecution?.invocation;
  const firstObservedCall = semanticExecution?.calls[0];
  let resolutionFailureReason = semanticExecution?.resolutionFailureReason;
  if (resolutionFailureReason === "definition-not-seen" && firstObservedCall) {
    const callParts = firstObservedCall.split(".");
    const callee = callParts[callParts.length - 1] ?? firstObservedCall;
    if (semanticStore.hasSymbolInSiblingContext(semanticContextKey, callee)) {
      resolutionFailureReason = "session-mismatch";
    }
  }
  const correlatedInputs = wsSemantic.executeRequestHasCode ? inferCorrelatedRiskInputs(semanticFromCode, invocation) : void 0;
  const riskScore = correlatedInputs ? computeDelegatedRiskScore(correlatedInputs) : void 0;
  const timeline = correlatedInputs ? buildTrustBoundaryTimeline(correlatedInputs) : [];
  const delegatedExecutionEvent = correlatedInputs ? buildDelegatedExecutionEvent("jupyter-execute-request", wsSemantic.confidence, correlatedInputs, {
    knownSymbolInvoked: invocation?.knownSymbolInvoked,
    inheritedCapabilities: invocation?.inheritedCapabilities
  }) : void 0;
  const riskFlags = [];
  if (wsSemantic.executeRequestHasCode && correlatedInputs) {
    riskFlags.push("delegated-execution", "code-execution");
    if (hasCorrelatedEgressPotential(correlatedInputs)) {
      riskFlags.push("hidden-egress");
    }
    if (correlatedInputs.embeddedData) {
      riskFlags.push("embedded-data");
    }
    if (hasConcreteSensitivePattern(wsSemantic.codeSample) || correlatedInputs.tokenLikeArgument) {
      riskFlags.push("sensitive-pattern");
    }
  }
  const trustBoundaryCrossings = wsSemantic.executeRequestHasCode ? [
    "browser->saas-control-plane",
    "saas-control-plane->managed-runtime",
    ...correlatedInputs && hasCorrelatedEgressPotential(correlatedInputs) ? ["managed-runtime->potential-external-egress"] : []
  ] : wsSemantic.trustBoundaryCrossings;
  const event = buildObservedEvent({
    id: crypto.randomUUID(),
    eventSource: "page-world",
    api: "websocket",
    destination,
    context: {
      url: message.payload.pageUrl,
      origin: new URL(message.payload.pageUrl).origin,
      frameId: String(sender.frameId ?? "0"),
      tabId: sender.tab?.id,
      timestamp: observedAt
    },
    observedAt,
    requestMethod: "SEND",
    payloadByteLength: message.payload.frameByteLength,
    initiatorLocation: message.payload.initiatorLocation,
    payloadSample: wsSemantic.executeRequestHasCode ? `[jupyter-code-redacted length=${wsSemantic.codeLength ?? 0}]` : message.payload.payloadSample ?? "",
    findings: wsSemantic.findings,
    riskFlags,
    trustBoundaryEvents: [
      {
        boundaryId: "browser-to-saas-control-plane",
        boundaryType: "saas-control-plane",
        direction: "out-of",
        details: "Browser-observed WebSocket frame sent to Colab control plane."
      },
      ...wsSemantic.executeRequestHasCode ? [
        {
          boundaryId: "saas-control-plane-to-managed-runtime",
          boundaryType: "managed-runtime",
          direction: "out-of",
          details: "Jupyter execute_request indicates delegated execution in managed runtime."
        }
      ] : []
    ],
    delegatedExecutionEvent,
    evidenceSummary: invocation?.evidence ?? (wsSemantic.executeRequestHasCode ? buildDefaultEvidenceSummary() : []),
    timeline,
    riskScore,
    detectedCapabilities: Array.from(
      /* @__PURE__ */ new Set([...wsSemantic.detectedCapabilities ?? [], ...invocation?.inheritedCapabilities ?? []])
    ),
    trustBoundaryCrossings,
    metadata: {
      websocketFrameType: message.payload.frameType,
      websocketFrameByteLength: message.payload.frameByteLength,
      websocketMessageType: wsSemantic.messageType ?? "unknown",
      jupyterCodeLength: wsSemantic.codeLength ?? 0,
      jupyterCodeHash: wsSemantic.codeHash ?? "none",
      jupyterNestedOrWrapped: wsSemantic.protocolObservation?.nestedOrWrapped ?? false,
      jupyterParseShape: wsSemantic.protocolObservation?.parseShape ?? "none",
      jupyterFrameEncoding: wsSemantic.protocolObservation?.frameEncoding ?? message.payload.frameType,
      semanticContextKeyHash: hashStable(semanticContextKey),
      knownSymbolHash: invocation?.knownSymbolInvoked ? hashStable(invocation.knownSymbolInvoked) : "none",
      semanticExecutionIdHash: hashStable(
        `${semanticContextKey}|${wsSemantic.codeHash ?? "none"}|${message.payload.timestamp}`
      ),
      semanticStatementKinds: semanticExecution?.diagnostics.statementKinds.join(",") ?? (wsSemantic.executeRequestHasCode ? "unknown" : "none"),
      semanticImportsDetected: semanticExecution?.diagnostics.importsDetected ?? 0,
      semanticFunctionDefinitionsDetected: semanticExecution?.diagnostics.functionDefinitionsDetected ?? 0,
      semanticAssignmentsDetected: semanticExecution?.diagnostics.assignmentsDetected ?? 0,
      semanticCallsDetected: semanticExecution?.diagnostics.callsDetected ?? 0,
      semanticCallResolved: semanticExecution?.diagnostics.callResolved ?? false,
      semanticResolutionFailureReason: resolutionFailureReason ?? "none",
      semanticArgumentProvenance: invocation?.argumentProvenance.map((value) => value.category).join(",") ?? "none",
      semanticStoreSizeBefore: semanticExecution?.diagnostics.semanticStoreSizeBefore ?? 0,
      semanticStoreSizeAfter: semanticExecution?.diagnostics.semanticStoreSizeAfter ?? 0,
      semanticExecutionSequenceId: semanticExecution?.diagnostics.executionSequenceId ?? 0,
      analysisInputLength: message.payload.analysisFrameTextLength ?? 0,
      analysisInputProvided: typeof message.payload.analysisFrameText === "string",
      analysisDisplaySampleLength: message.payload.payloadSampleLength ?? (message.payload.payloadSample?.length ?? 0),
      analysisDisplaySampleTruncated: message.payload.payloadSampleTruncated ?? false,
      analysisEligibilityFailureReason: message.payload.analysisEligibilityFailureReason ?? "none",
      semanticParseFailureReason: wsSemantic.parseFailureReason ?? "none"
    }
  });
  eventStore.add(event);
  console.info("[WireShadow] background event stored");
  if (typeof sender.tab?.id === "number") {
    let tabState = getOrCreateTabState(sender.tab.id);
    tabState = applyWebSocketSemanticToTabState(
      tabState,
      wsSemantic,
      observedAt,
      message.payload.frameType,
      message.payload.frameByteLength,
      message.payload.payloadSampleLength ?? message.payload.payloadSample?.length,
      message.payload.payloadSampleTruncated
    );
    if (invocation?.knownSymbolInvoked) {
      tabState.latestMeaningfulExecutionEvent = `${invocation.knownSymbolInvoked}(...) invoked`;
    }
    if (semanticExecution) {
      tabState.currentSemanticSessionHash = hashStable(semanticContextKey);
      tabState.knownFunctionsCount = semanticExecution.diagnostics.semanticStoreFunctionsAfter;
      tabState.knownVariablesCount = semanticExecution.diagnostics.semanticStoreVariablesAfter;
      tabState.knownSymbolsCount = tabState.knownFunctionsCount + tabState.knownVariablesCount;
      if (semanticExecution.diagnostics.latestFunctionDefined) {
        tabState.latestFunctionDefined = semanticExecution.diagnostics.latestFunctionDefined;
      }
      if (semanticExecution.diagnostics.latestFunctionInvoked) {
        tabState.latestFunctionInvoked = semanticExecution.diagnostics.latestFunctionInvoked;
      }
    }
    if (semanticExecution?.diagnostics.latestResolutionResult) {
      tabState.latestResolutionResult = semanticExecution.diagnostics.latestResolutionResult;
    }
    const resolvedFailureReason = resolutionFailureReason ?? semanticExecution?.diagnostics.latestResolutionFailureReason;
    if (resolvedFailureReason !== void 0) {
      tabState.latestResolutionFailureReason = resolvedFailureReason;
    }
    if (codeAnalysisAttempted) {
      tabState.astAnalysisAttempts += 1;
      if (semanticExecution) {
        tabState.astAnalysisSuccesses += 1;
        tabState.importsDiscovered += semanticExecution.diagnostics.importsDetected;
        tabState.functionsDiscovered += semanticExecution.diagnostics.functionDefinitionsDetected;
        tabState.assignmentsDiscovered += semanticExecution.diagnostics.assignmentsDetected;
        tabState.callsDiscovered += semanticExecution.diagnostics.callsDetected;
        tabState.functionDefNodesFound += semanticExecution.diagnostics.functionDefNodesFound;
        tabState.asyncFunctionDefNodesFound += semanticExecution.diagnostics.asyncFunctionDefNodesFound;
        tabState.latestFunctionNameHash = semanticExecution.diagnostics.latestFunctionNameHash;
        tabState.latestFunctionParameterCount = semanticExecution.diagnostics.latestFunctionParameterCount;
        tabState.latestFunctionDecoratorCount = semanticExecution.diagnostics.latestFunctionDecoratorCount;
        tabState.latestFunctionBodyStatementCount = semanticExecution.diagnostics.latestFunctionBodyStatementCount;
        tabState.latestFunctionNestedCount = semanticExecution.diagnostics.latestFunctionNestedCount;
        tabState.latestFunctionCapabilityCount = semanticExecution.diagnostics.latestFunctionCapabilityCount;
        tabState.latestFunctionSemanticFactEmitted = semanticExecution.diagnostics.latestFunctionSemanticFactEmitted;
        tabState.functionStoreInsertionAttempted = semanticExecution.diagnostics.functionStoreInsertionAttempted;
        tabState.functionStoreInsertionSucceeded = semanticExecution.diagnostics.functionStoreInsertionSucceeded;
        tabState.functionStoreInsertionFailureReason = semanticExecution.diagnostics.functionStoreInsertionFailureReason;
        tabState.functionExtractionAttempted += semanticExecution.diagnostics.functionExtractionAttemptedCount;
        tabState.functionExtractionSucceeded += semanticExecution.diagnostics.functionExtractionSucceededCount;
        tabState.functionExtractionFailed += semanticExecution.diagnostics.functionExtractionFailedCount;
        tabState.functionStoreInsertionSucceededCumulative += semanticExecution.diagnostics.functionStoreInsertionSucceededCount;
        tabState.functionStoreInsertionFailedCumulative += semanticExecution.diagnostics.functionStoreInsertionFailedCount;
        tabState.functionDroppedCumulative += semanticExecution.diagnostics.functionDroppedCount;
        tabState.latestExecutionSequenceId = semanticExecution.diagnostics.executionSequenceId;
        tabState.storedFunctionNames = semanticExecution.diagnostics.storedFunctionNames;
        if (semanticExecution.diagnostics.callsDetected > 0) {
          if (semanticExecution.diagnostics.latestAttemptedFunction) {
            tabState.latestAttemptedFunction = semanticExecution.diagnostics.latestAttemptedFunction;
          }
          tabState.latestResolvedFunction = semanticExecution.diagnostics.latestResolvedFunction;
        }
        if (wsSemantic.executeRequestHasCode && correlatedInputs && hasCorrelatedEgressPotential(correlatedInputs)) {
          tabState.latestEgressExecutionEvent = invocation?.knownSymbolInvoked ? `${invocation.knownSymbolInvoked}(...) invoked (egress-indicating)` : "Notebook execution observed (egress-indicating)";
        }
        const emittedFacts = semanticExecution.diagnostics.importsDetected + semanticExecution.diagnostics.functionDefinitionsDetected + semanticExecution.diagnostics.assignmentsDetected + semanticExecution.diagnostics.callsDetected;
        tabState.semanticFactsEmitted += emittedFacts;
        if (emittedFacts === 0) {
          tabState.latestAnalysisFailureReason = semanticExecution.diagnostics.latestFunctionAnalysisFailureReason ?? "no-supported-statements";
        } else {
          tabState.latestAnalysisFailureReason = semanticExecution.diagnostics.latestFunctionAnalysisFailureReason;
        }
      } else {
        tabState.astAnalysisFailures += 1;
        tabState.latestAnalysisFailureReason = wsSemantic.parseFailureReason ?? message.payload.analysisEligibilityFailureReason ?? "ast-parse-failed";
      }
    }
    if (!semanticInput && message.payload.payloadSampleTruncated) {
      tabState.latestAnalysisFailureReason = "frame-truncated-before-parse";
    }
    if (semanticExecution?.diagnostics.stateResetReason) {
      tabState.lastStateResetReason = semanticExecution.diagnostics.stateResetReason;
    }
    if (wsSemantic.protocolObservation && tabState.protocolShapeLogsEmitted < MAX_PROTOCOL_SHAPE_LOGS_PER_TAB) {
      console.info("[WireShadow] jupyter-frame-shape", wsSemantic.protocolObservation);
      tabState.protocolShapeLogsEmitted += 1;
    }
    observerStateByTab.set(sender.tab.id, tabState);
  }
};
var ingestContentStatus = (message, sender) => {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return;
  }
  const existing = getOrCreateTabState(tabId);
  observerStateByTab.set(tabId, {
    ...existing,
    pageInstrumentation: mergeInstrumentationState(existing.pageInstrumentation, message.payload.pageInstrumentation),
    contentBridge: message.payload.contentBridgeReady ? "active" : existing.contentBridge,
    updatedAt: message.payload.timestamp
  });
};
var buildDiagnostics = (tabId, eventsObserved) => {
  if (typeof tabId !== "number") {
    return {
      pageInstrumentation: "unknown",
      contentBridge: "unavailable",
      backgroundObserver: "active",
      eventsObserved,
      websocketConnectionsObserved: 0,
      websocketOutboundFramesObserved: 0,
      jupyterExecutionRequestsObserved: 0,
      recogniserState: "inactive",
      knownSymbolsCount: 0,
      knownFunctionsCount: 0,
      knownVariablesCount: 0,
      totalWebSocketFramesObserved: 0,
      textWebSocketFramesObserved: 0,
      binaryWebSocketFramesObserved: 0,
      jupyterParseSuccesses: 0,
      jupyterParseFailures: 0,
      codeExtractionAttempts: 0,
      codeExtractionSuccesses: 0,
      codeExtractionFailures: 0,
      astAnalysisAttempts: 0,
      astAnalysisSuccesses: 0,
      astAnalysisFailures: 0,
      importsDiscovered: 0,
      functionsDiscovered: 0,
      assignmentsDiscovered: 0,
      callsDiscovered: 0,
      semanticFactsEmitted: 0,
      displaySamplesTruncatedCount: 0,
      functionDefNodesFound: 0,
      asyncFunctionDefNodesFound: 0
    };
  }
  const tabState = observerStateByTab.get(tabId);
  return {
    pageInstrumentation: tabState?.pageInstrumentation ?? "unknown",
    contentBridge: tabState?.contentBridge ?? "unavailable",
    backgroundObserver: "active",
    eventsObserved,
    websocketConnectionsObserved: tabState?.websocketConnectionsObserved ?? 0,
    websocketOutboundFramesObserved: tabState?.websocketOutboundFramesObserved ?? 0,
    jupyterExecutionRequestsObserved: tabState?.jupyterExecutionRequestsObserved ?? 0,
    recogniserState: tabState?.recogniserState ?? "inactive",
    latestProtocolEvent: tabState?.latestProtocolEvent,
    latestMeaningfulExecutionEvent: tabState?.latestMeaningfulExecutionEvent,
    latestEgressExecutionEvent: tabState?.latestEgressExecutionEvent,
    lastSemanticEvent: tabState?.latestMeaningfulExecutionEvent,
    knownSymbolsCount: tabState?.knownSymbolsCount ?? 0,
    knownFunctionsCount: tabState?.knownFunctionsCount ?? 0,
    knownVariablesCount: tabState?.knownVariablesCount ?? 0,
    currentSemanticSessionHash: tabState?.currentSemanticSessionHash,
    latestFunctionDefined: tabState?.latestFunctionDefined,
    latestFunctionInvoked: tabState?.latestFunctionInvoked,
    latestResolutionResult: tabState?.latestResolutionResult,
    latestResolutionFailureReason: tabState?.latestResolutionFailureReason,
    lastStateResetReason: tabState?.lastStateResetReason,
    totalWebSocketFramesObserved: tabState?.totalWebSocketFramesObserved ?? 0,
    textWebSocketFramesObserved: tabState?.textWebSocketFramesObserved ?? 0,
    binaryWebSocketFramesObserved: tabState?.binaryWebSocketFramesObserved ?? 0,
    latestFrameByteLength: tabState?.latestFrameByteLength,
    latestDisplaySampleLength: tabState?.latestDisplaySampleLength,
    latestDisplaySampleTruncated: tabState?.latestDisplaySampleTruncated,
    displaySamplesTruncatedCount: tabState?.displaySamplesTruncatedCount ?? 0,
    jupyterParseSuccesses: tabState?.jupyterParseSuccesses ?? 0,
    jupyterParseFailures: tabState?.jupyterParseFailures ?? 0,
    codeExtractionAttempts: tabState?.codeExtractionAttempts ?? 0,
    codeExtractionSuccesses: tabState?.codeExtractionSuccesses ?? 0,
    codeExtractionFailures: tabState?.codeExtractionFailures ?? 0,
    astAnalysisAttempts: tabState?.astAnalysisAttempts ?? 0,
    astAnalysisSuccesses: tabState?.astAnalysisSuccesses ?? 0,
    astAnalysisFailures: tabState?.astAnalysisFailures ?? 0,
    importsDiscovered: tabState?.importsDiscovered ?? 0,
    functionsDiscovered: tabState?.functionsDiscovered ?? 0,
    assignmentsDiscovered: tabState?.assignmentsDiscovered ?? 0,
    callsDiscovered: tabState?.callsDiscovered ?? 0,
    semanticFactsEmitted: tabState?.semanticFactsEmitted ?? 0,
    latestAnalysisFailureReason: tabState?.latestAnalysisFailureReason,
    functionDefNodesFound: tabState?.functionDefNodesFound ?? 0,
    asyncFunctionDefNodesFound: tabState?.asyncFunctionDefNodesFound ?? 0,
    latestFunctionNameHash: tabState?.latestFunctionNameHash,
    latestFunctionParameterCount: tabState?.latestFunctionParameterCount,
    latestFunctionDecoratorCount: tabState?.latestFunctionDecoratorCount,
    latestFunctionBodyStatementCount: tabState?.latestFunctionBodyStatementCount,
    latestFunctionNestedCount: tabState?.latestFunctionNestedCount,
    latestFunctionCapabilityCount: tabState?.latestFunctionCapabilityCount,
    latestFunctionSemanticFactEmitted: tabState?.latestFunctionSemanticFactEmitted,
    functionStoreInsertionAttempted: tabState?.functionStoreInsertionAttempted,
    functionStoreInsertionSucceeded: tabState?.functionStoreInsertionSucceeded,
    functionStoreInsertionFailureReason: tabState?.functionStoreInsertionFailureReason,
    functionExtractionAttempted: tabState?.functionExtractionAttempted ?? 0,
    functionExtractionSucceeded: tabState?.functionExtractionSucceeded ?? 0,
    functionExtractionFailed: tabState?.functionExtractionFailed ?? 0,
    functionStoreInsertionSucceededCount: tabState?.functionStoreInsertionSucceededCumulative ?? 0,
    functionStoreInsertionFailedCount: tabState?.functionStoreInsertionFailedCumulative ?? 0,
    functionDroppedCount: tabState?.functionDroppedCumulative ?? 0,
    currentKernelId: tabState?.currentKernelId,
    kernelEpochChanges: tabState?.kernelEpochChanges ?? 0,
    lastKernelRestartAt: tabState?.lastKernelRestartAt,
    storedFunctionNames: tabState?.storedFunctionNames ?? [],
    latestAttemptedFunction: tabState?.latestAttemptedFunction,
    latestResolvedFunction: tabState?.latestResolvedFunction,
    latestExecutionSequenceId: tabState?.latestExecutionSequenceId
  };
};
var startBackgroundObserver = () => {
  const runtime = getRuntime();
  if (!runtime) {
    return;
  }
  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isRuntimeObservedEventMessage(message)) {
      ingestObservedMessage(message, sender);
      return;
    }
    if (isRuntimeContentStatusMessage(message)) {
      ingestContentStatus(message, sender);
      return;
    }
    if (isRuntimeWebSocketFrameMessage(message)) {
      ingestWebSocketFrameMessage(message, sender);
      return;
    }
    if (isPanelGetEventsMessage(message)) {
      const tabId = typeof message.tabId === "number" ? message.tabId : sender.tab?.id;
      const events = eventStore.getEvents(tabId);
      sendResponse({
        type: "wireshadow-panel-events",
        payload: {
          events,
          diagnostics: buildDiagnostics(tabId, events.length)
        }
      });
    }
  });
  getTabsApi()?.onRemoved.addListener((tabId) => {
    observerStateByTab.delete(tabId);
    semanticStore.resetTab(`tab:${tabId}|`);
  });
};
startBackgroundObserver();
export {
  applyWebSocketSemanticToTabState,
  buildSemanticContextKey
};
