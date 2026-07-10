import { describe, expect, it } from "vitest";
import { PythonSemanticSessionStore } from "../src/core/python-semantic.js";

describe("python semantic session store", () => {
  it("detects imports and aliases", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:1|frame:0|kernel:x|notebook:y",
      "import requests as r\nfrom urllib import request as ureq\n",
      "2026-01-01T00:00:00.000Z"
    );
    expect(summary.imports).toEqual(expect.arrayContaining(["requests", "urllib"]));
    expect(summary.aliases.r).toBe("requests");
    expect(summary.aliases.ureq).toBe("urllib.request");
  });

  it("detects function and async function capabilities without retaining raw body", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:2|frame:0|kernel:x|notebook:y",
      [
        "def upload_to_github(data, token, repo):",
        "  import requests",
        "  requests.post('https://api.github.com/repos/org/repo/issues', json={'data': data})",
        "",
        "async def upload_async(path):",
        "  import httpx",
        "  return httpx.post('https://api.github.com/repos/org/repo/issues')"
      ].join("\n"),
      "2026-01-01T00:00:01.000Z"
    );
    const names = summary.functionDefinitions.map((fn) => fn.name);
    expect(names).toEqual(expect.arrayContaining(["upload_to_github", "upload_async"]));
    const upload = summary.functionDefinitions.find((fn) => fn.name === "upload_to_github");
    expect(upload?.capabilities).toEqual(
      expect.arrayContaining(["network-http", "github-target", "data-upload", "outbound-write"])
    );
    expect(upload?.codeHash).toHaveLength(64);
    expect(Object.prototype.hasOwnProperty.call(upload ?? {}, "body")).toBe(false);
  });

  it("supports decorated, typed, multiline function definitions with nested outbound capability", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:12|kernel:x|notebook:y",
      [
        "@decorator_one",
        "@decorator_two(param=1)",
        "async def upload_to_github(",
        "  data: str,",
        "  owner: str = 'owner/repo',",
        "  *,",
        "  token: str | None = None,",
        "  **kwargs",
        "):",
        "  \"\"\"doc\"\"\"",
        "  def helper(url: str):",
        "    return urllib.request.Request(url, method='PUT')",
        "  try:",
        "    req = helper('https://api.github.com/repos/' + owner)",
        "    return urllib.request.urlopen(req)",
        "  except Exception:",
        "    return None"
      ].join("\n"),
      "2026-01-01T00:02:00.000Z"
    );
    expect(summary.functionDefinitions.map((fn) => fn.name)).toContain("upload_to_github");
    const fn = summary.functionDefinitions.find((value) => value.name === "upload_to_github");
    expect(fn?.async).toBe(true);
    expect(fn?.capabilities).toEqual(expect.arrayContaining(["network-http", "github-target", "outbound-write"]));
    expect(summary.diagnostics.functionDefNodesFound).toBeGreaterThan(0);
    expect(summary.diagnostics.asyncFunctionDefNodesFound).toBeGreaterThan(0);
    expect(summary.diagnostics.latestFunctionDecoratorCount).toBe(2);
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("classifies assignment provenance categories", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:3|frame:0|kernel:x|notebook:y",
      [
        "GITHUB_TOKEN = 'ghp_1234567890abcdefghijABCDEFGHIJ'",
        `DLP = '${"A".repeat(300)}'`,
        "REPO = 'owner/repo'",
        "TARGET = 'https://api.github.com/repos/owner/repo/issues'",
        "FILE = '/tmp/data.json'"
      ].join("\n"),
      "2026-01-01T00:00:02.000Z"
    );
    const bySymbol = new Map(summary.assignments.map((value) => [value.symbol, value]));
    expect(bySymbol.get("GITHUB_TOKEN")?.category).toBe("token-like");
    expect(bySymbol.get("REPO")?.category).toBe("repository-identifier");
    expect(bySymbol.get("TARGET")?.category).toBe("url");
    expect(bySymbol.get("FILE")?.category).toBe("file-path");
    expect(bySymbol.get("GITHUB_TOKEN")?.hash).toHaveLength(64);
  });

  it("correlates later invocation against earlier function definition and argument provenance", () => {
    const store = new PythonSemanticSessionStore();
    const context = "tab:4|frame:0|kernel:x|notebook:y";
    store.applyExecution(
      context,
      [
        "def upload_to_github(data, token, repo):",
        "  import requests",
        "  requests.post('https://api.github.com/repos/owner/repo/issues', json={'data': data}, headers={'Authorization': token})"
      ].join("\n"),
      "2026-01-01T00:00:03.000Z"
    );
    store.applyExecution(
      context,
      [
        "DLP_TEST_DATA = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='",
        "GITHUB_TOKEN = 'ghp_1234567890abcdefghijABCDEFGHIJ'",
        "GITHUB_REPO = 'owner/repo'"
      ].join("\n"),
      "2026-01-01T00:00:04.000Z"
    );
    const summary = store.applyExecution(
      context,
      "upload_to_github(DLP_TEST_DATA, token=GITHUB_TOKEN, repo=GITHUB_REPO)",
      "2026-01-01T00:00:05.000Z"
    );
    expect(summary.invocation?.knownSymbolInvoked).toBe("upload_to_github");
    expect(summary.invocation?.egressPotential).toBe(true);
    expect(summary.invocation?.argumentProvenance.map((value) => value.category)).toEqual(
      expect.arrayContaining(["token-like", "repository-identifier"])
    );
    expect(summary.invocation?.evidence.map((value) => value.level)).toEqual(
      expect.arrayContaining(["observed", "correlated", "inferred", "unknown"])
    );
  });

  it("parses multiline assignment-wrapped invocation and resolves symbol", () => {
    const store = new PythonSemanticSessionStore();
    const context = "tab:10|kernel:x|notebook:y";
    store.applyExecution(
      context,
      [
        "def upload_to_github(data, owner, token):",
        "  import urllib.request",
        "  req = urllib.request.Request('https://api.github.com/repos/' + owner, method='PUT')",
        "  return urllib.request.urlopen(req)"
      ].join("\n"),
      "2026-01-01T00:00:20.000Z"
    );
    store.applyExecution(
      context,
      ["DLP_TEST_DATA = 'sample-data'", "GITHUB_OWNER = 'owner/repo'", "GITHUB_TOKEN = 'ghp_1234567890abcdefghijABCDEFGHIJ'"].join(
        "\n"
      ),
      "2026-01-01T00:00:21.000Z"
    );
    const summary = store.applyExecution(
      context,
      [
        "result = upload_to_github(",
        "  DLP_TEST_DATA,",
        "  owner=GITHUB_OWNER,",
        "  token=GITHUB_TOKEN,",
        ")"
      ].join("\n"),
      "2026-01-01T00:00:22.000Z"
    );
    expect(summary.invocation?.knownSymbolInvoked).toBe("upload_to_github");
    expect(summary.invocation?.inheritedCapabilities).toEqual(
      expect.arrayContaining(["network-http", "github-target", "outbound-write"])
    );
    expect(summary.diagnostics.callsDetected).toBe(1);
    expect(summary.diagnostics.callResolved).toBe(true);
  });

  it("does not correlate unknown symbol calls", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:5|frame:0|kernel:x|notebook:y",
      "unknown_function(token='x')",
      "2026-01-01T00:00:06.000Z"
    );
    expect(summary.invocation).toBeUndefined();
    expect(summary.resolutionFailureReason).toBe("definition-not-seen");
    expect(summary.diagnostics.latestResolutionResult).toBe("failed");
  });

  it("supports symbol redefinition with updated capabilities", () => {
    const store = new PythonSemanticSessionStore();
    const context = "tab:6|frame:0|kernel:x|notebook:y";
    store.applyExecution(
      context,
      ["def op(data):", "  return data"].join("\n"),
      "2026-01-01T00:00:07.000Z"
    );
    store.applyExecution(
      context,
      ["def op(data):", "  import requests", "  return requests.post('https://api.github.com')"].join("\n"),
      "2026-01-01T00:00:08.000Z"
    );
    const summary = store.applyExecution(context, "op('x')", "2026-01-01T00:00:09.000Z");
    expect(summary.invocation?.inheritedCapabilities).toContain("network-http");
  });

  it("respects bounded symbol state", () => {
    const store = new PythonSemanticSessionStore({
      maxContexts: 10,
      maxSymbolsPerContext: 1,
      maxAgeMs: 60_000
    });
    const context = "tab:7|frame:0|kernel:x|notebook:y";
    store.applyExecution(context, "def first():\n  return 1", "2026-01-01T00:00:10.000Z");
    store.applyExecution(context, "def second():\n  import requests\n  return requests.get('https://x')", "2026-01-01T00:00:11.000Z");
    const oldInvocation = store.applyExecution(context, "first()", "2026-01-01T00:00:12.000Z");
    const newInvocation = store.applyExecution(context, "second()", "2026-01-01T00:00:13.000Z");
    expect(oldInvocation.invocation).toBeUndefined();
    expect(newInvocation.invocation?.knownSymbolInvoked).toBe("second");
  });

  it("expires stale session state", () => {
    const store = new PythonSemanticSessionStore({
      maxContexts: 10,
      maxSymbolsPerContext: 10,
      maxAgeMs: 1000
    });
    const context = "tab:8|frame:0|kernel:x|notebook:y";
    store.applyExecution(
      context,
      "def upload_to_github(data):\n  import requests\n  return requests.post('https://api.github.com')",
      "2026-01-01T00:00:00.000Z"
    );
    const expired = store.applyExecution(context, "upload_to_github('x')", "2026-01-01T00:00:03.000Z");
    expect(expired.invocation).toBeUndefined();
  });

  it("resets context state on reset", () => {
    const store = new PythonSemanticSessionStore();
    const context = "tab:9|frame:0|kernel:x|notebook:y";
    store.applyExecution(context, "def op():\n  return 1", "2026-01-01T00:00:00.000Z");
    store.resetContext(context);
    const summary = store.applyExecution(context, "op()", "2026-01-01T00:00:01.000Z");
    expect(summary.invocation).toBeUndefined();
    expect(summary.diagnostics.stateResetReason).toBe("state-reset");
  });

  it("exposes sibling-context symbol presence for session-mismatch diagnostics", () => {
    const store = new PythonSemanticSessionStore();
    store.applyExecution("tab:11|kernel:x|notebook:a", "def upload_to_github(data):\n  return data", "2026-01-01T00:01:00.000Z");
    expect(store.hasSymbolInSiblingContext("tab:11|kernel:y|notebook:a", "upload_to_github")).toBe(true);
  });

  // ── function-record invariant tests ────────────────────────────────────────

  it("persists a simple FunctionDef with zero capabilities", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:20|kernel:x|notebook:y",
      "def noop():\n  pass",
      "2026-01-01T00:10:00.000Z"
    );
    expect(summary.functionDefinitions).toHaveLength(1);
    expect(summary.functionDefinitions[0]?.name).toBe("noop");
    expect(summary.diagnostics.functionDefNodesFound).toBe(1);
    expect(summary.diagnostics.functionStoreInsertionAttempted).toBe(true);
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
    expect(summary.diagnostics.semanticStoreFunctionsAfter).toBe(1);
    // zero capabilities still persisted
    expect(summary.functionDefinitions[0]?.capabilities).toEqual([]);
    expect(summary.diagnostics.functionDroppedCount).toBe(0);
  });

  it("persists an AsyncFunctionDef", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:21|kernel:x|notebook:y",
      "async def fetch_data():\n  return None",
      "2026-01-01T00:10:01.000Z"
    );
    expect(summary.functionDefinitions[0]?.async).toBe(true);
    expect(summary.diagnostics.asyncFunctionDefNodesFound).toBe(1);
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
    expect(summary.diagnostics.semanticStoreFunctionsAfter).toBe(1);
  });

  it("persists a function containing only pass", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:22|kernel:x|notebook:y",
      "def placeholder():\n  pass",
      "2026-01-01T00:10:02.000Z"
    );
    expect(summary.functionDefinitions[0]?.name).toBe("placeholder");
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("persists a function that only returns a literal", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:23|kernel:x|notebook:y",
      "def answer():\n  return 42",
      "2026-01-01T00:10:03.000Z"
    );
    expect(summary.functionDefinitions[0]?.name).toBe("answer");
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("persists a decorated function", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:24|kernel:x|notebook:y",
      "@staticmethod\ndef helper(x):\n  return x",
      "2026-01-01T00:10:04.000Z"
    );
    expect(summary.functionDefinitions[0]?.name).toBe("helper");
    expect(summary.diagnostics.latestFunctionDecoratorCount).toBe(1);
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("persists a multiline function signature", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:25|kernel:x|notebook:y",
      [
        "def multi(",
        "  a: str,",
        "  b: int,",
        "  c: float = 1.0,",
        "):",
        "  return a"
      ].join("\n"),
      "2026-01-01T00:10:05.000Z"
    );
    expect(summary.functionDefinitions[0]?.name).toBe("multi");
    expect(summary.functionDefinitions[0]?.params).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("persists function with typed parameters", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:26|kernel:x|notebook:y",
      "def typed(x: str, y: int = 0) -> str:\n  return x",
      "2026-01-01T00:10:06.000Z"
    );
    expect(summary.functionDefinitions[0]?.name).toBe("typed");
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("persists function with *args and **kwargs", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:27|kernel:x|notebook:y",
      "def variadic(*args, **kwargs):\n  return args",
      "2026-01-01T00:10:07.000Z"
    );
    expect(summary.functionDefinitions[0]?.name).toBe("variadic");
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("persists function with try/except", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:28|kernel:x|notebook:y",
      [
        "def safe_call():",
        "  try:",
        "    import requests",
        "    return requests.get('https://example.com')",
        "  except Exception:",
        "    return None"
      ].join("\n"),
      "2026-01-01T00:10:08.000Z"
    );
    expect(summary.functionDefinitions[0]?.name).toBe("safe_call");
    expect(summary.functionDefinitions[0]?.capabilities).toContain("network-http");
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("persists function with a with block", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:29|kernel:x|notebook:y",
      [
        "def read_file(path):",
        "  with open(path, 'r') as f:",
        "    return f.read()"
      ].join("\n"),
      "2026-01-01T00:10:09.000Z"
    );
    expect(summary.functionDefinitions[0]?.name).toBe("read_file");
    expect(summary.functionDefinitions[0]?.capabilities).toContain("file-read");
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("persists function with loops", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:30|kernel:x|notebook:y",
      [
        "def batch(items):",
        "  import requests",
        "  for item in items:",
        "    requests.post('https://api.github.com/repos', json=item)"
      ].join("\n"),
      "2026-01-01T00:10:10.000Z"
    );
    expect(summary.functionDefinitions[0]?.name).toBe("batch");
    expect(summary.functionDefinitions[0]?.capabilities).toContain("network-http");
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
  });

  it("nested function does not suppress parent function persistence", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:31|kernel:x|notebook:y",
      [
        "def outer():",
        "  def inner():",
        "    pass",
        "  return inner()"
      ].join("\n"),
      "2026-01-01T00:10:11.000Z"
    );
    const names = summary.functionDefinitions.map((fn) => fn.name);
    expect(names).toContain("outer");
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
    expect(summary.diagnostics.latestFunctionNestedCount).toBeGreaterThanOrEqual(1);
  });

  it("function metadata enters analysis result", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:32|kernel:x|notebook:y",
      "def compute(x, y):\n  return x + y",
      "2026-01-01T00:10:12.000Z"
    );
    expect(summary.diagnostics.functionDefinitionsDetected).toBe(1);
    expect(summary.functionDefinitions).toHaveLength(1);
    expect(summary.diagnostics.semanticStoreFunctionsAfter).toBe(1);
  });

  it("function survives aggregation across multiple executions in the same context", () => {
    const store = new PythonSemanticSessionStore();
    const ctx = "tab:33|kernel:x|notebook:y";
    store.applyExecution(ctx, "def defined_fn():\n  pass", "2026-01-01T00:10:13.000Z");
    // second execution: imports only, no new function definitions
    const second = store.applyExecution(ctx, "import os", "2026-01-01T00:10:14.000Z");
    expect(second.diagnostics.semanticStoreFunctionsAfter).toBe(1);
    // third execution: invocation
    const third = store.applyExecution(ctx, "defined_fn()", "2026-01-01T00:10:15.000Z");
    expect(third.diagnostics.semanticStoreFunctionsAfter).toBe(1);
  });

  it("function survives normalisation – raw body is not retained in stored record", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:34|kernel:x|notebook:y",
      [
        "def sensitive():",
        "  secret = 'ghp_ABCDEF1234567890abcdef'",
        "  import requests",
        "  requests.post('https://api.github.com/repos', headers={'Authorization': f'Bearer {secret}'})"
      ].join("\n"),
      "2026-01-01T00:10:16.000Z"
    );
    const fn = summary.functionDefinitions[0];
    expect(fn).toBeDefined();
    // raw body must not be retained
    expect(Object.prototype.hasOwnProperty.call(fn ?? {}, "body")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(fn ?? {}, "rawText")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(fn ?? {}, "bodyText")).toBe(false);
    // only safe metadata retained
    expect(fn?.codeHash).toHaveLength(64);
    expect(fn?.codeLength).toBeGreaterThan(0);
  });

  it("function store insertion is attempted and succeeds for each recognised FunctionDef", () => {
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:35|kernel:x|notebook:y",
      [
        "def fn_a():\n  pass",
        "def fn_b():\n  pass",
        "def fn_c():\n  pass"
      ].join("\n"),
      "2026-01-01T00:10:17.000Z"
    );
    expect(summary.diagnostics.functionDefNodesFound).toBe(3);
    expect(summary.diagnostics.functionStoreInsertionAttempted).toBe(true);
    expect(summary.diagnostics.functionStoreInsertionSucceeded).toBe(true);
    expect(summary.diagnostics.functionStoreInsertionAttemptedCount).toBe(3);
    expect(summary.diagnostics.functionStoreInsertionSucceededCount).toBe(3);
    expect(summary.diagnostics.semanticStoreFunctionsAfter).toBe(3);
    expect(summary.diagnostics.functionDroppedCount).toBe(0);
  });

  it("function redefinition updates the stored record", () => {
    const store = new PythonSemanticSessionStore();
    const ctx = "tab:36|kernel:x|notebook:y";
    store.applyExecution(ctx, "def work():\n  return 1", "2026-01-01T00:10:18.000Z");
    store.applyExecution(
      ctx,
      "def work():\n  import requests\n  return requests.post('https://api.github.com')",
      "2026-01-01T00:10:19.000Z"
    );
    const inv = store.applyExecution(ctx, "work()", "2026-01-01T00:10:20.000Z");
    // latest definition has networking capability
    expect(inv.invocation?.inheritedCapabilities).toContain("network-http");
  });

  it("symbol key is stable across definition and invocation", () => {
    const store = new PythonSemanticSessionStore();
    const ctx = "tab:37|kernel:x|notebook:y";
    store.applyExecution(ctx, "def upload_to_github(data):\n  import requests\n  requests.post('https://api.github.com')", "2026-01-01T00:10:21.000Z");
    const inv = store.applyExecution(ctx, "upload_to_github('data')", "2026-01-01T00:10:22.000Z");
    expect(inv.invocation?.knownSymbolInvoked).toBe("upload_to_github");
  });

  it("later assignment-wrapped multiline call resolves and inherits capabilities", () => {
    const store = new PythonSemanticSessionStore();
    const ctx = "tab:38|kernel:x|notebook:y";
    store.applyExecution(
      ctx,
      [
        "def upload_to_github(data, owner, repo_path, token, message, branch):",
        "  import urllib.request",
        "  req = urllib.request.Request('https://api.github.com/repos/' + owner + '/' + repo_path, method='PUT')",
        "  req.add_header('Authorization', 'Bearer ' + token)",
        "  return urllib.request.urlopen(req)"
      ].join("\n"),
      "2026-01-01T00:10:23.000Z"
    );
    store.applyExecution(
      ctx,
      [
        "dlp_test_data = 'sensitive data'",
        "GITHUB_OWNER = 'owner/repo'",
        "GITHUB_REPO = 'my-repo'",
        "GITHUB_TOKEN = 'ghp_1234567890abcdefghijABCDEFGHIJ'",
        "GITHUB_BRANCH = 'main'"
      ].join("\n"),
      "2026-01-01T00:10:24.000Z"
    );
    const summary = store.applyExecution(
      ctx,
      [
        "result = upload_to_github(",
        "  dlp_test_data,",
        "  owner=GITHUB_OWNER,",
        "  repo_path='dlp-test-data/dlptest-sample-data.txt',",
        "  token=GITHUB_TOKEN,",
        "  message='Upload synthetic DLP test data',",
        "  branch=GITHUB_BRANCH,",
        ")"
      ].join("\n"),
      "2026-01-01T00:10:25.000Z"
    );
    expect(summary.invocation?.knownSymbolInvoked).toBe("upload_to_github");
    expect(summary.invocation?.inheritedCapabilities).toEqual(
      expect.arrayContaining(["network-http", "github-target", "token-use", "outbound-write"])
    );
    expect(summary.invocation?.argumentProvenance.some((p) => p.category === "token-like")).toBe(true);
    expect(summary.invocation?.egressPotential).toBe(true);
    expect(summary.diagnostics.callResolved).toBe(true);
  });

  it("risk factors exceed execution-only baseline when outbound capabilities are inherited", () => {
    // The test just validates the semantic summary; risk scoring is in semantic.ts
    const store = new PythonSemanticSessionStore();
    const ctx = "tab:39|kernel:x|notebook:y";
    store.applyExecution(
      ctx,
      "def upload():\n  import requests\n  requests.put('https://api.github.com/repos')",
      "2026-01-01T00:10:26.000Z"
    );
    const summary = store.applyExecution(ctx, "upload()", "2026-01-01T00:10:27.000Z");
    expect(summary.invocation?.egressPotential).toBe(true);
    expect(summary.invocation?.inheritedCapabilities).toContain("network-http");
    expect(summary.invocation?.inheritedCapabilities).toContain("github-target");
  });

  it("infers outbound-capable direct GitHub SDK call without prior function definition", () => {
    const store = new PythonSemanticSessionStore();
    const ctx = "tab:42|kernel:x|notebook:y";
    store.applyExecution(
      ctx,
      ["from github import Github", "gh = Github(GITHUB_TOKEN)", "repo = gh.get_repo('owner/repo')"].join("\n"),
      "2026-01-01T00:12:00.000Z"
    );
    const summary = store.applyExecution(
      ctx,
      "repo.create_file('out.txt', 'msg', DLP_TEST_DATA, branch='main')",
      "2026-01-01T00:12:01.000Z"
    );
    expect(summary.invocation).toBeDefined();
    expect(summary.invocation?.knownSymbolInvoked).toBeUndefined();
    expect(summary.invocation?.egressPotential).toBe(true);
    expect(summary.invocation?.inheritedCapabilities).toEqual(
      expect.arrayContaining(["github-target", "data-upload", "outbound-write"])
    );
    expect(summary.resolutionFailureReason).toBe("definition-not-seen");
    expect(summary.diagnostics.latestResolutionResult).toBe("failed");
  });

  it("every recognised FunctionDef either persists or records an explicit failure reason", () => {
    // Invariant: no silent drops allowed. functionDroppedCount must equal 0 for
    // valid, parseable function definitions.
    const store = new PythonSemanticSessionStore();
    const summary = store.applyExecution(
      "tab:40|kernel:x|notebook:y",
      [
        "def alpha():\n  pass",
        "def beta(x):\n  return x",
        "async def gamma():\n  return None"
      ].join("\n"),
      "2026-01-01T00:10:28.000Z"
    );
    expect(summary.diagnostics.functionDefNodesFound).toBe(3);
    expect(summary.diagnostics.functionExtractionAttemptedCount).toBe(3);
    expect(summary.diagnostics.functionExtractionSucceededCount).toBe(3);
    expect(summary.diagnostics.functionStoreInsertionAttemptedCount).toBe(3);
    expect(summary.diagnostics.functionStoreInsertionSucceededCount).toBe(3);
    expect(summary.diagnostics.functionDroppedCount).toBe(0);
    expect(summary.diagnostics.semanticStoreFunctionsAfter).toBe(3);
  });

  it("regression: parser recognises 3 FunctionDef nodes and all 3 enter the function store", () => {
    // Reproduces the live failure: FunctionDef nodes found: 3, Known functions: 0.
    // After the fix, every node must reach the store.
    const store = new PythonSemanticSessionStore();
    const ctx = "tab:41|kernel:x|notebook:y";
    const defSummary = store.applyExecution(
      ctx,
      [
        "def upload_to_github(data, owner, repo, repo_path, token, message, branch):",
        "  import urllib.request",
        "  req = urllib.request.Request('https://api.github.com/repos/' + owner + '/' + repo, method='PUT')",
        "  req.add_header('Authorization', 'Bearer ' + token)",
        "  return urllib.request.urlopen(req)",
        "",
        "def build_payload(data):",
        "  return {'content': data}",
        "",
        "def make_commit_message(msg):",
        "  return msg"
      ].join("\n"),
      "2026-01-01T00:11:00.000Z"
    );
    // all 3 functions recognised and stored
    expect(defSummary.diagnostics.functionDefNodesFound).toBe(3);
    expect(defSummary.diagnostics.functionStoreInsertionAttemptedCount).toBe(3);
    expect(defSummary.diagnostics.functionStoreInsertionSucceededCount).toBe(3);
    expect(defSummary.diagnostics.semanticStoreFunctionsAfter).toBe(3);
    expect(defSummary.diagnostics.functionDroppedCount).toBe(0);

    // invocation in a subsequent call resolves correctly
    const invSummary = store.applyExecution(
      ctx,
      [
        "result = upload_to_github(",
        "  'data',",
        "  owner='org/repo',",
        "  repo='repo',",
        "  repo_path='path/file.txt',",
        "  token='ghp_1234567890abcdefghijABCDEFGHIJ',",
        "  message='test',",
        "  branch='main',",
        ")"
      ].join("\n"),
      "2026-01-01T00:11:01.000Z"
    );
    // functions must still be in the store
    expect(invSummary.diagnostics.semanticStoreFunctionsAfter).toBe(3);
    // invocation resolves
    expect(invSummary.invocation?.knownSymbolInvoked).toBe("upload_to_github");
    expect(invSummary.invocation?.egressPotential).toBe(true);
    expect(invSummary.diagnostics.callResolved).toBe(true);
  });
});
