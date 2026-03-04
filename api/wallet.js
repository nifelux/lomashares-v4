import { cors, getEnv, bearer, jsonBody, getUserFromToken, sbHeaders } from "./_utils.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SERVICE, ANON, PAYSTACK } = getEnv();
  if (!SUPABASE_URL || !SERVICE || !ANON) {
    return res.status(500).json({ error: "Missing env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY)" });
  }

  try {
    const body = jsonBody(req);
    const action = String(body.action || "").toLowerCase();

    // Auth required for all wallet calls
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const user = await getUserFromToken(SUPABASE_URL, ANON, token);
    if (!user) return res.status(401).json({ error: "Invalid session" });

    const headers = sbHeaders(SERVICE);

    // ---- GET BALANCE ----
    if (action === "get") {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${user.id}&select=balance&limit=1`, { headers });
      const rows = await r.json();
      if (!r.ok) return res.status(500).json({ error: "Failed to load wallet", details: rows });
      const balance = rows?.[0]?.balance ? Number(rows[0].balance) : 0;
      return res.status(200).json({ balance });
    }

    // ---- PAYSTACK INIT (redirect flow) ----
    if (action === "paystack_init") {
      if (!PAYSTACK) return res.status(500).json({ error: "Missing PAYSTACK_SECRET_KEY" });

      const amount = Number(body.amount || 0);
      const callback_url = String(body.callback_url || "");
      if (!amount || amount < 1000) return res.status(400).json({ error: "Minimum deposit is ₦1000" });
      if (!callback_url) return res.status(400).json({ error: "callback_url required" });

      const ref = `LS_${user.id}_${Date.now()}`;

      const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: user.email,
          amount: Math.round(amount * 100),
          reference: ref,
          callback_url,
          metadata: { user_id: user.id, purpose: "wallet_deposit" },
        }),
      });

      const initData = await initRes.json();
      if (!initRes.ok || !initData.status) {
        return res.status(400).json({ error: initData.message || "Paystack init failed", raw: initData });
      }

      return res.status(200).json({
        authorization_url: initData.data.authorization_url,
        reference: initData.data.reference,
      });
    }

    // ---- PAYSTACK VERIFY + CREDIT (idempotent using deposits table) ----
    if (action === "paystack_verify") {
      if (!PAYSTACK) return res.status(500).json({ error: "Missing PAYSTACK_SECRET_KEY" });

      const reference = String(body.reference || "");
      if (!reference) return res.status(400).json({ error: "reference required" });

      const vRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${PAYSTACK}` },
      });
      const vData = await vRes.json();

      if (!vRes.ok || !vData.status) {
        return res.status(400).json({ error: vData.message || "Verification failed", raw: vData });
      }

      const tx = vData.data;
      if (tx.status !== "success") return res.status(400).json({ error: "Payment not successful" });
      if (tx.currency !== "NGN") return res.status(400).json({ error: "Currency mismatch" });

      const paid = Math.floor(Number(tx.amount) / 100); // whole naira

      // Insert deposit reference (idempotency)
      const depIns = await fetch(`${SUPABASE_URL}/rest/v1/deposits`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({
          reference,
          user_id: user.id,
          amount: paid,
          status: "credited",
          channel: tx.channel || null,
        }),
      });

      if (!depIns.ok) {
        // Already credited (duplicate reference)
        return res.status(200).json({ ok: true, already_credited: true, reference });
      }

      // Credit wallet
      const wRes = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${user.id}&select=balance&limit=1`, { headers });
      const wRows = await wRes.json();
      const current = wRows?.[0]?.balance ? Number(wRows[0].balance) : 0;
      const newBalance = current + paid;

      // Update wallet
      const upRes = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${user.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ balance: newBalance, updated_at: new Date().toISOString() }),
      });
      if (!upRes.ok) return res.status(500).json({ error: "Wallet update failed" });

      // Log transaction
      await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: user.id,
          kind: "deposit",
          amount: paid,
          meta: { reference },
        }),
      });

      return res.status(200).json({ ok: true, reference, paid, balance: newBalance });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
      }
