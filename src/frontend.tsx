/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { publicAssetUrl } from "./lib/public-url";

if (!document.querySelector('link[rel="manifest"]')) {
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = publicAssetUrl("manifest.webmanifest");
  document.head.appendChild(link);
}

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

if (import.meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  // The hot module reloading API is not available in production.
  createRoot(elem).render(app);
}

function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const local =
    location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  if (!local) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(publicAssetUrl("service-worker.js")).catch(() => {});
  });
}

registerServiceWorker();
