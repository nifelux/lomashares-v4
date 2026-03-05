export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function getEnv() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const PAYSTACK = process.env.PAYSTACK_SECRET_KEY;

  return { SUPABASE_URL, SERVICE, ANON, PAYSTACK };
}

export async function getUserFromToken(SUPABASE_URL, ANON, token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  const data = await r.json();
  if (!r.ok || !data?.id) return null;
  return data;
}

export function bearer(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export function jsonBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

export function sbHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export function todayWATDateString() {
  // WAT = UTC+1 => add 1 hour to UTC, then take YYYY-MM-DD
  const now = new Date();
  const wat = new Date(now.getTime() + 60 * 60 * 1000);
  return wat.toISOString().slice(0, 10);
}

export async function requireUser(req, SUPABASE_URL, ANON_KEY) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });

  const user = await uRes.json();
  if (!uRes.ok || !user?.id) return null;
  return user;
                                                        }
