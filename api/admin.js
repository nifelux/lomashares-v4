import { cors, getEnv, sbHeaders } from "./_utils.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SERVICE } = getEnv();
  if (!SUPABASE_URL || !SERVICE) return res.status(500).json({ error: "Missing env vars" });

  const headers = sbHeaders(SERVICE);

  try {
    // total deposits
    const dRes = await fetch(`${SUPABASE_URL}/rest/v1/deposits?select=amount`, { headers });
    const dRows = await dRes.json();
    const totalDeposits = (Array.isArray(dRows) ? dRows : []).reduce((s, r) => s + Number(r.amount || 0), 0);

    // total withdrawals paid
    const wRes = await fetch(`${SUPABASE_URL}/rest/v1/withdrawals?status=eq.paid&select=amount`, { headers });
    const wRows = await wRes.json();
    const totalWithdrawals = (Array.isArray(wRows) ? wRows : []).reduce((s, r) => s + Number(r.amount || 0), 0);

    return res.status(200).json({ ok: true, totalDeposits, totalWithdrawals });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
