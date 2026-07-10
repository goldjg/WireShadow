import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Worker } from "playwright";

const shouldRunIntegration = process.env.WIRESHADOW_E2E === "1";
const suite = shouldRunIntegration ? describe : describe.skip;

suite("extension observation pipeline integration", () => {
  let context: BrowserContext;
  let extensionId = "";
  let userDataDir = "";

  beforeAll(async () => {
    const extensionPath = resolve(process.cwd(), "dist", "extension");
    if (!existsSync(extensionPath)) {
      throw new Error("dist/extension is missing. Run `npm run build` before WIRESHADOW_E2E=1 npm test.");
    }

    userDataDir = await mkdtemp(resolve(tmpdir(), "wireshadow-e2e-"));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    const serviceWorker = context.serviceWorkers()[0] ?? ((await context.waitForEvent("serviceworker")) as Worker);
    extensionId = new URL(serviceWorker.url()).host;
  }, 60_000);

  afterAll(async () => {
    await context?.close();
    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true });
    }
  });

  it(
    "receives page-ready handshake and forwards fetch/xhr observations to background",
    async () => {
      const observedPage = await context.newPage();
      await observedPage.goto("https://example.com", { waitUntil: "domcontentloaded" });

      await observedPage.evaluate(async () => {
        try {
          await fetch("https://example.com/wireshadow-fetch", {
            method: "POST",
            body: "probe=fetch"
          });
        } catch {
          // Network success is not required; the extension emits before request completion.
        }

        await new Promise<void>((resolveXhr) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "https://example.com/wireshadow-xhr");
          xhr.onload = () => resolveXhr();
          xhr.onerror = () => resolveXhr();
          xhr.send("probe=xhr");
        });
      });

      const panelPage = await context.newPage();
      await panelPage.goto(`chrome-extension://${extensionId}/panel/index.html`, {
        waitUntil: "domcontentloaded"
      });

      const pipelineState = await panelPage.evaluate(async () => {
        const chromeApi = (globalThis as any).chrome;
        const runtime = chromeApi?.runtime;
        const tabs = chromeApi?.tabs;
        if (!runtime?.sendMessage || !tabs?.query) {
          return null;
        }

        const observedTab = await new Promise<any>((resolveTab) => {
          tabs.query({ url: ["https://example.com/*"] }, (results: any[]) => resolveTab(results?.[0]));
        });

        const response = await new Promise<any>((resolveResponse) => {
          runtime.sendMessage(
            {
              type: "wireshadow-panel-get-events",
              tabId: observedTab?.id
            },
            (result: any) => resolveResponse(result)
          );
        });

        return {
          diagnostics: response?.payload?.diagnostics,
          apis: (response?.payload?.events ?? []).map((event: any) => event.api)
        };
      });

      expect(pipelineState).not.toBeNull();
      if (!pipelineState) {
        throw new Error("Pipeline state was null");
      }
      expect(pipelineState.diagnostics.pageInstrumentation).toBe("active");
      expect(pipelineState.diagnostics.contentBridge).toBe("active");
      expect(pipelineState.diagnostics.eventsObserved).toBeGreaterThanOrEqual(2);
      expect(pipelineState.apis).toContain("fetch");
      expect(pipelineState.apis).toContain("xhr");
    },
    60_000
  );
});
