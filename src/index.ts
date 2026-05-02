import { existsSync } from "fs";
import path from "path";
import { serve } from "bun";
import index from "./index.html";
import { loadTasksPayload, resolveImageFile } from "./exam-data-server";

const cwd = process.cwd();
const distDir = path.join(cwd, "dist");
const useDist = process.env.NODE_ENV === "production" && existsSync(path.join(distDir, "index.html"));

function mimeType(filePath: string): string {
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".webmanifest")) return "application/manifest+json";
  if (filePath.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function resolveFirstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    if (await Bun.file(p).exists()) return p;
  }
  return null;
}

async function serveDistSpa(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";
  const rel = pathname.replace(/^\/+/, "");
  if (rel.includes("..")) {
    return new Response("Invalid path", { status: 400 });
  }
  const filePath = path.join(distDir, rel);
  const file = Bun.file(filePath);
  if (await file.exists()) {
    const st = await file.stat();
    if (st.isFile()) {
      return new Response(file, { headers: { "Content-Type": mimeType(rel) } });
    }
  }
  const fallback = Bun.file(path.join(distDir, "index.html"));
  return new Response(fallback, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const server = serve({
  routes: {
    "/data/tasks.json": async () => {
      try {
        const payload = await loadTasksPayload();
        return Response.json(payload, {
          headers: {
            "Cache-Control": "public, max-age=300",
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load tasks";
        return Response.json({ error: msg }, { status: 404 });
      }
    },

    "/images/:filename": async req => {
      const name = req.params.filename;
      const filePath = await resolveImageFile(name);
      if (!filePath) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(Bun.file(filePath), {
        headers: {
          "Cache-Control": "public, max-age=86400",
        },
      });
    },

    "/manifest.webmanifest": async () => {
      const manifestPath = await resolveFirstExisting(
        useDist
          ? [path.join(distDir, "manifest.webmanifest"), path.join(cwd, "public", "manifest.webmanifest")]
          : [path.join(cwd, "public", "manifest.webmanifest")],
      );
      if (manifestPath) {
        return new Response(Bun.file(manifestPath), {
          headers: { "Content-Type": "application/manifest+json" },
        });
      }
      return new Response("Not found", { status: 404 });
    },

    "/service-worker.js": async () => {
      const swPath = await resolveFirstExisting(
        useDist
          ? [path.join(distDir, "service-worker.js"), path.join(cwd, "public", "service-worker.js")]
          : [path.join(cwd, "public", "service-worker.js")],
      );
      if (swPath) {
        return new Response(Bun.file(swPath), {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Service-Worker-Allowed": "/",
            "Cache-Control": "no-cache",
          },
        });
      }
      return new Response("Not found", { status: 404 });
    },

    "/icon.svg": async () => {
      const iconPath = await resolveFirstExisting(
        useDist
          ? [path.join(distDir, "icon.svg"), path.join(cwd, "public", "icon.svg")]
          : [path.join(cwd, "public", "icon.svg")],
      );
      if (iconPath) {
        return new Response(Bun.file(iconPath), {
          headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
        });
      }
      return new Response("Not found", { status: 404 });
    },

    "/*": useDist ? serveDistSpa : index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}${useDist ? " (static from dist/)" : ""}`);
