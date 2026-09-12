import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";

const shouldRunIntegration = process.env.WIRESHADOW_E2E === "1";
const suite = shouldRunIntegration ? describe : describe.skip;

suite("extension built-output smoke test", () => {
  let context: BrowserContext;
  let server: Server;
  let baseUrl = "";
  let extensionId = "";
  let userDataDir = "";
  let evidenceDir = "";
  const upgradedSockets = new Set<Duplex>();
  const runtimeErrors: string[] = [];

  const attachPageDiagnostics = (page: Page): void => {
    page.on("pageerror", (error) => {
      runtimeErrors.push(`[pageerror] ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(`[console:error] ${message.text()}`);
      }
    });
  };

  const queryPanelState = async (panelPage: Page, tabId: number | undefined) =>
    panelPage.evaluate(async ({ selectedTabId }) => {
      const chromeApi = (globalThis as any).chrome;
      const runtime = chromeApi?.runtime;
      if (!runtime?.sendMessage) {
        return null;
      }
      return await new Promise<any>((resolveResponse) => {
        runtime.sendMessage(
          { type: "wireshadow-panel-get-events", tabId: selectedTabId },
          (response: any) => resolveResponse(response?.payload ?? null)
        );
      });
    }, { selectedTabId: tabId });

  const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) {
        return;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    throw new Error("Timed out waiting for smoke-test condition");
  };

  const capturePanelEvidence = async (
    panelPage: Page,
    tabId: number | undefined,
    expectedText: string,
    fileName: string
  ): Promise<void> => {
    if (typeof tabId !== "number") {
      throw new Error("Cannot capture panel evidence without an observed tab id");
    }
    await panelPage.evaluate(async ({ selectedTabId }) => {
      const chromeApi = (globalThis as any).chrome;
      await new Promise<void>((resolveUpdated) => {
        chromeApi.tabs.update(selectedTabId, { active: true }, () => resolveUpdated());
      });
    }, { selectedTabId: tabId });
    await panelPage.reload({ waitUntil: "domcontentloaded" });
    await panelPage.waitForFunction(
      ({ text }) => document.body.innerText.includes(text),
      { text: expectedText },
      { timeout: 15_000 }
    );
    await panelPage.screenshot({ path: resolve(evidenceDir, fileName), fullPage: true });
  };

  beforeAll(async () => {
    const extensionPath = resolve(process.cwd(), "dist", "extension");
    if (!existsSync(extensionPath)) {
      throw new Error("dist/extension is missing. Run `npm run build` before WIRESHADOW_E2E=1 npm test.");
    }
    evidenceDir = resolve(process.cwd(), "docs", "test-evidence");
    await mkdir(evidenceDir, { recursive: true });

    server = createServer((request, response) => {
      if (request.url?.startsWith("/api/probe")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"ok":true}');
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>WireShadow Smoke Test</title><main>ok</main>");
    });
    server.on("upgrade", (request, socket) => {
      const websocketKey = request.headers["sec-websocket-key"];
      if (typeof websocketKey !== "string") {
        socket.destroy();
        return;
      }
      upgradedSockets.add(socket);
      socket.once("close", () => upgradedSockets.delete(socket));
      const accept = createHash("sha1")
        .update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write([
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        ""
      ].join("\r\n"));
    });
    await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", () => resolveReady()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve local smoke-test server address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    userDataDir = await mkdtemp(resolve(tmpdir(), "wireshadow-e2e-"));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--host-resolver-rules=MAP www.kaggle.com 127.0.0.1"
      ]
    });

    context.pages().forEach(attachPageDiagnostics);
    context.on("page", attachPageDiagnostics);

    const serviceWorker = context.serviceWorkers()[0] ?? ((await context.waitForEvent("serviceworker")) as Worker);
    extensionId = new URL(serviceWorker.url()).host;
  }, 90_000);

  afterAll(async () => {
    await context?.close();
    for (const socket of upgradedSockets) {
      socket.destroy();
    }
    upgradedSockets.clear();
    server?.closeAllConnections();
    await new Promise<void>((resolveClosed) => server?.close(() => resolveClosed()));
    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true });
    }
  }, 90_000);

  it(
    "loads built extension, reports bridge readiness, and stores an observed fetch event",
    async () => {
      const observedPage = await context.newPage();
      await observedPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });

      const panelPage = await context.newPage();
      await panelPage.goto(`chrome-extension://${extensionId}/panel/index.html`, {
        waitUntil: "domcontentloaded"
      });

      const tabId = await panelPage.evaluate(async ({ observedBaseUrl }) => {
        const chromeApi = (globalThis as any).chrome;
        const tabs = chromeApi?.tabs;
        if (!tabs?.query) {
          return undefined;
        }
        const selected = await new Promise<any>((resolveTab) => {
          tabs.query({ url: [`${observedBaseUrl}/*`] }, (results: any[]) => resolveTab(results?.[0]));
        });
        return selected?.id;
      }, { observedBaseUrl: baseUrl });

      await waitFor(async () => {
        const payload = await queryPanelState(panelPage, tabId);
        return (
          payload?.diagnostics?.contentBridge === "active" &&
          payload?.diagnostics?.pageInstrumentation === "active"
        );
      });

      await observedPage.evaluate(async ({ probeBaseUrl }) => {
        await fetch(`${probeBaseUrl}/api/probe`, {
          method: "POST",
          body: "probe=fetch"
        });
      }, { probeBaseUrl: baseUrl });

      await waitFor(async () => {
        const payload = await queryPanelState(panelPage, tabId);
        const apis = (payload?.events ?? []).map((event: any) => event.api);
        return apis.includes("fetch");
      });

      const finalPayload = await queryPanelState(panelPage, tabId);
      expect(finalPayload?.diagnostics?.contentBridge).toBe("active");
      expect(finalPayload?.diagnostics?.pageInstrumentation).toBe("active");
      expect((finalPayload?.events ?? []).some((event: any) => event.api === "fetch")).toBe(true);
      expect(runtimeErrors).toEqual([]);
      await capturePanelEvidence(panelPage, tabId, "Events observed:", "extension-smoke-fetch.png");
    },
    90_000
  );

  it(
    "surfaces Kaggle Jupyter delegated execution with retained screenshot evidence",
    async () => {
      const kagglePage = await context.newPage();
      await kagglePage.goto(`http://www.kaggle.com:${new URL(baseUrl).port}/code/example/notebook`, {
        waitUntil: "domcontentloaded"
      });

      const panelPage = await context.newPage();
      await panelPage.goto(`chrome-extension://${extensionId}/panel/index.html`, {
        waitUntil: "domcontentloaded"
      });
      const tabId = await panelPage.evaluate(async () => {
        const chromeApi = (globalThis as any).chrome;
        const selected = await new Promise<any>((resolveTab) => {
          chromeApi.tabs.query({ url: ["http://www.kaggle.com:*/code/*"] }, (results: any[]) => {
            resolveTab(results?.[0]);
          });
        });
        return selected?.id;
      });

      await waitFor(async () => {
        const payload = await queryPanelState(panelPage, tabId);
        return payload?.diagnostics?.pageInstrumentation === "active";
      });

      await kagglePage.evaluate(async ({ socketUrl }) => {
        const frame = JSON.stringify({
          header: { msg_id: "browser-evidence", msg_type: "execute_request" },
          content: {
            code: "import requests\nrequests.post('https://api.github.com/repos/example/repo/issues')"
          }
        });
        await new Promise<void>((resolveSent, rejectSend) => {
          const socket = new WebSocket(socketUrl);
          socket.addEventListener("open", () => {
            socket.send(frame);
            resolveSent();
          }, { once: true });
          socket.addEventListener("error", () => rejectSend(new Error("WebSocket fixture failed")), { once: true });
        });
      }, { socketUrl: `ws://www.kaggle.com:${new URL(baseUrl).port}/api/kernels/browser-evidence/channels` });

      await waitFor(async () => {
        const payload = await queryPanelState(panelPage, tabId);
        return (payload?.events ?? []).some(
          (event: any) =>
            event.delegatedExecutionEvent?.executionPlatform === "kaggle-notebooks" &&
            event.riskFlags?.includes("hidden-egress")
        );
      });

      const finalPayload = await queryPanelState(panelPage, tabId);
      const semanticEvent = (finalPayload?.events ?? []).find(
        (event: any) => event.delegatedExecutionEvent?.executionPlatform === "kaggle-notebooks"
      );
      expect(semanticEvent?.riskFlags).toEqual(
        expect.arrayContaining(["delegated-execution", "code-execution", "hidden-egress"])
      );
      expect(semanticEvent?.metadata?.jupyterCodeHash).toHaveLength(64);
      expect(JSON.stringify(semanticEvent)).not.toContain("requests.post");
      expect(runtimeErrors).toEqual([]);
      await capturePanelEvidence(
        panelPage,
        tabId,
        "kaggle-notebooks",
        "kaggle-delegated-execution.png"
      );
    },
    90_000
  );
});
