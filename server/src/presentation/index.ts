import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import type { Context } from "../usecases/context";
import { recordVisit } from "../usecases/usage/record-visit";
import { managementMcp } from "./mcp";
import { adminAccess } from "./middleware/admin-access";
import { requestLog } from "./middleware/request-log";
import { appRouter } from "./trpc/routers";

const STATIC_DIR = process.env.STATIC_DIR ?? "./static";

export function createApp(ctx: Context) {
  const app = new Hono();
  // Each request observes its own time.
  const fresh = (): Context => ({ ...ctx, now: new Date() });

  // 何よりも先に。後段が何を返しても記録が残るようにする。
  app.use(requestLog(ctx.logger));

  app.use(compress());

  app.use(
    secureHeaders({
      xFrameOptions: "SAMEORIGIN",
      xContentTypeOptions: "nosniff",
      xXssProtection: "1; mode=block",
      referrerPolicy: "strict-origin-when-cross-origin",
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.use("*", adminAccess());
  app.post("/api/usage/visit", async (c) => {
    c.header("Cache-Control", "no-store");
    if (c.req.header("X-Yuniview-Visit") !== "1") return c.body(null, 400);
    const visit = await recordVisit(c.get("usageSubject")).run(fresh());
    return c.body(null, visit.ok && visit.value === "recorded" ? 204 : 503);
  });

  const mcp = managementMcp(ctx);
  app.all("/mcp", async (c) => {
    const url = new URL(c.req.url);
    const origin = c.req.header("Origin");
    if (origin && origin !== url.origin) return c.body(null, 403);
    if (
      process.env.YUNIVIEW_ADMIN_AUTH === "local" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return c.body(null, 403);
    return mcp.fetch(c.req.raw);
  });
  app.all("/api/agent/*", (c) => c.notFound());

  app.use(
    "/api/trpc/*",
    trpcServer({
      router: appRouter,
      createContext: () => fresh() as unknown as Record<string, unknown>,
    }),
  );

  app.use("/*", serveStatic({ root: STATIC_DIR }));
  app.get("*", serveStatic({ root: STATIC_DIR, path: "index.html" }));

  return app;
}
