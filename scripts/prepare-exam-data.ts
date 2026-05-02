#!/usr/bin/env bun
/**
 * Converts processed/tasks.jsonl to tasks.json, copies question JPEGs into outdir/RawData.
 *
 * Layout (place images before build):
 *   RawData/<filename>.jpg     — project root (see RAW_DATA_DIR in .env), OR
 *   processed/tasks.jsonl
 *   processed/<filename>.jpg   — same folder as jsonl, OR
 *   processed/images/ or processed/RawData/
 */
import type { ExamTask, TasksPayload } from "../src/lib/exam-types";
import { copyFile, mkdir } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const DEFAULT_SOURCE = path.join(ROOT, "processed");
const DEFAULT_OUT = path.join(ROOT, "dist");

function parseArgs(): { sourceDir: string; outDir: string } {
  let sourceDir = DEFAULT_SOURCE;
  let outDir = DEFAULT_OUT;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--source" && args[i + 1]) {
      sourceDir = path.resolve(args[++i] ?? sourceDir);
    } else if (a === "--outdir" && args[i + 1]) {
      outDir = path.resolve(args[++i] ?? outDir);
    }
  }
  return { sourceDir, outDir };
}

async function resolveImagePath(sourceDir: string, filename: string): Promise<string | null> {
  const base = path.join(sourceDir, filename);
  if (await Bun.file(base).exists()) return base;
  const inImages = path.join(sourceDir, "images", filename);
  if (await Bun.file(inImages).exists()) return inImages;
  const inProcRaw = path.join(sourceDir, "RawData", filename);
  if (await Bun.file(inProcRaw).exists()) return inProcRaw;
  const rootRaw = path.join(ROOT, "RawData", filename);
  if (await Bun.file(rootRaw).exists()) return rootRaw;
  return null;
}

export async function prepareExamData(sourceDir: string, outDir: string): Promise<string[]> {
  const jsonlPath = path.join(sourceDir, "tasks.jsonl");
  if (!(await Bun.file(jsonlPath).exists())) {
    throw new Error(`Missing ${jsonlPath}. Add processed/tasks.jsonl (and JPEGs) before build.`);
  }

  const text = await Bun.file(jsonlPath).text();
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  const tasks: ExamTask[] = lines.map((line, id) => {
    const row = JSON.parse(line) as Omit<ExamTask, "id">;
    return { ...row, id };
  });

  const dataDir = path.join(outDir, "data");
  const rawDataDir = path.join(outDir, "RawData");
  await mkdir(dataDir, { recursive: true });
  await mkdir(rawDataDir, { recursive: true });

  await Bun.write(path.join(dataDir, "tasks.json"), JSON.stringify({ tasks } satisfies TasksPayload));

  const precacheUrls: string[] = ["/data/tasks.json"];
  const seen = new Set<string>();

  for (const t of tasks) {
    if (seen.has(t.img)) continue;
    seen.add(t.img);
    const src = await resolveImagePath(sourceDir, t.img);
    if (src) {
      await copyFile(src, path.join(rawDataDir, path.basename(t.img)));
      const base = t.img.split("/").pop() ?? t.img;
      precacheUrls.push(`/RawData/${base}`);
    } else {
      console.warn(`[prepare-exam-data] Missing image for task ${t.id}: ${t.img}`);
    }
  }

  return precacheUrls;
}

if (import.meta.main) {
  const { sourceDir, outDir } = parseArgs();
  const urls = await prepareExamData(sourceDir, outDir);
  console.log(`[prepare-exam-data] Wrote tasks + images → ${outDir} (${urls.length} precache entries incl. tasks.json)`);
}
