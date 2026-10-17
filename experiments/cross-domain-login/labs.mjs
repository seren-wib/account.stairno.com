// Stand-in for stairnolabs.com: a second Better Auth instance on a different origin.
// It owns its own session cookie and only trusts the account server as an OIDC provider.
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { memoryAdapter } from "@better-auth/memory-adapter";
import { memoryDb } from "./memory-db.mjs";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { ACCOUNT_ORIGIN, API_RESOURCE } from "./account.mjs";

export const LABS_ORIGIN = "http://localhost:4102";
export const PROVIDER_ID = "stairno";
export const LABS_CALLBACK = `${LABS_ORIGIN}/api/auth/callback/${PROVIDER_ID}`;

export async function createLabs({ clientId, clientSecret }) {
  const options = {
    baseURL: LABS_ORIGIN,
    basePath: "/api/auth",
    secret: "experiment-only-secret-for-the-labs-server-0123456789",
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: PROVIDER_ID,
            clientId,
            clientSecret,
            discoveryUrl: `${ACCOUNT_ORIGIN}/api/auth/.well-known/openid-configuration`,
            // offline_access is what makes the account server hand out a refresh token.
            scopes: ["openid", "profile", "email", "offline_access"],
            pkce: true,
            // Ask for an access token aimed at the shared API (RFC 8707 resource indicator).
            authorizationUrlParams: { resource: API_RESOURCE },
            tokenUrlParams: { resource: API_RESOURCE },
          },
        ],
      }),
    ],
  };
  const db = memoryDb(options);
  const auth = betterAuth({ ...options, database: memoryAdapter(db) });

  const app = new Hono();
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
  app.get("/me", (c) => c.text("labs page after login"));

  const server = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 4102, hostname: "localhost" }, () => resolve(s));
  });
  return { auth, db, close: () => server.close() };
}
