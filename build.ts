#!/usr/bin/env bun
import plugin from "bun-plugin-tailwind";
import { existsSync } from "fs";
import { copyFile, rm } from "fs/promises";
import path from "path";
import { prepareExamData } from "./scripts/prepare-exam-data";
import { buildPrecacheUrls, writeServiceWorker } from "./scripts/write-service-worker";

/** Path prefix only, e.g. `/my-repo` for `https://user.github.io/my-repo`. */
function pathnamePrefixFromBase(base: string): string {
  const b = base.trim().replace(/\/$/, "");
  if (!b) return "";
  if (/^https?:\/\//i.test(b)) {
    return new URL(b.endsWith("/") ? b : `${b}/`).pathname.replace(/\/$/, "") || "";
  }
  return (b.startsWith("/") ? b : `/${b}`).replace(/\/$/, "");
}

function publicPathForBun(base: string): string | undefined {
  const p = pathnamePrefixFromBase(base);
  if (!p) return undefined;
  return `${p}/`;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
🏗️  Bun Build Script

Usage: bun run build.ts [options]

Common Options:
  --outdir <path>          Output directory (default: "dist")
  --minify                 Enable minification (or --minify.whitespace, --minify.syntax, etc)
  --sourcemap <type>      Sourcemap type: none|linked|inline|external
  --target <target>        Build target: browser|bun|node
  --format <format>        Output format: esm|cjs|iife
  --splitting              Enable code splitting
  --packages <type>        Package handling: bundle|external
  --public-path <path>     Public path for assets
  --env <mode>             Environment handling: inline|disable|prefix*
  --conditions <list>      Package.json export conditions (comma separated)
  --external <list>        External packages (comma separated)
  --banner <text>          Add banner text to output
  --footer <text>          Add footer text to output
  --define <obj>           Define global constants (e.g. --define.VERSION=1.0.0)
  --help, -h               Show this help message

Example:
  bun run build.ts --outdir=dist --minify --sourcemap=linked --external=react,react-dom
`);
  process.exit(0);
}

const toCamelCase = (str: string): string => str.replace(/-([a-z])/g, g => g[1].toUpperCase());

const parseValue = (value: string): any => {
  if (value === "true") return true;
  if (value === "false") return false;

  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d*\.\d+$/.test(value)) return parseFloat(value);

  if (value.includes(",")) return value.split(",").map(v => v.trim());

  return value;
};

function parseArgs(): Partial<Bun.BuildConfig> {
  const config: Partial<Bun.BuildConfig> = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) continue;

    if (arg.startsWith("--no-")) {
      const key = toCamelCase(arg.slice(5));
      config[key] = false;
      continue;
    }

    if (!arg.includes("=") && (i === args.length - 1 || args[i + 1]?.startsWith("--"))) {
      const key = toCamelCase(arg.slice(2));
      config[key] = true;
      continue;
    }

    let key: string;
    let value: string;

    if (arg.includes("=")) {
      [key, value] = arg.slice(2).split("=", 2) as [string, string];
    } else {
      key = arg.slice(2);
      value = args[++i] ?? "";
    }

    key = toCamelCase(key);

    if (key.includes(".")) {
      const [parentKey, childKey] = key.split(".");
      config[parentKey] = config[parentKey] || {};
      config[parentKey][childKey] = parseValue(value);
    } else {
      config[key] = parseValue(value);
    }
  }

  return config;
}

const formatFileSize = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

console.log("\n🚀 Starting build process...\n");

const cliConfig = parseArgs();
const outdir = cliConfig.outdir || path.join(process.cwd(), "dist");
const baseFrontend = process.env.BASE_FRONTEND_URL?.trim() || "/";
const pathPrefix = pathnamePrefixFromBase(baseFrontend);

if (existsSync(outdir)) {
  console.log(`🗑️ Cleaning previous build at ${outdir}`);
  await rm(outdir, { recursive: true, force: true });
}

const start = performance.now();

const entrypoints = [...new Bun.Glob("**.html").scanSync("src")]
  .map(a => path.resolve("src", a))
  .filter(dir => !dir.includes("node_modules"));
console.log(`📄 Found ${entrypoints.length} HTML ${entrypoints.length === 1 ? "file" : "files"} to process\n`);

const optionalPublicPath = publicPathForBun(baseFrontend);
const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [plugin],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  ...(optionalPublicPath ? { publicPath: optionalPublicPath } : {}),
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.BASE_FRONTEND_URL": JSON.stringify(baseFrontend),
  },
  ...cliConfig,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.BASE_FRONTEND_URL": JSON.stringify(baseFrontend),
    ...(typeof cliConfig.define === "object" && cliConfig.define ? cliConfig.define : {}),
  },
  publicPath: cliConfig.publicPath ?? optionalPublicPath,
});

if (!result.success) {
  console.error("Build failed", result.logs);
  process.exit(1);
}

const end = performance.now();

const outputTable = result.outputs.map(output => ({
  File: path.relative(process.cwd(), output.path),
  Type: output.kind,
  Size: formatFileSize(output.size),
}));

console.table(outputTable);
const buildTime = (end - start).toFixed(2);

const processedDir = path.join(process.cwd(), "processed");
if (existsSync(path.join(processedDir, "tasks.jsonl"))) {
  console.log("\n📦 Preparing exam data and PWA service worker...\n");
  const dataUrls = await prepareExamData(processedDir, outdir);
  const pub = path.join(process.cwd(), "public");
  const root = process.cwd();
  for (const [from, to] of [
    [path.join(pub, "manifest.webmanifest"), path.join(outdir, "manifest.webmanifest")],
    [path.join(pub, "icon.svg"), path.join(outdir, "icon.svg")],
    [path.join(root, "src", "logo.svg"), path.join(outdir, "logo.svg")],
  ] as const) {
    if (existsSync(from)) {
      await copyFile(from, to);
    }
  }

  const manifestOut = path.join(outdir, "manifest.webmanifest");
  if (pathPrefix && existsSync(manifestOut)) {
    const raw = await Bun.file(manifestOut).text();
    const m = JSON.parse(raw) as {
      start_url?: string;
      icons?: { src?: string }[];
    };
    m.start_url = `${pathPrefix}/`;
    for (const icon of m.icons ?? []) {
      if (typeof icon.src === "string" && icon.src.startsWith("/")) {
        icon.src = `${pathPrefix}${icon.src}`;
      }
    }
    await Bun.write(manifestOut, JSON.stringify(m, null, 2));
  }

  const precache = await buildPrecacheUrls(outdir, dataUrls, pathPrefix);
  await writeServiceWorker(outdir, precache);
  console.log(`   Precache ${precache.length} URLs (see ${path.join(outdir, "precache-manifest.json")})`);
} else {
  console.warn("\n⚠️  Skipping exam data: processed/tasks.jsonl not found. Add it to build a full PWA bundle.\n");
}

const indexHtmlPath = path.join(outdir, "index.html");
if (existsSync(indexHtmlPath)) {
  await Bun.write(path.join(outdir, ".nojekyll"), "");
  await copyFile(indexHtmlPath, path.join(outdir, "404.html"));
}

console.log(`\n✅ Build completed in ${buildTime}ms\n`);
