/**
 * Build-time `BASE_FRONTEND_URL` (GitHub Pages base, CDN, etc.).
 * Default `/` = same origin, site root (`/RawData/...`).
 */
function normalizedBase(): string {
  const v = import.meta.env?.BASE_FRONTEND_URL;
  const raw = typeof v === "string" ? v.trim() : "/";
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
