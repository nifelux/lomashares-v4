import { cors, getEnv, bearer, jsonBody, getUserFromToken, sbHeaders } from "./_utils.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SERVICE, ANON, PAYSTACK } = getEnv();
  if (!SUPABASE_URL || !SERVICE || !ANON) return res.status(500).json({ error: "Missing env vars" });

  const headers = sbHeaders(SERVICE);

  try {
    const body = jsonBody(req);
    const action = String(body.action || "").toLowerCase();

    // User session
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: "Missing auth token" });
    const user = await getUserFromToken(SUPABASE_URL, ANON, token);
    if (!user) return res.status(401).json({ error: "Invalid session" });

    // --------------------------
    // USER: request withdrawal
    // --------------------------
    if (action === "request") {
      const amount = Math.floor(Number(body.amount || 0));
      if (!amount || amount < 500) return res.status(400).json({ error: "Minimum withdrawal is ₦500" });

      // bank payload example {bank_code, account_number, account_name}
      const bank = body.bank || {};
      if (!bank.bank_code || !bank.account_number) return res.status(400).json({ error: "Bank details required" });

      // check wallet
      const wRes = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${user.id}&select=balance&limit=1`, { headers });
      const wRows = await wRes.json();
      const balance = wRows?.[0]?.balance ? Number(wRows[0].balance) : 0;

      if (balance < amount) return res.status(400).json({ error: "Insufficient balance" });

      // Create withdrawal (do NOT debit yet; debit on approve)
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/withdrawals`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ user_id: user.id, amount, status: "pending", bank }),
      });

      const rows = await ins.json();
      if (!ins.ok) return res.status(500).json({ error: "Withdrawal create failed", details: rows });

      // tx log
      await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ user_id: user.id, kind: "withdraw_request", amount, meta: { withdrawal_id: rows?.[0]?.id } }),
      });

      return res.status(200).json({ ok: true, withdrawal: rows?.[0] });
    }

    // --------------------------
    // ADMIN: list pending withdrawals
    // --------------------------
    if (action === "list_pending") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/withdrawals?status=eq.pending&select=id,user_id,amount,bank,created_at&order=created_at.asc`,
        { headers }
      );
      const rows = await r.json();
      if (!r.ok) return res.status(500).json({ error: "Failed", details: rows });
      return res.status(200).json({ withdrawals: rows || [] });
    }

    // --------------------------
    // ADMIN: approve + Paystack transfer (one click)
    // --------------------------
    if (action === "approve") {
      if (!PAYSTACK) return res.status(500).json({ error: "Missing PAYSTACK_SECRET_KEY" });

      const withdrawal_id = String(body.withdrawal_id || "");
      if (!withdrawal_id) return res.status(400).json({ error: "withdrawal_id required" });

      // load withdrawal
      const w = await fetch(`${SUPABASE_URL}/rest/v1/withdrawals?id=eq.${withdrawal_id}&select=id,user_id,amount,status,bank&limit=1`, { headers });
      const wRows = await w.json();
      const wd = wRows?.[0];
      if (!w.ok || !wd) return res.status(400).json({ error: "Withdrawal not found" });
      if (wd.status !== "pending") return res.status(400).json({ error: "Not pending" });

      // Debit wallet now (prevent overdraft)
      const walRes = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${wd.user_id}&select=balance&limit=1`, { headers });
      const walRows = await walRes.json();
      const balance = walRows?.[0]?.balance ? Number(walRows[0].balance) : 0;
      if (balance < Number(wd.amount)) return res.status(400).json({ error: "User balance insufficient" });

      const newBal = balance - Number(wd.amount);
      const walUp = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${wd.user_id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ balance: newBal, updated_at: new Date().toISOString() }),
      });
      if (!walUp.ok) return res.status(500).json({ error: "Failed to debit wallet" });

      // Paystack Transfer requires recipient code (we'll create one-time recipient per withdrawal)
      const bank = wd.bank || {};
      const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "nuban",
          name: bank.account_name || "LomaShares User",
          account_number: bank.account_number,
          bank_code: bank.bank_code,
          currency: "NGN",
        }),
      });
      const recipientData = await recipientRes.json();
      if (!recipientRes.ok || !recipientData.status) {
        return res.status(400).json({ error: "Recipient create failed", raw: recipientData });
      }

      const recipient_code = recipientData.data.recipient_code;

      // initiate transfer
      const transferRes = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(Number(wd.amount) * 100),
          recipient: recipient_code,
          reason: "LomaShares Withdrawal",
        }),
      });

      const transferData = await transferRes.json();
      if (!transferRes.ok || !transferData.status) {
        return res.status(400).json({ error: "Transfer failed", raw: transferData });
      }

      const transfer_code = transferData.data.transfer_code;

      // update withdrawal as paid
      const upWd = await fetch(`${SUPABASE_URL}/rest/v1/withdrawals?id=eq.${withdrawal_id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "paid", paystack_transfer_code: transfer_code, updated_at: new Date().toISOString() }),
      });
      if (!upWd.ok) return res.status(500).json({ error: "Failed to update withdrawal status" });

      // log tx
      await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ user_id: wd.user_id, kind: "withdraw_paid", amount: Number(wd.amount), meta: { withdrawal_id, transfer_code } }),
      });

      return res.status(200).json({ ok: true, withdrawal_id, transfer_code, balance: newBal });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
                                                                      }
