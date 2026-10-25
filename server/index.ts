import "dotenv/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp, ensureReady } from "./app.js";
import { dailyPuzzles, today } from "./puzzles.js";

/**
 * Long-running server (local dev, Vultr). Serves the API and, after `npm run build`, the built
 * website from dist/ on the same port, so one process is the whole app. (On Vercel, api/index.ts
 * runs the API and Vercel serves the site.)
 */
const port = Number(process.env.PORT || 4000);
const dist = fileURLToPath(new URL("../dist/", import.meta.url));

async function start() {
  await ensureReady();
  // Build today's puzzles up front (and again after midnight) so no visitor waits for them.
  setTimeout(() => dailyPuzzles(today()), 0);
  setInterval(() => dailyPuzzles(today()), 10 * 60_000).unref();
  const app = createApp();
  if (existsSync(`${dist}index.html`)) {
    // Hashed asset files never change, so browsers may keep them; index.html always revalidates.
    app.use("/assets", express.static(`${dist}assets`, { immutable: true, maxAge: "1y" }));
    app.use(express.static(dist, { index: false }));
    // Any other page (e.g. /table/123 opened directly) is the single-page app.
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(`${dist}index.html`);
    });
    console.log("[web] serving the built site from dist/");
  }
  app.listen(port, "0.0.0.0", () => {
    console.log(`betonthehorns api on :${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
