#!/usr/bin/env bun
/**
 * Converts processed/tasks.jsonl to tasks.json, copies question JPEGs into outdir/images.
 *
 * Layout (place images next to tasks.jsonl before build):
 *   processed/tasks.jsonl
 *   processed/<filename>.jpg   — same folder as jsonl, OR
 *   processed/images/<filename>.jpg
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
  const nested = path.join(sourceDir, "images", filename);
  if (await Bun.file(nested).exists()) return nested;
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
  const imagesDir = path.join(outDir, "images");
  await mkdir(dataDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });

  await Bun.write(path.join(dataDir, "tasks.json"), JSON.stringify({ tasks } satisfies TasksPayload));

  const precacheUrls: string[] = ["/data/tasks.json"];
  const seen = new Set<string>();

  for (const t of tasks) {
    if (seen.has(t.img)) continue;
    seen.add(t.img);
    const src = await resolveImagePath(sourceDir, t.img);
    if (src) {
      await copyFile(src, path.join(imagesDir, path.basename(t.img)));
      precacheUrls.push(`/images/${t.img.split("/").pop()}`);
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
