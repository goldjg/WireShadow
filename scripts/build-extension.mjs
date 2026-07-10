import { build } from "esbuild";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import vm from "node:vm";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const srcExtensionDir = resolve(repoRoot, "src", "extension");
const extensionOutDir = resolve(repoRoot, "dist", "extension");
const panelOutDir = resolve(extensionOutDir, "panel");

const bundleTargets = [
  {
    entryPoint: resolve(srcExtensionDir, "content-script.ts"),
    outfile: resolve(extensionOutDir, "content-script.js"),
    format: "iife"
  },
  {
    entryPoint: resolve(srcExtensionDir, "page-world.ts"),
    outfile: resolve(extensionOutDir, "page-world.js"),
    format: "iife"
  },
  {
    entryPoint: resolve(srcExtensionDir, "background.ts"),
    outfile: resolve(extensionOutDir, "background.js"),
    format: "esm"
  },
  {
    entryPoint: resolve(srcExtensionDir, "panel", "panel.ts"),
    outfile: resolve(panelOutDir, "panel.js"),
    format: "iife"
  }
];

const buildBundle = async (target) => {
  await build({
    entryPoints: [target.entryPoint],
    outfile: target.outfile,
    bundle: true,
    platform: "browser",
    format: target.format,
    target: "es2022",
    sourcemap: false,
    legalComments: "none"
  });
};

const verifyClassicScript = async (path) => {
  const content = await readFile(path, "utf8");
  try {
    new vm.Script(content, { filename: path });
  } catch (error) {
    throw new Error(`Module syntax verification failed for ${path}: ${String(error)}`);
  }
};

const copyPanelStaticFiles = async (srcDir, destDir) => {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = resolve(srcDir, entry.name);
    const destPath = resolve(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyPanelStaticFiles(srcPath, destPath);
      continue;
    }
    if (!/\.(html|css|png|svg|ico)$/i.test(entry.name)) {
      continue;
    }
    await cp(srcPath, destPath);
  }
};

await rm(extensionOutDir, { recursive: true, force: true });
await mkdir(panelOutDir, { recursive: true });

for (const target of bundleTargets) {
  await buildBundle(target);
}

await cp(resolve(srcExtensionDir, "manifest.json"), resolve(extensionOutDir, "manifest.json"));
await copyPanelStaticFiles(resolve(srcExtensionDir, "panel"), panelOutDir);

for (const assetDirName of ["assets", "icons", "images"]) {
  const assetDir = resolve(srcExtensionDir, assetDirName);
  try {
    await cp(assetDir, resolve(extensionOutDir, assetDirName), { recursive: true });
  } catch {
    // Optional asset directory absent.
  }
}

for (const fileName of await readdir(srcExtensionDir)) {
  if (!/\.(png|svg|ico)$/i.test(fileName)) {
    continue;
  }
  await cp(resolve(srcExtensionDir, fileName), resolve(extensionOutDir, fileName));
}

await verifyClassicScript(resolve(extensionOutDir, "content-script.js"));
await verifyClassicScript(resolve(extensionOutDir, "page-world.js"));

console.log(`Built unpacked extension in ${extensionOutDir}`);
