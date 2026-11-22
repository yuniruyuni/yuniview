import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

declare module "hono" {
  interface ContextVariableMap {
    usageSubject: string | undefined;
  }
}

export function accessGuard(
  issuer: string,
  audience: string,
  keys: JWTVerifyGetKey,
): MiddlewareHandler {
  return async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) return c.body(null, 403);
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub", "email"],
      });
      if (typeof payload.email !== "string" || !payload.email)
        return c.body(null, 403);
      c.set("usageSubject", payload.sub);
    } catch {
      return c.body(null, 403);
    }
    await next();
    c.header("Cache-Control", "private, no-store");
  };
}
export function adminAccess(): MiddlewareHandler {
  if (process.env.YUNIVIEW_ADMIN_AUTH === "local")
    return async (c, next) => {
      await next();
      c.header("Cache-Control", "private, no-store");
    };
  const team = process.env.CF_ACCESS_TEAM;
  const audience = process.env.CF_ACCESS_AUD;
  if (
    process.env.YUNIVIEW_ADMIN_AUTH !== "cloudflare" ||
    !team ||
    !/^[a-z0-9-]+$/.test(team) ||
    !audience ||
    !/^[a-f\d]{64}$/.test(audience)
  )
    return async (c) => {
      c.header("Cache-Control", "no-store");
      return c.body(null, 403);
    };
  const issuer = `https://${team}.cloudflareaccess.com`;
  return accessGuard(
    issuer,
    audience,
    createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
  );
}
