import { expect, test } from "bun:test";
import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { accessGuard } from "./admin-access";

test("admin accepts only an unexpired signed user token for this application", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const app = new Hono();
  app.use(
    "*",
    accessGuard("https://issuer", "yuniview", async () => publicKey),
  );
  app.get("*", (c) => c.text("private"));
  const issue = (aud: string, exp: string) =>
    new SignJWT({ email: "owner@example.test" })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("owner")
      .setIssuer("https://issuer")
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  for (const path of ["/", "/api/trpc/library", "/index.js"]) {
    expect(
      (
        await app.request(path, {
          headers: {
            "Cf-Access-Authenticated-User-Email": "owner@example.test",
          },
        })
      ).status,
    ).toBe(403);
    for (const [aud, exp, code] of [
      ["other", "1h", 403],
      ["yuniview", "-1h", 403],
      ["yuniview", "1h", 200],
    ] as const) {
      const token = await issue(aud, exp);
      const r = await app.request(path, {
        headers: { "Cf-Access-Jwt-Assertion": token },
      });
      expect(r.status).toBe(code);
      expect(r.headers.get("Cache-Control")).toContain("no-store");
    }
  }
});
