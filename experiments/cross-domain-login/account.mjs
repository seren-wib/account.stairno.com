// Stand-in for account.stairno.com: Better Auth as an OAuth 2.1 / OIDC provider.
// Runs on its own origin so that no cookie it sets is visible to the Labs origin.
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "@better-auth/memory-adapter";
import { memoryDb } from "./memory-db.mjs";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

export const ACCOUNT_ORIGIN = "http://127.0.0.1:4101";
// Stand-in identifier for api.stairno.com. Access tokens are opaque unless a resource (RFC 8707) is requested;
// with one they become JWTs whose audience is that resource, which is what the API will verify.
export const API_RESOURCE = "http://127.0.0.1:4103";

export async function createAccount() {
  const options = {
    baseURL: ACCOUNT_ORIGIN,
    basePath: "/api/auth",
    secret: "experiment-only-secret-for-the-account-server-0123456789",
    emailAndPassword: { enabled: true },
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resources: [API_RESOURCE],
        enforcePerClientResources: false,
      }),
    ],
  };
  const db = memoryDb(options);
  const auth = betterAuth({ ...options, database: memoryAdapter(db) });

  const app = new Hono();
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
  // The pages a real account center would render. Here they only prove where the redirect lands.
  app.get("/sign-in", (c) => c.text(`sign-in page, query: ${c.req.url.split("?")[1] ?? ""}`));
  app.get("/consent", (c) => c.text("consent page"));

  const server = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 4101, hostname: "127.0.0.1" }, () => resolve(s));
  });
  return { auth, db, close: () => server.close() };
}
