import type { ExamTask, TasksPayload } from "./lib/exam-types";
import path from "path";

const cwd = () => process.cwd();

function jsonlPath() {
  return path.join(cwd(), "processed", "tasks.jsonl");
}

function distTasksJson() {
  return path.join(cwd(), "dist", "data", "tasks.json");
}

let parsedCache: TasksPayload | null = null;

async function parseJsonl(): Promise<TasksPayload> {
  const p = jsonlPath();
  const f = Bun.file(p);
  if (!(await f.exists())) {
    throw new Error(`Missing ${p}`);
  }
  const text = await f.text();
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  const tasks: ExamTask[] = lines.map((line, id) => {
    const row = JSON.parse(line) as Omit<ExamTask, "id">;
    return { ...row, id };
  });
  return { tasks };
}

/**
 * Development: prefer processed/tasks.jsonl when present.
 * Production / post-build: use dist/data/tasks.json when present.
 */
export async function loadTasksPayload(): Promise<TasksPayload> {
  if (parsedCache) return parsedCache;

  const jl = jsonlPath();
  const devFirst = process.env.NODE_ENV !== "production" && (await Bun.file(jl).exists());

  if (devFirst) {
    parsedCache = await parseJsonl();
    return parsedCache;
  }

  const dj = distTasksJson();
  if (await Bun.file(dj).exists()) {
    parsedCache = (await Bun.file(dj).json()) as TasksPayload;
    return parsedCache;
  }

  if (await Bun.file(jl).exists()) {
    parsedCache = await parseJsonl();
    return parsedCache;
  }

  throw new Error("No exam data: add processed/tasks.jsonl or run build with prepare step.");
}

export function invalidateTasksCache() {
  parsedCache = null;
}

export function imageSearchRoots(): string[] {
  const roots =
    process.env.NODE_ENV === "production"
      ? [path.join(cwd(), "dist", "images")]
      : [path.join(cwd(), "processed"), path.join(cwd(), "processed", "images"), path.join(cwd(), "dist", "images")];
  return roots;
}

export async function resolveImageFile(filename: string): Promise<string | null> {
  const safe = path.basename(filename);
  if (safe !== filename || safe.includes("..")) return null;

  for (const root of imageSearchRoots()) {
    const full = path.join(root, safe);
    if (await Bun.file(full).exists()) return full;
  }
  return null;
}
