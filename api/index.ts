function restoreUrl(req: { url?: string; headers: Record<string, unknown> }) {
  const raw =
    req.headers["x-vercel-original-url"] ??
    req.headers["x-invoke-path"] ??
    req.headers["x-forwarded-uri"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !value) return;
  try {
    const url = value.startsWith("http") ? new URL(value) : new URL(value, "http://n");
    const path = `${url.pathname}${url.search}`;
    if (path.startsWith("/api")) req.url = path;
  } catch {
    if (value.startsWith("/api")) req.url = value;
  }
}

export default async function handler(
  req: { url?: string; headers: Record<string, unknown> },
  res: {
    status: (code: number) => { json: (body: unknown) => unknown };
    json: (body: unknown) => unknown;
  },
) {
  try {
    restoreUrl(req);
    const path = typeof req.url === "string" ? req.url.split("?")[0] : "";
    if (path === "/api/health" || path.includes("ping=1")) {
      return res.json({
        ok: true,
        service: "betonthehorns",
        ping: true,
        env: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          ABLY_ROOT_KEY: Boolean(process.env.ABLY_ROOT_KEY),
          ABLY_SUBSCRIBE_KEY: Boolean(process.env.ABLY_SUBSCRIBE_KEY),
        },
      });
    }
    const { createApp, ensureReady } = await import("../server/app.js");
    void ensureReady();
    const app = createApp();
    return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api]", message);
    return res.status(500).json({
      error: message,
      env: {
        DATABASE_URL: Boolean(process.env.DATABASE_URL),
        ABLY_ROOT_KEY: Boolean(process.env.ABLY_ROOT_KEY),
        ABLY_SUBSCRIBE_KEY: Boolean(process.env.ABLY_SUBSCRIBE_KEY),
      },
    });
  }
}
