import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const compiledExtensionDir = resolve(repoRoot, "dist", "src", "extension");
const extensionBundleDir = resolve(repoRoot, "dist", "extension");
const extensionPanelDir = resolve(extensionBundleDir, "panel");

await rm(extensionBundleDir, { recursive: true, force: true });
await mkdir(extensionPanelDir, { recursive: true });

const extensionScripts = ["background.js", "content-script.js", "page-world.js"];
for (const scriptName of extensionScripts) {
  await cp(resolve(compiledExtensionDir, scriptName), resolve(extensionBundleDir, scriptName));
}

await cp(resolve(repoRoot, "src", "extension", "manifest.json"), resolve(extensionBundleDir, "manifest.json"));
await cp(resolve(repoRoot, "src", "extension", "panel", "index.html"), resolve(extensionPanelDir, "index.html"));

console.log(`Prepared unpacked extension in ${extensionBundleDir}`);
