import { cors, getEnv, bearer, jsonBody, getUserFromToken, sbHeaders } from "./_utils.js";

function randCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "LSG-";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SERVICE, ANON } = getEnv();
  if (!SUPABASE_URL || !SERVICE || !ANON) return res.status(500).json({ error: "Missing env vars" });

  try {
    const body = jsonBody(req);
    const action = String(body.action || "").toLowerCase();
    const headers = sbHeaders(SERVICE);

    // ----- ADMIN: generate gift code -----
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

    // ----- USER: redeem gift code -----
if (action === "redeem") {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(SUPABASE_URL, ANON, token);
  if (!user) return res.status(401).json({ error: "Invalid session" });

  const code = String(body.code || "").trim();
  if (!code) return res.status(400).json({ error: "Code required" });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_gift_code`, {
    method: "POST",
    headers: sbHeaders(SERVICE),
    body: JSON.stringify({ p_user_id: user.id, p_code: code }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(500).json({ error: "Redeem failed", details: j });

  if (!j.ok) return res.status(400).json({ error: j.error || "Invalid or already used code" });

  return res.status(200).json({ ok: true, amount: j.amount });
        }
      
      
      // credit wallet
      const wRes = await fetch(
        `${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${encodeURIComponent(user.id)}&select=id,balance&limit=1`,
        { headers }
      );

      const wRows = await wRes.json();
      if (!wRes.ok || !wRows?.length) return res.status(500).json({ error: "Wallet fetch failed" });

      const wallet = wRows[0];
      const current = Number(wallet.balance || 0);
      const newBalance = current + amount;

      const wUp = await fetch(`${SUPABASE_URL}/rest/v1/wallets?id=eq.${wallet.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ balance: newBalance }),
      });

      const wUpJson = await wUp.json().catch(() => ({}));
      if (!wUp.ok) return res.status(500).json({ error: "Wallet credit failed", details: wUpJson });

      // transaction (use columns you showed earlier: type, amount, status)
      await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: user.id,
          type: "gift",
          amount,
          status: "success",
        }),
      }).catch(() => {});

      return res.status(200).json({ ok: true, amount, balance: newBalance });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
        }
