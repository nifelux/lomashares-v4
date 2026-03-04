import {
  cors, getEnv, bearer, jsonBody, getUserFromToken, sbHeaders, todayWATDateString
} from "./_utils.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SERVICE, ANON } = getEnv();
  if (!SUPABASE_URL || !SERVICE || !ANON) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  try {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const user = await getUserFromToken(SUPABASE_URL, ANON, token);
    if (!user) return res.status(401).json({ error: "Invalid session" });

    const headers = sbHeaders(SERVICE);

    // ----------------------------
    // GET: list investments
    // ----------------------------
    if (req.method === "GET") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/investments?user_id=eq.${user.id}&select=id,product_id,amount,daily_income,days_paid,days_total,status,start_at,last_paid_date,created_at&order=created_at.desc`,
        { headers }
      );
      const rows = await r.json();
      if (!r.ok) return res.status(500).json({ error: "Failed to load investments", details: rows });

      return res.status(200).json({ investments: Array.isArray(rows) ? rows : [] });
    }

    // ----------------------------
    // POST: actions
    // ----------------------------
    const body = jsonBody(req);
    const action = String(body.action || "create").toLowerCase();

    // Sync daily income (catch-up) for this user
    if (action === "sync") {
      const today = todayWATDateString();
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_pay_daily_for_user`, {
        method: "POST",
        headers,
        body: JSON.stringify({ p_user_id: user.id, p_today: today }),
      });
      const rpcData = await rpcRes.json();
      if (!rpcRes.ok) return res.status(500).json({ error: "Sync failed", details: rpcData });

      return res.status(200).json(rpcData);
    }

    // Create investment
    const product_id = Number(body.product_id);
    if (!product_id || product_id < 1 || product_id > 10) {
      return res.status(400).json({ error: "Invalid product_id" });
    }

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_create_investment`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_user_id: user.id, p_product_id: product_id }),
    });

    const rpcData = await rpcRes.json();
    if (!rpcRes.ok) return res.status(500).json({ error: "Investment RPC failed", details: rpcData });
    if (!rpcData?.ok) return res.status(400).json({ error: rpcData?.error || "Investment failed" });

    return res.status(200).json(rpcData);
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
      }
