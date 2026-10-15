import "dotenv/config";

/**
 * Exchanges a short-lived user token (from Graph API Explorer) for a
 * long-lived page token with inherited Instagram scopes.
 *
 * Usage:
 *   1. Go to https://developers.facebook.com/tools/explorer/
 *   2. Select app "Abby"
 *   3. "User or Page" → select "User Token"
 *   4. Click "Generate Access Token" with these permissions:
 *      instagram_basic, instagram_content_publish,
 *      instagram_manage_comments, instagram_manage_insights,
 *      pages_show_list, pages_manage_posts, pages_read_engagement,
 *      pages_manage_engagement, business_management
 *   5. Copy the token
 *   6. Run: npx tsx scripts/exchange-meta-token.ts <user_token> [brand]
 */

async function main() {
  const userToken = process.argv[2];
  const brand = (process.argv[3] ?? "ds").toLowerCase();
  const GRAPH_API_VERSION = "v21.0";
  const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
  const APP_ID = process.env.DS_META_APP_ID ?? process.env.META_APP_ID ?? "";
  const APP_SECRET = process.env.DS_META_APP_SECRET ?? process.env.META_APP_SECRET ?? "";

  if (!userToken) {
    console.error("Usage: npx tsx scripts/exchange-meta-token.ts <user_token> [ds|ns]");
    console.error("Get the user token from https://developers.facebook.com/tools/explorer/");
    process.exit(1);
  }
  if (!APP_SECRET) {
    console.error("Missing DS_META_APP_SECRET (or META_APP_SECRET) in .env");
    process.exit(1);
  }
  if (!APP_ID) {
    console.error("Missing DS_META_APP_ID (or META_APP_ID) in .env");
    process.exit(1);
  }

  const brandPrefix = brand.toUpperCase();
  const targetPageId = process.env[`${brandPrefix}_META_PAGE_ID`] ?? "";
  console.log(`Brand: ${brand}  Target Page ID: ${targetPageId}\n`);

  // Step 1: Exchange short-lived user token for long-lived user token
  console.log("Step 1 — Exchanging for long-lived user token...");
  const llRes = await fetch(
    `${BASE_URL}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: APP_ID,
      client_secret: APP_SECRET,
      fb_exchange_token: userToken,
    })
  );
  if (!llRes.ok) {
    console.error(`Failed: ${llRes.status} ${await llRes.text()}`);
    process.exit(1);
  }
  const llData = await llRes.json() as { access_token: string };
  const longLivedUserToken = llData.access_token;
  console.log("  OK — long-lived user token obtained.\n");

  // Step 2: Get pages with page tokens and IG business accounts
  console.log("Step 2 — Fetching pages...");
  const pagesRes = await fetch(
    `${BASE_URL}/me/accounts?fields=id,name,access_token,instagram_business_account{username}&access_token=${longLivedUserToken}`
  );
  if (!pagesRes.ok) {
    console.error(`Failed: ${pagesRes.status} ${await pagesRes.text()}`);
    process.exit(1);
  }
  const pagesData = await pagesRes.json() as {
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string; username?: string };
    }>;
  };

  const page = targetPageId
    ? pagesData.data.find((p) => p.id === targetPageId)
    : pagesData.data[0];

  if (!page) {
    console.error(`Page ${targetPageId} not found. Available pages:`);
    for (const p of pagesData.data) {
      console.error(`  ${p.id} — ${p.name}  IG: ${p.instagram_business_account?.username ?? "none"}`);
    }
    process.exit(1);
  }

  console.log(`  Found: ${page.name} (${page.id})`);
  console.log(`  IG: ${page.instagram_business_account ? `@${page.instagram_business_account.username ?? page.instagram_business_account.id}` : "NOT LINKED"}\n`);

  // Step 3: Verify the page token's scopes
  console.log("Step 3 — Verifying page token scopes...");
  const debugRes = await fetch(
    `${BASE_URL}/debug_token?input_token=${page.access_token}&access_token=${page.access_token}`
  );
  const debugData = await debugRes.json() as any;
  const scopes: string[] = debugData.data?.scopes ?? [];
  const igScopes = scopes.filter((s) => s.startsWith("instagram"));

  console.log(`  Instagram scopes: ${igScopes.length ? igScopes.join(", ") : "NONE"}`);
  console.log(`  All scopes: ${scopes.join(", ")}\n`);

  // Step 4: Output the result
  const envVar = `${brandPrefix}_META_PAGE_TOKEN`;
  console.log("=== RESULT ===\n");
  if (igScopes.length > 0) {
    console.log(`✅ Page token has Instagram scopes!`);
  } else {
    console.log(`⚠️  Page token does NOT have Instagram scopes.`);
    console.log(`   Make sure you selected all Instagram permissions in the Graph API Explorer.`);
  }
  console.log(`\nAdd to .env:\n${envVar}=${page.access_token}\n`);

  if (!page.instagram_business_account) {
    console.log("⚠️  Instagram is NOT linked to this page.");
    console.log("   Go to Meta Business Suite → Settings → Instagram → Connect Account");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
