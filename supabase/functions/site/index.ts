// VERIFY — site: la predizione che appare sul sito web del mago.
// POST { pin, profile, action:"arm", text:"il 7 di Picche" }  → memorizza la rivelazione
// POST { pin, profile, action:"clear" }                        → azzera (dopo lo show)
// GET  ?profile=dash                                           → { reveal, ts } (pubblico, letto dalla pagina)

const env = (k: string) => Deno.env.get(k) ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
const H = () => ({
  apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
  Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
  "Content-Type": "application/json",
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);

    // ---- GET pubblico: la pagina sul sito legge qui ----
    // La rivelazione è visibile SOLO nella finestra dopo l'arma (default 3 min):
    // fuori dalla finestra il sito è normale, così non appare a tutti né al prossimo spettatore.
    if (req.method === "GET") {
      const prof = (url.searchParams.get("profile") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/verify_config?profile=eq.${prof}&select=data`, { headers: H() });
      const rows = await r.json();
      const d = rows[0]?.data ?? {};
      const active = d.site_exp && Date.now() < Number(d.site_exp);
      return json(active
        ? { reveal: d.site_reveal ?? "", card: d.site_card ?? "", lang: d.site_lang ?? "en", ts: d.site_ts ?? "", mode: d.site_mode ?? "eye" }
        : { reveal: "", card: "", lang: "en", ts: "", mode: "" });
    }

    // ---- POST: arma/azzera (protetto da PIN) ----
    const body = await req.json();
    if (body.pin !== env("ADMIN_PIN")) return json({ error: "PIN errato" }, 403);
    const prof = String(body.profile ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const r0 = await fetch(`${env("SUPABASE_URL")}/rest/v1/verify_config?profile=eq.${prof}&select=data`, { headers: H() });
    const rows = await r0.json();
    const data = rows[0]?.data ?? {};

    if (body.action === "clear") {
      data.site_reveal = "";
      data.site_card = "";
      data.site_ts = "";
      data.site_exp = 0;
    } else {
      data.site_reveal = String(body.text ?? "").slice(0, 200);
      data.site_card = String(body.card ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
      data.site_lang = String(body.lang ?? "en").slice(0, 2);
      data.site_mode = String(body.mode ?? "eye").slice(0, 12);
      data.site_ts = body.ts ?? "";
      const ttl = Number(body.ttl ?? 180) * 1000; // finestra in secondi (default 180)
      data.site_exp = Date.now() + ttl;
    }
    const r1 = await fetch(`${env("SUPABASE_URL")}/rest/v1/verify_config`, {
      method: "POST",
      headers: { ...H(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ profile: prof, data, updated_at: new Date().toISOString() }),
    });
    if (!r1.ok) throw new Error(await r1.text());
    return json({ ok: true, reveal: data.site_reveal });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
