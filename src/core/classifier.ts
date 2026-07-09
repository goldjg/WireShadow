import { redactMany, redactValue } from "./redaction.js";
import type {
  ClassificationCategory,
  PayloadClassification,
  RedactedEvidence
} from "./types.js";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const URL_RE = /\bhttps?:\/\/[^\s'"<>]+/gi;
const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const API_KEY_LIKE_RE =
  /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{24,}|AIza[0-9A-Za-z\-_]{20,})\b/g;
const TOKEN_LIKE_RE = /\b[A-Za-z0-9_\-]{24,}\b/g;
const BASE64_RE = /\b(?:[A-Za-z0-9+/]{40,}={0,2})\b/g;
const EMBEDDED_DATA_RE = /\bdata:[^;]+;base64,[A-Za-z0-9+/=]{16,}\b/gi;
const SOURCE_CODE_RE = /\b(function|const|class|import|def|return|await)\b/;
const PY_NETWORK_RE = /\b(requests\.|urllib\.|httpx\.)/i;
const URLLIB3_RE = /\burllib3\b/i;
const AIOHTTP_RE = /\baiohttp\b/i;
const SOCKET_RE = /\bsocket\b/i;
const WEBSOCKET_CLIENT_RE = /\bwebsocket-client\b/i;
const REQUESTS_POST_RE = /\brequests\.post\s*\(/i;
const REQUESTS_GET_RE = /\brequests\.get\s*\(/i;
const URLLIB_RE = /\burllib(?:\.request|\.parse)?\b/i;
const HTTPX_RE = /\bhttpx\.(?:get|post|put|delete|patch|request)\b/i;
const SUBPROCESS_RE = /\bsubprocess\b/i;
const OS_SYSTEM_RE = /\bos\.system\s*\(/i;
const CURL_RE = /\bcurl(?:\s+-X\s+(?:GET|POST|PUT|PATCH|DELETE))?\b/i;
const WGET_RE = /\bwget\b/i;
const GITHUB_API_RE = /\bhttps?:\/\/api\.github\.com\b/i;
const GIST_API_RE = /\bhttps?:\/\/api\.github\.com\/gists\b|\bgist\.github\.com\b/i;
const PYGITHUB_RE = /\bPyGithub\b/i;
const CLOUD_STORAGE_RE =
  /\b(?:drive\.google\.com|google drive|dropbox|onedrive|s3(?:\.amazonaws\.com)?|blob\.core\.windows\.net|azure\.blob)\b/i;
const HTTP_METHOD_RE = /\b(?:GET|POST|PUT|PATCH|DELETE)\b/;
const NOTEBOOK_METADATA_RE = /\b(?:metadata|kernelspec|language_info|google\.colab)\b/i;

const extractMatches = (input: string, pattern: RegExp): string[] =>
  Array.from(input.matchAll(pattern)).map((m) => m[0]);

const addEvidence = (
  categories: ClassificationCategory[],
  evidence: RedactedEvidence[],
  category: ClassificationCategory,
  values: readonly string[],
  cap = 3
): void => {
  if (values.length === 0) {
    return;
  }
  categories.push(category);
  evidence.push(...redactMany(category, values.slice(0, cap)));
};

export const classifyUrl = (value: string): RedactedEvidence => {
  let host = value;
  try {
    host = new URL(value).host;
  } catch {
    host = value;
  }
  return redactValue("url", host);
};

export const hasEmail = (value: string): boolean =>
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value);
export const hasJwt = (value: string): boolean =>
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8,}\b/.test(value);
export const hasPythonNetworking = (value: string): boolean =>
  PY_NETWORK_RE.test(value) ||
  URLLIB3_RE.test(value) ||
  AIOHTTP_RE.test(value) ||
  SOCKET_RE.test(value) ||
  WEBSOCKET_CLIENT_RE.test(value);

export const classifyPayload = (input: string): PayloadClassification => {
  const categories: ClassificationCategory[] = [];
  const evidence: RedactedEvidence[] = [];

  addEvidence(categories, evidence, "email", extractMatches(input, EMAIL_RE));
  addEvidence(categories, evidence, "jwt", extractMatches(input, JWT_RE));
  addEvidence(categories, evidence, "bearer-token", extractMatches(input, BEARER_RE), 2);
  addEvidence(categories, evidence, "uuid", extractMatches(input, UUID_RE));
  addEvidence(categories, evidence, "url", extractMatches(input, URL_RE), 2);
  addEvidence(categories, evidence, "ip-address", extractMatches(input, IPV4_RE), 2);
  addEvidence(categories, evidence, "api-key-like", extractMatches(input, API_KEY_LIKE_RE));

  const tokens = extractMatches(input, TOKEN_LIKE_RE).filter((token) => token.length >= 32);
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
