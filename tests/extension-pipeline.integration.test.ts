import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
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

  beforeAll(async () => {
    const extensionPath = resolve(process.cwd(), "dist", "extension");
    if (!existsSync(extensionPath)) {
      throw new Error("dist/extension is missing. Run `npm run build` before WIRESHADOW_E2E=1 npm test.");
    }

    server = createServer((request, response) => {
      if (request.url?.startsWith("/api/probe")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"ok":true}');
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>WireShadow Smoke Test</title><main>ok</main>");
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
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    context.pages().forEach(attachPageDiagnostics);
    context.on("page", attachPageDiagnostics);

    const serviceWorker = context.serviceWorkers()[0] ?? ((await context.waitForEvent("serviceworker")) as Worker);
    extensionId = new URL(serviceWorker.url()).host;
  }, 90_000);

  afterAll(async () => {
    await context?.close();
    await new Promise<void>((resolveClosed) => server?.close(() => resolveClosed()));
    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true });
    }
  });

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
    },
    90_000
  );
});
