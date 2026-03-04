import { cors, getEnv, jsonBody, sbHeaders } from "./_utils.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { SUPABASE_URL, SERVICE } = getEnv();
  if (!SUPABASE_URL || !SERVICE) return res.status(500).json({ error: "Missing env vars" });

  try {
    const body = jsonBody(req);
    const action = String(body.action || "").toLowerCase();
    const code = String(body.code || "").trim().toUpperCase();

    if (action !== "validate") return res.status(400).json({ error: "Use action=validate" });

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
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
                                                          }
