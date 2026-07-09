import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const outputDir = resolve(process.cwd(), "docs", "screenshots");
const panelHtmlPath = resolve(process.cwd(), "src", "extension", "panel", "index.html");
const panelUrl = `file://${panelHtmlPath}`;

const colabSignalEvent = {
  observedAt: new Date().toISOString(),
  api: "fetch",
  destination: { host: "api.github.com" },
  classification: { categories: ["token-like", "base64-like"] },
  riskFlags: ["delegated-execution", "hidden-egress", "embedded-data", "code-execution"],
  context: { url: "https://colab.research.google.com/drive/example-notebook-id" },
  recogniserFindings: [{ recogniserId: "colab-semantic-recogniser" }],
  detectedCapabilities: ["python-networking", "github-target", "http-method-intent", "token-like-indicator"],
  trustBoundaryCrossings: [
    "browser -> saas-control-plane",
    "saas-control-plane -> managed-runtime",
    "managed-runtime -> external-egress"
  ],
  timeline: [
    { title: "Notebook edited", details: "User modified executable Python cell content." },
    { title: "Outbound capability detected", details: "Networking helpers and GitHub target markers found." },
    { title: "Execution observed", details: "Notebook execution marker indicates delegated runtime activity." }
  ],
  riskScore: {
    total: 67,
    factors: [
      { title: "Colab notebook context", score: 15, detected: true },
      { title: "Networking capability in Python", score: 20, detected: true },
      { title: "GitHub/cloud target indicators", score: 12, detected: true },
      { title: "Embedded data marker", score: 10, detected: true },
      { title: "Execution marker", score: 10, detected: true }
    ]
  }
};

const screenshots = [
  { name: "panel-empty-state.png", events: [] },
  { name: "panel-colab-signal.png", events: [colabSignalEvent] }
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

for (const shot of screenshots) {
  const page = await context.newPage();
  await page.addInitScript((mockEvents) => {
    globalThis.chrome = {
      runtime: {
        sendMessage(_message, callback) {
          callback({ payload: { events: mockEvents } });
        }
      }
    };
  }, shot.events);

  await page.goto(panelUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(outputDir, shot.name), fullPage: true });
  await page.close();
}

await context.close();
await browser.close();

console.log(`Generated ${screenshots.length} screenshots in ${outputDir}`);
