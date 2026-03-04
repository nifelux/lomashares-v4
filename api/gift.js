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
      // simple admin gate (email list) optional later
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

      const code = String(body.code || "").trim().toUpperCase();
      if (!code) return res.status(400).json({ error: "Code required" });

      // fetch gift
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gift_codes?code=eq.${encodeURIComponent(code)}&select=code,amount,redeemed`, { headers });
      const rows = await r.json();
      if (!r.ok) return res.status(500).json({ error: "Gift fetch failed", details: rows });

      const gift = rows?.[0];
      if (!gift) return res.status(400).json({ error: "Invalid code" });
      if (gift.redeemed) return res.status(400).json({ error: "Code already used" });

      const amount = Number(gift.amount);

      // mark redeemed (idempotent-ish)
      const up = await fetch(`${SUPABASE_URL}/rest/v1/gift_codes?code=eq.${encodeURIComponent(code)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ redeemed: true, redeemed_by: user.id, redeemed_at: new Date().toISOString() }),
      });
      if (!up.ok) return res.status(500).json({ error: "Failed to redeem code" });

      // credit wallet
      const wRes = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${user.id}&select=balance&limit=1`, { headers });
      const wRows = await wRes.json();
      const current = wRows?.[0]?.balance ? Number(wRows[0].balance) : 0;
      const newBalance = current + amount;

      const wUp = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${user.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ balance: newBalance, updated_at: new Date().toISOString() }),
      });
      if (!wUp.ok) return res.status(500).json({ error: "Wallet credit failed" });

      // transaction
      await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ user_id: user.id, kind: "gift_redeem", amount, meta: { code } }),
      });

      return res.status(200).json({ ok: true, amount, balance: newBalance });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
                          }
