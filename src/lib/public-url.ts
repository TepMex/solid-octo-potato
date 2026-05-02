/**
 * Build-time public base for GitHub Pages (`BASE_FRONTEND_URL` env).
 * Uses `__PUBLIC_BASE_FRONTEND_URL__` from `build.ts` define so Bun inlines a string;
 * `import.meta.env?.BASE_FRONTEND_URL` is not reliably replaced and caused `/data/...`
 * to resolve to the org site root instead of `/<repo>/data/...`.
 */
function normalizedBase(): string {
  let raw: string;
  if (typeof __PUBLIC_BASE_FRONTEND_URL__ !== "undefined" && __PUBLIC_BASE_FRONTEND_URL__ !== "") {
    raw = __PUBLIC_BASE_FRONTEND_URL__;
  } else {
    const env = import.meta.env;
    const v = env != null ? env.BASE_FRONTEND_URL : undefined;
    raw = typeof v === "string" ? v.trim() : "/";
  }
  return (raw || "/").replace(/\/$/, "");
}

/** Absolute URL or root-relative path for static assets and fetch targets. */
export function publicAssetUrl(relativePath: string): string {
  const path = relativePath.replace(/^\/+/, "");
  const base = normalizedBase();
  if (!base) return `/${path}`;
  if (/^https?:\/\//i.test(base)) {
    return new URL(path, `${base}/`).href;
  }
  const prefix = base.startsWith("/") ? base : `/${base}`;
  return `${prefix.replace(/\/$/, "")}/${path}`;
}
