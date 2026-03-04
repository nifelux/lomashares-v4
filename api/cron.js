import { cors, getEnv, sbHeaders, todayWATDateString } from "./_utils.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // Secure this endpoint with a simple secret if you want later.
  // For now: allow GET.
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SERVICE } = getEnv();
  if (!SUPABASE_URL || !SERVICE) return res.status(500).json({ error: "Missing env vars" });

  try {
    const headers = sbHeaders(SERVICE);
    const today = todayWATDateString();

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_pay_daily_for_all`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_today: today }),
    });

    const rpcData = await rpcRes.json();
    if (!rpcRes.ok) return res.status(500).json({ error: "Cron RPC failed", details: rpcData });

    return res.status(200).json(rpcData);
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
