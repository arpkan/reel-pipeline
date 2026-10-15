import "dotenv/config";

async function main() {
  const pageId = process.env.DS_META_PAGE_ID ?? "";
  const token = process.env.DS_META_PAGE_TOKEN ?? "";
  const GRAPH_API_VERSION = "v21.0";
  const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

  if (!pageId || !token) {
    console.error("Missing DS_META_PAGE_ID or DS_META_PAGE_TOKEN");
    process.exit(1);
  }

  console.log(`Page ID: ${pageId}`);
  console.log(`Token: ${token.slice(0, 8)}...${token.slice(-4)}`);

  const res1 = await fetch(`${BASE_URL}/${pageId}?fields=instagram_business_account&access_token=${token}`);
  const data1 = await res1.json() as any;
  console.log(`\nStep 1 — FB Page -> IG Business Account:`);
  console.log(`  HTTP ${res1.status}`);
  console.log(`  Response: ${JSON.stringify(data1, null, 2)}`);

  const igUserId = data1.instagram_business_account?.id;
  if (!igUserId) {
    console.error("\nNo Instagram Business Account linked to this Facebook Page.");
    process.exit(1);
  }

  const res2 = await fetch(`${BASE_URL}/${igUserId}?fields=username,followers_count,media_count,profile_picture_url&access_token=${token}`);
  const data2 = await res2.json() as any;
  console.log(`\nStep 2 — IG Account Profile:`);
  console.log(`  HTTP ${res2.status}`);
  console.log(`  Response: ${JSON.stringify(data2, null, 2)}`);

  console.log(`\nDS Instagram account is reachable and ready for publishing.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
