import { cors, getEnv, bearer, jsonBody, getUserFromToken, sbHeaders } from "./_utils.js";

function randCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "LOMA-GIFT-";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SERVICE, ANON } = getEnv();
  if (!SUPABASE_URL || !SERVICE || !ANON) return res.status(500).json({
    error: "Missing env vars",
    needs: ["SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  });

  try {
    const body = jsonBody(req);
    const action = String(body.action || "").toLowerCase();
    const headers = sbHeaders(SERVICE);

    // ADMIN: generate
    if (action === "generate") {
      const amount = Number(body.amount || 0);
      if (!amount || amount < 1) return res.status(400).json({ error: "Invalid amount" });

      const code = randCode();
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/gift_codes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ code, amount, redeemed: false }),
      });
      const j = await ins.json().catch(() => ({}));
      if (!ins.ok) return res.status(500).json({ error: "Gift insert failed", details: j });

      return res.status(200).json({ ok: true, code, amount });
    }

    // USER: redeem (RPC)
    if (action === "redeem") {
      const token = bearer(req);
      if (!token) return res.status(401).json({ error: "Missing auth token" });

      const user = await getUserFromToken(SUPABASE_URL, ANON, token);
      if (!user) return res.status(401).json({ error: "Invalid session" });

      const code = String(body.code || "").trim().toUpperCase();
      if (!code) return res.status(400).json({ error: "Code required" });

      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_gift_code`, {
        method: "POST",
        headers,
        body: JSON.stringify({ p_user_id: user.id, p_code: code }),
      });

      const out = await rpc.json().catch(() => ({}));
      if (!rpc.ok) return res.status(500).json({ error: "Gift redeem RPC failed", details: out });

      if (!out?.ok) return res.status(400).json({ error: out?.error || "Invalid or already used code" });

      return res.status(200).json({ ok: true, amount: out.amount });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
                                                         }
