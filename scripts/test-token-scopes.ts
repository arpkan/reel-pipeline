import "dotenv/config";

async function main() {
  const GRAPH_API_VERSION = "v21.0";
  const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

  for (const [label, tokenEnv] of [["DS", "DS_META_PAGE_TOKEN"], ["NS", "NS_META_PAGE_TOKEN"]] as const) {
    const token = process.env[tokenEnv] ?? "";
    if (!token) { console.log(`${label}: no token\n`); continue; }

    const res = await fetch(`${BASE_URL}/debug_token?input_token=${token}&access_token=${token}`);
    const data = await res.json() as any;
    const scopes: string[] = data.data?.scopes ?? [];
    const igScopes = scopes.filter(s => s.startsWith("instagram"));
    console.log(`${label} token (app: ${data.data?.application}):`);
    console.log(`  type: ${data.data?.type}`);
    console.log(`  valid: ${data.data?.is_valid}`);
    console.log(`  expires: ${data.data?.expires_at ? new Date(data.data.expires_at * 1000).toISOString() : "never"}`);
    console.log(`  instagram scopes: ${igScopes.length ? igScopes.join(", ") : "NONE"}`);
    console.log(`  all scopes: ${scopes.join(", ")}`);
    console.log("");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
