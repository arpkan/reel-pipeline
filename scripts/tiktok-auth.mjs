#!/usr/bin/env node
/**
 * TikTok OAuth token acquisition — run this on your LOCAL machine.
 *
 * Usage:
 *   node scripts/tiktok-auth.mjs ds
 *   node scripts/tiktok-auth.mjs ns
 *
 * Requires Node.js 18+. No dependencies.
 * Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET as env vars or edit below.
 */

import http from "http";
import { randomBytes, createHash } from "crypto";
import { URL, URLSearchParams } from "url";

const brand     = process.argv[2] ?? "ds";
const PORT      = 3100;
const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY    ?? "sbaw06vq9yl8d4tvzb";
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET ?? "MXafEylN379Idocg1I9Uz9BdnCcLwhzT";
const REDIRECT_URI  = `http://localhost:${PORT}/auth/tiktok/callback`;

// Generate PKCE pair (S256)
const codeVerifier  = randomBytes(32).toString("base64url");
const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
console.log(`[tiktok-auth] code_verifier:  ${codeVerifier}`);
console.log(`[tiktok-auth] code_challenge: ${codeChallenge}`);

// Build TikTok authorize URL
const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize");
authUrl.searchParams.set("client_key",            CLIENT_KEY);
authUrl.searchParams.set("scope",                 "video.publish");
authUrl.searchParams.set("response_type",         "code");
authUrl.searchParams.set("redirect_uri",          REDIRECT_URI);
authUrl.searchParams.set("state",                 brand);
authUrl.searchParams.set("code_challenge",        codeChallenge);
authUrl.searchParams.set("code_challenge_method", "S256");

console.log(`\n[tiktok-auth] Starting OAuth flow for brand: ${brand}`);
console.log(`[tiktok-auth] Listening on http://localhost:${PORT}`);
console.log(`\n👉 Open this URL in your browser (logged in as ${brand.toUpperCase()} TikTok account):\n`);
console.log(authUrl.toString());
console.log();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (!url.pathname.startsWith("/auth/tiktok/callback")) {
    res.writeHead(404); res.end(); return;
  }

  const code  = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(`TikTok auth error: ${error ?? "no code"}`);
    server.close();
    return;
  }

  console.log("[tiktok-auth] Received callback, exchanging code for token...");

  try {
    const resp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key:    CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code,
        grant_type:    "authorization_code",
        redirect_uri:  REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    const raw = await resp.json();
    const token = raw.data ?? raw;

    const envVar = brand === "ns" ? "NS_TIKTOK_ACCESS_TOKEN" : "DS_TIKTOK_ACCESS_TOKEN";

    const html = `<html><body><pre style="font-family:monospace;font-size:14px">
Brand:         ${brand}
Access token:  ${token.access_token}
Refresh token: ${token.refresh_token}
Expires in:    ${token.expires_in}s

Add to server .env:
${envVar}=${token.access_token}

Full response:
${JSON.stringify(raw, null, 2)}
</pre></body></html>`;

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);

    console.log(`\n✅ Success!`);
    console.log(`\nAdd to server .env:\n${envVar}=${token.access_token}\n`);
    console.log(`Full response: ${JSON.stringify(raw, null, 2)}`);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`Token exchange failed: ${err.message}`);
    console.error("[tiktok-auth] Token exchange failed:", err);
  }

  server.close();
});

server.listen(PORT);
