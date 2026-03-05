import { cors, getEnv, jsonBody, sbHeaders, requireUser } from "./_utils.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SERVICE, ANON } = getEnv();
  if (!SUPABASE_URL || !SERVICE || !ANON) {
    return res.status(500).json({
      error: "Missing env vars",
      needs: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    });
  }

  try {
    const body = jsonBody(req);
    const action = String(body.action || "").toLowerCase();

    // -----------------------------
    // action: validate  (existing)
    // -----------------------------
    if (action === "validate") {
      const code = String(body.code || "").trim().toUpperCase();

      if (!code) return res.status(200).json({ valid: true }); // optional field
      if (!/^LOMA\d{6}$/.test(code)) return res.status(200).json({ valid: false });

      const headers = sbHeaders(SERVICE);

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?referral_code=eq.${encodeURIComponent(code)}&select=id&limit=1`,
        { headers }
      );

      const rows = await r.json();
      if (!r.ok) return res.status(500).json({ error: "Referral query failed", details: rows });

      if (!rows?.length) return res.status(200).json({ valid: false });
      return res.status(200).json({ valid: true, referrer_id: rows[0].id });
    }

    // For anything below, we need the logged-in user (Bearer token)
    const user = await requireUser(req, SUPABASE_URL, ANON);
    if (!user?.id) return res.status(401).json({ error: "Invalid session" });

    // -----------------------------
    // action: my_code  (NEW)
    // -----------------------------
    if (action === "my_code") {
      const headers = sbHeaders(SERVICE);

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=referral_code,email&limit=1`,
        { headers }
      );

      const rows = await r.json();
      if (!r.ok) return res.status(500).json({ error: "Profile query failed", details: rows });

      const referral_code = rows?.[0]?.referral_code || null;
      return res.status(200).json({
        user_id: user.id,
        email: rows?.[0]?.email || user.email || null,
        referral_code,
      });
    }

    // -----------------------------
    // action: stats  (optional but useful)
    // -----------------------------
    if (action === "stats") {
      const headers = sbHeaders(SERVICE);

      // count referrals where referrer_id = me
      const r1 = await fetch(
        `${SUPABASE_URL}/rest/v1/referrals?referrer_id=eq.${encodeURIComponent(user.id)}&select=id`,
        { headers }
      );
      const refs = await r1.json();
      if (!r1.ok) return res.status(500).json({ error: "Referrals query failed", details: refs });

      // sum referral bonus from transactions (if you record it)
      // adjust type string to whatever you use: "referral_bonus" / "Referral Bonus"
      const r2 = await fetch(
        `${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${encodeURIComponent(user.id)}&type=eq.referral_bonus&select=amount`,
        { headers }
      );
      const txs = await r2.json();
      // If you don't store referral_bonus in transactions, you can remove this block.
      const total_bonus = Array.isArray(txs)
        ? txs.reduce((s, t) => s + Number(t.amount || 0), 0)
        : 0;

      return res.status(200).json({
        referrals_count: Array.isArray(refs) ? refs.length : 0,
        total_bonus,
      });
    }

    return res.status(400).json({ error: "Invalid action", allowed: ["validate", "my_code", "stats"] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
